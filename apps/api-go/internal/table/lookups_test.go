package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Lookups run through the api (house decision #87), on the harm fixture with the lookup the rules engine's sample-harm
// declares: a switch that changes the wounds, surge dice that raise the total, a stacking condition brutes are immune
// to, applied again for each point of press, an open-ended last line and a line naming a second table.

const lookupTables = `{
	"conditions": [{"id": "dazed", "label": "Dazed", "cite": "Fixture p.4", "duration": "manual", "stacking": "stack",
		"maxStacks": 3, "visibility": "party", "immune": "derived.strainCap == 0"}],
	"tables": {
		"blow": {"title": "Telling Blow", "die": "d66", "visibility": "gm", "cite": "Fixture p.8", "typedOnly": true,
			"entities": ["hero", "brute"],
			"inputs": [{"id": "past", "label": "Past the hide", "type": "bool"},
				{"id": "surge", "label": "Surge dice", "type": "int", "min": 0, "max": 4},
				{"id": "press", "label": "Press", "type": "int", "min": 0, "max": 3}],
			"modifier": "ctx.surge * 10",
			"entries": [
				{"id": "graze", "label": "Graze", "range": [11, 36], "apply": [{"kind": "harm", "wounds": "ctx.past ? 2 : 1"}]},
				{"id": "reel", "label": "Reel", "range": [41, 56], "apply": [
					{"kind": "harm", "wounds": "2", "when": "ctx.past"},
					{"kind": "harm", "wounds": "1", "when": "!ctx.past"},
					{"kind": "condition", "condition": "dazed", "when": "ctx.past"},
					{"kind": "condition", "condition": "dazed", "when": "ctx.past", "times": "ctx.press"}]},
				{"id": "ruin", "label": "Ruin", "range": [61], "apply": [{"kind": "harm", "wounds": "ctx.past ? 4 : 1"}],
					"next": "aftermath"}]},
		"jolt": {"title": "Jolt", "die": "d6", "visibility": "gm", "cite": "Fixture p.9", "typedOnly": true,
			"entities": ["hero", "brute"],
			"entries": [
				{"id": "both", "label": "Both", "range": [1, 3], "apply": [{"kind": "harm", "wounds": "1", "shock": "2"}]},
				{"id": "strain", "label": "Strain", "range": [4, 6], "apply": [{"kind": "harm", "shock": "1"}]}]},
		"aftermath": {"title": "Aftermath", "die": "d6", "visibility": "gm", "cite": "Fixture p.10",
			"entries": [{"id": "limp", "label": "Limp", "range": [1, 3]}, {"id": "scar", "label": "Scar", "range": [4, 6]}]}
	}
}`

func newLookupPlay(t *testing.T, tx pgx.Tx) *play {
	var m, extra map[string]any
	if err := json.Unmarshal([]byte(harmFixture), &m); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(lookupTables), &extra); err != nil {
		t.Fatal(err)
	}
	m["conditions"] = append(m["conditions"].([]any), extra["conditions"].([]any)...)
	m["tables"] = extra["tables"]
	// The hero converts harm, as sample-harm's does since the spends layer (house decision #84): a lookup's hit is unchanged.
	m["health"].(map[string]any)["harm"].(map[string]any)["profiles"].([]any)[0].(map[string]any)["convert"] = true
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(out))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

