package table

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Entries made from pack entries (house decision #97), through ApplyAction as the gateway runs them. The manifest and
// the pack are our own invention.

// fromPackFixture is playFixture with sites nested through `within`, incidents naming checks and foes, a place made
// from a site (its peril mapped, the sites inside it nested) and a scene made from an incident.
func fromPackFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["entities"] = append(m["entities"].([]any),
		map[string]any{"id": "site", "label": "Site", "base": "item", "fields": map[string]any{
			"within": map[string]any{"type": "ref", "label": "Within", "entity": "site", "visibility": "public"},
			"peril":  map[string]any{"type": "int", "label": "Peril", "min": 0, "max": 10, "visibility": "public"},
		}},
		map[string]any{"id": "incident", "label": "Incident", "base": "item", "fields": map[string]any{
			"checks": map[string]any{"type": "list", "label": "Checks", "visibility": "public"},
			"dc":     map[string]any{"type": "int", "label": "DC", "visibility": "public"},
			"foes":   map[string]any{"type": "list", "label": "Foes", "visibility": "public"},
		}})
	m["codex"] = map[string]any{"kinds": map[string]any{
		"location": map[string]any{
			"fields": map[string]any{"peril": map[string]any{"type": "int", "label": "Peril", "min": 0, "max": 10}},
			"from":   []any{map[string]any{"entity": "site", "values": map[string]any{"peril": "peril"}, "children": "within"}},
		},
		"scene": map[string]any{"fields": map[string]any{}, "from": []any{map[string]any{"entity": "incident",
			"tests": map[string]any{"field": "checks", "inputs": map[string]any{"dc": "dc"}}, "roster": "foes"}}},
	}}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// newFromPackPlay is a room on fromPackFixture with a session running, so Undo has one to work in.
func newFromPackPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, fromPackFixture(t))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// attachAtlas attaches a pack of entries, each {key, type, visibility, body as JSON}, named after their key.
func (p *play) attachAtlas(entries [][4]string) {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-atlas', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', $3, 0) RETURNING id::text`, pack, rulesetVersion, len(entries))
	for _, e := range entries {
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, $3, $2, '{}', $4, 'Atlas p.1', 'h', $5::jsonb)`, version, e[0], e[1], e[2], e[3])
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
}

var atlas = [][4]string{
	{"mill", "site", "party", `{"peril": 2}`},
	{"cellar", "site", "party", `{"within": "mill", "peril": 4}`},
	{"well", "site", "party", `{"within": "cellar"}`},
	{"toll", "incident", "gm", `{"checks": ["check", "gambit"], "dc": 12, "foes": ["wolf", "wolf", "ghost"]}`},
	{"wolf", "character", "gm", `{}`},
}

type madeEntry struct {
	Title  string
	Parent *string
	Source map[string]any
	Fields map[string]any
	Prep   map[string]any
}

func (p *play) entry(id string) *madeEntry {
	p.t.Helper()
	var e madeEntry
	err := p.tx.QueryRow(p.t.Context(), `SELECT title, parent_id::text, source, fields, prep FROM codex_entry WHERE id = $1`, id).
		Scan(&e.Title, &e.Parent, &e.Source, &e.Fields, &e.Prep)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		p.t.Fatal(err)
	}
	return &e
}

func TestAnEntryIsMadeFromAPackEntryWithTheOnesInsideItAndUndoneWhole(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newFromPackPlay(t, tx)
		p.attachAtlas(atlas)
		gm := p.room.GM()

		made := p.send(gm, map[string]any{"type": "codex.fromPack", "kind": "location", "entity": "site", "key": "mill"})
		if len(made.IDs) != 3 || made.ID != made.IDs[0] {
			t.Fatalf("the place and the two inside it, root first: %+v", made)
		}
		mill, cellar, well := p.entry(made.IDs[0]), p.entry(made.IDs[1]), p.entry(made.IDs[2])
		if mill.Title != "mill" || mill.Parent != nil || mill.Fields["peril"] != 2.0 {
			t.Fatalf("the root takes the name and the mapped value: %+v", mill)
		}
		if *cellar.Parent != made.IDs[0] || *well.Parent != made.IDs[1] || cellar.Fields["peril"] != 4.0 || len(well.Fields) != 0 {
			t.Fatalf("each sits under the one it names: %+v %+v", cellar, well)
		}
		if fmt.Sprint(well.Source) != fmt.Sprint(map[string]any{"entity": "site", "key": "well", "cite": "Atlas p.1"}) {
			t.Fatalf("an entry keeps the pack entry's key and page: %v", well.Source)
		}

		// One Undo takes the whole creation back.
		p.send(gm, map[string]any{"type": "event.undo"})
		for _, id := range made.IDs {
			if p.entry(id) != nil {
				t.Fatalf("undo leaves %s", id)
			}
		}
	})
}

