package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// resetFixture is the mode fixture with two resources only the GM may edit by hand: one refills when a session starts,
// the other when an encounter ends.
func resetFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(modeFixture(t, "gm", "gmless", "solo")), &m); err != nil {
		t.Fatal(err)
	}
	refill := func(id, event string) map[string]any {
		return map[string]any{"id": id, "label": id, "cite": "Fixture p.7", "scope": "entity", "max": "3", "visibility": "party",
			"resetOn": []any{map[string]any{"event": event, "to": "max"}}}
	}
	m["resources"] = append(m["resources"].([]any), refill("nerve", "sessionStart"), refill("grit", "encounterEnd"))
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Without a GM any seat starts the session and ends the fight (ADR 0009), and the resets those events bring reach every
// character, not only the ones that seat holds: a reset is the rules' write, not the seat's edit (house decision #53).
func TestWithoutAGMATableEventResetsEveryCharacter(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, resetFixture(t))
		p := &play{t, tx, room}
		ash, bo := p.character("Ash", 5), p.character("Bo", 2)
		dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value)
			VALUES ($1, 'nerve', 0), ($2, 'nerve', 0), ($1, 'grit', 0), ($2, 'grit', 0)`, ash, bo)
		p.setMode(room.GM(), "gmless")
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		ben := room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)
		value := func(actorID, resource string) int {
			return dbtest.Scalar[int](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = $2`, actorID, resource)
		}

		p.send(alice, map[string]any{"type": "session.start"})
		for name, id := range map[string]string{"Ash": ash, "Bo": bo} {
			if got := value(id, "nerve"); got != 3 {
				t.Fatalf("%s after a session Alice started: want nerve 3, got %d", name, got)
			}
		}

		p.send(ben, map[string]any{"type": "encounter.start"})
		p.send(ben, map[string]any{"type": "encounter.add", "actorIds": []any{ash, bo}, "side": "party"})
		p.send(alice, map[string]any{"type": "encounter.end"})
		for name, id := range map[string]string{"Ash": ash, "Bo": bo} {
			if got := value(id, "grit"); got != 3 {
				t.Fatalf("%s after a fight Alice ended: want grit 3, got %d", name, got)
			}
		}

		// A hand edit is still refused: the reset did not open the value to the seat.
		p.refused(alice, map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
			"input": map[string]any{"actorId": bo, "resource": "nerve", "delta": -1.0}}, "notYourCharacter")
	})
}
