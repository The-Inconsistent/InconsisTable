package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Declared entry fields (house decision #71), through ApplyAction as the gateway runs them. The manifest and the pack
// are our own invention.

// fieldsFixture is the play fixture with a boon and a gear type, and a codex block: a person's mood and temper the
// party sees, their backer the GM sees; a band's footing for the GM.
func fieldsFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["entities"] = append(m["entities"].([]any),
		map[string]any{"id": "boon", "label": "Boon", "base": "ability"},
		map[string]any{"id": "gear", "label": "Gear", "base": "item"})
	m["codex"] = map[string]any{"kinds": map[string]any{
		"npc": map[string]any{"fields": map[string]any{
			"mood": map[string]any{"type": "enum", "label": "Mood", "values": []any{"warm", "cold"},
				"labels": map[string]any{"warm": "Warm"}, "notes": map[string]any{"cold": "-2"}, "visibility": "party"},
			"temper": map[string]any{"type": "int", "label": "Temper", "min": -3, "max": 3, "visibility": "party"},
			"motto":  map[string]any{"type": "text", "label": "Motto", "maxLength": 5, "visibility": "party"},
			"sworn":  map[string]any{"type": "bool", "label": "Sworn", "visibility": "party"},
			"backer": map[string]any{"type": "ref", "label": "Backer", "entity": "boon"},
			"ally":   map[string]any{"type": "ref", "label": "Ally", "entity": "boon", "visibility": "party"},
			"home":   map[string]any{"type": "entry", "label": "Home", "kind": "location", "visibility": "party"},
			"friend": map[string]any{"type": "entry", "label": "Friend", "kind": "npc", "visibility": "party"},
		}},
		"faction": map[string]any{"fields": map[string]any{
			"footing": map[string]any{"type": "enum", "label": "Footing", "values": []any{"ally", "rival"}},
		}},
	}}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// attachFieldsPack attaches a pack with a gm boon, a public boon and a public gear item.
func (p *play) attachFieldsPack() {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-fields', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 3, 0) RETURNING id::text`, pack, rulesetVersion)
	for _, e := range [][3]string{{"lurker", "boon", "gm"}, {"hound", "boon", "public"}, {"rope", "gear", "public"}} {
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, $3, $2, '{}', $4, 'Fixture p.1', 'h', '{}')`, version, e[0], e[1], e[2])
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
}

func saveFields(id string, fields map[string]any) map[string]any {
	return map[string]any{"type": "codex.save", "id": id, "kind": "npc", "fields": fields}
}

func (p *play) storedFields(id string) map[string]any {
	p.t.Helper()
	return dbtest.Scalar[map[string]any](p.t, p.tx, `SELECT fields FROM codex_entry WHERE id = $1`, id)
}

func TestEntryFieldsArePatchedAndChecked(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, fieldsFixture(t))
		p := &play{t, tx, room}
		p.attachFieldsPack()
		gm := room.GM()

		// A new entry may carry fields; later saves patch: a sent value sets, null clears, an unsent key stays.
		id := p.send(gm, map[string]any{"type": "codex.save", "kind": "npc", "title": "Vale",
			"fields": map[string]any{"mood": "cold", "temper": -2.0, "backer": "lurker"}}).ID
		p.send(gm, saveFields(id, map[string]any{"temper": 3.0, "backer": nil, "sworn": true, "motto": "hold"}))
		got := p.storedFields(id)
		if got["mood"] != "cold" || got["temper"] != 3.0 || got["sworn"] != true || got["motto"] != "hold" || got["backer"] != nil {
			t.Fatalf("after the patch: %v", got)
		}
		if _, has := got["backer"]; has {
			t.Fatalf("null clears the field, got %v", got)
		}
		p.send(gm, map[string]any{"type": "codex.save", "id": id, "kind": "npc", "title": "Vale II"})
		if len(p.storedFields(id)) != 4 {
			t.Fatalf("a save without fields leaves them, got %v", p.storedFields(id))
		}

		p.refused(gm, saveFields(id, map[string]any{"nope": 1.0}), "noSuchEntryField")
		// The kind is the stored one: a faction's field is not an npc's.
		p.refused(gm, saveFields(id, map[string]any{"footing": "ally"}), "noSuchEntryField")
		for _, bad := range []map[string]any{
			{"mood": "sulky"}, {"mood": 1.0}, {"temper": 4.0}, {"temper": "1"}, {"motto": "toolong"}, {"sworn": "yes"},
			{"backer": "nobody"}, {"backer": "rope"}, {"ally": "lurker"}, {"temper": []any{"x"}},
		} {
			p.refused(gm, saveFields(id, bad), "badEntryField")
		}
		// The whole save is refused: nothing of it is written.
		p.refused(gm, saveFields(id, map[string]any{"mood": "warm", "temper": 9.0}), "badEntryField")
		if p.storedFields(id)["mood"] != "cold" {
			t.Fatal("a refused save wrote a field")
		}
		p.send(gm, saveFields(id, map[string]any{"ally": "hound"}))

		// Codex writers without the secrets scope write party fields only; a player writes none.
		coGM := gm
		other := dbtest.User(t, tx, "Co")
		coGM.UserID = &other
		coGM.Seat = cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"codex"}}
		p.send(coGM, saveFields(id, map[string]any{"mood": "warm"}))
		p.refused(coGM, saveFields(id, map[string]any{"backer": "lurker"}), "needSecretsScope")
		p.refused(coGM, saveFields(id, map[string]any{"backer": nil}), "needSecretsScope")
		secrets := coGM
		secrets.Seat.Scopes = []string{"codex", "codex.secrets"}
		// The secrets side without the combat scope does not read gm pack entries, so it cannot name one.
		p.refused(secrets, saveFields(id, map[string]any{"backer": "lurker"}), "badEntryField")
		p.send(secrets, saveFields(id, map[string]any{"backer": "hound"}))
		player := room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.refused(player, saveFields(id, map[string]any{"mood": "cold"}), "noPermission")
	})
}

// House decision #76: a link names an entry of this room and of the field's kind, never the entry itself; deleting its
// target rewrites nothing, and the link is then sent to nobody.
func TestEntryLinksAreCheckedAndOutliveTheirTarget(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, fieldsFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		save := func(kind, title string) string {
			return p.send(gm, map[string]any{"type": "codex.save", "kind": kind, "title": title}).ID
		}
		npc, place, band := save("npc", "Vale"), save("location", "Quay"), save("faction", "Band")
		other := dbtest.NewRoom(t, tx)
		elsewhere := p.send(other.GM(), map[string]any{"type": "codex.save", "kind": "location", "title": "Far"}).ID

		for _, bad := range []map[string]any{
			{"home": elsewhere}, // another room's entry
			{"home": band},      // another kind
			{"home": "0190a000-0000-7000-8000-000000000999"}, // no entry at all
			{"home": "quay"}, // not an id
			{"friend": npc},  // the entry itself
		} {
			p.refused(gm, saveFields(npc, bad), "badEntryField")
		}
		// A new entry has no id yet: it may link to any entry of the kind.
		p.send(gm, map[string]any{"type": "codex.save", "kind": "npc", "title": "Wren", "fields": map[string]any{"friend": npc}})
		p.send(gm, saveFields(npc, map[string]any{"home": place}))

		player := room.Seat(t, tx, dbtest.User(t, tx, "P"))
		p.send(gm, map[string]any{"type": "codex.reveal", "id": npc, "visibility": "party", "audienceMode": "all"})
		p.send(gm, map[string]any{"type": "codex.reveal", "id": place, "visibility": "party", "audienceMode": "all"})
		homeOf := func(c cs.Ctx) any {
			for _, e := range p.seatView(c).Codex.Entries {
				if e.ID == npc {
					return e.Fields["home"]
				}
			}
			return nil
		}
		if homeOf(player) != place || homeOf(gm) != place {
			t.Fatalf("a link to a readable place reaches the player and the GM: %v, %v", homeOf(player), homeOf(gm))
		}
		p.send(gm, map[string]any{"type": "codex.reveal", "id": place, "visibility": "gm", "audienceMode": "all"})
		if homeOf(player) != nil || homeOf(gm) != place {
			t.Fatalf("a link to a hidden place reaches the GM only: %v, %v", homeOf(player), homeOf(gm))
		}
		p.send(gm, map[string]any{"type": "codex.delete", "id": place})
		if homeOf(gm) != nil {
			t.Fatalf("a link to a deleted entry reaches nobody, got %v", homeOf(gm))
		}
		if p.storedFields(npc)["home"] != place {
			t.Fatalf("deleting the target rewrites nothing, got %v", p.storedFields(npc))
		}
	})
}

func TestARoomWithoutTheBlockTakesNoFields(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		bare := &play{t, tx, dbtest.NewRoom(t, tx)}
		bare.refused(bare.room.GM(), map[string]any{"type": "codex.save", "kind": "npc", "title": "N",
			"fields": map[string]any{"mood": "cold"}}, "noSuchEntryField")
		p := newPlay(t, tx)
		p.refused(p.room.GM(), map[string]any{"type": "codex.save", "kind": "npc", "title": "N",
			"fields": map[string]any{"mood": "cold"}}, "noSuchEntryField")
		id := p.send(p.room.GM(), map[string]any{"type": "codex.save", "kind": "npc", "title": "N"}).ID
		if len(p.storedFields(id)) != 0 {
			t.Fatal("an entry without fields stores none")
		}
	})
}
