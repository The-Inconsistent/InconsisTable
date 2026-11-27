package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// Spends (house decision #84) on the invented sides and harm fixtures: asked, approved, refused, cleared, done in one
// tap, and undone whole.

// withSpends adds spends (and requests.max) to a fixture's JSON.
func withSpends(t *testing.T, fixture string, spends []any, max float64) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(fixture), &m); err != nil {
		t.Fatal(err)
	}
	m["spends"] = spends
	if max > 0 {
		m["requests"] = map[string]any{"max": max}
	}
	if extra, ok := m["resources"].([]any); ok && m["id"] == "fixture-harm" {
		m["resources"] = append(extra, map[string]any{"id": "resolve", "label": "Resolve", "cite": "Fixture p.8",
			"scope": "entity", "entities": []any{"hero"}, "max": "3", "visibility": "party"})
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func spend(id string, cost []any, more map[string]any) map[string]any {
	s := map[string]any{"id": id, "label": id, "cite": "Fixture p.9", "entities": []any{"character"}, "cost": cost}
	for k, v := range more {
		s[k] = v
	}
	return s
}

func poolCost(pool string, amount string, byRun bool) map[string]any {
	return map[string]any{"pool": pool, "amount": amount, "byRun": byRun}
}

var sidesSpends = []any{
	spend("rally", []any{poolCost("momentum", "ctx.dice", false)},
		map[string]any{"inputs": map[string]any{"dice": map[string]any{"label": "Dice", "min": 1, "max": "3"}}}),
	spend("jump", []any{poolCost("momentum", "1", true)}, map[string]any{"if": "ctx.fight.in",
		"run":     []any{map[string]any{"primitive": "initiative.sides", "op": "seize", "input": map[string]any{"id": "ctx.self"}}},
		"clearOn": []any{"encounterEnd"}}),
	spend("shake", []any{poolCost("momentum", "2", true)}, map[string]any{"if": "ctx.fight.barred",
		"run": []any{map[string]any{"primitive": "initiative.sides", "op": "lift", "input": map[string]any{"id": "ctx.self"}}}}),
}

func newSpendsPlay(t *testing.T, tx pgx.Tx, max float64) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, withSpends(t, sidesFixture(t, nil), sidesSpends, max))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

func ask(actorID, spendID string, inputs map[string]any) map[string]any {
	a := map[string]any{"type": "request.send", "actorId": actorID, "spendId": spendID}
	if inputs != nil {
		a["inputs"] = inputs
	}
	return a
}

func doSpend(actorID, spendID string, inputs map[string]any) map[string]any {
	a := ask(actorID, spendID, inputs)
	a["type"] = "spend.do"
	return a
}

func (p *play) requestStatus(id string) string {
	return dbtest.Scalar[string](p.t, p.tx, `SELECT status FROM spend_request WHERE id = $1`, id)
}

func TestAPoolSpendIsAskedSeenByThePartyAndPaidAtApproval(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		wren, wick := p.character("Wren", 3), p.character("Wick", 2)
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		other := p.room.Seat(t, tx, dbtest.User(t, tx, "Q"), wick)
		p.fill("momentum", 3)

		p.refused(asker, ask(wren, "rally", map[string]any{"dice": 4.0}), "badInput")
		p.refused(asker, ask(wick, "rally", map[string]any{"dice": 1.0}), "notYourCharacter")
		p.refused(asker, map[string]any{"type": "request.send", "actorId": wren, "spendId": "rally", "amount": 1.0}, "requestKind")
		p.refused(asker, ask(wren, "jump", nil), "spendNotNow")
		id := p.send(asker, ask(wren, "rally", map[string]any{"dice": 2.0})).ID
		p.refused(asker, ask(wren, "rally", map[string]any{"dice": 1.0}), "spendAsked")

		seen := p.seatView(other).State.Requests
		if len(seen) != 1 || seen[0].ID != id || seen[0].SpendID == nil || *seen[0].SpendID != "rally" {
			t.Fatalf("the other player sees the ask on the party's pool: %+v", seen)
		}
		p.refused(other, map[string]any{"type": "request.cancel", "id": id}, "requestNotFound")

		p.send(gm, map[string]any{"type": "request.approve", "id": id})
		wantPool(t, p, "momentum", 1)
		if got := p.requestStatus(id); got != "approved" {
			t.Fatalf("approved: got %s", got)
		}
	})
}

