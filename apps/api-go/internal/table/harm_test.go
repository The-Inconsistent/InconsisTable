package table

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// health.harm run through the api (house decision #66), on the invented sample-harm ruleset of the rules engine's
// fixtures: heroes fall past their wound limit, brutes never take strain, swarms are mobs.

const harmFixture = `{
	"id": "go-harm", "version": "0.1.0", "core": "^0.1.0",
	"sources": [{"id": "fixture", "title": "Go Harm Rules", "license": "private"}],
	"entities": [
		{"id": "hero", "label": "Hero", "base": "actor", "fields": {
			"grit": {"type": "int", "label": "Grit", "min": 1, "max": 10, "visibility": "party", "editableBy": "owner"},
			"scars": {"type": "int", "label": "Scars", "min": 0, "visibility": "party"},
			"gone": {"type": "bool", "label": "Gone", "visibility": "party"}},
		 "derived": [
			{"id": "limit", "label": "Wound limit", "expr": "grit + 3", "visibility": "party", "cite": "Fixture p.2"},
			{"id": "strainCap", "label": "Strain limit", "expr": "grit", "visibility": "party", "cite": "Fixture p.2"}]},
		{"id": "brute", "label": "Brute", "base": "actor", "fields": {
			"hide": {"type": "int", "label": "Hide", "min": 1}, "gone": {"type": "bool", "label": "Gone"}},
		 "derived": [
			{"id": "limit", "label": "Wound limit", "expr": "hide", "cite": "Fixture p.5"},
			{"id": "strainCap", "label": "Strain limit", "expr": "0", "cite": "Fixture p.5"}]},
		{"id": "swarm", "label": "Swarm", "base": "actor", "fields": {
			"size": {"type": "int", "label": "Size", "min": 1, "max": 500, "visibility": "party"}},
		 "derived": [
			{"id": "limit", "label": "Wound limit", "expr": "1", "cite": "Fixture p.6"},
			{"id": "strainCap", "label": "Strain limit", "expr": "2", "cite": "Fixture p.6"}]}
	],
	"resources": [
		{"id": "wounds", "label": "Wounds", "cite": "Fixture p.3", "scope": "entity", "max": "derived.limit",
		 "capped": false, "start": "0", "visibility": "party"},
		{"id": "strain", "label": "Strain", "cite": "Fixture p.3", "scope": "entity", "max": "derived.strainCap",
		 "capped": false, "start": "0", "visibility": "party"},
		{"id": "members", "label": "Members", "cite": "Fixture p.6", "scope": "entity", "entities": ["swarm"],
		 "max": "size", "visibility": "party"}
	],
	"conditions": [
		{"id": "down", "label": "Down", "cite": "Fixture p.4", "duration": "manual", "visibility": "party"},
		{"id": "winded", "label": "Winded", "cite": "Fixture p.4", "duration": "manual", "visibility": "party"}
	],
	"initiative": {"strategy": "seated", "firstPlayer": "fixed", "cite": "Fixture p.7"},
	"health": {
		"states": [
			{"id": "hurt", "label": "Hurt", "when": "res.wounds > 0 && res.wounds <= derived.limit", "entities": ["hero", "brute"]},
			{"id": "fallen", "label": "Fallen", "when": "res.wounds > derived.limit", "entities": ["hero", "brute"]},
			{"id": "routing", "label": "Routing", "when": "res.members * 2 <= size && res.members > 0", "entities": ["swarm"]}
		],
		"harm": {
			"cite": "Fixture p.3", "wounds": "wounds", "shock": "strain", "mob": {"members": "members", "start": "size"},
			"profiles": [
				{"entities": ["hero"], "spent": {"when": "res.strain > derived.strainCap", "conditions": ["winded"]},
				 "felled": {"when": "res.wounds > derived.limit", "injuries": "scars", "condition": "down", "healTo": "derived.limit"},
				 "destroyed": {"over": "derived.limit * 2", "field": "gone"}},
				{"entities": ["brute"], "shockless": "derived.strainCap == 0", "destroyed": {"over": "derived.limit * 2", "field": "gone"}},
				{"entities": ["swarm"]}
			]
		}
	}
}`

func newHarmPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, harmFixture)
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// A hero of grit 2 (wound limit 5, strain limit 2, destroyed above 10) with these wounds and strain.
func (p *play) hero(name string, wounds, strain int) string {
	id := p.room.Actor(p.t, p.tx, "pc", name, "hero")
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'grit', 0, 2)`, id)
	p.counters(id, map[string]int{"wounds": wounds, "strain": strain})
	return id
}

func (p *play) counters(id string, values map[string]int) {
	for r, v := range values {
		dbtest.Exec(p.t, p.tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, $2, $3)`, id, r, v)
	}
}

