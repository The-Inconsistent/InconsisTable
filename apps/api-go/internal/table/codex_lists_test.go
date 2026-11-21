package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Tags, rows, a scene's picks and a kind's reminders (house decision #89), through ApplyAction as the gateway runs
// them. The manifest and the pack are our own invention.

// listsFixture is fieldsFixture with a place's gm dangers (filled from a boon, a ref to gear, a Test), a band's gm
// marks (boon names or one fixed word, no write-in) and a reminder on its gm footing, and a quest's party road log.
func listsFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(fieldsFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	kinds := m["codex"].(map[string]any)["kinds"].(map[string]any)
	kinds["location"] = map[string]any{"fields": map[string]any{
		"dangers": map[string]any{"type": "rows", "label": "Dangers", "maxRows": 3, "pick": map[string]any{"label": "Seen"},
			"columns": []any{
				map[string]any{"id": "name", "label": "Name", "type": "text", "maxLength": 20},
				map[string]any{"id": "threat", "label": "Threat", "type": "int", "min": 0, "max": 9},
				map[string]any{"id": "gear", "label": "Gear", "type": "ref", "entity": "gear"},
				map[string]any{"id": "check", "label": "Check", "type": "test"},
			},
			"from": []any{map[string]any{"entity": "boon", "name": "name"}}},
	}}
	faction := kinds["faction"].(map[string]any)
	faction["fields"].(map[string]any)["marks"] = map[string]any{"type": "tags", "label": "Marks", "entities": []any{"boon"},
		"options": []any{"lone"}, "maxItems": 3}
	faction["reminders"] = []any{map[string]any{"id": "odd", "if": `fields.footing == "ally" && contains(fields.marks, "lone")`, "text": "Odd ally"}}
	kinds["quest"] = map[string]any{"fields": map[string]any{
		"log": map[string]any{"type": "rows", "label": "Log", "visibility": "party",
			"columns": []any{map[string]any{"id": "what", "label": "What", "type": "text"}}},
	}}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestTagsAndRowsAreSavedCheckedAndSentByVisibility(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, listsFixture(t))
		p := &play{t, tx, room}
		p.attachFieldsPack()
		gm := room.GM()
		save := func(kind, title string, fields map[string]any) string {
			return p.send(gm, map[string]any{"type": "codex.save", "kind": kind, "title": title, "fields": fields}).ID
		}
		check := map[string]any{"testId": "check", "inputs": map[string]any{"dc": 12.0}}
		dangers := []any{
			map[string]any{"id": "d1", "from": map[string]any{"entity": "boon", "key": "lurker", "cite": "Fixture p.1"},
				"values": map[string]any{"name": "lurker", "threat": 2.0, "check": check}},
			map[string]any{"id": "d2", "values": map[string]any{"name": "Rope bridge", "gear": "rope"}},
		}
		place := save("location", "Ford", map[string]any{"dangers": dangers})
		band := save("faction", "Band", map[string]any{"footing": "ally", "marks": []any{"lone", "hound"}})
		road := save("quest", "Road", map[string]any{"log": []any{map[string]any{"id": "l1", "values": map[string]any{"what": "Set out"}}}})
		if got := p.storedFields(place)["dangers"].([]any); len(got) != 2 {
			t.Fatalf("the rows are stored whole, got %v", got)
		}

		fields := func(kind, id string, f map[string]any) map[string]any {
			return map[string]any{"type": "codex.save", "id": id, "kind": kind, "fields": f}
		}
		row := func(r map[string]any) map[string]any {
			return fields("location", place, map[string]any{"dangers": []any{r}})
		}
		for _, bad := range []map[string]any{
			row(map[string]any{"id": "x", "values": map[string]any{"threat": 10.0}}),                                              // over the column's max
			row(map[string]any{"id": "x", "values": map[string]any{"nope": 1.0}}),                                                 // no such column
			row(map[string]any{"id": "x", "values": map[string]any{"gear": "lurker"}}),                                            // not served as gear
			row(map[string]any{"id": "x", "values": map[string]any{"check": map[string]any{"testId": "gone"}}}),                   // no such Test
			row(map[string]any{"id": "x", "from": map[string]any{"entity": "boon", "key": "nobody"}, "values": map[string]any{}}), // no such entry
			row(map[string]any{"id": "x", "from": map[string]any{"entity": "gear", "key": "rope"}, "values": map[string]any{}}),   // not filled from gear
			fields("location", place, map[string]any{"dangers": []any{
				map[string]any{"id": "a", "values": map[string]any{}}, map[string]any{"id": "a", "values": map[string]any{}}}}), // an id twice
			fields("location", place, map[string]any{"dangers": []any{
				map[string]any{"id": "a", "values": map[string]any{}}, map[string]any{"id": "b", "values": map[string]any{}},
				map[string]any{"id": "c", "values": map[string]any{}}, map[string]any{"id": "d", "values": map[string]any{}}}}), // over maxRows
			fields("faction", band, map[string]any{"marks": []any{"stranger"}}),                        // no write-in
			fields("faction", band, map[string]any{"marks": []any{"lone", "lone"}}),                    // a word twice
			fields("faction", band, map[string]any{"marks": []any{"lone", "hound", "lurker", "rope"}}), // over maxItems
		} {
			p.refused(gm, bad, "badEntryField")
		}

		player := room.Seat(t, tx, dbtest.User(t, tx, "P"))
		for _, id := range []string{place, band, road} {
			p.send(gm, map[string]any{"type": "codex.reveal", "id": id, "visibility": "party", "audienceMode": "all"})
		}
		fieldsOf := func(c cs.Ctx, id string) map[string]any {
			for _, e := range p.seatView(c).Codex.Entries {
				if e.ID == id {
					return e.Fields
				}
			}
			return nil
		}
		if f := fieldsOf(player, place); len(f) != 0 {
			t.Fatalf("a player receives nothing of a gm rows field, got %v", f)
		}
		if f := fieldsOf(player, band); len(f) != 0 {
			t.Fatalf("a player receives nothing of a gm tags field, got %v", f)
		}
		if f := fieldsOf(player, road); len(f["log"].([]any)) != 1 {
			t.Fatalf("a player receives a party rows field, got %v", f)
		}
		if f := fieldsOf(gm, place); len(f["dangers"].([]any)) != 2 {
			t.Fatalf("the GM receives the gm rows, got %v", f)
		}
		// The band's reminder reads its gm footing and marks: the player's manifest does not carry it, the GM's does.
		var manifest map[string]any
		raw := dbtest.Scalar[[]byte](t, tx, `SELECT manifest FROM ruleset_version WHERE id =
			(SELECT ruleset_version_id FROM campaign WHERE id = $1)`, room.ID)
		if err := json.Unmarshal(raw, &manifest); err != nil {
			t.Fatal(err)
		}
		reminders := func(c cs.Ctx) []any {
			codex, _ := view.SeatManifest(manifest, c)["codex"].(map[string]any)
			kinds, _ := codex["kinds"].(map[string]any)
			k, _ := kinds["faction"].(map[string]any)
			list, _ := k["reminders"].([]any)
			return list
		}
		if len(reminders(player)) != 0 || len(reminders(gm)) != 1 {
			t.Fatalf("a reminder goes only where its fields go: player %v, gm %v", reminders(player), reminders(gm))
		}
	})
}

