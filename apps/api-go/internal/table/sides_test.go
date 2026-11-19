package table

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The sides turn order run through the api (house decisions #57 and #60). Every name is our own invention.

// sidesFixture is the two-type play fixture with a sides order: Wardens (characters) and Raiders (beasts), two shared
// pools to pay with, a condition for each expiry and a health state that leaves a member unable. over changes the
// initiative block.
func sidesFixture(t *testing.T, over map[string]any) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(scopedFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	pool := func(id, scope string) map[string]any {
		return map[string]any{"id": id, "label": id, "cite": "Fixture p.7", "scope": scope, "min": "0", "max": "5",
			"editableBy": "gm", "visibility": "party"}
	}
	m["resources"] = append(m["resources"].([]any), pool("momentum", "party"), pool("pressure", "gm"))
	m["conditions"] = []any{
		map[string]any{"id": "staggered", "label": "Staggered", "cite": "Fixture p.8", "duration": "ownTurnEnd"},
		map[string]any{"id": "dazed", "label": "Dazed", "cite": "Fixture p.8", "duration": "roundEnd"},
	}
	m["health"] = map[string]any{"tracks": []any{}, "states": []any{
		map[string]any{"id": "downed", "when": "res.hp <= 0", "cite": "Fixture p.9"}}}
	cost := func(pool string, n int) map[string]any { return map[string]any{"pool": pool, "amount": n} }
	init := map[string]any{
		"strategy": "sides", "roundEnd": "manual", "cite": "Fixture p.4",
		"sides": []any{
			map[string]any{"id": "wardens", "label": "Wardens", "entities": []any{"character"}},
			map[string]any{"id": "raiders", "label": "Raiders", "entities": []any{"beast"}},
		},
		"unableStates": []any{"downed"},
		"outOfTurn": map[string]any{"cite": "Fixture p.4",
			"cost": map[string]any{"wardens": cost("momentum", 1), "raiders": cost("pressure", 1)}},
		"hold": map[string]any{"cite": "Fixture p.4"},
		"barred": map[string]any{"throughRound": 1, "cite": "Fixture p.4",
			"liftCost": map[string]any{"wardens": cost("momentum", 2), "raiders": cost("pressure", 2)}},
	}
	for k, v := range over {
		init[k] = v
	}
	m["initiative"] = init
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func newSidesPlay(t *testing.T, tx pgx.Tx, over map[string]any) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, sidesFixture(t, over))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// A beast with this much Vigour (0 leaves it downed).
func (p *play) beast(name string, hp int) string {
	id := p.room.Actor(p.t, p.tx, "creature", name, "beast")
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 1)`, id)
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'hp', $2)`, id, hp)
	return id
}

func sidesOp(op string, in map[string]any) map[string]any {
	return map[string]any{"type": "rule.op", "primitive": "initiative.sides", "op": op, "input": in}
}

func pick(id string) map[string]any { return sidesOp("pick", map[string]any{"id": id}) }

// A fight of two Wardens and a Raider, started with nobody's side named.
func (p *play) sidesFight() (w1, w2, r1 string) {
	w1, w2, r1 = p.character("Wren", 3), p.character("Wick", 2), p.beast("Rook", 5)
	p.send(p.room.GM(), map[string]any{"type": "encounter.start"})
	p.send(p.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{w1, w2, r1}})
	return
}

func (p *play) enc() *cs.Encounter { return p.seatView(p.room.GM()).State.Encounter }

func (p *play) wantCurrent(want *string) {
	p.t.Helper()
	got := p.turn().CurrentID
	if (got == nil) != (want == nil) || (got != nil && *got != *want) {
		p.t.Fatalf("current: want %v, got %v", want, got)
	}
}

func (p *play) wantSideUp(want string) {
	p.t.Helper()
	got := p.enc().SideUp
	if (want == "") != (got == nil) || (got != nil && *got != want) {
		p.t.Fatalf("sideUp: want %q, got %v", want, got)
	}
}

func (p *play) conditions(actorID string) int {
	return dbtest.Scalar[int](p.t, p.tx, `SELECT count(*) FROM actor_condition WHERE actor_id = $1`, actorID)
}

func (p *play) addCondition(actorID, condition string) {
	p.send(p.room.GM(), map[string]any{"type": "condition.add", "actorId": actorID, "condition": condition, "expiresAfter": 1.0})
}

func (p *play) fill(pool string, n float64) { p.send(p.room.GM(), adjustPool(pool, n)) }

func (p *play) refusedAny(c cs.Ctx, action map[string]any) *cs.Error {
	p.t.Helper()
	_, err := p.try(c, action)
	var refusal *cs.Error
	if !errors.As(err, &refusal) {
		p.t.Fatalf("%v: want a refusal, got %v", action["type"], err)
	}
	return refusal
}

