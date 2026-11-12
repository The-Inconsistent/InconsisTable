package codex

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func run(t *testing.T, tx pgx.Tx, room dbtest.Room, fn func(context.Context, core.Conn, cs.Ctx, cs.Action) (cs.Result, error), a cs.Action) string {
	t.Helper()
	r, err := fn(context.Background(), tx, room.GM(), a)
	if err != nil {
		t.Fatalf("%v: %v", a, err)
	}
	return r.ID
}

func refuses(t *testing.T, tx pgx.Tx, room dbtest.Room, fn func(context.Context, core.Conn, cs.Ctx, cs.Action) (cs.Result, error), a cs.Action, code string) {
	t.Helper()
	_, err := fn(context.Background(), tx, room.GM(), a)
	var e *cs.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("%v: want refusal %q, got %v", a, code, err)
	}
}

func save(kind, title string, more cs.Action) cs.Action {
	a := cs.Action{"type": "codex.save", "kind": kind, "title": title}
	for k, v := range more {
		a[k] = v
	}
	return a
}

func positions(t *testing.T, tx pgx.Tx, ids ...string) []int {
	t.Helper()
	out := []int{}
	for _, id := range ids {
		out = append(out, dbtest.Scalar[int](t, tx, `SELECT position FROM codex_entry WHERE id = $1`, id))
	}
	return out
}

func TestQuestStatus(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		q := run(t, tx, room, Save, save("quest", "Q", nil))
		if got := dbtest.Scalar[string](t, tx, `SELECT status FROM codex_entry WHERE id = $1`, q); got != "open" {
			t.Fatalf("a new quest is open, got %q", got)
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "quest", "id": q, "status": "done"})
		if got := dbtest.Scalar[string](t, tx, `SELECT status FROM codex_entry WHERE id = $1`, q); got != "done" {
			t.Fatalf("want done, got %q", got)
		}
		npc := run(t, tx, room, Save, save("npc", "N", nil))
		refuses(t, tx, room, Save, save("npc", "N2", cs.Action{"status": "open"}), "onlyQuestStatus")
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "npc", "id": npc, "status": "open"}, "onlyQuestStatus")
		// The kind is the stored one: a client can't pass a quest's id as an npc to dodge the rule either way.
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "quest", "id": npc, "status": "open"}, "onlyQuestStatus")
		if dbtest.Scalar[bool](t, tx, `SELECT status IS NULL FROM codex_entry WHERE id = $1`, npc) != true {
			t.Fatal("a non-quest has no status")
		}
	})
}

func TestSceneParentsAndMove(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		other := dbtest.NewRoom(t, tx)
		adv := run(t, tx, room, Save, save("adventure", "A", nil))
		adv2 := run(t, tx, room, Save, save("adventure", "B", nil))
		s1 := run(t, tx, room, Save, save("scene", "1", nil))
		s2 := run(t, tx, room, Save, save("scene", "2", nil))
		s3 := run(t, tx, room, Save, save("scene", "3", nil))
		npc := run(t, tx, room, Save, save("npc", "N", nil))
		foreign := run(t, tx, other, Save, save("adventure", "F", nil))

		move := func(id string, parent any, at float64) cs.Action {
			return cs.Action{"type": "codex.move", "id": id, "parentId": parent, "position": at}
		}
		for i, s := range []string{s1, s2, s3} {
			run(t, tx, room, Move, move(s, adv, float64(i)))
		}
		if got := positions(t, tx, s1, s2, s3); !slices.Equal(got, []int{0, 1, 2}) {
			t.Fatalf("want 0 1 2, got %v", got)
		}
		// Insert the last scene first; a wild position is cut to the end, never stored as sent.
		run(t, tx, room, Move, move(s3, adv, 0))
		if got := positions(t, tx, s1, s2, s3); !slices.Equal(got, []int{1, 2, 0}) {
			t.Fatalf("want 1 2 0, got %v", got)
		}
		run(t, tx, room, Move, move(s3, adv, 9999))
		if got := positions(t, tx, s1, s2, s3); !slices.Equal(got, []int{0, 1, 2}) {
			t.Fatalf("want 0 1 2, got %v", got)
		}
		// Reparenting closes the gap it leaves.
		run(t, tx, room, Move, move(s1, adv2, 0))
		if got := positions(t, tx, s1, s2, s3); !slices.Equal(got, []int{0, 0, 1}) {
			t.Fatalf("want 0 0 1, got %v", got)
		}
		run(t, tx, room, Move, move(s1, nil, 0))
		if dbtest.Scalar[bool](t, tx, `SELECT parent_id IS NULL FROM codex_entry WHERE id = $1`, s1) != true {
			t.Fatal("a scene can be taken out of its adventure")
		}

		refuses(t, tx, room, Move, move(npc, adv, 0), "sceneNeedsAdventure")
		refuses(t, tx, room, Move, move(adv2, adv, 0), "sceneNeedsAdventure")
		refuses(t, tx, room, Move, move(s2, s3, 0), "sceneNeedsAdventure")
		refuses(t, tx, room, Move, move(s2, foreign, 0), "entryNotFound")
		refuses(t, tx, room, Move, move(foreign, nil, 0), "entryNotFound")

		// An adventure that still has scenes stays; once they are gone it can go.
		refuses(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": adv}, "adventureHasScenes")
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": s2})
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": s3})
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": adv})

		// Adventures are ordered among themselves.
		run(t, tx, room, Move, move(adv2, nil, 0))
		if got := positions(t, tx, adv2); got[0] != 0 {
			t.Fatalf("want 0, got %v", got)
		}
	})
}

