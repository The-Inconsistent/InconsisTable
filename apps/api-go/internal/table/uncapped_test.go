package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// uncappedFixture is the play fixture with a track that counts up and may pass its maximum (`capped: false`), beside
// one with the same maximum that may not.
func uncappedFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	track := func(id string, capped bool) map[string]any {
		return map[string]any{"id": id, "label": id, "cite": "Fixture p.7", "scope": "entity", "max": "5", "capped": capped,
			"start": "min", "visibility": "party"}
	}
	m["resources"] = append(m["resources"].([]any), track("strain", false), track("stress", true))
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// A resource declared `capped: false` runs past its maximum in play, and the table still shows that maximum; a capped
// one stops there. Undo brings the value back.
func TestAnUncappedResourcePassesItsMaximum(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, uncappedFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		ash := p.character("Ash", 3)
		dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'strain', 0), ($1, 'stress', 0)`, ash)
		p.startSession()

		adjust := func(resource string, delta float64) {
			p.send(gm, map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
				"input": map[string]any{"actorId": ash, "resource": resource, "delta": delta}})
		}
		value := func(resource string) int {
			return dbtest.Scalar[int](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = $2`, ash, resource)
		}
		adjust("stress", 8)
		if got := value("stress"); got != 5 {
			t.Fatalf("a capped resource stops at its maximum: want 5, got %d", got)
		}
		adjust("strain", 8)
		if got := value("strain"); got != 8 {
			t.Fatalf("an uncapped resource passes its maximum: want 8, got %d", got)
		}
		adjust("strain", -20)
		if got := value("strain"); got != 0 {
			t.Fatalf("an uncapped resource still stops at its minimum: want 0, got %d", got)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		if got := value("strain"); got != 8 {
			t.Fatalf("undo brings the value past the maximum back: want 8, got %d", got)
		}
	})
}
