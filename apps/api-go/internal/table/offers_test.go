package table

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// offerFixture is the play fixture whose Dice pool Test, of our own invention (house decision #80), takes a number to
// beat, reads one special die that flags a complication, may be called under a Fear mark, and offers on failure: +1
// Dread with the mark, and Spare by what the score fell short (double on a complication) with +1 Dread.
func offerFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["resources"] = append(m["resources"].([]any),
		map[string]any{"id": "spare", "label": "Spare", "cite": "Fixture p.10", "scope": "entity", "visibility": "party"},
		map[string]any{"id": "dread", "label": "Dread", "cite": "Fixture p.10", "scope": "party", "max": "2", "visibility": "party"},
	)
	pool := m["tests"].(map[string]any)["pool"].(map[string]any)
	pool["target"] = "ctx.dn"
	pool["inputs"] = map[string]any{"dn": "int"}
	pool["special"] = map[string]any{"label": "Omen", "count": 1, "flags": map[string]any{"complication": map[string]any{"from": 1, "to": 1}}}
	pool["marks"] = map[string]any{"fear": map[string]any{"label": "Fear", "cite": "Fixture p.10"}}
	pool["offers"] = []any{
		map[string]any{"id": "shaken", "label": "Shaken", "when": "!result.passed && ctx.fear", "cite": "Fixture p.10",
			"changes": []any{map[string]any{"pool": "dread", "by": "1"}}},
		map[string]any{"id": "strain", "label": "Strain", "when": "!result.passed", "cite": "Fixture p.10",
			"changes": []any{
				map[string]any{"resource": "spare", "by": "max(0, result.target - result.total) * (result.flags.complication ? 2 : 1)"},
				map[string]any{"pool": "dread", "by": "1"},
			}},
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func offerOf(t *testing.T, p *play, c cs.Ctx, callID, actorID string) map[string]cs.TestOfferState {
	t.Helper()
	out := map[string]cs.TestOfferState{}
	for _, call := range p.seatView(c).State.Tests {
		for _, target := range call.Targets {
			if call.ID == callID && target.ActorID == actorID {
				for _, o := range target.Offers {
					out[o.ID] = o
				}
			}
		}
	}
	return out
}

func apply(callID, actorID, offerID string) map[string]any {
	return map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": actorID, "offerId": offerID}
}

func TestAResultOffersItsChangesToTheGMSideOnceAndUndoTakesThemBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, offerFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		p.startSession()
		ash := p.character("Ash", 4)
		p.counters(ash, map[string]int{"spare": 0})
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		screen := cs.Ctx{CampaignID: room.ID, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
		call := func(fear bool) string {
			inputs := map[string]any{"dn": 4.0}
			if fear {
				inputs["fear"] = true
			}
			return p.send(gm, map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash}, "inputs": inputs}).ID
		}
		// One hit against 4, the Omen die showing a complication: failed by 3.
		failed := map[string]any{"kind": "pool", "counts": map[string]any{"hit": 1.0}, "special": []any{1.0}}
		report := func(c cs.Ctx, callID string, roll map[string]any) {
			p.send(c, map[string]any{"type": "test.report", "callId": callID, "actorId": ash, "roll": roll})
		}

		// Under Fear, failed: both are offered to the GM, the amount worked out for Ash; the player and screen see none.
		id := call(true)
		p.refused(gm, apply(id, ash, "shaken"), "notReported")
		report(alice, id, failed)
		offers := offerOf(t, p, gm, id, ash)
		want := cs.TestOfferState{ID: "strain", Label: "Strain", Changes: []cs.TestOfferChange{
			{Resource: "spare", Label: "Spare", By: 6}, {Pool: "dread", Label: "Dread", By: 1}}}
		if len(offers) != 2 || !reflect.DeepEqual(offers["strain"], want) || offers["shaken"].Applied {
			t.Fatalf("offers: %+v", offers)
		}
		for _, c := range []cs.Ctx{alice, screen} {
			if got := offerOf(t, p, c, id, ash); len(got) != 0 {
				t.Fatalf("a seat below the GM side got offers: %+v", got)
			}
		}
		p.refused(alice, apply(id, ash, "shaken"), "noPermission")
		p.refused(gm, apply(id, ash, "nope"), "noSuchOffer")

		// Applied once, refused twice; shown as applied.
		wantNotices(t, p.send(gm, apply(id, ash, "strain")))
		if p.res(ash, "spare") != 6 {
			t.Fatalf("spare: %d", p.res(ash, "spare"))
		}
		wantPool(t, p, "dread", 1)
		p.refused(gm, apply(id, ash, "strain"), "offerApplied")
		if !offerOf(t, p, gm, id, ash)["strain"].Applied {
			t.Fatal("strain is not shown as applied")
		}
		// The pool now holds 2 of 2 after the next: full, and the next change says what it lost.
		wantNotices(t, p.send(gm, apply(id, ash, "shaken")))
		wantPool(t, p, "dread", 2)

		// Undo takes the last apply back whole, and offers it again.
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "dread", 1)
		if offerOf(t, p, gm, id, ash)["shaken"].Applied {
			t.Fatal("shaken is still applied after undo")
		}
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "dread", 0)
		if p.res(ash, "spare") != 0 || offerOf(t, p, gm, id, ash)["strain"].Applied {
			t.Fatal("undo did not take strain back whole")
		}

		// A full pool: the change follows its clamp, and the GM is told what was lost.
		p.send(gm, adjustPool("dread", 2))
		wantNotices(t, p.send(gm, apply(id, ash, "shaken")), cs.PoolFull("Dread", 1))

		// The GM changes the report to a pass: what is not yet applied is no longer offered, and refused.
		p.send(gm, map[string]any{"type": "test.report", "callId": id, "actorId": ash,
			"roll": map[string]any{"kind": "pool", "counts": map[string]any{"hit": 3.0}, "special": []any{6.0}}})
		if got := offerOf(t, p, gm, id, ash); len(got) != 1 || !got["shaken"].Applied {
			t.Fatalf("after a pass: %+v", got)
		}
		p.refused(gm, apply(id, ash, "strain"), "offerNotOffered")

		// Without the mark, only the other one is offered.
		plain := call(false)
		report(alice, plain, failed)
		if got := offerOf(t, p, gm, plain, ash); len(got) != 1 || got["strain"].ID == "" {
			t.Fatalf("without the mark: %+v", got)
		}
		p.refused(gm, apply(plain, ash, "shaken"), "offerNotOffered")
	})
}

