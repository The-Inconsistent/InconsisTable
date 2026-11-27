package testcall

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// What a called Test's result offers the GM (house decision #80): each offer whose `when` holds for a taker's resolved
// report, applied once by test.applyOffer through the ordinary writes, and offered again once Undo took those back.

// The outcomes that pass (the engine's TestOutcome): a success, or a critical one.
var passing = []string{"success", "critical", "criticalSuccess"}

func number(n *int) float64 {
	if n == nil {
		return 0
	}
	return float64(*n)
}

// resultRecord is a taker's resolved report as an offer reads it (`result`, compile.ts RESULT_SCOPE): a number the kind
// of Test has not is 0, and target is the number to beat as the call set it.
func resultRecord(r *cs.TestResult, target float64) *engine.Record {
	outcome := ""
	if r.Outcome != nil {
		outcome = *r.Outcome
	}
	flags := map[string]any{}
	for _, f := range []string{"critical", "complication"} {
		flags[f] = slices.Contains(r.Flags, f)
	}
	return &engine.Record{Fields: map[string]any{
		"passed": slices.Contains(passing, outcome), "outcome": outcome, "total": number(r.Total),
		"margin": number(r.Margin), "shifts": number(r.Shifts), "natural": number(r.Natural), "target": target,
		"flags": &engine.Record{Fields: flags},
	}}
}

// offerScope is what an offer reads: the taker's scope (nil leaves it out, for `when` alone), the call's inputs and
// marks as `ctx`, and the result.
func offerScope(taker *engine.Record, inputs map[string]any, r *cs.TestResult, target float64) *engine.Record {
	scope := &engine.Record{Fields: map[string]any{}}
	if taker != nil {
		scope.Fields = maps.Clone(taker.Fields)
	}
	scope.Fields["ctx"] = engine.ValueFromJSON(inputs)
	scope.Fields["result"] = resultRecord(r, target)
	return scope
}

// offerHolds says whether the offer's `when` holds; one that cannot be evaluated does not.
func offerHolds(o *engine.CompiledOffer, scope *engine.Record) bool {
	held, err := engine.EvaluateBool(o.When, scope)
	return err == nil && held
}

// offerChanges are the offer's changes worked out for the taker, or false when one cannot be evaluated.
func offerChanges(rules *engine.CompiledRuleset, o *engine.CompiledOffer, scope *engine.Record) ([]cs.TestOfferChange, bool) {
	out := []cs.TestOfferChange{}
	for _, ch := range o.Changes {
		by, err := engine.EvaluateInt(ch.By, scope)
		if err != nil {
			return nil, false
		}
		c := cs.TestOfferChange{By: int(by)}
		if ch.Pool != nil {
			c.Pool = *ch.Pool
		} else if ch.Resource != nil {
			c.Resource = *ch.Resource
		}
		if res := rules.Resources[c.Pool+c.Resource]; res != nil {
			c.Label = res.Def.Label
		}
		out = append(out, c)
	}
	return out, true
}

// offersOf is what one taker's report offers: those whose `when` holds now, and those already applied whatever it says.
func offersOf(rules *engine.CompiledRuleset, test *engine.CompiledTest, b *actor.Built, inputs map[string]any,
	t cs.TestTargetState, applied map[string]bool) []cs.TestOfferState {
	if len(test.Offers) == 0 || t.Report == nil || b == nil || b.Scope == nil {
		return nil
	}
	scope := offerScope(b.Scope, withChoices(inputs, t.Report.Choices), t.Report, number(t.Target))
	var out []cs.TestOfferState
	for i := range test.Offers {
		o := &test.Offers[i]
		done := applied[o.Def.ID]
		if !done && !offerHolds(o, scope) {
			continue
		}
		changes, ok := offerChanges(rules, o, scope)
		if !ok {
			continue
		}
		out = append(out, cs.TestOfferState{ID: o.Def.ID, Label: o.Def.Label, Changes: changes, Applied: done})
	}
	return out
}

// appliedOffers is the offers applied and not taken back by Undo, by call, then taker, then offer.
func appliedOffers(ctx context.Context, conn core.Conn, callIDs []string) (map[string]map[string]bool, error) {
	rows, err := conn.Query(ctx, `SELECT o.call_id::text, o.actor_id::text, o.offer_id FROM test_offer o
		WHERE o.call_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM session_event e
			WHERE e.action_id = o.action_id AND e.type = 'delta' AND e.undone_by IS NOT NULL)`, callIDs)
	if err != nil {
		return nil, err
	}
	out := map[string]map[string]bool{}
	for rows.Next() {
		var callID, actorID, offerID string
		if err := rows.Scan(&callID, &actorID, &offerID); err != nil {
			rows.Close()
			return nil, err
		}
		key := callID + "/" + actorID
		if out[key] == nil {
			out[key] = map[string]bool{}
		}
		out[key][offerID] = true
	}
	rows.Close()
	return out, rows.Err()
}

