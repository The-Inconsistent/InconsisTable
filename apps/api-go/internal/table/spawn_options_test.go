package table

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Spawn options, a scaling fixed at spawn, a counter seeded from the entry, and a combatant's marker (house decision
// #92), on the Go fixture with a guard, a grudge and a Spite.

func newSpawnOptionsPlay(t *testing.T, tx pgx.Tx) (*play, string) {
	var m map[string]any
	if err := json.Unmarshal([]byte(dbtest.Fixture), &m); err != nil {
		t.Fatal(err)
	}
	fields := m["entities"].([]any)[0].(map[string]any)["fields"].(map[string]any)
	fields["guard"] = map[string]any{"type": "int", "label": "Guard"}
	fields["grudge"] = map[string]any{"type": "int", "label": "Grudge"}
	m["resources"] = append(m["resources"].([]any), map[string]any{"id": "spite", "label": "Spite", "cite": "Fixture p.5",
		"scope": "entity", "max": "6", "start": "grudge"})
	m["campaignFields"] = map[string]any{"peril": map[string]any{"type": "int", "label": "Peril", "min": 1, "max": 5, "default": 2, "cite": "Fixture p.6"}}
	m["spawn"] = map[string]any{
		"options": []any{
			map[string]any{"id": "hardened", "label": "Hardened", "cite": "Fixture p.6", "when": "level > 2",
				"effects": []any{map[string]any{"path": "guard", "mode": "add", "value": "2"}}},
			map[string]any{"id": "scaled", "label": "Scaled", "cite": "Fixture p.6"},
		},
		"adjust": []any{map[string]any{"option": "scaled", "when": "!ctx.mob", "cite": "Fixture p.6",
			"add": map[string]any{"level": "party.seated + campaign.peril", "spite": "1", "guard": "1"}}},
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(raw))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	p := &play{t, tx, room}
	version := p.attachPack()
	for key, body := range map[string]string{"brute": `{"level": 3, "grudge": 2}`, "minion": `{"level": 1, "guard": 9}`} {
		dbtest.Exec(t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, 'character', $2, '{}', 'gm', 'Fixture p.1', 'h', $3)`, version, key, body)
	}
	return p, version
}

func spawnOf(version, key string, over map[string]any) map[string]any {
	a := map[string]any{"type": "actor.spawn", "packVersionId": version, "key": key, "count": 1.0}
	for k, v := range over {
		a[k] = v
	}
	return a
}

func (p *play) actorNamed(c cs.Ctx, name string) *cs.Actor {
	p.t.Helper()
	for _, a := range p.seatView(c).State.Actors {
		if a.Name == name {
			return &a
		}
	}
	return nil
}

func TestASpawnKeepsItsOptionsAndScalesToTheSeatedOnce(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p, version := newSpawnOptionsPlay(t, tx)
		gm := p.room.GM()
		seated := p.character("Ash", 2)
		p.character("Bo", 2) // nobody holds Bo: not seated
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), seated)

		p.refused(gm, spawnOf(version, "brute", map[string]any{"options": []any{"nope"}}), "noSuchOption")
		p.refused(gm, spawnOf(version, "minion", map[string]any{"options": []any{"hardened"}}), "optionNotHere")

		p.send(gm, spawnOf(version, "brute", map[string]any{"options": []any{"scaled", "hardened"}, "name": "Brute"}))
		brute := p.actorNamed(gm, "Brute")
		if brute == nil || !slices.Equal(brute.SpawnOptions, []string{"scaled", "hardened"}) {
			t.Fatalf("the GM side sees the options kept: %+v", brute)
		}
		// One seated character and the peril of 2, fixed at spawn: 3 + 1 + 2. A guard the entry does not list stays
		// absent, so the option's +2 has nothing to raise. Spite starts from the grudge, plus 1.
		if level := p.intField(brute.ID, "level"); level == nil || *level != 6 {
			t.Fatalf("level %v, want 6", level)
		}
		if guard := p.intField(brute.ID, "guard"); guard != nil {
			t.Fatalf("guard %v, want absent", *guard)
		}
		if spite := p.res(brute.ID, "spite"); spite != 3 {
			t.Fatalf("spite %d, want 3", spite)
		}
		if brute.Derived["maxHp"] != 16 {
			t.Fatalf("maxHp %v, want 16", brute.Derived["maxHp"])
		}
		if other := p.actorNamed(player, "Brute"); other != nil && other.SpawnOptions != nil {
			t.Fatalf("a player is not told the options: %+v", other.SpawnOptions)
		}

		// A later seat does not move it; the option's effect is live on a guard the entry lists.
		p.room.Seat(t, tx, dbtest.User(t, tx, "Q"), p.character("Cy", 2))
		if level := p.intField(brute.ID, "level"); *level != 6 {
			t.Fatalf("a later seat moved the level to %d", *level)
		}
		p.send(gm, spawnOf(version, "minion", map[string]any{"options": []any{"scaled"}, "name": "Minion"}))
		minion := p.actorNamed(gm, "Minion")
		if level, guard := p.intField(minion.ID, "level"), p.intField(minion.ID, "guard"); *level != 1+2+2 || *guard != 10 {
			t.Fatalf("minion level %d guard %d, want 5 and 10 (two seated now)", *level, *guard)
		}
		if minion.Fields["guard"] != 10.0 {
			t.Fatalf("the minion takes no hardened: guard %v", minion.Fields["guard"])
		}
	})
}

func TestARosterLineCarriesItsMarkerAndOptionsIntoTheFight(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p, version := newSpawnOptionsPlay(t, tx)
		gm := p.room.GM()
		ash := p.character("Ash", 2)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), ash)
		line := map[string]any{"id": "r", "pack": "p-spawn", "key": "brute", "count": 1.0, "marker": "amber",
			"options": []any{"hardened"}, "visibility": "full"}
		p.send(gm, map[string]any{"type": "codex.save", "kind": "scene", "title": "Gate", "prep": map[string]any{"roster": []any{line}}})

		// START THE FIGHT, as the GM's screen sends it: the fight, then the line as a spawn with its marker and options.
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, spawnOf(version, "brute", map[string]any{"options": []any{"hardened"}, "marker": "amber", "visibility": "full"}))
		var marked *cs.Combatant
		for _, cb := range p.seatView(player).State.Encounter.Combatants {
			if cb.Marker != "" {
				marked = &cb
			}
		}
		if marked == nil || marked.Marker != "amber" {
			t.Fatalf("the player sees the marker: %+v", marked)
		}
		p.send(gm, map[string]any{"type": "encounter.mark", "combatantId": marked.ID, "marker": "blue"})
		p.send(gm, map[string]any{"type": "encounter.mark", "combatantId": marked.ID, "marker": nil})
		for _, cb := range p.seatView(gm).State.Encounter.Combatants {
			if cb.Marker != "" {
				t.Fatalf("cleared: %+v", cb)
			}
		}
		p.refused(player, map[string]any{"type": "encounter.mark", "combatantId": marked.ID, "marker": "red"}, "noPermission")
	})
}