func TestAMarkIsAYesOrNoTheCallMayLeaveOut(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, offerFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		p.startSession()
		ash := p.character("Ash", 4)
		id := p.send(gm, map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash},
			"inputs": map[string]any{"dn": 2.0}}).ID
		if fear := dbtest.Scalar[bool](t, tx, `SELECT (inputs->>'fear')::boolean FROM test_call WHERE id = $1`, id); fear {
			t.Fatal("a mark left out is set")
		}
		p.refused(gm, map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash},
			"inputs": map[string]any{"dn": 2.0, "fear": 1.0}}, "testProblem")
		defs := p.seatView(gm).State.TestDefs
		for _, d := range defs {
			if d.ID == "pool" && (len(d.Marks) != 1 || d.Marks[0] != cs.TestMarkDef{ID: "fear", Label: "Fear"} || len(d.Inputs) != 1) {
				t.Fatalf("pool def: %+v", d)
			}
		}
	})
}

// gmlessOffers is the offer fixture played without a GM. "secret" adds an offer whose change reads a `gm` resource,
// "hiddenModifier" a pool that reads one.
func gmlessOffers(t *testing.T, hidden string) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(offerFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["game"] = map[string]any{"title": "Fixture Table", "players": map[string]any{"min": 1, "max": 4},
		"modes": []any{"gm", "gmless"}, "cite": "Fixture p.9"}
	pool := m["tests"].(map[string]any)["pool"].(map[string]any)
	if hidden != "" {
		m["resources"] = append(m["resources"].([]any),
			map[string]any{"id": "doom", "label": "Doom", "cite": "Fixture p.10", "scope": "entity", "visibility": "gm"})
	}
	if hidden == "secret" {
		pool["offers"] = append(pool["offers"].([]any), map[string]any{"id": "doomed", "label": "Doomed",
			"when": "!result.passed", "cite": "Fixture p.10",
			"changes": []any{map[string]any{"pool": "dread", "by": "res.doom"}}})
	}
	if hidden == "hiddenModifier" {
		pool["pool"] = "level + res.doom"
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Without a GM a seat that may call Tests sees what a result offers and applies it as the table (house decision #170).
// A Test whose offers read a `gm` value, or a call that hides its number to beat or its modifier (called by the GM before
// the table went without one), offers nobody anything, and no seat may apply one: its change would tell what the table
// is not shown.
func TestWithoutAGMTheSeatsThatCallTestsApplyOffers(t *testing.T) {
	for _, hidden := range []string{"", "secret", "hiddenTarget", "hiddenModifier"} {
		dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
			room := dbtest.NewRoom(t, tx)
			room.Pin(t, tx, gmlessOffers(t, hidden))
			p := &play{t, tx, room}
			ash, bo := p.character("Ash", 4), p.character("Bo", 2)
			p.counters(ash, map[string]int{"spare": 0})
			if hidden != "" {
				p.counters(ash, map[string]int{"doom": 3})
			}
			alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
			ben := room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)
			call := map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash}, "inputs": map[string]any{"dn": 4.0}}
			report := func(id string) {
				p.send(alice, map[string]any{"type": "test.report", "callId": id, "actorId": ash,
					"roll": map[string]any{"kind": "pool", "counts": map[string]any{"hit": 1.0}, "special": []any{6.0}}})
			}
			var id string
			if hidden == "hiddenTarget" || hidden == "hiddenModifier" {
				// Without a GM no seat may call a Test that hides a number: the GM called this one, and the table changed
				// mode between sessions; an offer applies to a closed call too.
				call["hideTarget"] = hidden == "hiddenTarget"
				p.startSession()
				id = p.send(room.GM(), call).ID
				report(id)
				p.send(room.GM(), map[string]any{"type": "session.end"})
			}
			p.setMode(room.GM(), "gmless")
			alice.TableMode, ben.TableMode = "gmless", "gmless"
			p.send(alice, map[string]any{"type": "session.start"})
			if id == "" {
				id = p.send(ben, call).ID
				report(id)
			}
			if hidden != "" {
				for _, c := range []cs.Ctx{alice, ben} {
					if got := offerOf(t, p, c, id, ash); len(got) != 0 {
						t.Fatalf("%s: offers reached a seat: %+v", hidden, got)
					}
					for _, offer := range []string{"strain", "doomed"} {
						if offer == "doomed" && hidden != "secret" {
							continue
						}
						p.refused(c, apply(id, ash, offer), "offerNotOffered")
					}
				}
				if _, has := poolValue(p, "dread"); has || p.res(ash, "spare") != 0 {
					t.Fatalf("%s: a refused offer changed a value: spare %d", hidden, p.res(ash, "spare"))
				}
				return
			}
			// Both seats are the table: each sees the offer for Ash, and Ben, who does not hold Ash, applies it.
			for _, c := range []cs.Ctx{alice, ben} {
				if got := offerOf(t, p, c, id, ash); got["strain"].ID == "" {
					t.Fatalf("a gmless seat got no offer: %+v", got)
				}
			}
			by := offerOf(t, p, ben, id, ash)["strain"].Changes[0].By
			wantNotices(t, p.send(ben, apply(id, ash, "strain")))
			if by <= 0 || p.res(ash, "spare") != by {
				t.Fatalf("spare: %d", p.res(ash, "spare"))
			}
			p.refused(alice, apply(id, ash, "strain"), "offerApplied")
			if !offerOf(t, p, alice, id, ash)["strain"].Applied {
				t.Fatal("strain is not shown as applied")
			}
		})
	}
}

