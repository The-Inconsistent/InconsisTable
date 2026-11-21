package table

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// A generator's confirmed run (house decision #98), through ApplyAction as the gateway runs it. The manifest and the
// pack are our own invention.

// generateFixture is fromPackFixture with a warren generator (a number, a roll that may go on to another table, a
// filtered pick, a chamber rolled per round) and an event generator whose one pick of a GM-only incident makes a scene.
func generateFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(fromPackFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	line := func(id string, from, to int, next ...string) map[string]any {
		l := map[string]any{"id": id, "label": id + " line", "range": []any{from, to}}
		if len(next) > 0 {
			l["next"] = next[0]
		}
		return l
	}
	table := func(lines ...any) map[string]any {
		return map[string]any{"title": "T", "die": "1d6", "visibility": "gm", "cite": "Fixture p.9", "entries": lines}
	}
	m["tables"] = map[string]any{
		"warren":   table(line("flooded", 1, 2), line("burrowed", 3, 4), line("built", 5, 6, "builders")),
		"builders": table(line("smiths", 1, 3), line("monks", 4, 6)),
		"chamber":  table(line("roots", 1, 3), line("pit", 4, 6)),
	}
	m["generators"] = []any{
		map[string]any{"id": "warren", "label": "Warren", "cite": "Fixture p.9",
			"steps": []any{
				map[string]any{"id": "rooms", "label": "Rooms", "kind": "number", "min": 1, "max": 3},
				map[string]any{"id": "origin", "label": "Origin", "kind": "roll", "table": "warren"},
				map[string]any{"id": "keeper", "label": "Keeper", "kind": "pick", "entity": "site",
					"filter": `steps.origin != "flooded" || entry.peril >= 3`},
			},
			"each": map[string]any{"times": "steps.rooms", "steps": []any{
				map[string]any{"id": "chamber", "label": "Chamber", "kind": "roll", "table": "chamber"}}},
			"make": map[string]any{"kind": "location", "title": "origin", "fields": map[string]any{"peril": "rooms"},
				"each": map[string]any{"title": "chamber"}}},
		map[string]any{"id": "event", "label": "Event", "cite": "Fixture p.9",
			"steps": []any{map[string]any{"id": "event", "label": "Event", "kind": "pick", "entity": "incident"}},
			"make":  map[string]any{"kind": "scene", "title": "event", "from": "event"}},
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func newGeneratePlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, generateFixture(t))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	p := &play{t, tx, room}
	p.attachAtlas(atlas)
	return p
}

func warrenRun(values map[string]any, each ...any) map[string]any {
	given := map[string]any{"rooms": map[string]any{"value": 2.0}, "origin": map[string]any{"rows": []any{"built", "monks"}},
		"keeper": map[string]any{"key": "mill"}}
	for k, v := range values {
		given[k] = v
	}
	if each == nil {
		each = []any{map[string]any{"chamber": map[string]any{"rows": []any{"pit"}}},
			map[string]any{"chamber": map[string]any{"rows": []any{"roots"}}}}
	}
	return map[string]any{"type": "codex.generate", "generatorId": "warren", "values": given, "each": each}
}

func TestAGeneratorRunMakesItsEntriesAndIsUndoneWhole(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newGeneratePlay(t, tx)
		gm := p.room.GM()
		made := p.send(gm, warrenRun(nil))
		if len(made.IDs) != 3 {
			t.Fatalf("the warren and its two chambers: %+v", made)
		}
		root, pit, roots := p.entry(made.IDs[0]), p.entry(made.IDs[1]), p.entry(made.IDs[2])
		if root.Title != "monks line" || root.Fields["peril"] != 2.0 || root.Parent != nil {
			t.Fatalf("the root: %+v", root)
		}
		if pit.Title != "pit line" || *pit.Parent != made.IDs[0] || roots.Title != "roots line" || *roots.Parent != made.IDs[0] {
			t.Fatalf("each chamber under the warren, in its round's order: %+v %+v", pit, roots)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		for _, id := range made.IDs {
			if p.entry(id) != nil {
				t.Fatalf("undo leaves %s", id)
			}
		}

		// A pick made from: the scene of the GM-only incident, with its lines.
		adventure := p.send(gm, map[string]any{"type": "codex.save", "kind": "adventure", "title": "Road"}).ID
		event := p.send(gm, map[string]any{"type": "codex.generate", "generatorId": "event", "parentId": adventure,
			"values": map[string]any{"event": map[string]any{"key": "toll"}}})
		scene := p.entry(event.ID)
		if scene.Title != "toll" || *scene.Parent != adventure || len(scene.Prep["tests"].([]any)) != 2 || scene.Source["key"] != "toll" {
			t.Fatalf("the scene made from the pick: %+v", scene)
		}
	})
}

func TestAGeneratorRunIsCheckedAgainstItsDeclaration(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newGeneratePlay(t, tx)
		gm := p.room.GM()
		chamber := func(row string) any { return map[string]any{"chamber": map[string]any{"rows": []any{row}}} }
		p.refused(gm, warrenRun(map[string]any{"origin": map[string]any{"rows": []any{"forged"}}}), "generateRow")
		p.refused(gm, warrenRun(map[string]any{"origin": map[string]any{"rows": []any{"flooded", "monks"}}}), "generateRow")
		p.refused(gm, warrenRun(nil, chamber("pit")), "generateCount")
		p.refused(gm, warrenRun(map[string]any{"rooms": map[string]any{"value": 4.0}}, chamber("pit"), chamber("pit"), chamber("pit"), chamber("pit")), "generateValue")
		p.refused(gm, warrenRun(map[string]any{"keeper": map[string]any{"key": "gone"}}), "generatePick")
		// A flooded warren's keeper has a peril of 3 or more: the cellar does, the mill does not.
		p.refused(gm, warrenRun(map[string]any{"origin": map[string]any{"rows": []any{"flooded"}}}), "generatePick")
		p.send(gm, warrenRun(map[string]any{"origin": map[string]any{"rows": []any{"flooded"}}, "keeper": map[string]any{"key": "cellar"}}))
		p.refused(gm, map[string]any{"type": "codex.generate", "generatorId": "nope", "values": map[string]any{}}, "noSuchGenerator")

		// A GM-only pack entry is picked only by the GM side: a co-GM who writes the codex without it is not served it,
		// and a player may not write the codex at all.
		event := map[string]any{"type": "codex.generate", "generatorId": "event", "values": map[string]any{"event": map[string]any{"key": "toll"}}}
		coGM := gm
		coGM.UserID = new(dbtest.User(t, tx, "Co"))
		coGM.Seat = cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"codex"}}
		p.refused(coGM, event, "generatePick")
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pat"))
		var refusal *cs.Error
		if _, err := p.try(player, event); !errors.As(err, &refusal) {
			t.Fatalf("a player is refused, got %v", err)
		}
		// Nesting: the run's root goes under an entry of its own kind only.
		npc := p.send(gm, map[string]any{"type": "codex.save", "kind": "npc", "title": "N"}).ID
		run := warrenRun(nil)
		run["parentId"] = npc
		p.refused(gm, run, "parentOtherKind")
	})
}
