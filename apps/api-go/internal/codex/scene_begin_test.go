package codex

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Beginning a scene, taking it back, and deleting an adventure with its scenes (house decision #86).

func begin(t *testing.T, tx pgx.Tx, room dbtest.Room, scene string) (string, []cs.Notice) {
	t.Helper()
	ctx, notices := cs.WithNotices(context.Background())
	r, err := Begin(ctx, tx, room.GM(), cs.Action{"type": "scene.begin", "sceneId": scene})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	return r.ID, *notices
}

func undo(id string) cs.Action { return cs.Action{"type": "scene.undoBegin", "beginId": id} }

func statusOf(t *testing.T, tx pgx.Tx, id string) string {
	t.Helper()
	return dbtest.Scalar[string](t, tx, `SELECT status FROM codex_entry WHERE id = $1`, id)
}

func shown(t *testing.T, tx pgx.Tx, id string) (visibility string, stamped bool) {
	t.Helper()
	return dbtest.Scalar[string](t, tx, `SELECT visibility FROM codex_entry WHERE id = $1`, id),
		dbtest.Scalar[bool](t, tx, `SELECT revealed_at IS NOT NULL FROM codex_entry WHERE id = $1`, id)
}

func reveals(entries ...string) cs.Action {
	lines := []any{}
	for i, e := range entries {
		lines = append(lines, map[string]any{"id": "r" + string(rune('a'+i)), "label": "Line " + string(rune('A'+i)), "entryId": e})
	}
	return cs.Action{"prep": map[string]any{"roster": []any{}, "tests": []any{}, "pools": []any{}, "exits": []any{}, "reveals": lines}}
}

func TestBeginRevealsAndTakingItBackSealsWhatItRevealed(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		adventure := run(t, tx, room, Save, save("adventure", "A", nil))
		npc := run(t, tx, room, Save, save("npc", "Keeper", nil))
		map1 := run(t, tx, room, Save, save("handout", "Map", nil))
		known := run(t, tx, room, Save, save("lore", "Known", nil))
		gone := run(t, tx, room, Save, save("lore", "Gone", nil))
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": known, "visibility": "party", "audienceMode": "all", "audience": []any{}})
		first := run(t, tx, room, Save, save("scene", "First", nil))
		run(t, tx, room, Move, move(first, adventure, 0))
		second := run(t, tx, room, Save, save("scene", "Second", reveals(npc, map1, known, gone)))
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": gone})

		firstBegin, _ := begin(t, tx, room, first)
		id, notices := begin(t, tx, room, second)
		if statusOf(t, tx, first) != "done" || statusOf(t, tx, second) != "active" {
			t.Fatal("the scene being played goes to done, the begun one is active")
		}
		for _, e := range []string{npc, map1, known} {
			if v, at := shown(t, tx, e); v != "party" || !at {
				t.Fatalf("%s: %s %v", e, v, at)
			}
		}
		want := []cs.Notice{cs.RevealSkipped("Line D", "entryNotFound"), cs.SceneBegun("Second", 3)}
		if !reflect.DeepEqual(notices, want) {
			t.Fatalf("notices %+v, want %+v", notices, want)
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM codex_reveal`); n != 0 {
			t.Fatal("no listed readers")
		}

		refuses(t, tx, room, UndoBegin, undo(firstBegin), "notLatestBegin")
		run(t, tx, room, UndoBegin, undo(id))
		if statusOf(t, tx, first) != "active" || statusOf(t, tx, second) != "planned" {
			t.Fatalf("back: first %s, second %s", statusOf(t, tx, first), statusOf(t, tx, second))
		}
		for _, e := range []string{npc, map1} {
			if v, at := shown(t, tx, e); v != "gm" || at {
				t.Fatalf("%s sealed again: %s %v", e, v, at)
			}
		}
		if v, _ := shown(t, tx, known); v != "party" {
			t.Fatal("an entry revealed before the begin stays revealed")
		}
		refuses(t, tx, room, UndoBegin, undo(id), "notLatestBegin")

		// A begin whose scene is no longer the one being played is not taken back.
		again, _ := begin(t, tx, room, second)
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": second, "status": "done"})
		refuses(t, tx, room, UndoBegin, undo(again), "sceneNotActive")
		refuses(t, tx, room, Begin, cs.Action{"type": "scene.begin", "sceneId": npc}, "notAScene")
	})
}

// The codex payload carries the latest begin while its scene is the one being played (house decision #105).
func TestLatestBeginIsTheRoomsLatestWhileItsSceneIsActive(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		npc := run(t, tx, room, Save, save("npc", "Keeper", nil))
		first := run(t, tx, room, Save, save("scene", "First", reveals(npc)))
		second := run(t, tx, room, Save, save("scene", "Second", nil))
		latest := func() *cs.LatestBegin {
			t.Helper()
			c, err := Load(context.Background(), tx, room.ID)
			if err != nil {
				t.Fatal(err)
			}
			return c.LatestBegin
		}
		if latest() != nil {
			t.Fatal("no begin yet")
		}
		one, _ := begin(t, tx, room, first)
		if got := latest(); !reflect.DeepEqual(got, &cs.LatestBegin{ID: one, SceneID: first, Revealed: []string{npc}}) {
			t.Fatalf("after a begin: %+v", got)
		}
		two, _ := begin(t, tx, room, second)
		if got := latest(); got == nil || got.ID != two || got.SceneID != second || len(got.Revealed) != 0 {
			t.Fatalf("the second begin is the latest, with nothing revealed: %+v", got)
		}
		// Taking it back deletes that begin: the first is the latest again, and its scene is active again.
		run(t, tx, room, UndoBegin, undo(two))
		if got := latest(); got == nil || got.ID != one {
			t.Fatalf("after undo: %+v", got)
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "scene", "id": first, "status": "done"})
		if latest() != nil {
			t.Fatal("its scene is no longer active")
		}
	})
}

func TestBeginWithNothingBeforeAndAnEntryRevealedTwice(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		npc := run(t, tx, room, Save, save("npc", "Keeper", nil))
		scene := run(t, tx, room, Save, save("scene", "Only", reveals(npc)))
		id, _ := begin(t, tx, room, scene)
		run(t, tx, room, UndoBegin, undo(id))
		if statusOf(t, tx, scene) != "planned" {
			t.Fatal("with no scene before, the begun one goes back to its status and none is active")
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM codex_entry WHERE campaign_id = $1 AND status = 'active'`, room.ID); n != 0 {
			t.Fatal("no scene active")
		}
		if v, _ := shown(t, tx, npc); v != "gm" {
			t.Fatal("sealed")
		}
	})
}

