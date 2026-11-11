package campaign

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// A character at level 3 (so 10 Vigour at most) with hp Vigour, in a room with a running session.
func character(t *testing.T, tx pgx.Tx, room dbtest.Room, name string, hp int) string {
	id := room.Actor(t, tx, "pc", name, "character")
	dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 3)`, id)
	dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'hp', $2)`, id, hp)
	return id
}

func hit(t *testing.T, tx pgx.Tx, c cs.Ctx, actorID string, by float64) {
	t.Helper()
	ctx := context.Background()
	rc := dbtest.Must[*ruleset.Context](t)(ruleset.Open(ctx, tx, c))
	delta := engine.Delta{Target: engine.DeltaTarget{ActorID: actorID, Resource: "hp"}, Kind: "add", Value: by}
	if id := dbtest.Must[string](t)(rc.Apply(ctx, []engine.Delta{delta})); id == "" {
		t.Fatal("the hit changed nothing")
	}
}

func hp(t *testing.T, tx pgx.Tx, actorID string) int32 {
	t.Helper()
	return dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, actorID)
}

func TestUndoTakesBackTheNewestActionFirst(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, dbtest.Fixture)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
		lyra := character(t, tx, room, "Lyra", 5)
		hit(t, tx, room.GM(), lyra, -2)
		hit(t, tx, room.GM(), lyra, -1)
		// A delta written since keeps its effect: undo adds back what the step took, it never sets the old value.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = value - 1 WHERE actor_id = $1`, lyra)
		for _, want := range []int32{2, 4} {
			if _, err := Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"}); err != nil {
				t.Fatal(err)
			}
			if got := hp(t, tx, lyra); got != want {
				t.Fatalf("after undo: want %d Vigour, got %d", want, got)
			}
		}
		_, err := Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"})
		var refusal *cs.Error
		if !errors.As(err, &refusal) || refusal.Code != "nothingToUndo" {
			t.Fatalf("a third undo: want nothingToUndo, got %v", err)
		}
	})
}

func TestUndoSkipsADeletedActor(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, dbtest.Fixture)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
		lyra := character(t, tx, room, "Lyra", 5)
		bram := character(t, tx, room, "Bram", 5)
		rc := dbtest.Must[*ruleset.Context](t)(ruleset.Open(ctx, tx, room.GM()))
		hits := []engine.Delta{
			{Target: engine.DeltaTarget{ActorID: lyra, Resource: "hp"}, Kind: "add", Value: -2.0},
			{Target: engine.DeltaTarget{ActorID: bram, Resource: "hp"}, Kind: "add", Value: -2.0},
		}
		action := dbtest.Must[string](t)(rc.Apply(ctx, hits))
		dbtest.Exec(t, tx, `DELETE FROM actor WHERE id = $1`, bram)
		undone := dbtest.Must[cs.Result](t)(Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"}))
		if undone.ID != action || hp(t, tx, lyra) != 5 {
			t.Fatalf("undo of a step on a deleted actor: %+v, Lyra at %d", undone, hp(t, tx, lyra))
		}
		passed := dbtest.Scalar[string](t, tx, `SELECT payload->'skipped'->0->>'reason' FROM session_event
			WHERE campaign_id = $1 AND type = 'undo'`, room.ID)
		if passed != "deleted" {
			t.Fatalf("the deleted actor's step is noted as skipped: %q", passed)
		}
	})
}