func TestASidesFightWithASetupOpensNotBegun(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, map[string]any{"setup": map[string]any{"cite": "Fixture p.4"}})
		gm := p.room.GM()
		w1, w2, _ := p.sidesFight()
		if tr := p.turn(); tr.Round != 1 || tr.Begun == nil || *tr.Begun {
			t.Fatalf("not begun, round 1: got round %v, begun %v", tr.Round, tr.Begun)
		}
		p.refused(gm, pick(w1), "wrongState")
		p.send(gm, sidesOp("bar", map[string]any{"id": w2, "barred": true}))
		if got := p.turn().Barred; !slices.Equal(got, []string{w2}) {
			t.Fatalf("barred: got %v", got)
		}
		p.send(gm, sidesOp("begin", map[string]any{}))
		tr := p.turn()
		if tr.Round != 1 || !*tr.Begun || !slices.Equal(tr.Barred, []string{w2}) {
			t.Fatalf("begin keeps the bars: round %v, begun %v, barred %v", tr.Round, *tr.Begun, tr.Barred)
		}
		p.send(gm, pick(w1))

		// Without a setup the fight opens begun.
		p2 := newSidesPlay(t, tx, nil)
		p2.sidesFight()
		if tr := p2.turn(); !*tr.Begun {
			t.Fatal("no setup: begun")
		}
	})
}

func TestACombatantsSideComesFromItsEntityTypeOrTheAction(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, _, r1 := p.sidesFight()
		side := func(id string) string {
			return dbtest.Scalar[string](t, tx, `SELECT side FROM combatant WHERE actor_id = $1`, id)
		}
		if side(w1) != "wardens" || side(r1) != "raiders" {
			t.Fatalf("by entity type: got %s, %s", side(w1), side(r1))
		}
		// An explicit side, a side the manifest does not declare, and a type on no side.
		oddOne := p.room.Actor(t, tx, "creature", "Odd", "beast")
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{oddOne}, "side": "wardens"})
		if side(oddOne) != "wardens" {
			t.Fatalf("explicit side: got %s", side(oddOne))
		}
		other := p.beast("Other", 3)
		p.refused(gm, map[string]any{"type": "encounter.add", "actorIds": []any{other}, "side": "party"}, "badInput")
		p.refused(gm, map[string]any{"type": "encounter.add", "actorIds": []any{other}, "side": "nope"}, "badInput")
		// A type on no side is refused, naming the actor.
		bare := newSidesPlay(t, tx, map[string]any{"sides": []any{
			map[string]any{"id": "wardens", "label": "Wardens", "entities": []any{"character"}},
			map[string]any{"id": "raiders", "label": "Raiders"},
		}})
		bare.send(bare.room.GM(), map[string]any{"type": "encounter.start"})
		stranger := bare.beast("Stranger", 3)
		_, err := bare.try(bare.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{stranger}})
		var refusal *cs.Error
		if !errors.As(err, &refusal) || refusal.Code != "wrongState" || refusal.Params["detail"] != "Stranger is on no side" {
			t.Fatalf("a type on no side: got %v", err)
		}

		// Any other order keeps its three sides.
		plain := newPlay(t, tx)
		a := plain.character("Ash", 1)
		plain.send(plain.room.GM(), map[string]any{"type": "encounter.start"})
		plain.refused(plain.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{a}, "side": "wardens"}, "badInput")
		plain.refused(plain.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{a}}, "badInput")
		plain.send(plain.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{a}, "side": "foe"})
	})
}

func TestASidesRoundRunsFromPickToNewRoundAndWrapsOnItsOwnUnderAuto(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()
		p.wantSideUp("wardens")
		p.refused(gm, pick(r1), "wrongState")
		p.send(gm, pick(w1))
		p.wantCurrent(&w1)
		p.send(gm, sidesOp("next", map[string]any{}))
		p.wantCurrent(nil)
		p.wantSideUp("raiders")
		p.send(gm, pick(r1))
		p.send(gm, sidesOp("next", map[string]any{}))
		// Raiders have nobody left: the Wardens go again.
		p.wantSideUp("wardens")
		p.send(gm, pick(w2))
		p.send(gm, sidesOp("next", map[string]any{}))
		p.wantSideUp("")
		if p.turn().Round != 1 {
			t.Fatal("manual: the round waits")
		}
		p.send(gm, sidesOp("newRound", map[string]any{}))
		if tr := p.turn(); tr.Round != 2 || len(tr.Done) != 0 || tr.LastSide != nil {
			t.Fatalf("new round: round %v, done %v, last %v", tr.Round, tr.Done, tr.LastSide)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		if tr := p.turn(); tr.Round != 1 || len(tr.Done) != 3 || tr.LastSide == nil || *tr.LastSide != "wardens" {
			t.Fatalf("undo of the new round: round %v, done %v", tr.Round, tr.Done)
		}

		auto := newSidesPlay(t, tx, map[string]any{"roundEnd": "auto"})
		x1, _, _ := auto.sidesFight()
		auto.send(gm2(auto), pick(x1))
		for i := 0; i < 3; i++ {
			auto.send(gm2(auto), sidesOp("next", map[string]any{}))
			if auto.turn().Round == 2 {
				break
			}
			up := auto.enc().SideUp
			for _, c := range auto.enc().Combatants {
				if !c.Unable && *up == c.Side && !slices.Contains(auto.enc().Done, c.ID) {
					auto.send(gm2(auto), pick(c.ActorID))
					break
				}
			}
		}
		if auto.turn().Round != 2 {
			t.Fatalf("auto: the last next wraps the round, got %v", auto.turn().Round)
		}
	})
}

