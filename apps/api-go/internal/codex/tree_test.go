package codex

import (
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func move(id string, parent any, at float64) cs.Action {
	return cs.Action{"type": "codex.move", "id": id, "parentId": parent, "position": at}
}

func parentOf(t *testing.T, tx pgx.Tx, id string) *string {
	t.Helper()
	return dbtest.Scalar[*string](t, tx, `SELECT parent_id::text FROM codex_entry WHERE id = $1`, id)
}

// House decision #69: any kind nests in its own kind, never into itself, at most maxDepth levels.
func TestEntryTree(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		top := run(t, tx, room, Save, save("location", "Top", nil))
		mid := run(t, tx, room, Save, save("location", "Mid", nil))
		leaf := run(t, tx, room, Save, save("location", "Leaf", nil))
		run(t, tx, room, Move, move(mid, top, 0))
		run(t, tx, room, Move, move(leaf, mid, 0))
		if p := parentOf(t, tx, leaf); p == nil || *p != mid {
			t.Fatalf("leaf sits under mid, got %v", p)
		}

		refuses(t, tx, room, Move, move(top, leaf, 0), "wouldLoop")
		refuses(t, tx, room, Move, move(top, mid, 0), "wouldLoop")
		refuses(t, tx, room, Move, move(mid, mid, 0), "wouldLoop")

		lore := run(t, tx, room, Save, save("lore", "L", nil))
		refuses(t, tx, room, Move, move(lore, top, 0), "parentOtherKind")
		refuses(t, tx, room, Move, move(top, lore, 0), "parentOtherKind")
		inner := run(t, tx, room, Save, save("lore", "L2", nil))
		run(t, tx, room, Move, move(inner, lore, 0))

		// A chain of eight is the limit: a ninth level is refused, and so is a branch that would reach it.
		chain := []string{}
		for i := range maxDepth {
			id := run(t, tx, room, Save, save("faction", "F", nil))
			if i > 0 {
				run(t, tx, room, Move, move(id, chain[i-1], 0))
			}
			chain = append(chain, id)
		}
		ninth := run(t, tx, room, Save, save("faction", "F9", nil))
		refuses(t, tx, room, Move, move(ninth, chain[maxDepth-1], 0), "tooDeep")
		run(t, tx, room, Move, move(ninth, chain[maxDepth-2], 0))
		branch := run(t, tx, room, Save, save("faction", "B", nil))
		twig := run(t, tx, room, Save, save("faction", "T", nil))
		run(t, tx, room, Move, move(twig, branch, 0))
		refuses(t, tx, room, Move, move(branch, chain[maxDepth-2], 0), "tooDeep")
		run(t, tx, room, Move, move(branch, chain[maxDepth-3], 0))

		// Scenes keep their own rule; adventures now nest like any other kind.
		adv := run(t, tx, room, Save, save("adventure", "A", nil))
		sub := run(t, tx, room, Save, save("adventure", "A2", nil))
		scene := run(t, tx, room, Save, save("scene", "S", nil))
		run(t, tx, room, Move, move(sub, adv, 0))
		run(t, tx, room, Move, move(scene, sub, 0))
		refuses(t, tx, room, Move, move(scene, top, 0), "sceneNeedsAdventure")
		refuses(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": sub}, "adventureHasScenes")
	})
}

// Deleting an entry moves its children up into its place among its siblings, in their order.
func TestDeleteMakesChildrenRoots(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		top := run(t, tx, room, Save, save("location", "Top", nil))
		first := run(t, tx, room, Save, save("location", "First", nil))
		mid := run(t, tx, room, Save, save("location", "Mid", nil))
		last := run(t, tx, room, Save, save("location", "Last", nil))
		c1 := run(t, tx, room, Save, save("location", "C1", nil))
		c2 := run(t, tx, room, Save, save("location", "C2", nil))
		grand := run(t, tx, room, Save, save("location", "G", nil))
		for i, id := range []string{first, mid, last} {
			run(t, tx, room, Move, move(id, top, float64(i)))
		}
		run(t, tx, room, Move, move(c2, mid, 0))
		run(t, tx, room, Move, move(c1, mid, 0))
		run(t, tx, room, Move, move(grand, c1, 0))

		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": mid})
		for _, id := range []string{c1, c2} {
			if p := parentOf(t, tx, id); p != nil {
				t.Fatalf("a child of the deleted entry becomes a root, got %v", p)
			}
		}
		if p := parentOf(t, tx, grand); p == nil || *p != c1 {
			t.Fatalf("a grandchild stays where it is, got %v", p)
		}
		if got := positions(t, tx, first, last); !slices.Equal(got, []int{0, 1}) {
			t.Fatalf("the siblings it left close up: want 0 1, got %v", got)
		}
		if got := positions(t, tx, top, c1, c2); !slices.Equal(got, []int{0, 1, 2}) {
			t.Fatalf("the new roots follow the roots there were, in their order: want 0 1 2, got %v", got)
		}

		// A root's children become roots.
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": top})
		if parentOf(t, tx, c1) != nil || parentOf(t, tx, last) != nil {
			t.Fatal("the children of a deleted root are roots")
		}
	})
}
