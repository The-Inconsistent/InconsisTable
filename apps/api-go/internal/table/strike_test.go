package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// Strikes run through the api (house decision #99), on the harm fixture with the blow the rules engine's sample-harm
// 0.1.4 declares: an arm from the attacker's `arms`, the attacker's might (one more aiming, half a swarm's members more)
// against the target's guard, the target's toughness less the arm's pierce soaking the total; a swarm loses a member to
// a total over its soak, anyone else takes the rest as wounds, or 1 strain on a tie (none for a brute).

const strikeParts = `{
	"numbers": {
		"hero": [["might", "grit"], ["guard", "grit / 2 + 1"], ["toughness", "grit + 1"]],
		"brute": [["might", "hide"], ["guard", "2"], ["toughness", "hide"]],
		"swarm": [["might", "1"], ["guard", "1"], ["toughness", "1"]]
	},
	"arm": {"id": "arm", "label": "Arm", "base": "item", "fields": {
		"damage": {"type": "int", "label": "Damage"}, "edge": {"type": "int", "label": "Edge"},
		"pierce": {"type": "int", "label": "Pierce"}, "close": {"type": "bool", "label": "Close"}}},
	"strikes": [{
		"id": "blow", "label": "Blow", "cite": "Fixture p.15",
		"means": [{"from": "list", "field": "arms", "entry": "arm"}, {"from": "items", "kind": "carried"}],
		"values": {"damage": {"key": "damage", "type": "int"}, "edge": {"key": "edge", "type": "int"},
			"pierce": {"key": "pierce", "type": "int"}, "close": {"key": "close", "type": "bool"}, "ap": {"key": "ap", "type": "int"}},
		"inputs": [{"id": "aim", "label": "Aim", "type": "bool"}, {"id": "far", "label": "Far shots", "type": "int", "min": 0, "max": 3}],
		"pool": {"label": "Might", "expr": "derived.might", "adds": [
			{"label": "Aim", "when": "ctx.aim", "by": "1"},
			{"label": "Swarm", "when": "ctx.attackerMob > 0", "by": "(ctx.attackerMob + 1) / 2"}]},
		"beat": {"label": "Guard", "expr": "ctx.target.derived.guard", "adds": [
			{"label": "Hurt", "when": "res.wounds > 0", "by": "1"},
			{"label": "Far", "when": "!ctx.means.close", "by": "ctx.far"}]},
		"soak": {"label": "Toughness", "expr": "ctx.target.derived.toughness", "adds": [{"label": "Pierce", "by": "ctx.means.pierce"}, {"label": "AP", "by": "ctx.means.ap"}]},
		"outcomes": [
			{"id": "thinned", "label": "Thinned", "when": "ctx.targetMob > 0 && ctx.total > ctx.soak", "wounds": "1"},
			{"id": "wounded", "label": "Wounded", "when": "ctx.targetMob == 0 && ctx.total > ctx.soak", "wounds": "ctx.total - ctx.soak"},
			{"id": "strained", "label": "Strained", "when": "ctx.targetMob == 0 && ctx.total == ctx.soak",
				"shock": "ctx.target.derived.strainCap > 0 ? 1 : 0"}],
		"notes": [{"text": "A six on the edge die: read the Telling Blow table"}]
	}, {
		"id": "sweep", "label": "Sweep", "cite": "Fixture p.18", "entities": ["hero"], "targets": ["swarm", "brute"],
		"byOwner": true, "limit": {"per": "round", "max": 1},
		"inputs": [{"id": "force", "label": "Force", "type": "choice", "options": [{"label": "Light", "value": 0}, {"label": "Hard", "value": 1}]}],
		"pool": {"label": "Might", "expr": "derived.might", "adds": [{"label": "Force", "by": "ctx.force"}]},
		"beat": {"label": "Guard", "expr": "ctx.target.derived.guard"},
		"outcomes": [{"id": "thinned", "label": "Thinned", "when": "ctx.total > ctx.beat", "wounds": "1 + ctx.force"}]
	}],
	"items": {"kinds": [{"id": "carried", "label": "Carried arms", "entry": "arm", "entities": ["hero", "brute"],
		"card": "weapons", "cite": "Fixture p.17"}]}
}`