func gm2(p *play) cs.Ctx { return p.room.GM() }

func TestSeizeChargesThePoolAndOneUndoReturnsThePoolAndTheTurn(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, _ := p.sidesFight()
		p.fill("momentum", 2)
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("next", map[string]any{})) // the Raiders are up now
		p.send(gm, sidesOp("seize", map[string]any{"id": w2}))
		wantPool(t, p, "momentum", 1)
		p.wantCurrent(&w2)
		if tr := p.turn(); tr.OutOfTurnSide == nil || *tr.OutOfTurnSide != "wardens" {
			t.Fatalf("outOfTurnSide: %v", tr.OutOfTurnSide)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "momentum", 2)
		p.wantCurrent(nil)
		if tr := p.turn(); tr.OutOfTurnSide != nil {
			t.Fatalf("undone: outOfTurnSide %v", tr.OutOfTurnSide)
		}

		// A pool that cannot pay refuses it, and nothing is written.
		p.fill("momentum", -2)
		p.refusedAny(gm, sidesOp("seize", map[string]any{"id": w2}))
		wantPool(t, p, "momentum", 0)
		p.wantCurrent(nil)
		if tr := p.turn(); tr.OutOfTurnSide != nil {
			t.Fatal("a refused seize wrote nothing")
		}
	})
}

func TestAConditionEndsWithItsHoldersTurnHoweverTheTurnEnds(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()

		// next
		p.addCondition(w1, "staggered")
		p.addCondition(w2, "staggered")
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("next", map[string]any{}))
		if p.conditions(w1) != 0 || p.conditions(w2) != 1 {
			t.Fatalf("next ends the holder's own: %d, %d", p.conditions(w1), p.conditions(w2))
		}
		// another member picked while the holder acts
		p.addCondition(r1, "staggered")
		p.send(gm, pick(r1))
		p.send(gm, pick(w2))
		if p.conditions(r1) != 0 || p.conditions(w2) != 1 {
			t.Fatalf("a pick over the acting one ends their turn, not the picked one's: %d, %d", p.conditions(r1), p.conditions(w2))
		}
		p.addCondition(w2, "dazed")
		p.send(gm, sidesOp("hold", map[string]any{}))
		if p.conditions(w2) != 1 {
			t.Fatalf("hold ends w2's turn, so its own-turn one, leaving the round one: %d", p.conditions(w2))
		}

		// a round-end condition ends on the wrap
		p.send(gm, sidesOp("newRound", map[string]any{}))
		if p.conditions(w2) != 0 {
			t.Fatalf("roundEnd on the wrap: %d", p.conditions(w2))
		}
	})
}

func TestAnUnableCombatantCannotBePickedAndDoesNotHoldUpTheRound(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, map[string]any{"roundEnd": "auto"})
		gm := p.room.GM()
		w1 := p.character("Wren", 3)
		down := p.beast("Rook", 0)
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{w1, down}})
		p.refused(gm, sidesOp("pick", map[string]any{"id": down, "force": true}), "wrongState")
		if got := p.enc().Combatants; !got[1].Unable || got[0].Unable {
			t.Fatalf("unable flags: %+v", got)
		}
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("next", map[string]any{}))
		if p.turn().Round != 2 {
			t.Fatalf("the downed raider holds nothing up: round %v", p.turn().Round)
		}
	})
}

func TestHoldInterruptMarkBarAndLift(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("hold", map[string]any{}))
		if got := p.turn().Held; !slices.Equal(got, []string{w1}) {
			t.Fatalf("held: %v", got)
		}
		p.send(gm, sidesOp("interrupt", map[string]any{"id": w1}))
		if len(p.turn().Held) != 0 {
			t.Fatal("interrupt plays the held action")
		}
		// A second turn: clearing done.
		p.send(gm, sidesOp("mark", map[string]any{"id": w1, "done": false}))
		if slices.Contains(p.turn().Done, w1) {
			t.Fatal("mark cleared done")
		}
		// Bar, then lift for two (charged), refused while the pool cannot pay.
		p.send(gm, sidesOp("bar", map[string]any{"id": r1, "barred": true}))
		p.refusedAny(gm, sidesOp("lift", map[string]any{"id": r1}))
		if len(p.turn().Barred) != 1 {
			t.Fatal("a refused lift wrote nothing")
		}
		p.fill("pressure", 3)
		p.send(gm, sidesOp("lift", map[string]any{"id": r1}))
		wantPool(t, p, "pressure", 1)
		if len(p.turn().Barred) != 0 {
			t.Fatal("lift frees it")
		}
		_ = w2
	})
}

