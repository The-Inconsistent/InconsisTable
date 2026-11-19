package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// scopedFixture is the play fixture with a second actor type, shaped like the first, and a Test only characters take.
func scopedFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	entities := m["entities"].([]any)
	raw, err := json.Marshal(entities[0])
	if err != nil {
		t.Fatal(err)
	}
	var beast map[string]any
	if err := json.Unmarshal(raw, &beast); err != nil {
		t.Fatal(err)
	}
	beast["id"], beast["label"] = "beast", "Beast"
	m["entities"] = append(entities, beast)
	m["tests"].(map[string]any)["rally"] = map[string]any{"kind": "sumVsTarget", "dice": "1d20", "modifier": "level",
		"target": "ctx.dc", "inputs": map[string]any{"dc": "int"}, "entities": []any{"character"}, "cite": "Fixture p.5"}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// House decision #50: a Test that names its actor types is called only for actors of those types.
func TestATestIsCalledOnlyForTheActorTypesItNames(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, scopedFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		ash := p.character("Ash", 3)
		wolf := room.Actor(t, tx, "creature", "Wolf", "beast")
		dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 1)`, wolf)
		p.startSession()

		call := func(testID string, actorIDs ...any) map[string]any {
			return map[string]any{"type": "test.call", "testId": testID, "actorIds": actorIDs, "inputs": map[string]any{"dc": 12.0}}
		}
		p.refused(gm, call("rally", wolf), "testNotForType")
		p.refused(gm, call("rally", ash, wolf), "testNotForType")
		if id := p.send(gm, call("rally", ash)).ID; id == "" {
			t.Fatal("no call id for a character")
		}
	})
}
