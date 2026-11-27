package table

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Acquiring an item by a Test (house decision #102), on the ledger fixture: a hero procures gear against 8 + its
// rating, eased by every keyword shared past the first, once a session for gear and once for stores; a miss is topped
// up with coin, up to 3; stores come three at a time; and a fitting goes on a weapon the saved build gives.
// Wren is a Lamplighter of the Ironhand guild (WARDEN, IRONHAND), with a Lantern Staff and a Leather Coat, and 5 coin.

// oathBuild is an Oathkeeper of the same catalogue, whose archetype gives no weapon or armour; the GM approves its two
// story requirements.
const oathBuild = `{"tier":1,"archetypeId":"oathkeeper",` +
	`"background":{"tableId":"warden-roots","roots":"Lowland","deed":"Held the Gate","dream":"A Quiet Hearth","bonus":"dream"},` +
	`"languages":{"picks":["trade-tongue"]},"wealth":1,` +
	`"gm":{"approved":["archetype/oathkeeper/0","archetype/oathkeeper/1/requires/oath-witness"]}}`

func acquire(actorID, entry string, picks map[string]any, more ...string) map[string]any {
	typ, _, _ := strings.Cut(entry, ".")
	acq := map[string]any{"type": typ, "entry": entry}
	for i := 0; i+1 < len(more); i += 2 {
		acq[more[i]] = more[i+1]
	}
	return map[string]any{"type": "request.send", "actorId": actorID, "acquire": acq, "inputs": picks}
}

// call is the acquisition call of the hero the seat sees, the last one.
func (r *itemRoom) call(c cs.Ctx) *cs.TestCall {
	var out *cs.TestCall
	for _, call := range r.seatView(c).State.Tests {
		if call.Acquire != nil {
			out = &call
		}
	}
	return out
}

func (r *itemRoom) coin(actorID string) float64 {
	for _, a := range r.seatView(r.gm).State.Actors {
		if a.ID == actorID {
			return a.Resources["coin"]
		}
	}
	return -1
}

func (r *itemRoom) report(callID string, face float64) {
	r.send(r.ana, map[string]any{"type": "test.report", "callId": callID, "actorId": r.hero,
		"roll": map[string]any{"kind": "faces", "faces": []any{face}}})
}

func (r *itemRoom) offers(callID string) string {
	out := []string{}
	for _, call := range r.seatView(r.gm).State.Tests {
		if call.ID != callID {
			continue
		}
		for _, t := range call.Targets {
			for _, o := range t.Offers {
				s := o.ID
				for _, ch := range o.Changes {
					s += " " + ch.Resource + strings.Repeat("-", -ch.By)
				}
				if o.Applied {
					s += " applied"
				}
				out = append(out, s)
			}
		}
	}
	return strings.Join(out, ",")
}

func newAcquireRoom(t *testing.T, tx pgx.Tx, lib ledgerLibrary) *itemRoom {
	r := newItemRoom(t, tx, lib)
	if got := r.coin(r.hero); got != 5 {
		t.Fatalf("a hero starts with 5 coin: %v", got)
	}
	return r
}

func TestAnAcquisitionAskedFromAPhoneIsCalledReportedAndGrantedOnce(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newAcquireRoom(t, tx, lib)
		bow := acquire(r.hero, "wargear.hunting-bow", map[string]any{"push": 1.0})
		r.refusedWith(r.bo, bow, "notYourCharacter")
		r.refusedWith(r.ana, acquire(r.hero, "wargear.sling", map[string]any{"push": 0.0}), "acquireNotNow") // no keyword shared
		r.refusedWith(r.ana, acquire(r.hero, "wargear.hunting-bow", map[string]any{"push": 3.0}), "badInput")
		r.refusedWith(r.ana, acquire(r.hero, "wargear.nope", map[string]any{"push": 0.0}), "itemNoEntry")
		ask := r.send(r.ana, bow).ID
		r.refusedWith(r.ana, acquire(r.hero, "supply.pellets", map[string]any{"push": 0.0}), "acquireAsked")
		// The GM side sees the ask; Bo does not.
		if q := r.seatView(r.gm).State.Requests; len(q) != 1 || q[0].Acquire == nil || q[0].Acquire.Entry != "wargear.hunting-bow" {
			t.Fatalf("the GM's requests: %+v", q)
		}
		if q := r.seatView(r.bo).State.Requests; len(q) != 0 {
			t.Fatalf("another player reads the ask: %+v", q)
		}
		callID := r.send(r.gm, map[string]any{"type": "request.approve", "id": ask}).ID
		// The phone sees the call, its number 8 + 3 (the bow's rating) + 0 (one keyword shared), and its parts.
		call := r.call(r.ana)
		if call == nil || call.ID != callID || call.Acquire.Name != "Hunting Bow" || *call.Targets[0].Target != 11 {
			t.Fatalf("the phone's call: %+v", call)
		}
		if dn := call.Acquire.Inputs["dn"]; len(dn.Parts) != 3 || dn.Parts[1].Label != "Rating" || dn.Parts[1].Value != 3.0 ||
			dn.Label != "Number to beat" {
			t.Fatalf("the number's parts and the Test's word for it: %+v", dn)
		}
		// House decision #175: a yes-or-no input is its one part's answer; the bow is rated 3, so it is rare.
		if rare := call.Acquire.Inputs["rare"]; rare.Total != true || len(rare.Parts) != 1 || rare.Label != "Rare" {
			t.Fatalf("the yes-or-no input: %+v", rare)
		}
		if got := r.offers(callID); got != "" {
			t.Fatalf("nothing is offered before the report: %s", got)
		}
		r.report(callID, 15) // 15 + 1 pushed beats 11
		if got := r.offers(callID); got != "acquire" {
			t.Fatalf("a pass offers the grant: %s", got)
		}
		r.refusedWith(r.ana, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquire"},
			"noPermission")
		r.send(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquire"})
		if got := r.line(r.hero); got != "Hunting Bow" {
			t.Fatalf("granted: %s", got)
		}
		if x := r.items(r.ana, r.hero)[0]; x.Source != "acquire" || x.Kind != "arms" {
			t.Fatalf("the bow's row: %+v", x)
		}
		r.refusedWith(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquire"},
			"offerApplied")
		if got := r.offers(callID); got != "acquire applied" {
			t.Fatalf("applied once: %s", got)
		}
		// Gear once a session: the staff is refused now, stores are a limit of their own.
		r.refusedWith(r.ana, acquire(r.hero, "wargear.lantern-staff", map[string]any{"push": 0.0}), "acquireLimit")
		stores := r.send(r.ana, acquire(r.hero, "supply.pellets", map[string]any{"push": 0.0})).ID
		storeCall := r.send(r.gm, map[string]any{"type": "request.approve", "id": stores}).ID
		r.report(storeCall, 20)
		r.send(r.gm, map[string]any{"type": "test.applyOffer", "callId": storeCall, "actorId": r.hero, "offerId": "acquire"})
		if got := r.line(r.hero); got != "Hunting Bow,Pelletsx3" {
			t.Fatalf("stores come three at a time: %s", got)
		}
		// Undo takes the grant back, and the grant is offered again.
		undoAs(r.play, r.gm)
		if got := r.line(r.hero); got != "Hunting Bow" {
			t.Fatalf("after Undo: %s", got)
		}
		if got := r.offers(storeCall); got != "acquire" {
			t.Fatalf("offered again after Undo: %s", got)
		}
		// A new session clears the count.
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, r.room.ID)
		r.refusedWith(r.ana, acquire(r.hero, "wargear.lantern-staff", map[string]any{"push": 0.0}), "noSessionRunning")
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 2)`, r.room.ID)
		r.send(r.ana, acquire(r.hero, "wargear.lantern-staff", map[string]any{"push": 0.0}))
		r.send(r.gm, map[string]any{"type": "request.deny", "id": r.seatView(r.gm).State.Requests[0].ID})
	})
}

func TestAMissIsToppedUpWithCoinUpToTheBound(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newAcquireRoom(t, tx, lib)
		callID := r.send(r.gm, map[string]any{"type": "request.approve",
			"id": r.send(r.ana, acquire(r.hero, "wargear.hunting-bow", map[string]any{"push": 0.0})).ID}).ID
		r.report(callID, 10) // 10, less 1 for a rare find (house decision #175), against 11: 2 short
		if got := r.offers(callID); got != "acquireTopUp coin--" {
			t.Fatalf("a miss within the top-up: %s", got)
		}
		r.refusedWith(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquire"},
			"offerNotOffered")
		r.send(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquireTopUp"})
		if got, coin := r.line(r.hero), r.coin(r.hero); got != "Hunting Bow" || coin != 3 {
			t.Fatalf("topped up: %s with %v coin", got, coin)
		}
		// The GM corrects the report to a worse miss: past the bound, nothing more is offered (the applied one stays).
		undoAs(r.play, r.gm)
		r.send(r.gm, map[string]any{"type": "test.report", "callId": callID, "actorId": r.hero,
			"roll": map[string]any{"kind": "faces", "faces": []any{7.0}}})
		if got := r.offers(callID); got != "" {
			t.Fatalf("4 short is past the top-up: %s", got)
		}
		r.refusedWith(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquireTopUp"},
			"offerNotOffered")
	})
}

func TestAFittingGoesOnALineTheBuildGivesAndARebuildThatDropsTheLineTakesIt(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newAcquireRoom(t, tx, lib)
		base := r.guard(r.hero)
		r.add(r.hero, "fittings", "wargear.sight-lens")
		r.add(r.hero, "fittings", "wargear.long-sight")
		sight, long := r.id(r.hero, "Sight Lens"), r.id(r.hero, "Long Sight")
		onLine := func(item, line string) map[string]any {
			return map[string]any{"type": "item.fit", "itemId": item, "to": nil, "line": line}
		}
		r.refusedWith(r.ana, onLine(sight, "weapons/Nope"), "itemNotFound")
		r.refusedWith(r.ana, onLine(sight, "armour/Leather Coat"), "itemFitsNot") // fittings fit arms only
		r.send(r.ana, onLine(sight, "weapons/Lantern Staff"))
		if x := r.items(r.ana, r.hero)[0]; x.FittedLine == nil || *x.FittedLine != "weapons/Lantern Staff" {
			t.Fatalf("fitted to the line: %+v", x)
		}
		if got := r.guard(r.hero); got != base+1 {
			t.Fatalf("a Sight Lens on the build's staff adds 1: %v from %v", got, base)
		}
		r.refusedWith(r.ana, onLine(long, "weapons/Lantern Staff"), "itemSlotTaken")
		r.refusedWith(r.ana, onLine(sight, "weapons/Lantern Staff"), "itemFitted")
		// Bo's phone reads none of it; a rebuild that keeps the staff keeps the fitting.
		if got := r.items(r.bo, r.hero); len(got) != 0 {
			t.Fatalf("another seat: %+v", got)
		}
		r.send(r.gm, save(r.hero, dreamBuild))
		if x := r.items(r.gm, r.hero)[0]; x.FittedLine == nil {
			t.Fatalf("a rebuild keeping the staff drops its fitting: %+v", x)
		}
		// A rebuild without the staff drops the fitting with it, as the source app does; Undo puts it back.
		r.send(r.gm, save(r.hero, oathBuild))
		if got := r.line(r.hero); got != "Long Sight" {
			t.Fatalf("after a rebuild without the staff: %s", got)
		}
		undoAs(r.play, r.gm)
		if got := r.line(r.hero); got != "Sight Lens,Long Sight" {
			t.Fatalf("after Undo: %s", got)
		}
	})
}

func TestAnAcquiredFittingIsFittedAtOnceToTheLineTheAskNamed(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newAcquireRoom(t, tx, lib)
		r.refusedWith(r.ana, acquire(r.hero, "wargear.long-sight", map[string]any{"push": 0.0}, "line", "armour/Leather Coat"),
			"itemFitsNot")
		ask := r.send(r.ana, acquire(r.hero, "wargear.long-sight", map[string]any{"push": 0.0}, "line", "weapons/Lantern Staff")).ID
		callID := r.send(r.gm, map[string]any{"type": "request.approve", "id": ask}).ID
		r.report(callID, 20)
		r.send(r.gm, map[string]any{"type": "test.applyOffer", "callId": callID, "actorId": r.hero, "offerId": "acquire"})
		if x := r.items(r.ana, r.hero)[0]; x.Name != "Long Sight" || x.FittedLine == nil || *x.FittedLine != "weapons/Lantern Staff" {
			t.Fatalf("fitted at once: %+v", x)
		}
	})
}

// The GM changes the entry's values for one acquisition when approving (house decision #196): the bow read as rated 1
// makes the number 9, the pack entry is unchanged, and a field the entry type lacks, a value that does not fit it, or a
// change on an ask that is not an acquisition is refused.
func TestTheGmChangesAnEntrysValuesForOneAcquisition(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newAcquireRoom(t, tx, lib)
		ask := r.send(r.ana, acquire(r.hero, "wargear.hunting-bow", map[string]any{"push": 0.0})).ID
		approve := func(item map[string]any) map[string]any {
			return map[string]any{"type": "request.approve", "id": ask, "item": item}
		}
		r.refusedWith(r.gm, approve(map[string]any{"fields": map[string]any{"nope": 1.0}}), "badRequest")
		r.refusedWith(r.gm, approve(map[string]any{"fields": map[string]any{"rating": "high"}}), "fieldInvalid")
		r.send(r.gm, approve(map[string]any{"fields": map[string]any{"rating": 1.0}}))
		if call := r.call(r.ana); call == nil || *call.Targets[0].Target != 9 {
			t.Fatalf("want the number read at rating 1 (9), got %+v", call)
		}
		if body := dbtest.Scalar[string](t, tx, `SELECT body->>'rating' FROM pack_entry WHERE key = 'wargear.hunting-bow'`); body != "3" {
			t.Fatalf("the pack entry changed: %s", body)
		}
	})
}