// Undo of an approved spend gives its cost back and leaves the ask waiting, to be answered again (#227, house decision
// #119), as an applied offer is applicable again.
func TestUndoOfAnApprovedSpendLeavesItsAskPending(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		wren := p.character("Wren", 3)
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 3)
		id := p.send(asker, ask(wren, "rally", map[string]any{"dice": 2.0})).ID
		p.send(gm, map[string]any{"type": "request.approve", "id": id})
		wantPool(t, p, "momentum", 1)
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "momentum", 3)
		if got := p.requestStatus(id); got != "pending" {
			t.Fatalf("after undo: got %s", got)
		}
		if seen := p.seatView(gm).State.Requests; len(seen) != 1 || seen[0].ID != id {
			t.Fatalf("the GM side sees the ask again: %+v", seen)
		}
		p.send(gm, map[string]any{"type": "request.approve", "id": id})
		wantPool(t, p, "momentum", 1)
	})
}

// In a room without a GM nobody answers, so a spend ask is done at once as the table, and no request waits.
func TestASpendAskWithoutAGMIsDoneAtOnce(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		wren := p.character("Wren", 3)
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 3)
		dbtest.Exec(t, tx, `UPDATE campaign SET table_mode = 'gmless' WHERE id = $1`, p.room.ID)
		p.refused(asker, ask(wren, "rally", map[string]any{"dice": 4.0}), "badInput")
		p.send(asker, ask(wren, "rally", map[string]any{"dice": 2.0}))
		wantPool(t, p, "momentum", 1)
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM spend_request WHERE campaign_id = $1`, p.room.ID); n != 0 {
			t.Fatalf("requests waiting: %d", n)
		}
	})
}

func TestASpendThePoolCannotPayAtApprovalStaysPending(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		wren := p.character("Wren", 3)
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 2)
		id := p.send(asker, ask(wren, "rally", map[string]any{"dice": 2.0})).ID
		p.fill("momentum", -1)
		p.refused(gm, map[string]any{"type": "request.approve", "id": id}, "cannotPay")
		wantPool(t, p, "momentum", 1)
		if got := p.requestStatus(id); got != "pending" {
			t.Fatalf("refused at approval: got %s", got)
		}
		p.send(gm, map[string]any{"type": "request.deny", "id": id})
	})
}

func TestTheRulesetCapsPendingAsksPerUser(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 1)
		wren, _, _ := p.sidesFight()
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 5)
		p.send(asker, ask(wren, "rally", map[string]any{"dice": 1.0}))
		p.refused(asker, ask(wren, "jump", nil), "requestLimit")
	})
}

func TestAFightsAsksAreClearedWhenItEnds(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		wren, _, _ := p.sidesFight()
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 5)
		jump := p.send(asker, ask(wren, "jump", nil)).ID
		rally := p.send(asker, ask(wren, "rally", map[string]any{"dice": 1.0})).ID
		p.send(gm, map[string]any{"type": "encounter.end"})
		if a, b := p.requestStatus(jump), p.requestStatus(rally); a != "cancelled" || b != "pending" {
			t.Fatalf("jump %s (want cancelled), rally %s (want pending)", a, b)
		}
	})
}

func TestAnOutOfTurnSpendInOneTapIsUndoneWhole(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		w1, w2, _ := p.sidesFight()
		p.fill("momentum", 3)
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("next", map[string]any{})) // the Raiders are up now
		p.send(gm, doSpend(w2, "jump", nil))
		wantPool(t, p, "momentum", 2) // the op's own charge, once
		p.wantCurrent(&w2)
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "momentum", 3)
		p.wantCurrent(nil)

		// A lifted bar: the lift pays its own charge.
		p.send(gm, sidesOp("bar", map[string]any{"id": w2, "barred": true}))
		p.send(gm, doSpend(w2, "shake", nil))
		wantPool(t, p, "momentum", 1)
		if got := p.turn().Barred; len(got) != 0 {
			t.Fatalf("lifted: barred %v", got)
		}
		p.refused(gm, doSpend(w2, "shake", nil), "spendNotNow")
	})
}

var harmSpends = []any{
	map[string]any{"id": "retry", "label": "Retry", "cite": "Fixture p.8", "entities": []any{"hero"},
		"cost": []any{map[string]any{"resource": "resolve", "amount": "1"}}},
	map[string]any{"id": "steady", "label": "Steady", "cite": "Fixture p.8", "entities": []any{"hero"},
		"cost": []any{map[string]any{"resource": "resolve", "amount": "1"}}, "if": "res.strain > 0",
		"run": []any{map[string]any{"primitive": "health.harm", "op": "hit", "input": map[string]any{"actorId": "ctx.self", "shock": "-grit"}}}},
	map[string]any{"id": "endure", "label": "Endure", "cite": "Fixture p.9", "entities": []any{"hero"}, "cost": []any{},
		"inputs": map[string]any{"marks": map[string]any{"label": "Marks", "min": 1, "max": "grit * 2"}},
		"run":    []any{map[string]any{"primitive": "health.harm", "op": "convert", "input": map[string]any{"actorId": "ctx.self", "amount": "ctx.marks"}}}},
}

func TestAPersonalSpendAndAConversionAreOneActionEach(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		var m map[string]any
		if err := json.Unmarshal([]byte(harmFixture), &m); err != nil {
			t.Fatal(err)
		}
		m["id"] = "fixture-harm"
		profiles := m["health"].(map[string]any)["harm"].(map[string]any)["profiles"].([]any)
		profiles[0].(map[string]any)["convert"] = true
		raw, _ := json.Marshal(m)
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, withSpends(t, string(raw), harmSpends, 0))
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
		p := &play{t, tx, room}
		gm := room.GM()
		hero := p.hero("Ash", 4, 1)
		p.counters(hero, map[string]int{"resolve": 1})

		p.send(gm, doSpend(hero, "steady", nil)) // resolve 1 → 0, strain 1 - grit 2 → 0
		if r, s := p.res(hero, "resolve"), p.res(hero, "strain"); r != 0 || s != 0 {
			t.Fatalf("steady: resolve %d strain %d", r, s)
		}
		p.refused(gm, doSpend(hero, "retry", nil), "cannotPay")

		p.send(gm, doSpend(hero, "endure", map[string]any{"marks": 3.0}))
		if w, s := p.res(hero, "wounds"), p.res(hero, "strain"); w != 1 || s != 3 {
			t.Fatalf("endure: wounds %d strain %d", w, s)
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		if w, s := p.res(hero, "wounds"), p.res(hero, "strain"); w != 4 || s != 0 {
			t.Fatalf("undone: wounds %d strain %d", w, s)
		}
		p.refused(gm, doSpend(hero, "endure", map[string]any{"marks": 5.0}), "badInput")

		// A player of the hero asks; without the GM's approval nothing moves.
		player := room.Seat(t, tx, dbtest.User(t, tx, "P"), hero)
		id := p.send(player, ask(hero, "endure", map[string]any{"marks": 2.0})).ID
		if seen := p.seatView(room.Seat(t, tx, dbtest.User(t, tx, "Q"), p.hero("Bo", 0, 0))).State.Requests; len(seen) != 0 {
			t.Fatalf("an ask on no pool stays with its asker: %+v", seen)
		}
		p.send(gm, map[string]any{"type": "request.approve", "id": id})
		if w, s := p.res(hero, "wounds"), p.res(hero, "strain"); w != 2 || s != 2 {
			t.Fatalf("approved: wounds %d strain %d", w, s)
		}
	})
}
