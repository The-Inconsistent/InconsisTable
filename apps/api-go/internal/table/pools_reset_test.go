package table

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// rows for every reset pool, at 9 so a reset shows
func seedResetPools(t *testing.T, p *play, tx pgx.Tx) {
	t.Helper()
	for id, scope := range map[string]string{"stashSession": "party", "stashGm": "gm", "stashFight": "party", "stashRest": "party"} {
		dbtest.Exec(t, tx, `INSERT INTO resource_pool (campaign_id, scope, resource_id, value) VALUES ($1, $2, $3, 9)`,
			p.room.ID, scope, id)
	}
}

func TestPoolsResetOnTheEventsTheyList(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		ash, bo := p.character("Ash", 3), p.character("Bo", 2)
		seedResetPools(t, p, tx)

		p.startSession()
		wantPool(t, p, "stashSession", 2) // party.characters
		wantPool(t, p, "stashGm", 2)      // "2" in the manifest
		wantPool(t, p, "stashFight", 9)
		wantPool(t, p, "stashRest", 9)

		// A rest of one actor leaves pools alone; the whole table's resets those that list it.
		p.send(gm, map[string]any{"type": "actor.rest", "event": "longRest", "actorId": ash})
		wantPool(t, p, "stashRest", 9)
		p.send(gm, map[string]any{"type": "actor.rest", "event": "longRest"})
		wantPool(t, p, "stashRest", 4)

		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{ash, bo}, "side": "party"})
		p.send(gm, map[string]any{"type": "encounter.end"})
		wantPool(t, p, "stashFight", 1)
	})
}

func TestWithoutAGMAPlayerStartingTheSessionResetsThePools(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		ash := p.character("Ash", 3)
		seedResetPools(t, p, tx)
		p.setMode(room.GM(), "gmless")
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)

		p.send(alice, map[string]any{"type": "session.start"})
		wantPool(t, p, "stashSession", 1)
		wantPool(t, p, "stashGm", 2) // a gm pool too: the reset is the rules' write, not Alice's edit
	})
}

func TestUndoTakesAPoolChangeBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		p.character("Ash", 3)
		seedResetPools(t, p, tx)
		p.startSession()

		// The adjust that made the row: undo returns the value to the minimum (1).
		p.send(gm, adjustPool("capped", 3))
		wantPool(t, p, "capped", 4)
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "capped", 1)

		// A second adjust adds to the stored value, and undo takes back that one only.
		p.send(gm, adjustPool("partyOwner", 4))
		p.send(gm, adjustPool("partyOwner", 3))
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "partyOwner", 4)

		// A reset.
		p.send(gm, map[string]any{"type": "actor.rest", "event": "longRest"})
		wantPool(t, p, "stashRest", 4)
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "stashRest", 9)
	})
}
