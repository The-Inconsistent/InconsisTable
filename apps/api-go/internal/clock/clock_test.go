package clock_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/clock"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func create(t *testing.T, tx pgx.Tx, c cs.Ctx, over cs.Action) string {
	t.Helper()
	a := cs.Action{"type": "clock.create", "name": "Ritual", "segments": 6.0, "visibility": "party"}
	for k, v := range over {
		a[k] = v
	}
	return dbtest.Must[cs.Result](t)(clock.Create(context.Background(), tx, c, a)).ID
}

func tick(tx pgx.Tx, c cs.Ctx, id string, delta float64) error {
	_, err := clock.Tick(context.Background(), tx, c, cs.Action{"type": "clock.tick", "id": id, "delta": delta})
	return err
}

func filled(t *testing.T, tx pgx.Tx, id string) int32 {
	t.Helper()
	return dbtest.Scalar[int32](t, tx, `SELECT filled FROM clock WHERE id = $1`, id)
}

func code(err error) string {
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		return refusal.Code
	}
	return ""
}

func TestTickClampsAtZeroAndSegments(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		id := create(t, tx, room.GM(), nil)
		for _, step := range []struct{ delta, want float64 }{{4, 4}, {12, 6}, {-3, 3}, {-12, 0}, {-1, 0}} {
			if err := tick(tx, room.GM(), id, step.delta); err != nil {
				t.Fatal(err)
			}
			if got := filled(t, tx, id); float64(got) != step.want {
				t.Fatalf("after %+v: filled %d", step, got)
			}
		}
	})
}

func TestLoweringSegmentsClampsFilled(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		id := create(t, tx, room.GM(), cs.Action{"segments": 8.0})
		if err := tick(tx, room.GM(), id, 7); err != nil {
			t.Fatal(err)
		}
		dbtest.Must[cs.Result](t)(clock.Update(context.Background(), tx, room.GM(), cs.Action{"id": id, "segments": 4.0}))
		if got := filled(t, tx, id); got != 4 {
			t.Fatalf("filled %d, want 4", got)
		}
	})
}

func TestTheThirtyFirstClockIsRefused(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		for range cs.MaxClocks {
			create(t, tx, room.GM(), nil)
		}
		_, err := clock.Create(context.Background(), tx, room.GM(), cs.Action{"name": "One more", "segments": 4.0, "visibility": "gm"})
		if code(err) != "clockLimit" {
			t.Fatalf("want clockLimit, got %v", err)
		}
	})
}

func TestAnEntryOfAnotherRoomIsRefused(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room, other := dbtest.NewRoom(t, tx), dbtest.NewRoom(t, tx)
		foreign := dbtest.Scalar[string](t, tx, `INSERT INTO codex_entry (campaign_id, kind, title) VALUES ($1, 'lore', 'x') RETURNING id::text`, other.ID)
		_, err := clock.Create(context.Background(), tx, room.GM(), cs.Action{"name": "C", "segments": 4.0, "visibility": "gm", "entryId": foreign})
		if code(err) != "entryNotFound" {
			t.Fatalf("create: want entryNotFound, got %v", err)
		}
		id := create(t, tx, room.GM(), nil)
		_, err = clock.Update(context.Background(), tx, room.GM(), cs.Action{"id": id, "entryId": foreign})
		if code(err) != "entryNotFound" {
			t.Fatalf("update: want entryNotFound, got %v", err)
		}
	})
}

func TestAClockOfAnotherRoomIsNotFound(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room, other := dbtest.NewRoom(t, tx), dbtest.NewRoom(t, tx)
		id := create(t, tx, other.GM(), nil)
		if code(tick(tx, room.GM(), id, 1)) != "clockNotFound" {
			t.Fatal("a tick reached another room's clock")
		}
		_, err := clock.Delete(context.Background(), tx, room.GM(), cs.Action{"id": id})
		if code(err) != "clockNotFound" {
			t.Fatal("a delete reached another room's clock")
		}
	})
}

func TestDeletingTheEntryUnlinksTheClock(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		entry := dbtest.Scalar[string](t, tx, `INSERT INTO codex_entry (campaign_id, kind, title) VALUES ($1, 'lore', 'x') RETURNING id::text`, room.ID)
		id := create(t, tx, room.GM(), cs.Action{"entryId": entry})
		dbtest.Exec(t, tx, `DELETE FROM codex_entry WHERE id = $1`, entry)
		if dbtest.Scalar[*string](t, tx, `SELECT entry_id::text FROM clock WHERE id = $1`, id) != nil {
			t.Fatal("the clock still points at the deleted entry")
		}
	})
}

func TestUndoRevertsATick(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, dbtest.Fixture)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
		id := create(t, tx, room.GM(), nil)
		for _, d := range []float64{2, 1} {
			if err := tick(tx, room.GM(), id, d); err != nil {
				t.Fatal(err)
			}
		}
		for _, want := range []int32{2, 0} {
			dbtest.Must[cs.Result](t)(campaign.Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"}))
			if got := filled(t, tx, id); got != want {
				t.Fatalf("after undo: filled %d, want %d", got, want)
			}
		}
		// A clamped tick undoes by what it actually moved, not by what was asked.
		if err := tick(tx, room.GM(), id, 12); err != nil {
			t.Fatal(err)
		}
		dbtest.Must[cs.Result](t)(campaign.Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"}))
		if got := filled(t, tx, id); got != 0 {
			t.Fatalf("after undoing a clamped tick: filled %d, want 0", got)
		}
	})
}
