package table

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Ending without an award, deleting the last session, and the GM's journal (house decision #85).

func (p *play) startTitled(title string) string {
	p.t.Helper()
	return p.send(p.room.GM(), map[string]any{"type": "session.start", "title": title}).ID
}

func TestAbandonEndsTheSessionWithNoAwardAndLogsIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.refused(gm, map[string]any{"type": "session.abandon"}, "noSessionRunning")

		id := p.startTitled("Never played")
		p.refused(player, map[string]any{"type": "session.abandon"}, "noPermission")
		p.send(gm, map[string]any{"type": "session.abandon", "recap": "Rained off."})
		if !dbtest.Scalar[bool](t, tx, `SELECT ended_at IS NOT NULL AND abandoned AND recap = 'Rained off.' FROM session WHERE id = $1`, id) {
			t.Fatal("the session ends, marked, with its recap")
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM session_event WHERE session_id = $1 AND type = 'session.abandon'`, id); n != 1 {
			t.Fatalf("logged %d times", n)
		}
		p.refused(gm, map[string]any{"type": "session.abandon"}, "noSessionRunning")

		// An ordinary end is not marked.
		other := p.startTitled("")
		p.send(gm, map[string]any{"type": "session.end"})
		if dbtest.Scalar[bool](t, tx, `SELECT abandoned FROM session WHERE id = $1`, other) {
			t.Fatal("session.end marks nothing")
		}
	})
}

func TestDeleteTakesOnlyTheLatestEndedSession(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		del := func(id string) map[string]any { return map[string]any{"type": "session.delete", "sessionId": id} }

		one := p.startTitled("One")
		p.send(gm, map[string]any{"type": "session.end", "recap": "We met."})
		two := p.startTitled("Two")
		p.refused(gm, del(two), "endSessionFirst")
		p.refused(gm, del(one), "notLatestSession")
		p.refused(gm, del("0190a000-0000-7000-8000-000000000999"), "sessionNotFound")
		p.send(gm, map[string]any{"type": "session.edit", "sessionId": two, "notes": "kept"})
		// A step logged in the session stays in the room's log, under no session.
		dbtest.Exec(t, tx, `INSERT INTO session_event (campaign_id, session_id, type, payload) VALUES ($1, $2, 'note', '{}')`, p.room.ID, two)
		p.send(gm, map[string]any{"type": "session.end"})
		p.refused(player, del(two), "noPermission")

		r := p.send(gm, del(two))
		if len(r.Notices) != 1 || r.Notices[0].Code != "sessionDeleted" || r.Notices[0].Params["number"] != 2 {
			t.Fatalf("notices %+v", r.Notices)
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM session WHERE campaign_id = $1`, p.room.ID); n != 1 {
			t.Fatalf("%d sessions left", n)
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type = 'note' AND session_id IS NULL`, p.room.ID); n != 1 {
			t.Fatal("the deleted session's log rows stay, under no session")
		}
		// The numbering goes on from the one left, and that one is now the latest.
		if three := p.startTitled(""); dbtest.Scalar[int32](t, tx, `SELECT number FROM session WHERE id = $1`, three) != 2 {
			t.Fatal("the next session takes the deleted one's number")
		}
		p.send(gm, map[string]any{"type": "session.end"})
		p.refused(gm, del(one), "notLatestSession")
	})
}

func TestStartingASessionClosesTheOpenTestCalls(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		call := dbtest.Scalar[string](t, tx, `INSERT INTO test_call (campaign_id, test_id, inputs, hide_target, show_outcome)
			VALUES ($1, 'check', '{}', false, false) RETURNING id::text`, p.room.ID)
		p.startSession()
		if s := dbtest.Scalar[string](t, tx, `SELECT status FROM test_call WHERE id = $1`, call); s != "closed" {
			t.Fatalf("status %s", s)
		}
	})
}

func TestARunningSessionsRecapWaitsForItsEnd(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		id := p.startTitled("")
		p.refused(gm, map[string]any{"type": "session.edit", "sessionId": id, "recap": "early"}, "recapAtSessionEnd")
		p.send(gm, map[string]any{"type": "session.edit", "sessionId": id, "title": "Named", "notes": "any time"})
		p.send(gm, map[string]any{"type": "session.end"})
		p.send(gm, map[string]any{"type": "session.edit", "sessionId": id, "recap": "late"})
		if got := dbtest.Scalar[string](t, tx, `SELECT title || '/' || recap || '/' || notes FROM session WHERE id = $1`, id); got != "Named/late/any time" {
			t.Fatal(got)
		}
	})
}

func TestTheJournalReachesTheGMNewestFirstAndNoPlayer(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.startTitled("One")
		p.send(gm, map[string]any{"type": "session.abandon"})
		two := p.startTitled("Two")
		p.send(gm, map[string]any{"type": "session.edit", "sessionId": two, "notes": "secret"})

		state, compiled, _, err := LoadLive(context.Background(), tx, p.room.ID)
		if err != nil {
			t.Fatal(err)
		}
		gmView := view.Of(view.Snapshot{State: *state, Codex: cs.Codex{Entries: []cs.CodexEntry{}, Recaps: []cs.SessionRecap{}}}, compiled, gm)
		j := gmView.State.Journal
		if len(j) != 2 || j[0].Title != "Two" || j[0].Notes != "secret" || j[0].EndedAt != nil || !j[1].Abandoned || j[1].EndedAt == nil {
			t.Fatalf("GM journal %+v", j)
		}
		playerView := view.Of(view.Snapshot{State: *state, Codex: cs.Codex{Entries: []cs.CodexEntry{}, Recaps: []cs.SessionRecap{}}}, compiled, player)
		if len(playerView.State.Journal) != 0 || playerView.State.Session.Notes != "" {
			t.Fatalf("player journal %+v", playerView.State.Journal)
		}
	})
}
