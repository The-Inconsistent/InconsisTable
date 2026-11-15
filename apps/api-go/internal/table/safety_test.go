package table

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Session Zero (docs/p2-plan.md group E): lines, veils and the anonymous X-Card.

func safetyOf(p *play) cs.Safety {
	var s cs.Safety
	if err := p.tx.QueryRow(context.Background(), `SELECT safety FROM campaign WHERE id = $1`, p.room.ID).Scan(&s); err != nil {
		p.t.Fatal(err)
	}
	return s
}

func TestSafetyListsAreSetByTheGMAndSuggestedByPlayersWithNoAuthor(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.send(p.room.GM(), map[string]any{"type": "campaign.setSafety", "lines": []any{" Line one "}, "veils": []any{}, "xCard": true})
		p.refused(player, map[string]any{"type": "campaign.setSafety", "lines": []any{}, "veils": []any{}, "xCard": false}, "noPermission")
		p.refused(p.room.GM(), map[string]any{"type": "safety.suggest", "kind": "veil", "text": "x"}, "noPermission") // players only
		p.send(player, map[string]any{"type": "safety.suggest", "kind": "veil", "text": "Veil one"})
		if s := safetyOf(p); len(s.Lines) != 1 || s.Lines[0] != "Line one" || len(s.Veils) != 1 || s.Veils[0] != "Veil one" || !s.XCard {
			t.Fatalf("safety %+v", s)
		}
		// Nothing stored says who: the whole document is two lists of text and a switch, and no event was logged.
		raw := dbtest.Scalar[string](t, tx, `SELECT safety::text FROM campaign WHERE id = $1`, p.room.ID)
		if strings.Contains(raw, *player.UserID) || strings.Contains(raw, p.room.Owner) {
			t.Fatalf("the document names a user: %s", raw)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1`, p.room.ID); n != 0 {
			t.Fatalf("%d session events", n)
		}
	})
}

func TestASafetyListStopsAtThirty(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		for range cs.MaxSafetyItems {
			p.send(player, map[string]any{"type": "safety.suggest", "kind": "line", "text": "a"})
		}
		p.refused(player, map[string]any{"type": "safety.suggest", "kind": "line", "text": "a"}, "safetyListFull")
		p.send(player, map[string]any{"type": "safety.suggest", "kind": "veil", "text": "a"}) // the other list is its own
	})
}

func TestSetSafetyRefusesALongListOrLine(t *testing.T) {
	for _, bad := range []map[string]any{
		{"lines": make([]any, 31), "veils": []any{}},
		{"lines": []any{strings.Repeat("a", 81)}, "veils": []any{}},
		{"lines": []any{" "}, "veils": []any{}},
	} {
		bad["type"], bad["xCard"] = "campaign.setSafety", true
		if _, issues := cs.ParseAction(bad); len(issues) == 0 {
			t.Fatalf("%v parsed", bad)
		}
	}
}

func TestTheXCardWritesNothingAndIsRefusedWhenOff(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		before := safetyOf(p)
		rows := func(table string) int { return dbtest.Scalar[int](t, tx, `SELECT count(*) FROM `+table) }
		events, admin := rows("session_event"), rows("admin_event")
		r := p.send(player, map[string]any{"type": "safety.xcard"})
		if r.XCardMode != "gm" {
			t.Fatalf("mode %q", r.XCardMode)
		}
		for table, was := range map[string]int{"session_event": events, "admin_event": admin} {
			if n := rows(table); n != was {
				t.Fatalf("%s holds %d rows", table, n)
			}
		}
		if after := safetyOf(p); len(after.Lines) != len(before.Lines) || !after.XCard {
			t.Fatalf("changed %+v", after)
		}
		p.send(p.room.GM(), map[string]any{"type": "campaign.setSafety", "lines": []any{}, "veils": []any{}, "xCard": false})
		p.refused(player, map[string]any{"type": "safety.xcard"}, "xcardOff")
		p.refused(p.room.GM(), map[string]any{"type": "safety.xcard"}, "noPermission")
	})
}

func TestWithoutAGMEveryPlayerSetsTheListsAndHearsTheCard(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.setMode(p.room.GM(), "gmless")
		p.send(player, map[string]any{"type": "campaign.setSafety", "lines": []any{"a"}, "veils": []any{}, "xCard": true})
		if r := p.send(player, map[string]any{"type": "safety.xcard"}); r.XCardMode != "gmless" {
			t.Fatalf("mode %q", r.XCardMode)
		}
	})
}

func TestTheXCardReachesTheGMSideAndTheScreenAndOneSeatTouchesItOncePerWindow(t *testing.T) {
	_, server := testGateway(t, func(context.Context, cs.Ctx, cs.Action) (Result, error) {
		return Result{OK: true, XCardMode: "gm"}, nil
	})
	gm, player, screen := joined(t, server, "gm"), joined(t, server, "player"), joined(t, server, "screen")
	player.emit(t, 1, "action", map[string]any{"type": "safety.xcard"})
	if ack := player.ack(t, 1); ack["ok"] != true {
		t.Fatalf("ack %v", ack)
	}
	for _, c := range []*rawClient{gm, screen} {
		if f := c.expect(t, `42["safety:xcard"`); strings.Contains(f, "userId") {
			t.Fatalf("event names someone: %s", f)
		}
	}
	select {
	case f := <-player.frames:
		if strings.Contains(f, "safety:xcard") {
			t.Fatalf("a player heard it: %s", f)
		}
	case <-time.After(300 * time.Millisecond):
	}
	player.emit(t, 2, "action", map[string]any{"type": "safety.xcard"})
	if ack := player.ack(t, 2); ack["code"] != "xcardWait" {
		t.Fatalf("second touch: %v", ack)
	}
}