func TestDeletingAnAdventureTakesItsScenesWhenAsked(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		adventure := run(t, tx, room, Save, save("adventure", "A", nil))
		scene := run(t, tx, room, Save, save("scene", "S", nil))
		run(t, tx, room, Move, move(scene, adventure, 0))
		npc := run(t, tx, room, Save, save("npc", "Keeper", nil))
		other := run(t, tx, room, Save, save("scene", "Elsewhere", cs.Action{"prep": map[string]any{
			"exits": []any{map[string]any{"id": "e", "label": "On", "sceneId": scene}}}}))
		run(t, tx, room, Link, cs.Action{"type": "codex.link", "id": scene, "targetId": npc})
		begin(t, tx, room, scene)

		refuses(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": adventure}, "adventureHasScenes")
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": adventure, "withScenes": true})
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM codex_entry WHERE id IN ($1, $2)`, adventure, scene); n != 0 {
			t.Fatal("the adventure and its scene are gone")
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM scene_begin WHERE campaign_id = $1`, room.ID); n != 0 {
			t.Fatal("its begin goes with it")
		}
		// What pointed at the scene stays, unlinked: the exit line is kept and shows broken.
		if got := dbtest.Scalar[string](t, tx, `SELECT prep->'exits'->0->>'sceneId' FROM codex_entry WHERE id = $1`, other); got != scene {
			t.Fatal("the exit line stays")
		}
	})
}