func newStrikePlay(t *testing.T, tx pgx.Tx) *play {
	var m, parts map[string]any
	if err := json.Unmarshal([]byte(harmFixture), &m); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(strikeParts), &parts); err != nil {
		t.Fatal(err)
	}
	numbers := parts["numbers"].(map[string]any)
	entities := m["entities"].([]any)
	for _, e := range entities {
		entity := e.(map[string]any)
		entity["fields"].(map[string]any)["arms"] = map[string]any{"type": "list", "label": "Arms", "visibility": "party"}
		for _, pair := range numbers[entity["id"].(string)].([]any) {
			p := pair.([]any)
			entity["derived"] = append(entity["derived"].([]any), map[string]any{"id": p[0], "label": p[0], "expr": p[1], "cite": "Fixture p.15"})
		}
	}
	m["entities"] = append(entities, parts["arm"])
	m["strikes"] = parts["strikes"]
	m["items"] = parts["items"]
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(out))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	p := &play{t, tx, room}
	p.attachArms()
	return p
}

// attachArms attaches a pack of arms: a close maul, a far sling that pierces 1, and a claw.
func (p *play) attachArms() {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-arms', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 3, 0) RETURNING id::text`, pack, rulesetVersion)
	for key, body := range map[string]string{
		"maul":  `{"damage": 4, "edge": 1, "pierce": 0, "close": true}`,
		"sling": `{"damage": 3, "edge": 0, "pierce": -1, "close": false}`,
		"claw":  `{"damage": 3, "edge": 1, "pierce": -1, "close": true}`,
	} {
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, 'arm', initcap($2), '{}', 'gm', 'Fixture p.17', 'h', $3)`, version, key, body)
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
}

// arm gives an actor these arms, in order.
func (p *play) arm(id string, keys ...string) {
	for i, k := range keys {
		dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, text_value) VALUES ($1, 'arms', $2, $3)`, id, i, k)
	}
}

// swarm is a swarm of this many members, its size the same.
func (p *play) swarm(name string, members int) string {
	id := p.room.Actor(p.t, p.tx, "creature", name, "swarm")
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'size', 0, $2)`, id, members)
	p.counters(id, map[string]int{"wounds": 0, "strain": 0, "members": members})
	return id
}

func strikeOf(attacker, target, arm string, total int, inputs map[string]any) map[string]any {
	a := map[string]any{"type": "strike.apply", "strikeId": "blow", "attackerId": attacker, "targetId": target,
		"inputs": inputs, "total": float64(total)}
	if arm != "" {
		a["means"] = map[string]any{"source": 0.0, "ref": arm}
	}
	return a
}

func (p *play) fight(party []string, foes []string) {
	gm := p.room.GM()
	p.send(gm, map[string]any{"type": "encounter.start"})
	p.send(gm, map[string]any{"type": "encounter.add", "actorIds": anyOf(party), "side": "party"})
	p.send(gm, map[string]any{"type": "encounter.add", "actorIds": anyOf(foes), "side": "foe"})
}

func anyOf(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// The server reads the total itself: wounds are the total over the soak, a tie is 1 strain, and Undo takes it back.
func TestAStrikeLandsWhatItsTotalGivesAsOneAction(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0) // grit 2: toughness 3, strain limit 2
		ogre := p.brute("Ogre", 5)
		p.arm(hal, "maul", "sling")
		p.arm(ogre, "claw")
		p.fight([]string{hal}, []string{ogre})
		// Ogre's claw pierces 1: Hal soaks 2. A total of 6 is 4 wounds, never more whatever the client thinks it did.
		p.send(gm, strikeOf(ogre, hal, "claw", 6, map[string]any{}))
		if w := p.res(hal, "wounds"); w != 4 {
			t.Fatalf("Hal's wounds: want 4, got %d", w)
		}
		p.send(gm, undo)
		if w := p.res(hal, "wounds"); w != 0 {
			t.Fatalf("after Undo: want 0, got %d", w)
		}
		// A tie is 1 strain; a brute takes none, so its tie applies nothing.
		p.send(gm, strikeOf(ogre, hal, "claw", 2, map[string]any{}))
		if s := p.res(hal, "strain"); s != 1 {
			t.Fatalf("Hal's strain: want 1, got %d", s)
		}
		p.refused(gm, strikeOf(hal, ogre, "maul", 5, map[string]any{}), "strikeNoHarm")
		p.refused(gm, strikeOf(hal, ogre, "maul", 1, map[string]any{}), "strikeNoHarm")
		// A means it does not hold, none at all, an input out of bounds: refused, nothing written.
		p.refused(gm, strikeOf(hal, ogre, "claw", 9, map[string]any{}), "noSuchMeans")
		p.refused(gm, strikeOf(hal, ogre, "", 9, map[string]any{}), "noMeans")
		p.refused(gm, strikeOf(hal, ogre, "maul", 9, map[string]any{"far": 4.0}), "badInput")
		if w := p.res(ogre, "wounds"); w != 0 {
			t.Fatalf("Ogre's wounds after refusals: want 0, got %d", w)
		}
		p.send(gm, strikeOf(hal, ogre, "maul", 9, map[string]any{"aim": true}))
		if w := p.res(ogre, "wounds"); w != 4 {
			t.Fatalf("Ogre's wounds: want 4, got %d", w)
		}
		// The strike is logged beside its writes, under the same action; the one Undo took back has its writes taken back.
		n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM session_event s WHERE s.campaign_id = $1 AND s.type = 'strike'
			AND EXISTS (SELECT 1 FROM session_event d WHERE d.action_id = s.action_id AND d.type = 'delta' AND d.undone_by IS NULL)`, p.room.ID)
		if n != 2 {
			t.Fatalf("strike events with live writes: want 2, got %d", n)
		}
	})
}