func TestLinks(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		other := dbtest.NewRoom(t, tx)
		scene := run(t, tx, room, Save, save("scene", "S", nil))
		npc := run(t, tx, room, Save, save("npc", "N", nil))
		adv := run(t, tx, room, Save, save("adventure", "A", nil))
		foreign := run(t, tx, other, Save, save("npc", "F", nil))
		link := func(id, target string) cs.Action {
			return cs.Action{"type": "codex.link", "id": id, "targetId": target}
		}

		run(t, tx, room, Link, link(scene, npc))
		run(t, tx, room, Link, link(scene, npc))
		count := func() int {
			return dbtest.Scalar[int](t, tx, `SELECT count(*) FROM codex_link WHERE entry_id = $1`, scene)
		}
		if count() != 1 {
			t.Fatalf("linking twice is one link, got %d", count())
		}
		refuses(t, tx, room, Link, link(scene, adv), "cantLinkThat")
		refuses(t, tx, room, Link, link(scene, scene), "cantLinkThat")
		refuses(t, tx, room, Link, link(npc, scene), "cantLinkThat")
		refuses(t, tx, room, Link, link(scene, foreign), "entryNotFound")
		refuses(t, tx, room, Link, link(foreign, npc), "entryNotFound")
		refuses(t, tx, room, Unlink, cs.Action{"type": "codex.unlink", "id": foreign, "targetId": npc}, "entryNotFound")

		got, err := Load(context.Background(), tx, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range got.Entries {
			if e.ID == scene && !slices.Equal(e.Links, []string{npc}) {
				t.Fatalf("the snapshot carries the link, got %v", e.Links)
			}
		}

		unlink := cs.Action{"type": "codex.unlink", "id": scene, "targetId": npc}
		run(t, tx, room, Unlink, unlink)
		run(t, tx, room, Unlink, unlink)
		if count() != 0 {
			t.Fatal("unlinked")
		}

		// Deleting either end takes the link with it.
		run(t, tx, room, Link, link(scene, npc))
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": npc})
		if count() != 0 {
			t.Fatal("a deleted target takes its links")
		}
	})
}

func TestPlannedTests(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		scene := run(t, tx, room, Save, save("scene", "S", cs.Action{"plannedTests": []any{"check", "check", "gone"}}))
		read := func() []string {
			got, err := Load(context.Background(), tx, room.ID)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range got.Entries {
				if e.ID == scene {
					return e.PlannedTests
				}
			}
			return nil
		}
		if got := read(); !slices.Equal(got, []string{"check", "gone"}) {
			t.Fatalf("duplicates are dropped, unknown ids kept, got %v", got)
		}
		// A save that doesn't send them leaves them; an empty list clears them.
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": scene, "body": "x"})
		if len(read()) != 2 {
			t.Fatal("a save without plannedTests keeps them")
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": scene, "plannedTests": []any{}})
		if len(read()) != 0 {
			t.Fatal("an empty list clears them")
		}
		refuses(t, tx, room, Save, save("npc", "N", cs.Action{"plannedTests": []any{"check"}}), "onlySceneTests")
	})
}
