package table

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// The play actions end to end in one rolled-back transaction: parsed, authorized and dispatched as the gateway does.

// playFixture is dbtest.Fixture with two Tests (a hidden-number check and a Dice pool) and a scored game, all of our own
// invention ("Fixture p.N" points at no book).
func playFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(dbtest.Fixture), &m); err != nil {
		t.Fatal(err)
	}
	m["tests"] = map[string]any{
		"check": map[string]any{"kind": "sumVsTarget", "dice": "1d20", "modifier": "level", "target": "ctx.dc",
			"inputs": map[string]any{"dc": "int"}, "cite": "Fixture p.5"},
		"pool": map[string]any{"kind": "poolSuccesses", "pool": "level", "die": 6, "target": "2",
			"bands": []any{map[string]any{"id": "hit", "from": 4, "to": 6, "worth": 1}}, "cite": "Fixture p.6"},
	}
	m["scoring"] = map[string]any{"score": "level", "endWhen": []any{map[string]any{"when": "round > 3", "cite": "Fixture p.7"}},
		"cite": "Fixture p.7"}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

type play struct {
	t    *testing.T
	tx   pgx.Tx
	room dbtest.Room
}

func newPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, playFixture(t))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// A character at this level, with full Vigour.
func (p *play) character(name string, level int) string {
	id := p.room.Actor(p.t, p.tx, "pc", name, "character")
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, $2)`, id, level)
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'hp', $2)`, id, 4+2*level)
	return id
}

// try parses the action as a client's and applies it as c.
func (p *play) try(c cs.Ctx, action map[string]any) (Result, error) {
	p.t.Helper()
	a, issues := cs.ParseAction(action)
	if len(issues) > 0 {
		p.t.Fatalf("%v does not parse: %v", action, issues)
	}
	return ApplyAction(context.Background(), p.tx, c, a)
}

func (p *play) send(c cs.Ctx, action map[string]any) Result {
	p.t.Helper()
	r, err := p.try(c, action)
	if err != nil {
		p.t.Fatalf("%v: %v", action["type"], err)
	}
	return r
}

func (p *play) refused(c cs.Ctx, action map[string]any, code string) {
	p.t.Helper()
	_, err := p.try(c, action)
	var refusal *cs.Error
	if !errors.As(err, &refusal) || refusal.Code != code {
		p.t.Fatalf("%v: want %s, got %v", action["type"], code, err)
	}
}

func (p *play) turn() *turn.Turn {
	p.t.Helper()
	return dbtest.Must[*turn.Turn](p.t)(turn.Load(context.Background(), p.tx, p.room.ID))
}

func (p *play) combatant(actorID string) string {
	return dbtest.Scalar[string](p.t, p.tx, `SELECT c.id::text FROM combatant c JOIN encounter e ON e.id = c.encounter_id
		WHERE e.campaign_id = $1 AND e.active AND c.actor_id = $2`, p.room.ID, actorID)
}

func (p *play) seatView(c cs.Ctx) view.SeatView {
	p.t.Helper()
	loaded := dbtest.Must[*Loaded](p.t)(LoadSnapshot(context.Background(), p.tx, p.room.ID))
	return view.Of(loaded.Snapshot, loaded.Compiled, c)
}

func TestAnEncounterRoundWrapsAndUndoTakesTheWrapBack(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		ash, bo, cy := p.character("Ash", 5), p.character("Bo", 3), p.character("Cy", 1)
		p.refused(gm, map[string]any{"type": "turn.next"}, "noEncounterRunning")
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.refused(gm, map[string]any{"type": "encounter.start"}, "encounterRunning")
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{cy, ash, bo}, "side": "party"})
		for actorID, score := range map[string]float64{ash: 15, bo: 10, cy: 5} {
			p.send(gm, map[string]any{"type": "encounter.setInitiative", "combatantId": p.combatant(actorID), "score": score})
		}
		if got := p.turn().Order; strings.Join(got, ",") != strings.Join([]string{ash, bo, cy}, ",") {
			t.Fatalf("ranked by initiative: got %v", got)
		}
		for _, want := range []string{ash, bo, cy, ash} {
			p.send(gm, map[string]any{"type": "turn.next"})
			if cur := p.turn().CurrentID; cur == nil || *cur != want {
				t.Fatalf("turn.next: want %s, got %v", want, cur)
			}
		}
		if p.turn().Round != 2 {
			t.Fatalf("the round wrapped: got %v", p.turn().Round)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		if tr := p.turn(); tr.Round != 1 || tr.CurrentID == nil || *tr.CurrentID != cy {
			t.Fatalf("undo of the wrap: round %v, current %v", tr.Round, tr.CurrentID)
		}
		// A player runs no tracker.
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), ash)
		p.refused(player, map[string]any{"type": "turn.next"}, "noPermission")
		p.send(gm, map[string]any{"type": "encounter.end"})
		if p.turn() != nil {
			t.Fatal("the encounter ended")
		}
	})
}