func (p *play) res(id, resource string) int {
	return dbtest.Scalar[int](p.t, p.tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = $2`, id, resource)
}

func (p *play) intField(id, field string) *int {
	return dbtest.Scalar[*int](p.t, p.tx, `SELECT (SELECT int_value FROM actor_field WHERE actor_id = $1 AND field_id = $2)`, id, field)
}

func (p *play) holds(id, condition string) bool {
	return dbtest.Scalar[bool](p.t, p.tx, `SELECT EXISTS (SELECT 1 FROM actor_condition WHERE actor_id = $1 AND condition_id = $2)`,
		id, condition)
}

func harmOp(op string, in map[string]any) map[string]any {
	return map[string]any{"type": "rule.op", "primitive": "health.harm", "op": op, "input": in}
}

func hit(id string, wounds, shock int) map[string]any {
	return harmOp("hit", map[string]any{"actorId": id, "wounds": float64(wounds), "shock": float64(shock)})
}

var undo = map[string]any{"type": "event.undo"}

func TestAHitIsOneActionAndUndoTakesItBackWhole(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHarmPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 3, 3)
		want := func(wounds, strain int, scars *int, down bool) {
			t.Helper()
			gotScars := p.intField(hal, "scars")
			if p.res(hal, "wounds") != wounds || p.res(hal, "strain") != strain || p.holds(hal, "down") != down ||
				(gotScars == nil) != (scars == nil) || (scars != nil && *gotScars != *scars) {
				t.Fatalf("want wounds %d strain %d scars %v down %v; got %d %d %v %v", wounds, strain, scars, down,
					p.res(hal, "wounds"), p.res(hal, "strain"), gotScars, p.holds(hal, "down"))
			}
		}
		// Spent (strain 3 over 2): the strain becomes wounds, 3 + 3 is past 5, so Hal goes down.
		p.send(gm, hit(hal, 2, 1))
		want(6, 3, nil, true)
		p.send(gm, undo)
		want(3, 3, nil, false)

		p.send(gm, hit(hal, 3, -1))
		want(6, 2, nil, true)
		// A wound while down is a scar, and the wounds stay.
		p.send(gm, hit(hal, 4, 0))
		one := 1
		want(6, 2, &one, true)
		p.send(gm, undo)
		want(6, 2, nil, true)
		// Healing while down stops at the limit.
		p.send(gm, hit(hal, -1, 0))
		want(5, 2, nil, true)

		// One hit past twice the limit: gone, and nothing else moves; Undo clears it.
		pip := p.hero("Pip", 0, 0)
		p.send(gm, hit(pip, 11, 2))
		gone := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM actor_field WHERE actor_id = $1 AND field_id = 'gone'`, pip)
		if gone != 1 || p.res(pip, "wounds") != 0 || p.res(pip, "strain") != 0 {
			t.Fatalf("destroyed: gone rows %d, wounds %d, strain %d", gone, p.res(pip, "wounds"), p.res(pip, "strain"))
		}
		p.send(gm, undo)
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM actor_field WHERE actor_id = $1 AND field_id = 'gone'`, pip); n != 0 {
			t.Fatalf("undo left gone set")
		}
	})
}

func TestHarmRefusals(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHarmPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		ogre := p.room.Actor(t, tx, "creature", "Ogre", "brute")
		dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'hide', 0, 4)`, ogre)
		p.counters(ogre, map[string]int{"wounds": 0, "strain": 0})
		_, err := p.try(gm, hit(ogre, 0, 1))
		refusal, ok := err.(*cs.Error)
		if !ok || refusal.Code != "neverShocked" || refusal.Params["name"] != "Ogre" {
			t.Fatalf("want neverShocked naming the Ogre, got %v", err)
		}
		p.refused(gm, harmOp("muster", map[string]any{"actorId": hal, "members": 3.0}), "notAMob")
		// The plain stepper is closed on the counted resources, for every seat.
		for _, r := range []string{"wounds", "strain"} {
			p.refused(gm, map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
				"input": map[string]any{"actorId": hal, "resource": r, "delta": 1.0}}, "hpThroughDamage")
		}
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"), hal)
		p.refused(player, map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
			"input": map[string]any{"actorId": hal, "resource": "wounds", "delta": -1.0}}, "hpThroughDamage")
		p.refused(player, hit(hal, 1, 0), "noPermission")
	})
}