func (p *play) brute(name string, hide int) string {
	id := p.room.Actor(p.t, p.tx, "creature", name, "brute")
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'hide', 0, $2)`, id, hide)
	p.counters(id, map[string]int{"wounds": 0, "strain": 0})
	return id
}

func (p *play) stacks(id, condition string) int {
	return dbtest.Scalar[int](p.t, p.tx, `SELECT coalesce(sum(stacks), 0)::int FROM actor_condition
		WHERE actor_id = $1 AND condition_id = $2`, id, condition)
}

func applyBlow(actorID string, result int, inputs map[string]any) map[string]any {
	return map[string]any{"type": "table.apply", "tableId": "blow", "result": float64(result), "actorId": actorID, "inputs": inputs}
}

func TestALookupAppliesItsLineAsOneAction(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		// 44 reads Reel: past the hide, 2 wounds and Dazed, then once more for the one point of press.
		r := p.send(gm, applyBlow(hal, 44, map[string]any{"past": true, "press": 1.0}))
		if r.Roll == nil || r.Roll.EntryID != "reel" || r.Roll.Total != 44 || r.ID == "" {
			t.Fatalf("want the Reel line answered under one action, got %+v", r)
		}
		if p.res(hal, "wounds") != 2 || p.stacks(hal, "dazed") != 2 {
			t.Fatalf("want 2 wounds and 2 stacks of Dazed, got %d and %d", p.res(hal, "wounds"), p.stacks(hal, "dazed"))
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(DISTINCT action_id) FROM session_event WHERE campaign_id = $1
			AND type = 'delta'`, p.room.ID); n != 1 {
			t.Fatalf("want one logged action, got %d", n)
		}
		// One Undo takes the whole line back.
		p.send(gm, undo)
		if p.res(hal, "wounds") != 0 || p.holds(hal, "dazed") {
			t.Fatalf("undo left wounds %d, dazed %v", p.res(hal, "wounds"), p.holds(hal, "dazed"))
		}
		// Not past the hide: the switch makes it 1 wound and no condition.
		p.send(gm, applyBlow(hal, 51, map[string]any{}))
		if p.res(hal, "wounds") != 1 || p.holds(hal, "dazed") {
			t.Fatalf("want 1 wound and no Dazed, got %d, %v", p.res(hal, "wounds"), p.holds(hal, "dazed"))
		}
	})
}

// A lookup's line on a hero whose profile converts harm, applied in a fight: TURN BACK takes the step and the whole line
// with it, and a conversion after it, as one action each.
func TestTurnBackTakesALookupLineWhole(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 1, 0)
		ogre := p.brute("Ogre", 4)
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{hal}, "side": "party"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{ogre}, "side": "foe"})
		p.send(gm, harmOp("convert", map[string]any{"actorId": hal, "amount": 1.0})) // before any step: stays
		p.send(gm, map[string]any{"type": "rule.op", "primitive": "initiative.seated", "op": "next", "input": map[string]any{}})
		p.send(gm, applyBlow(hal, 44, map[string]any{"past": true, "press": 1.0}))
		p.send(gm, hit(hal, 0, 1))
		p.send(gm, harmOp("convert", map[string]any{"actorId": hal, "amount": 1.0}))
		if w, s, n := p.res(hal, "wounds"), p.res(hal, "strain"), p.stacks(hal, "dazed"); w != 1 || s != 3 || n != 2 {
			t.Fatalf("before TURN BACK: wounds %d strain %d dazed %d", w, s, n)
		}
		p.wantTurnBack(&cs.EncounterTurnBack{Kind: "turnStart", Name: "Hal", Round: 1, Later: 3})
		p.send(gm, turnBack)
		if w, s := p.res(hal, "wounds"), p.res(hal, "strain"); w != 0 || s != 1 || p.holds(hal, "dazed") {
			t.Fatalf("after TURN BACK: wounds %d strain %d dazed %v", w, s, p.holds(hal, "dazed"))
		}
		p.wantCurrent(nil)
	})
}

func TestALookupTotalReadsTheOpenEndedLine(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		// 36 and three surge dice: 66, read by Ruin, the last line, which has no top.
		r := p.send(gm, applyBlow(hal, 36, map[string]any{"surge": 3.0}))
		if r.Roll.EntryID != "ruin" || r.Roll.Total != 66 || r.Roll.Value != 36 || p.res(hal, "wounds") != 1 {
			t.Fatalf("want Ruin at 66 dealing 1 wound, got %+v and %d wounds", r.Roll, p.res(hal, "wounds"))
		}
		r = p.send(gm, applyBlow(hal, 66, map[string]any{"surge": 4.0, "past": true}))
		if r.Roll.EntryID != "ruin" || r.Roll.Total != 106 || p.res(hal, "wounds") != 5 {
			t.Fatalf("want Ruin at 106 dealing 4 more wounds, got %+v and %d wounds", r.Roll, p.res(hal, "wounds"))
		}
	})
}

func TestALookupSkipsAConditionTheTargetIsImmuneTo(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		ogre := p.brute("Ogre", 4)
		r := p.send(gm, applyBlow(ogre, 44, map[string]any{"past": true, "press": 2.0}))
		if p.res(ogre, "wounds") != 2 || p.holds(ogre, "dazed") {
			t.Fatalf("want 2 wounds and no Dazed, got %d, %v", p.res(ogre, "wounds"), p.holds(ogre, "dazed"))
		}
		if len(r.Notices) != 1 || r.Notices[0].Code != "conditionSkipped" || r.Notices[0].Params["name"] != "Ogre" ||
			r.Notices[0].Params["condition"] != "Dazed" {
			t.Fatalf("want one conditionSkipped notice naming the Ogre and Dazed, got %+v", r.Notices)
		}
	})
}