// A swarm struck loses one member to a total over its soak; a swarm striking gets half its members more dice, which
// changes no harm; outside the fight, or from a player's seat when its owner may not send it, a strike is refused.
func TestAStrikeThinsASwarmAndIsTheGMSides(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		rats := p.swarm("Rats", 6)
		stray := p.brute("Stray", 3)
		p.arm(hal, "maul")
		p.arm(rats, "claw")
		p.fight([]string{hal}, []string{rats})
		p.send(gm, strikeOf(hal, rats, "maul", 9, map[string]any{}))
		if m := p.res(rats, "members"); m != 5 {
			t.Fatalf("Rats' members: want 5, got %d", m)
		}
		p.refused(gm, strikeOf(hal, stray, "maul", 9, map[string]any{}), "strikeNotInFight")
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"), hal)
		p.refused(player, strikeOf(hal, rats, "maul", 9, map[string]any{}), "strikeNotByOwner")
	})
}

// TURN BACK takes back a strike made after the turn step, with the step.
func TestTurnBackTakesAStrikeBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		ogre := p.brute("Ogre", 5)
		p.arm(hal, "maul")
		p.fight([]string{hal}, []string{ogre})
		p.send(gm, map[string]any{"type": "rule.op", "primitive": "initiative.seated", "op": "next", "input": map[string]any{}})
		p.send(gm, strikeOf(hal, ogre, "maul", 8, map[string]any{}))
		if w := p.res(ogre, "wounds"); w != 3 {
			t.Fatalf("Ogre's wounds: want 3, got %d", w)
		}
		p.send(gm, turnBack)
		if w := p.res(ogre, "wounds"); w != 0 {
			t.Fatalf("after TURN BACK: want 0, got %d", w)
		}
	})
}

// carry gives an actor an item of the carried kind: an arm of the pack by key, or one written by hand with no entry.
func (p *play) carry(id, key, name string) string {
	var entryType, entryKey any
	if key != "" {
		entryType, entryKey = "arm", key
	}
	return dbtest.Scalar[string](p.t, p.tx, `INSERT INTO actor_item (actor_id, kind, entry_type, entry_key, name, source, ordinal)
		VALUES ($1, 'carried', $2, $3, $4, 'hand', (SELECT count(*) FROM actor_item WHERE actor_id = $1)) RETURNING id::text`,
		id, entryType, entryKey, name)
}

