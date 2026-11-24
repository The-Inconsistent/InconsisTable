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