// A scene picks rows of a place's rows field; the switch is an ordinary save of the scene's prep (house decision #89).
func TestASceneKeepsItsPicksAndTheirSwitch(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, listsFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		place := p.send(gm, map[string]any{"type": "codex.save", "kind": "location", "title": "Ford", "fields": map[string]any{
			"dangers": []any{map[string]any{"id": "d1", "values": map[string]any{"name": "Mud"}}}}}).ID
		scene := p.send(gm, map[string]any{"type": "codex.save", "kind": "scene", "title": "S"}).ID
		pick := func(on bool) map[string]any {
			return map[string]any{"type": "codex.save", "id": scene, "kind": "scene", "prep": map[string]any{"picks": []any{
				map[string]any{"id": "k1", "entryId": place, "field": "dangers", "rows": []any{map[string]any{"rowId": "d1", "on": on}}}}}}
		}
		p.send(gm, pick(false))
		p.send(gm, pick(true))
		prep := dbtest.Scalar[map[string]any](t, tx, `SELECT prep FROM codex_entry WHERE id = $1`, scene)
		rows := prep["picks"].([]any)[0].(map[string]any)["rows"].([]any)
		if rows[0].(map[string]any)["on"] != true {
			t.Fatalf("the switch is saved with the prep, got %v", prep)
		}
		// A pick of a row the place no longer has is kept, for the screen to show as broken.
		p.send(gm, map[string]any{"type": "codex.save", "id": place, "kind": "location", "fields": map[string]any{"dangers": []any{}}})
		if got := dbtest.Scalar[map[string]any](t, tx, `SELECT prep FROM codex_entry WHERE id = $1`, scene); len(got["picks"].([]any)) != 1 {
			t.Fatalf("a stale pick stays, got %v", got)
		}
	})
}