func TestASceneFromAPackEntryBringsItsTestsAndRoster(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newFromPackPlay(t, tx)
		p.attachAtlas(atlas)
		gm := p.room.GM()
		adventure := p.send(gm, map[string]any{"type": "codex.save", "kind": "adventure", "title": "Road"}).ID

		made := p.send(gm, map[string]any{"type": "codex.fromPack", "kind": "scene", "entity": "incident", "key": "toll",
			"parentId": adventure})
		scene := p.entry(made.ID)
		if scene.Parent == nil || *scene.Parent != adventure {
			t.Fatalf("the scene goes under the adventure: %+v", scene)
		}
		tests, roster := scene.Prep["tests"].([]any), scene.Prep["roster"].([]any)
		want := `[map[actorIds:[] hideTarget:false id:t1 inputs:map[dc:12] outcomes:[] takers:party testId:check] ` +
			`map[actorIds:[] hideTarget:false id:t2 inputs:map[] outcomes:[] takers:party testId:gambit]]`
		if fmt.Sprint(tests) != want {
			t.Fatalf("two prepared Tests, the input only where the Test takes it:\n%v", tests)
		}
		if fmt.Sprint(roster) != `[map[count:2 id:r1 key:wolf pack:p-atlas temporary:true visibility:hidden]]` {
			t.Fatalf("the served foe twice, the unserved one left out: %v", roster)
		}
		if _, issues := cs.ParseAction(map[string]any{"type": "codex.save", "id": made.ID, "kind": "scene", "prep": scene.Prep}); len(issues) > 0 {
			t.Fatalf("the prep made is one codex.save takes: %v", issues)
		}
	})
}

func TestFromPackRefusals(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newFromPackPlay(t, tx)
		chain := [][4]string{{"s0", "site", "party", `{}`}}
		for i := 1; i < 9; i++ {
			chain = append(chain, [4]string{fmt.Sprintf("s%d", i), "site", "party", fmt.Sprintf(`{"within": "s%d"}`, i-1)})
		}
		chain = append(chain, [4]string{"hub", "site", "party", `{}`})
		for i := range 60 {
			chain = append(chain, [4]string{fmt.Sprintf("room%d", i), "site", "party", `{"within": "hub"}`})
		}
		p.attachAtlas(append(chain, atlas...))
		gm := p.room.GM()
		from := func(kind, entity, key string) map[string]any {
			return map[string]any{"type": "codex.fromPack", "kind": kind, "entity": entity, "key": key}
		}
		p.refused(gm, from("npc", "site", "mill"), "fromPackNotFor")
		p.refused(gm, from("location", "site", "nope"), "fromPackNoEntry")
		p.refused(gm, from("location", "site", "s0"), "tooDeep")
		p.refused(gm, from("location", "site", "hub"), "fromPackTooMany")
		p.send(gm, from("location", "site", "s1")) // eight deep fits

		// A GM-only pack entry is read only by the GM side: a co-GM who writes the codex without it is not served it, and a
		// player may not write the codex at all.
		coGM := gm
		coGM.UserID = new(dbtest.User(t, tx, "Co"))
		coGM.Seat = cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"codex"}}
		p.refused(coGM, from("scene", "incident", "toll"), "fromPackNoEntry")
		p.send(coGM, from("location", "site", "mill"))
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pat"))
		var refusal *cs.Error
		if _, err := p.try(player, from("scene", "incident", "toll")); !errors.As(err, &refusal) {
			t.Fatalf("a player is refused, got %v", err)
		}

		// codex.save takes a source of its own: a type the kind is made from, served to this room; the page is read again.
		npc := p.send(gm, map[string]any{"type": "codex.save", "kind": "npc", "title": "N"}).ID
		p.refused(gm, map[string]any{"type": "codex.save", "id": npc, "kind": "npc",
			"source": map[string]any{"entity": "site", "key": "mill"}}, "fromPackNotFor")
		place := p.send(gm, map[string]any{"type": "codex.save", "kind": "location", "title": "P",
			"source": map[string]any{"entity": "site", "key": "mill", "cite": "Forged p.9"}}).ID
		if p.entry(place).Source["cite"] != "Atlas p.1" {
			t.Fatalf("the cite is the served entry's: %v", p.entry(place).Source)
		}
		p.send(gm, map[string]any{"type": "codex.save", "id": place, "kind": "location", "source": nil})
		if p.entry(place).Source != nil {
			t.Fatal("null forgets the source")
		}
	})
}