// applyOffer is test.applyOffer: the offer's changes for that taker through the pipeline as one logged action, so
// they are clamped as a stepper's are and Undo takes them back whole. A pool that cannot take a change whole says so
// (house decision #79).
func applyOffer(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, callID, actorID, offerID := c.CampaignID, a.Str("callId"), a.Str("actorId"), a.Str("offerId")
	if offerID == engine.AcquireGrantOffer || offerID == engine.AcquireTopUpOffer {
		var here bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM test_call WHERE id = $1 AND campaign_id = $2)`, callID, cid).Scan(&here); err != nil {
			return cs.Result{}, err
		}
		if !here {
			return cs.Result{}, cs.Fail("testNotHere")
		}
		return applyAcquire(ctx, tx, c, callID, actorID, offerID)
	}
	var testID string
	var rawInputs []byte
	var hideTarget bool
	var called []string
	err := tx.QueryRow(ctx, `SELECT c.test_id, c.inputs, c.hide_target,
			(SELECT array_agg(t.actor_id::text) FROM test_call_target t WHERE t.call_id = c.id)
		FROM test_call c WHERE c.id = $1 AND c.campaign_id = $2`, callID, cid).
		Scan(&testID, &rawInputs, &hideTarget, &called)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("testNotHere")
	}
	if err != nil {
		return cs.Result{}, err
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	test, err := testOf(rules, testID)
	if err != nil {
		return cs.Result{}, err
	}
	i := slices.IndexFunc(test.Offers, func(o engine.CompiledOffer) bool { return o.Def.ID == offerID })
	if i < 0 {
		return cs.Result{}, cs.Fail("noSuchOffer", cs.Params{"offer": offerID})
	}
	offer := &test.Offers[i]
	var target int32
	if err := tx.QueryRow(ctx, `SELECT target FROM test_call_target WHERE call_id = $1 AND actor_id = $2`, callID, actorID).
		Scan(&target); errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("notCalled")
	} else if err != nil {
		return cs.Result{}, err
	}
	// Without a GM the seat that applies an offer applies it as the table (house decision #170), as a spend ask is done.
	noGM := !c.HasGM()
	if noGM {
		c.Seat = cs.Seat{Kind: cs.SeatAdmin}
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b := rc.Built[actorID]
	switch {
	case b == nil:
		return cs.Result{}, cs.Fail("characterNotFound")
	case b.Scope == nil:
		return cs.Result{}, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
	// Only an offer the seat is shown: its changes would tell a number the table may not see.
	case noGM && !offersShown(test, hideTarget, called, actorID, rc.Built):
		return cs.Result{}, cs.Fail("offerNotOffered")
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
	if applied[callID+"/"+actorID][offerID] {
		return cs.Result{}, cs.Fail("offerApplied")
	}
	inputs := map[string]any{}
	if err := json.Unmarshal(rawInputs, &inputs); err != nil {
		return cs.Result{}, err
	}
	scope := offerScope(b.Scope, withChoices(inputs, choicesOf(test, report.Choices)), report, float64(target))
	// The GM may have changed the report since the card offered it.
	if !offerHolds(offer, scope) {
		return cs.Result{}, cs.Fail("offerNotOffered")
	}
	changes, ok := offerChanges(rules, offer, scope)
	if !ok {
		return cs.Result{}, cs.Fail("offerNotOffered")
	}
	deltas := []engine.Delta{}
	for _, ch := range changes {
		if ch.By == 0 {
			continue
		}
		t := engine.DeltaTarget{Pool: ch.Pool}
		if ch.Resource != "" {
			t = engine.DeltaTarget{ActorID: actorID, Resource: ch.Resource}
		}
		deltas = append(deltas, engine.Delta{Target: t, Kind: "add", Value: float64(ch.By)})
	}
	// The offer's own permission (test:call) authorises its pool change, as an op's charge is.
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

// reportOf is the taker's resolved report, whole, or nil when there is none yet.
func reportOf(ctx context.Context, conn core.Conn, callID, actorID string) (*cs.TestResult, error) {
	var natural, margin, shifts *int32
	var total int32
	var outcome string
	var flags []string
	var choices map[string]any
	err := conn.QueryRow(ctx, `SELECT "natural", total, outcome, margin, shifts, flags, choices FROM test_report
		WHERE call_id = $1 AND actor_id = $2`, callID, actorID).Scan(&natural, &total, &outcome, &margin, &shifts, &flags, &choices)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	t := int(total)
	return &cs.TestResult{Natural: intPtr(natural), Total: &t, Outcome: &outcome, Margin: intPtr(margin),
		Shifts: intPtr(shifts), Flags: flags, Choices: choices}, err
}