// A held item is a means (house decision #95): its entry's values strike as an arm in the list would; a hand-written
// item, another's item, or one of the wrong kind is no means.
func TestAStrikeWithAHeldItemAsItsMeans(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0) // grit 2: toughness 3
		ogre := p.brute("Ogre", 5)
		sling := p.carry(hal, "sling", "")
		stick := p.carry(hal, "", "Stick")
		claw := p.carry(ogre, "claw", "")
		p.fight([]string{hal}, []string{ogre})
		held := func(attacker, target, item string, total int) map[string]any {
			a := strikeOf(attacker, target, "", total, map[string]any{})
			a["means"] = map[string]any{"source": 1.0, "ref": item}
			return a
		}
		// Ogre's held claw pierces 1: Hal soaks 2, so a total of 6 is 4 wounds.
		p.send(gm, held(ogre, hal, claw, 6))
		if w := p.res(hal, "wounds"); w != 4 {
			t.Fatalf("Hal's wounds: want 4, got %d", w)
		}
		p.refused(gm, held(hal, ogre, stick, 9), "noSuchMeans")
		p.refused(gm, held(hal, ogre, claw, 9), "noSuchMeans")
		p.refused(gm, held(hal, ogre, "sling", 9), "noSuchMeans")
		// The sling Hal holds pierces 1 too: Ogre soaks 4, so 9 is 5 wounds; the log names the item's entry.
		p.send(gm, held(hal, ogre, sling, 9))
		if w := p.res(ogre, "wounds"); w != 5 {
			t.Fatalf("Ogre's wounds: want 5, got %d", w)
		}
		means := dbtest.Scalar[string](t, tx, `SELECT payload->>'means' FROM session_event WHERE campaign_id = $1 AND type = 'strike'
			ORDER BY id DESC LIMIT 1`, p.room.ID)
		if means != "Sling" {
			t.Fatalf("the logged means: want Sling, got %q", means)
		}
	})
}

// A held weapon strikes with what is fitted to it (house decision #102): a keen edge fitted to Hal's sling takes 2 off
// the target's soak, as the card shows it.
func TestAStrikeReadsWhatIsFittedToItsWeapon(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		version := dbtest.Scalar[string](t, tx, `SELECT pack_version_id::text FROM campaign_pack WHERE campaign_id = $1`, p.room.ID)
		dbtest.Exec(t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body, effects)
			VALUES ($1, 'keen', 'arm', 'Keen', '{}', 'gm', 'Fixture p.17', 'h', '{}',
			'[{"path": "host.ap", "mode": "add", "value": "-2", "phase": "derived"}]')`, version)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		ogre := p.brute("Ogre", 5)
		sling := p.carry(hal, "sling", "")
		keen := p.carry(hal, "keen", "")
		dbtest.Exec(t, tx, `UPDATE actor_item SET fitted_to = $1 WHERE id = $2`, sling, keen)
		p.fight([]string{hal}, []string{ogre})
		a := strikeOf(hal, ogre, "", 9, map[string]any{})
		a["means"] = map[string]any{"source": 1.0, "ref": sling}
		// Ogre's toughness 5, less the sling's pierce 1 and the keen edge's 2: 9 is 7 wounds (5 without the edge).
		p.send(gm, a)
		if w := p.res(ogre, "wounds"); w != 7 {
			t.Fatalf("Ogre's wounds: want 7, got %d", w)
		}
	})
}

// The fight's log (house decision #100): the GM side reads the running fight's actions newest first, each with its
// round, who was acting, whether it was taken back and the strike it was; a player's seat reads none of it.
func TestTheFightLogTellsTheGMWhatHappened(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		ogre := p.brute("Ogre", 5)
		p.arm(hal, "maul")
		p.fight([]string{hal}, []string{ogre})
		p.send(gm, map[string]any{"type": "rule.op", "primitive": "initiative.seated", "op": "next", "input": map[string]any{}})
		p.send(gm, strikeOf(hal, ogre, "maul", 8, map[string]any{}))
		p.send(gm, hit(ogre, 1, 0))
		p.send(gm, undo)
		log := p.seatView(gm).State.Encounter.Log
		if len(log) != 3 {
			t.Fatalf("want 3 lines, got %d: %+v", len(log), log)
		}
		last, strike, step := log[0], log[1], log[2]
		if !last.Undone || strike.Undone || step.Undone {
			t.Fatalf("taken back: want only the newest, got %v %v %v", last.Undone, strike.Undone, step.Undone)
		}
		if strike.Strike == nil || strike.Strike.Outcome != "wounded" || strike.Strike.Means == nil || *strike.Strike.Means != "Maul" {
			t.Fatalf("the strike line: %+v", strike.Strike)
		}
		if strike.ActorID == nil || *strike.ActorID != hal || strike.Round != 1 {
			t.Fatalf("the strike was taken in round 1 on Hal's turn, got round %d by %v", strike.Round, strike.ActorID)
		}
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"), hal)
		if got := p.seatView(player).State.Encounter.Log; got != nil {
			t.Fatalf("a player's seat reads the log: %+v", got)
		}
	})
}
