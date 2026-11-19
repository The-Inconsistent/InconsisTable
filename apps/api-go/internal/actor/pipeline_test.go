package actor

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

func add(actorID, resource string, by float64) engine.Delta {
	return engine.Delta{Target: engine.DeltaTarget{ActorID: actorID, Resource: resource}, Kind: "add", Value: by}
}

// A character at level 3 (so 10 Vigour at most) with 5 Vigour and 2 Focus, in a room with a running session.
func hero(t *testing.T, tx pgx.Tx) (dbtest.Room, string) {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, dbtest.Fixture)
	id := room.Actor(t, tx, "pc", "Lyra", "character")
	dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 3)`, id)
	dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'hp', 5), ($1, 'focus', 2)`, id)
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return room, id
}

func apply(t *testing.T, tx pgx.Tx, c cs.Ctx, deltas ...engine.Delta) (string, error) {
	t.Helper()
	ctx := context.Background()
	rules := dbtest.Must[*engine.CompiledRuleset](t)(compiled.Load(ctx, tx, c.CampaignID))
	rows := dbtest.Must[[]Rows](t)(LoadRows(ctx, tx, c.CampaignID))
	built := dbtest.Must[map[string]*Built](t)(Build(rules, rows, nil))
	return ApplyDeltas(ctx, tx, Apply{Ctx: c, Compiled: rules, Built: built, Deltas: deltas})
}

func refusedWith(t *testing.T, err error, code string) {
	t.Helper()
	var refusal *cs.Error
	if !errors.As(err, &refusal) || refusal.Code != code {
		t.Fatalf("want refusal %s, got %v", code, err)
	}
}

func TestDeltasClampOnTheServerAndAreLogged(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room, id := hero(t, tx)
		first, err := apply(t, tx, room.GM(), add(id, "hp", 20))
		if err != nil || first == "" {
			t.Fatalf("apply: %q %v", first, err)
		}
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, id); hp != 10 {
			t.Fatalf("hp clamped to the max: want 10, got %d", hp)
		}
		if _, err := apply(t, tx, room.GM(), add(id, "hp", -50)); err != nil {
			t.Fatal(err)
		}
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, id); hp != 0 {
			t.Fatalf("hp clamped to the min: want 0, got %d", hp)
		}
		var payload []byte
		if err := tx.QueryRow(context.Background(), `SELECT payload FROM session_event
			WHERE campaign_id = $1 AND action_id = $2 AND type = 'delta' AND session_id IS NOT NULL`, room.ID, first).Scan(&payload); err != nil {
			t.Fatal(err)
		}
		logged := dbtest.Must[eventlog.Written](t)(eventlog.Parse(payload))
		if logged.Before != 5.0 || logged.After != 10.0 || logged.Kind != "add" || logged.Target.Resource != "hp" {
			raw, _ := json.Marshal(logged)
			t.Fatalf("logged delta: %s", raw)
		}
		// A write that changes nothing leaves no row and no action id.
		none, err := apply(t, tx, room.GM(), add(id, "hp", -1))
		if err != nil || none != "" {
			t.Fatalf("a no-op write: %q %v", none, err)
		}
	})
}

func TestEditableByDecidesWhatASeatWrites(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room, id := hero(t, tx)
		ana := room.Seat(t, tx, dbtest.User(t, tx, "Ana"), id)
		_, err := apply(t, tx, ana, add(id, "focus", 1))
		refusedWith(t, err, "onlySpend")
		if _, err := apply(t, tx, ana, add(id, "focus", -1)); err != nil {
			t.Fatalf("spending Focus: %v", err)
		}
		_, err = apply(t, tx, ana, add(id, "hp", -1))
		refusedWith(t, err, "gmOnly")
		other := room.Actor(t, tx, "pc", "Bram", "character")
		_, err = apply(t, tx, ana, engine.Delta{Target: engine.DeltaTarget{ActorID: other, Field: "note"}, Kind: "set", Value: "hi"})
		refusedWith(t, err, "notYourCharacter")
		_, err = apply(t, tx, ana, engine.Delta{Target: engine.DeltaTarget{ActorID: id, Field: "note"}, Kind: "set",
			Value: "a note far longer than twenty characters"})
		refusedWith(t, err, "fieldInvalid")
	})
}

func TestEventlogInvertTakesBackWhatAStepDid(t *testing.T) {
	hp := engine.DeltaTarget{ActorID: "a", Resource: "hp"}
	back, refusal := eventlog.Invert(eventlog.Written{Target: hp, Kind: "add", Before: 5.0, After: 10.0}, nil)
	if refusal != nil || back.Kind != "add" || back.Value != -5.0 {
		t.Fatalf("a resource is undone by the change it made: %+v %v", back, refusal)
	}
	note := engine.DeltaTarget{ActorID: "a", Field: "note"}
	_, refusal = eventlog.Invert(eventlog.Written{Target: note, Kind: "set", Before: "x", After: "y"}, "z")
	if refusal == nil || refusal.Code != "undoChanged" || refusal.Params["now"] != `"z"` {
		t.Fatalf("a field changed since refuses: %v", refusal)
	}
	back, refusal = eventlog.Invert(eventlog.Written{Target: note, Kind: "set", Before: "x", After: "y"}, "y")
	if refusal != nil || back.Kind != "set" || back.Value != "x" {
		t.Fatalf("a field still as the step left it is set back: %+v %v", back, refusal)
	}
}