// attachHarmPack attaches a pack with a swarm entry and a hero entry, and returns its version.
func (p *play) attachHarmPack() string {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-harm', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 2, 0) RETURNING id::text`, pack, rulesetVersion)
	for key, entity := range map[string]string{"rats": "swarm", "squire": "hero"} {
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, $3, $2, '{}', 'public', 'Fixture p.1', 'h', '{"grit": 2}')`, version, key, entity)
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
	return version
}

func spawnMob(version, key string, count, mob int) map[string]any {
	return map[string]any{"type": "actor.spawn", "packVersionId": version, "key": key, "count": float64(count), "mob": float64(mob)}
}

func TestAMobIsSpawnedHitHealedAndMustered(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHarmPlay(t, tx)
		gm := p.room.GM()
		version := p.attachHarmPack()
		p.refused(gm, spawnMob(version, "squire", 1, 4), "noMobsHere")
		p.refused(gm, spawnMob(version, "rats", 2, 4), "badRequest")
		p.send(gm, spawnMob(version, "rats", 1, 6))
		rats := dbtest.Scalar[string](t, tx, `SELECT id::text FROM actor WHERE campaign_id = $1 AND name = 'rats ×6'`, p.room.ID)
		want := func(size, members int) {
			t.Helper()
			if got := p.intField(rats, "size"); got == nil || *got != size || p.res(rats, "members") != members {
				t.Fatalf("want size %d members %d, got %v %d", size, members, got, p.res(rats, "members"))
			}
		}
		want(6, 6)
		p.send(gm, hit(rats, 2, 0))
		want(6, 4)
		// Strain past the members' limit (2) takes one more; a mob keeps no wounds or strain.
		p.send(gm, hit(rats, 1, 3))
		want(6, 2)
		if p.res(rats, "wounds") != 0 || p.res(rats, "strain") != 0 {
			t.Fatalf("a mob kept wounds or strain")
		}
		// Healed back up to its start, and no further.
		p.send(gm, hit(rats, -9, 0))
		want(6, 6)
		// Mustered past its start: the start rises, and the members reach it in the same action.
		p.send(gm, harmOp("muster", map[string]any{"actorId": rats, "members": 9.0}))
		want(9, 9)
		p.send(gm, undo)
		want(6, 6)
	})
}

// What each seat receives of a harm fight (house decision #66): the bar from wounds or members, the states, a mob's
// count; the combat side all of it, anyone else nothing of a hidden combatant and no numbers at bar.
func TestEachSeatReceivesTheBarStatesAndCountItMay(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHarmPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 3, 0)
		lurker := p.hero("Lurker", 6, 0)
		version := p.attachHarmPack()
		p.send(gm, spawnMob(version, "rats", 1, 6))
		rats := dbtest.Scalar[string](t, tx, `SELECT id::text FROM actor WHERE campaign_id = $1 AND name = 'rats ×6'`, p.room.ID)
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{hal}, "side": "party", "visibility": "full"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{lurker}, "side": "foe", "visibility": "hidden"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{rats}, "side": "foe"}) // at bar
		p.send(gm, hit(rats, 2, 0))

		type seen struct {
			bar     float64
			hp      bool
			states  string
			members float64 // -1: none
		}
		look := func(c cs.Ctx) map[string]seen {
			out := map[string]seen{}
			for _, cb := range p.seatView(c).State.Encounter.Combatants {
				s := seen{hp: cb.HP != nil, members: -1}
				if cb.Bar != nil {
					s.bar = *cb.Bar
				}
				for _, x := range cb.States {
					s.states += x.ID + ","
				}
				if cb.Members != nil {
					s.members = cb.Members.Value
				}
				out[cb.ActorID] = s
			}
			return out
		}
		check := func(who string, got map[string]seen, id string, want seen) {
			t.Helper()
			if g, ok := got[id]; !ok || g != want {
				t.Fatalf("%s sees %s as %+v (present %v), want %+v", who, id, g, ok, want)
			}
		}
		all := look(gm)
		mob := seen{bar: 4.0 / 6, states: "", members: 4}
		check("gm", all, hal, seen{bar: 0.4, states: "hurt,", members: -1})
		check("gm", all, lurker, seen{bar: 0, states: "fallen,", members: -1})
		check("gm", all, rats, mob)
		screen := p.room.GM()
		screen.UserID, screen.Seat = nil, cs.Seat{Kind: cs.SeatToken, Role: "screen", CharacterIDs: []string{}}
		for who, c := range map[string]cs.Ctx{"player": p.room.Seat(t, tx, dbtest.User(t, tx, "Pl"), hal), "screen": screen} {
			got := look(c)
			if _, ok := got[lurker]; ok || len(got) != 2 {
				t.Fatalf("%s receives the hidden combatant: %+v", who, got)
			}
			check(who, got, rats, mob)
			check(who, got, hal, seen{bar: 0.4, states: "hurt,", members: -1})
		}
	})
}