// A scene on its own goes, however much points at it: one shaped like an imported room's (every prep line, a link, an
// exit to it, revealed, begun and then left for another, shown to the table, a clock about it) and one made by hand.
func TestDeletingASceneAloneTakesWhatHangsOnIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		adventure := run(t, tx, room, Save, save("adventure", "A", nil))
		npc := run(t, tx, room, Save, save("npc", "Keeper", nil))
		place := run(t, tx, room, Save, save("location", "Quay", nil))
		full := run(t, tx, room, Save, save("scene", "Full", nil))
		bare := run(t, tx, room, Save, save("scene", "Bare", nil))
		next := run(t, tx, room, Save, save("scene", "Next", nil))
		for i, s := range []string{full, bare, next} {
			run(t, tx, room, Move, move(s, adventure, float64(i)))
		}
		// The prep a room document writes as it came.
		dbtest.Exec(t, tx, `UPDATE codex_entry SET prep = $2::jsonb, planned_tests = '{check}' WHERE id = $1`, full, `{
			"roster": [{"id": "r1", "label": "Wisps", "pack": "p", "key": "k", "count": 2, "visibility": "gm", "marker": "amber"}],
			"tests": [{"id": "t1", "testId": "check", "inputs": {"dn": 3}, "takers": "all", "outcomes": [{"label": "Pass", "text": "On"}]}],
			"pools": [{"id": "p1", "pool": "glory", "amount": 1, "text": "x"}],
			"exits": [{"id": "e1", "label": "On", "sceneId": "`+next+`"}],
			"reveals": [{"id": "v1", "entryId": "`+npc+`"}],
			"picks": [{"id": "k1", "entryId": "`+place+`", "field": "dangers", "rows": [{"rowId": "d1", "on": true}]}]}`)
		dbtest.Exec(t, tx, `UPDATE codex_entry SET prep = $2::jsonb WHERE id = $1`, next,
			`{"exits": [{"id": "back", "label": "Back", "sceneId": "`+full+`"}]}`)
		run(t, tx, room, Link, cs.Action{"type": "codex.link", "id": full, "targetId": npc})
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": full, "visibility": "party", "audienceMode": "all", "audience": []any{}})
		begin(t, tx, room, full)
		begin(t, tx, room, next) // its begin keeps the full scene as the one before
		run(t, tx, room, ShowSpotlight, show(full))
		dbtest.Exec(t, tx, `INSERT INTO clock (campaign_id, name, segments, entry_id, position) VALUES ($1, 'Tide', 4, $2, 0)`, room.ID, full)

		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": full})
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": bare})
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM codex_entry WHERE id IN ($1, $2)`, full, bare); n != 0 {
			t.Fatal("both scenes are gone")
		}
		if got := positions(t, tx, next); got[0] != 0 {
			t.Fatalf("the scene left is renumbered, got %v", got)
		}
		for what, q := range map[string]string{
			"its links":     `SELECT count(*) FROM codex_link WHERE entry_id = $1 OR target_id = $1`,
			"its begin":     `SELECT count(*) FROM scene_begin WHERE scene_id = $1 OR before_id = $1`,
			"the spotlight": `SELECT count(*) FROM spotlight WHERE entry_id = $1`,
			"the clock's":   `SELECT count(*) FROM clock WHERE entry_id = $1`,
		} {
			if n := dbtest.Scalar[int64](t, tx, q, full); n != 0 {
				t.Fatalf("%s go with it", what)
			}
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM scene_begin WHERE scene_id = $1`, next); n != 1 {
			t.Fatal("the next scene's begin stays")
		}
		if got := dbtest.Scalar[string](t, tx, `SELECT prep->'exits'->0->>'sceneId' FROM codex_entry WHERE id = $1`, next); got != full {
			t.Fatal("an exit to it stays, unlinked")
		}
	})
}
