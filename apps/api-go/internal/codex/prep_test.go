package codex

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// parsed is an action as the socket hands it on: through the schema, defaults filled.
func parsed(t *testing.T, a cs.Action) cs.Action {
	t.Helper()
	out, issues := cs.ParseAction(map[string]any(a))
	if issues != nil {
		t.Fatalf("%v: %v", a, issues)
	}
	return out
}

// A scene's prepared lines (house decision #73): saved whole, replaced, cleared; a line naming nothing is kept.
func TestScenePrep(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		nowhere := "00000000-0000-4000-8000-000000000001"
		prep := map[string]any{
			"roster":  []any{map[string]any{"id": "r", "pack": "no-such-pack", "key": "nobody", "count": float64(2)}},
			"tests":   []any{map[string]any{"id": "t", "testId": "no-such-test"}},
			"pools":   []any{map[string]any{"id": "p", "pool": "no-such-pool", "amount": float64(-2)}},
			"exits":   []any{map[string]any{"id": "e", "label": "Away", "sceneId": nowhere}},
			"reveals": []any{map[string]any{"id": "v", "entryId": nowhere}},
		}
		scene := run(t, tx, room, Save, parsed(t, save("scene", "S", cs.Action{"prep": prep})))
		read := func() (any, string) {
			got, err := Load(context.Background(), tx, room.ID)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range got.Entries {
				if e.ID == scene {
					return e.Prep, *e.Status
				}
			}
			t.Fatal("the scene is gone")
			return nil, ""
		}
		stored, status := read()
		want := `{"exits":[{"id":"e","label":"Away","sceneId":"` + nowhere + `"}],"pools":[{"amount":-2,"id":"p","pool":"no-such-pool","text":""}],` +
			`"reveals":[{"entryId":"` + nowhere + `","id":"v"}],"roster":[{"count":2,"id":"r","key":"nobody","pack":"no-such-pack","temporary":true,"visibility":"hidden"}],` +
			`"tests":[{"actorIds":[],"hideTarget":false,"id":"t","inputs":{},"outcomes":[],"takers":"party","testId":"no-such-test"}]}`
		if got := engine.CanonicalJSON(stored); got != want {
			t.Fatalf("every line is kept as sent, with its defaults:\n got %s\nwant %s", got, want)
		}
		if status != "planned" {
			t.Fatalf("a new scene is planned, got %q", status)
		}

		// A save without prep leaves it; a new document replaces it whole; null clears it.
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": scene, "body": "x"})
		if stored, _ := read(); stored == nil {
			t.Fatal("a save without prep keeps it")
		}
		run(t, tx, room, Save, parsed(t, cs.Action{"type": "codex.save", "kind": "scene", "id": scene,
			"prep": map[string]any{"exits": []any{map[string]any{"id": "e2", "label": "Back", "sceneId": nowhere}}}}))
		if stored, _ := read(); engine.CanonicalJSON(stored) !=
			`{"exits":[{"id":"e2","label":"Back","sceneId":"`+nowhere+`"}],"pools":[],"reveals":[],"roster":[],"tests":[]}` {
			t.Fatalf("a new document replaces the old one whole, got %s", engine.CanonicalJSON(stored))
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": scene, "prep": nil})
		if stored, _ := read(); stored != nil {
			t.Fatalf("null clears it, got %v", stored)
		}

		// Only a scene holds prepared lines, new or saved.
		npc := run(t, tx, room, Save, save("npc", "N", nil))
		refuses(t, tx, room, Save, save("npc", "M", cs.Action{"prep": nil}), "sceneOnly")
		refuses(t, tx, room, Save, parsed(t, cs.Action{"type": "codex.save", "kind": "scene", "id": npc, "prep": map[string]any{}}), "sceneOnly")
	})
}

// A scene's status: its own four values, a quest's three, none elsewhere; one scene of a room is active at a time.
func TestSceneStatus(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		status := func(id string) string {
			return dbtest.Scalar[string](t, tx, `SELECT status FROM codex_entry WHERE id = $1`, id)
		}
		a := run(t, tx, room, Save, save("scene", "A", nil))
		b := run(t, tx, room, Save, save("scene", "B", nil))
		for _, s := range cs.SceneStatuses {
			run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": a, "status": s})
			if got := status(a); got != s {
				t.Fatalf("want %q, got %q", s, got)
			}
		}
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": a, "status": "open"}, "wrongStatus")
		q := run(t, tx, room, Save, save("quest", "Q", nil))
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "quest", "id": q, "status": "active"}, "wrongStatus")
		refuses(t, tx, room, Save, save("lore", "L", cs.Action{"status": "planned"}), "onlyQuestStatus")

		// Making B active leaves A, the one being played, done; saving B active again changes nothing.
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": a, "status": "active"})
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": b, "status": "active"})
		if got := []string{status(a), status(b)}; got[0] != "done" || got[1] != "active" {
			t.Fatalf("one active scene, got %v", got)
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": b, "status": "active"})
		if status(b) != "active" {
			t.Fatal("saving the active scene active keeps it active")
		}
		// A new scene made active takes over too; another room's active scene is its own.
		other := dbtest.NewRoom(t, tx)
		elsewhere := run(t, tx, other, Save, save("scene", "E", cs.Action{"status": "active"}))
		c := run(t, tx, room, Save, save("scene", "C", cs.Action{"status": "active"}))
		if got := []string{status(b), status(c), status(elsewhere)}; got[0] != "done" || got[1] != "active" || got[2] != "active" {
			t.Fatalf("a new active scene leaves only this room's done, got %v", got)
		}
		// The database holds the rule for any other path.
		if _, err := tx.Exec(context.Background(), `SAVEPOINT s`); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(context.Background(), `UPDATE codex_entry SET status = 'active' WHERE id = $1`, a); err == nil {
			t.Fatal("two active scenes in one room")
		}
		if _, err := tx.Exec(context.Background(), `ROLLBACK TO SAVEPOINT s`); err != nil {
			t.Fatal(err)
		}
	})
}