func TestTurnNextRunsASidesOrderAndPrevAndPhaseDoneAreRefused(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()
		p.send(gm, pick(w1))
		p.addCondition(w1, "staggered")
		p.send(gm, map[string]any{"type": "turn.next"})
		p.wantCurrent(nil)
		if p.conditions(w1) != 0 {
			t.Fatal("turn.next runs the expiries")
		}
		if got := p.refusedAny(gm, map[string]any{"type": "turn.prev"}); got.Code != "wrongState" {
			t.Fatalf("turn.prev: %v", got)
		}
		if got := p.refusedAny(gm, map[string]any{"type": "phase.done", "actorId": w1}); got.Code != "wrongState" {
			t.Fatalf("phase.done: %v", got)
		}

		// Removing the acting combatant leaves nobody acting.
		p.send(gm, pick(r1))
		p.send(gm, map[string]any{"type": "encounter.remove", "combatantId": p.combatant(r1)})
		p.wantCurrent(nil)

		// With no session running every op is refused.
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, p.room.ID)
		for _, op := range []string{"begin", "next", "hold", "newRound"} {
			p.refused(gm, sidesOp(op, map[string]any{}), "sessionPaused")
		}
		for _, op := range []string{"pick", "seize", "interrupt", "lift"} {
			p.refused(gm, sidesOp(op, map[string]any{"id": w2}), "sessionPaused")
		}
		p.refused(gm, sidesOp("mark", map[string]any{"id": w2, "done": true}), "sessionPaused")
		p.refused(gm, sidesOp("bar", map[string]any{"id": w2, "barred": true}), "sessionPaused")
	})
}

func TestTheSnapshotCarriesTheSidesValuesAndAHiddenCombatantKeepsItsFlags(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, _, r1 := p.sidesFight()
		p.send(gm, map[string]any{"type": "encounter.setVisibility", "combatantId": p.combatant(r1), "visibility": "hidden"})
		p.send(gm, sidesOp("bar", map[string]any{"id": r1, "barred": true}))
		p.send(gm, pick(w1))

		whole := p.enc()
		if whole.EncounterSides == nil || !whole.Begun || whole.SideUp == nil || *whole.SideUp != "wardens" ||
			whole.LastSide != nil {
			t.Fatalf("the GM's encounter: %+v", whole.EncounterSides)
		}
		// w1 acts and w2 is still pending, so the Wardens stay up.
		if !slices.ContainsFunc(whole.Combatants, func(c cs.Combatant) bool { return c.ActorID == r1 && c.Barred }) {
			t.Fatal("the GM sees the raider's flags")
		}

		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), w1)
		seen := p.seatView(player).State.Encounter
		if len(seen.Combatants) != 2 || seen.Combatants[0].ActorID == r1 || seen.Combatants[1].ActorID == r1 ||
			seen.Combatants[0].CombatantSides == nil {
			t.Fatalf("the player does not see the hidden raider, and sees the others' flags: %+v", seen.Combatants)
		}
		raw, err := json.Marshal(seen)
		if err != nil {
			t.Fatal(err)
		}
		var keys map[string]any
		if err := json.Unmarshal(raw, &keys); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"begun", "lastSide", "outOfTurnSide", "sideUp"} {
			if _, ok := keys[k]; !ok {
				t.Fatalf("the player's encounter lacks %s", k)
			}
		}

		// A fight in any other order has none of these keys.
		plain := newPlay(t, tx)
		a := plain.character("Ash", 1)
		plain.send(plain.room.GM(), map[string]any{"type": "encounter.start"})
		plain.send(plain.room.GM(), map[string]any{"type": "encounter.add", "actorIds": []any{a}, "side": "party"})
		raw, err = json.Marshal(plain.seatView(plain.room.GM()).State.Encounter)
		if err != nil {
			t.Fatal(err)
		}
		var ranked map[string]any
		if err := json.Unmarshal(raw, &ranked); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"begun", "lastSide", "outOfTurnSide", "sideUp"} {
			if _, ok := ranked[k]; ok {
				t.Fatalf("a ranked fight carries %s", k)
			}
		}
		if _, ok := ranked["combatants"].([]any)[0].(map[string]any)["held"]; ok {
			t.Fatal("a ranked combatant carries held")
		}
	})
}