// A hit a target never takes shock from lands its wounds alone, with a notice; a line of shock alone writes nothing but
// the notice (house decision #163). A hero takes both.
func TestALookupLeavesOutTheShockOfATargetThatNeverTakesIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		ogre := p.brute("Ogre", 4)
		jolt := func(id string, result int) map[string]any {
			return map[string]any{"type": "table.apply", "tableId": "jolt", "result": float64(result), "actorId": id, "inputs": map[string]any{}}
		}
		r := p.send(gm, jolt(ogre, 2))
		if p.res(ogre, "wounds") != 1 || p.res(ogre, "strain") != 0 {
			t.Fatalf("want 1 wound and no strain, got %d, %d", p.res(ogre, "wounds"), p.res(ogre, "strain"))
		}
		if len(r.Notices) != 1 || r.Notices[0].Code != "shockSkipped" || r.Notices[0].Params["name"] != "Ogre" ||
			r.Notices[0].Params["shock"] != "Strain" {
			t.Fatalf("want one shockSkipped notice naming the Ogre and Strain, got %+v", r.Notices)
		}
		r = p.send(gm, jolt(ogre, 5))
		if p.res(ogre, "wounds") != 1 || len(r.Notices) != 1 || r.Notices[0].Code != "shockSkipped" {
			t.Fatalf("want nothing written and one notice, got %d wounds, %+v", p.res(ogre, "wounds"), r.Notices)
		}
		hal := p.hero("Hal", 0, 0)
		p.send(gm, jolt(hal, 2))
		if p.res(hal, "wounds") != 1 || p.res(hal, "strain") != 2 {
			t.Fatalf("Hal: want 1 wound and 2 strain, got %d, %d", p.res(hal, "wounds"), p.res(hal, "strain"))
		}
	})
}

func TestLookupRefusals(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		swarm := p.room.Actor(t, tx, "creature", "Rats", "swarm")
		roll := func(over map[string]any) map[string]any {
			a := map[string]any{"type": "table.roll", "tableId": "blow"}
			for k, v := range over {
				a[k] = v
			}
			return a
		}
		p.refused(gm, roll(nil), "tableTypedOnly")
		p.refused(gm, roll(map[string]any{"result": 44.0}), "tableNeedsTarget")
		p.refused(gm, roll(map[string]any{"result": 17.0, "actorId": hal}), "tableResultOut")
		p.refused(gm, applyBlow(hal, 70, nil), "tableResultOut")
		p.refused(gm, applyBlow(hal, 44, map[string]any{"surge": 9.0}), "tableInput")
		p.refused(gm, applyBlow(hal, 44, map[string]any{"loud": true}), "tableInput")
		p.refused(gm, applyBlow(swarm, 44, nil), "tableNotFor")
		p.refused(gm, map[string]any{"type": "table.apply", "tableId": "aftermath", "result": 4.0, "actorId": hal}, "tableNoApply")
		p.refused(gm, map[string]any{"type": "table.apply", "tableId": "nope", "result": 4.0, "actorId": hal}, "tableNotFound")
		p.refused(p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hal), applyBlow(hal, 44, nil), "noPermission")
		if p.res(hal, "wounds") != 0 {
			t.Fatalf("a refusal wrote wounds")
		}
	})
}

func TestATypedRollReadsItsLine(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newLookupPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		r := p.send(gm, map[string]any{"type": "table.roll", "tableId": "aftermath", "result": 5.0})
		if r.Roll == nil || r.Roll.EntryID != "scar" || r.Roll.Value != 5 {
			t.Fatalf("want Scar for a typed 5, got %+v", r.Roll)
		}
		r = p.send(gm, map[string]any{"type": "table.roll", "tableId": "blow", "result": 36.0, "actorId": hal,
			"inputs": map[string]any{"surge": 3.0}})
		if r.Roll.EntryID != "ruin" || r.Roll.Total != 66 {
			t.Fatalf("want Ruin at 66, got %+v", r.Roll)
		}
		p.refused(gm, map[string]any{"type": "table.roll", "tableId": "aftermath", "result": 7.0}, "tableResultOut")
		// A roll is logged, never a delta: it changes nothing Undo reads.
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type = 'table.roll'`,
			p.room.ID); n != 2 {
			t.Fatalf("want 2 rolls logged, got %d", n)
		}
	})
}