func TestAHiddenTargetStaysOffAPlayersViewAndTheServerResolvesTheRoll(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		ash := p.character("Ash", 5)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), ash)
		p.refused(gm, map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{ash}}, "testProblem")
		callID := p.send(gm, map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{ash},
			"inputs": map[string]any{"dc": 17.0}, "hideTarget": true}).ID

		targetOf := func(v view.SeatView) *int {
			for _, c := range v.State.Tests {
				if c.ID == callID {
					return c.Targets[0].Target
				}
			}
			t.Fatal("the call is not in the view")
			return nil
		}
		if got := targetOf(p.seatView(gm)); got == nil || *got != 17 {
			t.Fatalf("the GM sees the number: %v", got)
		}
		if got := targetOf(p.seatView(player)); got != nil {
			t.Fatalf("the player must not see the hidden number, got %d", *got)
		}
		if raw, _ := json.Marshal(p.seatView(player).State.Tests); strings.Contains(string(raw), "17") {
			t.Fatalf("the hidden number leaks into the player's view: %s", raw)
		}

		// 11 on the die plus level 5 is 16, under the hidden 17: the server says so, the phone never knew the number.
		p.send(player, map[string]any{"type": "test.report", "callId": callID, "actorId": ash,
			"roll": map[string]any{"kind": "faces", "faces": []any{11.0}}})
		outcome := dbtest.Scalar[string](t, tx, `SELECT outcome FROM test_report WHERE call_id = $1`, callID)
		total := dbtest.Scalar[int32](t, tx, `SELECT total FROM test_report WHERE call_id = $1`, callID)
		if outcome != "failure" || total != 16 {
			t.Fatalf("resolved: %s with %d", outcome, total)
		}
		p.refused(player, map[string]any{"type": "test.report", "callId": callID, "actorId": ash,
			"roll": map[string]any{"kind": "faces", "faces": []any{20.0}}}, "alreadyReported")
		p.send(gm, map[string]any{"type": "test.close", "callId": callID})
		p.refused(gm, map[string]any{"type": "test.close", "callId": callID}, "testClosed")
	})
}

func TestAPoolTestCountsTheReportedDice(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		ash := p.character("Ash", 5)
		callID := p.send(gm, map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash}}).ID
		if pool := dbtest.Scalar[int32](t, tx, `SELECT pool FROM test_call_target WHERE call_id = $1`, callID); pool != 5 {
			t.Fatalf("the pool is set at the call: got %d", pool)
		}
		p.refused(gm, map[string]any{"type": "test.report", "callId": callID, "actorId": ash, "advantage": "advantage",
			"roll": map[string]any{"kind": "pool", "counts": map[string]any{"hit": 3.0}}}, "poolNoAdvantage")
		p.send(gm, map[string]any{"type": "test.report", "callId": callID, "actorId": ash,
			"roll": map[string]any{"kind": "pool", "counts": map[string]any{"hit": 3.0}}})
		var total, margin int32
		var outcome string
		if err := tx.QueryRow(context.Background(), `SELECT total, margin, outcome FROM test_report WHERE call_id = $1`, callID).
			Scan(&total, &margin, &outcome); err != nil {
			t.Fatal(err)
		}
		if total != 3 || margin != 1 || outcome != "success" {
			t.Fatalf("three hits against 2: total %d, margin %d, %s", total, margin, outcome)
		}
	})
}

func TestGameEndRanksTheTableAndResultSetRanksAgain(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		ash, bo, cy := p.character("Ash", 3), p.character("Bo", 5), p.character("Cy", 3)
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{ash, bo, cy}, "side": "party"})
		p.send(gm, map[string]any{"type": "game.end"})
		if p.turn() != nil {
			t.Fatal("game.end closes the encounter")
		}
		places := func() string {
			rows := dbtest.Must[pgx.Rows](t)(tx.Query(context.Background(),
				`SELECT name || ':' || place FROM session_result WHERE campaign_id = $1 ORDER BY place, name`, p.room.ID))
			return strings.Join(dbtest.Must[[]string](t)(pgx.CollectRows(rows, pgx.RowTo[string])), " ")
		}
		// Highest level first; a tie shares the place and the next one is skipped.
		if got := places(); got != "Bo:1 Ash:2 Cy:2" {
			t.Fatalf("ranked: %s", got)
		}
		if early := dbtest.Scalar[bool](t, tx, `SELECT bool_and(ended_early) FROM session_result WHERE campaign_id = $1`, p.room.ID); !early {
			t.Fatal("no endWhen met: ended early")
		}
		cyRow := dbtest.Scalar[string](t, tx, `SELECT id::text FROM session_result WHERE actor_id = $1`, cy)
		p.send(gm, map[string]any{"type": "result.set", "resultId": cyRow, "score": 9.0})
		if got := places(); got != "Cy:1 Bo:2 Ash:3" {
			t.Fatalf("ranked again: %s", got)
		}
		other := newPlay(t, tx)
		p.refused(other.room.GM(), map[string]any{"type": "result.set", "resultId": cyRow, "score": 1.0}, "resultNotFound")
	})
}
