package testcall

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/item"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// An acquisition's call offers its grant beside the Test's own offers (house decision #102): on a pass, the item; on a
// miss short by no more than the top-up's most and what the taker holds of its resource, the item for that much of it.
// Either is applied once, as an offer is (house decision #80), and Undo takes it back.

// shortOf is how far a report fell short of the call's number, 0 when it passed.
func shortOf(t cs.TestTargetState) int {
	if t.Report == nil || t.Report.Total == nil || t.Target == nil {
		return 0
	}
	return max(0, *t.Target-*t.Report.Total)
}

// acquireOffers is what an acquisition call offers its taker now: the one applied, if any; else the grant on a pass, or
// the topped-up grant on a miss the top-up covers.
func acquireOffers(rules *engine.CompiledRuleset, acq *item.Acquired, b *actor.Built, t cs.TestTargetState,
	applied map[string]bool) []cs.TestOfferState {
	if t.Report == nil || t.Report.Outcome == nil {
		return nil
	}
	grant := cs.TestOfferState{ID: engine.AcquireGrantOffer, Label: acq.Name, Changes: []cs.TestOfferChange{}}
	topped, ok := topUpOf(rules, acq, b, t)
	switch {
	case applied[engine.AcquireGrantOffer]:
		grant.Applied = true
		return []cs.TestOfferState{grant}
	case applied[engine.AcquireTopUpOffer]:
		topped.Applied = true
		return []cs.TestOfferState{topped}
	case slices.Contains(passing, *t.Report.Outcome):
		return []cs.TestOfferState{grant}
	case ok:
		return []cs.TestOfferState{topped}
	}
	return nil
}

// topUpOf is the topped-up grant for a miss, and whether the top-up covers it: short by at least 1, no more than its
// most, and the taker holding that much of the resource.
func topUpOf(rules *engine.CompiledRuleset, acq *item.Acquired, b *actor.Built, t cs.TestTargetState) (cs.TestOfferState, bool) {
	out := cs.TestOfferState{ID: engine.AcquireTopUpOffer, Label: acq.Name, Changes: []cs.TestOfferChange{}}
	short := shortOf(t)
	if acq.TopUp == nil || t.Report == nil || t.Report.Outcome == nil || slices.Contains(passing, *t.Report.Outcome) {
		return out, false
	}
	label := acq.TopUp.Resource
	if res := rules.Resources[acq.TopUp.Resource]; res != nil {
		label = res.Def.Label
	}
	out.Changes = append(out.Changes, cs.TestOfferChange{Resource: acq.TopUp.Resource, Label: label, By: -short})
	held := 0.0
	if b != nil {
		held = b.Resources[acq.TopUp.Resource]
	}
	return out, short >= 1 && float64(short) <= acq.TopUp.Max && float64(short) <= held
}

// applyAcquire is test.applyOffer of an acquisition's grant: refused as an offer is (offerApplied for either one
// applied, offerNotOffered when the result no longer offers it), then the item granted, and for a top-up the resource
// taken, as one logged action recorded as the offer.
func applyAcquire(ctx context.Context, tx core.Conn, c cs.Ctx, callID, actorID, offerID string) (cs.Result, error) {
	acquired, err := item.LoadAcquired(ctx, tx, []string{callID})
	if err != nil {
		return cs.Result{}, err
	}
	acq := acquired[callID]
	if acq == nil || acq.ActorID != actorID {
		return cs.Result{}, cs.Fail("noSuchOffer", cs.Params{"offer": offerID})
	}
	var target int32
	if err := tx.QueryRow(ctx, `SELECT target FROM test_call_target WHERE call_id = $1 AND actor_id = $2`, callID, actorID).
		Scan(&target); errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("notCalled")
	} else if err != nil {
		return cs.Result{}, err
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b := rc.Built[actorID]
	if b == nil {
		return cs.Result{}, cs.Fail("characterNotFound")
	}
	report, err := reportOf(ctx, tx, callID, actorID)
	if err != nil {
		return cs.Result{}, err
	}
	if report == nil {
		return cs.Result{}, cs.Fail("notReported", cs.Params{"name": b.Row.Name})
	}
	applied, err := appliedOffers(ctx, tx, []string{callID})
	if err != nil {
		return cs.Result{}, err
	}
	done := applied[callID+"/"+actorID]
	if done[engine.AcquireGrantOffer] || done[engine.AcquireTopUpOffer] {
		return cs.Result{}, cs.Fail("offerApplied")
	}
	t := int(target)
	offers := acquireOffers(rc.Compiled, acq, b, cs.TestTargetState{ActorID: actorID, Target: &t, Report: report}, nil)
	i := slices.IndexFunc(offers, func(o cs.TestOfferState) bool { return o.ID == offerID })
	if i < 0 {
		return cs.Result{}, cs.Fail("offerNotOffered")
	}
	deltas, err := item.Grant(ctx, tx, c, acq)
	if err != nil {
		return cs.Result{}, err
	}
	for _, ch := range offers[i].Changes {
		deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{ActorID: actorID, Resource: ch.Resource}, Kind: "add", Value: float64(ch.By)})
	}
	actionID, err := rc.ApplyCharged(ctx, deltas)
	if err != nil {
		return cs.Result{}, err
	}
	var logged any
	if actionID != "" {
		logged = actionID
	}
	_, err = tx.Exec(ctx, `INSERT INTO test_offer (call_id, actor_id, offer_id, action_id) VALUES ($1, $2, $3, $4)
		ON CONFLICT (call_id, actor_id, offer_id) DO UPDATE SET action_id = excluded.action_id, applied_at = now()`,
		callID, actorID, offerID, logged)
	return cs.Done(actionID), err
}

// acquireState is what a call shows of its acquisition.
func acquireState(acq *item.Acquired) *cs.CallAcquire {
	raw, err := json.Marshal(map[string]any{"name": acq.Name, "kind": acq.Kind, "inputs": acq.Inputs})
	if err != nil {
		return nil
	}
	var out cs.CallAcquire
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return &out
}