// A choice the taker makes while reporting (house decision #170), on the offer fixture: spending Wrath lowers the
// number to beat by one each, never below 1, and an offer reads what was spent.
func TestAChoiceMadeWhileReportingMovesTheNumberAndItsOffers(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		var m map[string]any
		if err := json.Unmarshal([]byte(offerFixture(t)), &m); err != nil {
			t.Fatal(err)
		}
		pool := m["tests"].(map[string]any)["pool"].(map[string]any)
		pool["target"] = "max(1, ctx.dn - ctx.wrath)"
		pool["choices"] = map[string]any{"wrath": map[string]any{"label": "Wrath spent", "max": 1, "cite": "Fixture p.10"}}
		pool["offers"] = append(pool["offers"].([]any), map[string]any{"id": "spent", "label": "Spent", "when": "ctx.wrath > 0",
			"cite": "Fixture p.10", "changes": []any{map[string]any{"resource": "spare", "by": "-ctx.wrath"}}})
		fixture, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, string(fixture))
		p := &play{t, tx, room}
		gm := room.GM()
		p.startSession()
		ash := p.character("Ash", 4)
		p.counters(ash, map[string]int{"spare": 5})
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		id := p.send(gm, map[string]any{"type": "test.call", "testId": "pool", "actorIds": []any{ash},
			"inputs": map[string]any{"dn": 4.0}}).ID
		report := func(choices map[string]any) map[string]any {
			a := map[string]any{"type": "test.report", "callId": id, "actorId": ash,
				"roll": map[string]any{"kind": "pool", "counts": map[string]any{"hit": 1.0}, "special": []any{1.0}}}
			if choices != nil {
				a["choices"] = choices
			}
			return a
		}
		// Out of bounds, undeclared, or a number for a count: refused, and nothing is reported.
		for _, bad := range []map[string]any{{"wrath": 2.0}, {"luck": true}, {"wrath": true}} {
			p.refused(alice, report(bad), "testProblem")
		}
		p.send(alice, report(map[string]any{"wrath": 1.0}))
		var got cs.TestTargetState
		for _, call := range p.seatView(gm).State.Tests {
			if call.ID == id {
				got = call.Targets[0]
				if len(call.Choices) != 1 || call.Choices[0].ID != "wrath" || *call.Choices[0].Max != 1 {
					t.Fatalf("declared choices: %+v", call.Choices)
				}
			}
		}
		// The number to beat is 3 now: one hit fails by 2, doubled on the complication, and Spent reads the point.
		if *got.Target != 3 || got.Report.Choices["wrath"] != 1.0 {
			t.Fatalf("target %d, choices %v", *got.Target, got.Report.Choices)
		}
		offers := offerOf(t, p, gm, id, ash)
		if offers["strain"].Changes[0].By != 4 || offers["spent"].Changes[0].By != -1 {
			t.Fatalf("offers: %+v", offers)
		}
		p.send(gm, apply(id, ash, "spent"))
		if p.res(ash, "spare") != 4 {
			t.Fatalf("spare: %d", p.res(ash, "spare"))
		}
		// The GM corrects the report with no choice made: the number goes back to 4.
		p.send(gm, report(nil))
		for _, call := range p.seatView(gm).State.Tests {
			if call.ID == id && (*call.Targets[0].Target != 4 || call.Targets[0].Report.Choices["wrath"] != 0.0) {
				t.Fatalf("after the correction: %+v", call.Targets[0])
			}
		}
	})
}
