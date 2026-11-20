package request

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// Spends (house decision #84): a ruleset's named cost and the ops it buys, done by the side that runs the table in one
// tap (spend.do), or asked for by a player and done when the GM side approves.

// Do is spend.do: the spend's costs and ops for one actor, as one logged action.
func Do(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id, err := doSpend(ctx, tx, c, a.Str("spendId"), a.Str("actorId"), inputsOf(a))
	return cs.Done(id), err
}

func inputsOf(a cs.Action) map[string]any {
	in, _ := a["inputs"].(map[string]any)
	if in == nil {
		in = map[string]any{}
	}
	return in
}

// plan is engine.PlanSpend on the room as it stands: the actor built, the shared pools, the running fight.
func plan(ctx context.Context, rc *ruleset.Context, spendID, actorID string, inputs map[string]any) (*engine.SpendPlan, error) {
	b, ok := rc.Built[actorID]
	if !ok {
		return nil, cs.Fail("characterNotFound")
	}
	t, err := rc.Turn(ctx)
	if err != nil {
		return nil, err
	}
	var ts *engine.TurnState
	if t != nil {
		ts = &t.TurnState
	}
	p, refusal := engine.PlanSpend(rc.Compiled.Ruleset, spendID, b.State, rc.State(nil, ts), inputs)
	if refusal != nil {
		return nil, cs.Fail(refusal.Code, cs.Params{"name": b.Row.Name, "detail": refusal.Message})
	}
	return p, nil
}

// doSpend takes every cost a run op does not take itself, then runs each op as rule.op would (its own permission, an
// initiative.sides op with its expiries), and writes it all as one action: a refusal anywhere writes nothing.
func doSpend(ctx context.Context, tx core.Conn, c cs.Ctx, spendID, actorID string, inputs map[string]any) (string, error) {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return "", err
	}
	p, err := plan(ctx, rc, spendID, actorID, inputs)
	if err != nil {
		return "", err
	}
	deltas := []engine.Delta{}
	for _, cost := range p.Costs {
		if cost.ByRun {
			continue
		}
		target := engine.DeltaTarget{Pool: cost.Pool}
		if cost.Pool == "" {
			target = engine.DeltaTarget{ActorID: actorID, Resource: cost.Resource}
		}
		deltas = append(deltas, engine.Delta{Target: target, Kind: "add", Value: -cost.Amount})
	}
	// A spend limited per round records its use in the turn (house decision #91), so Undo and TURN BACK return it.
	if p.Used != nil {
		deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{Turn: turn.Used}, Kind: "set", Value: p.Used})
	}
	t, err := rc.Turn(ctx)
	if err != nil {
		return "", err
	}
	run := func(primitive, op string, input any) ([]engine.Delta, error) {
		return rc.Run(ctx, ruleset.Run{Primitive: primitive, Op: op, Input: input})
	}
	for _, step := range p.Run {
		perm, known := engine.OpPerm(step.Primitive, step.Op)
		if !known {
			return "", cs.Fail("noOperation", cs.Params{"primitive": step.Primitive, "op": step.Op})
		}
		target, _ := step.Input["actorId"].(string)
		if refused := cs.RequirePerm(c, perm, target); refused != nil {
			return "", refused
		}
		var more []engine.Delta
		if step.Primitive == "initiative.sides" {
			more, err = encounter.PlanSides(run, t, step.Op, step.Input)
		} else {
			more, err = run(step.Primitive, step.Op, step.Input)
		}
		if err != nil {
			return "", err
		}
		deltas = append(deltas, more...)
	}
	// The spend's permission authorises its pool costs, as an op's authorises its own charge.
	return rc.ApplyCharged(ctx, deltas)
}

// sendSpend is request.send of a spend: checked as it would be done now, then queued for the GM side (or, without a
// GM, done at once as the table).
func sendSpend(ctx context.Context, tx core.Conn, c cs.Ctx, rc *ruleset.Context, a cs.Action, max int) (cs.Result, error) {
	spendID, actorID, inputs := a.Str("spendId"), a.Str("actorId"), inputsOf(a)
	if _, ok := rc.Built[actorID]; !ok {
		return cs.Result{}, cs.Fail("characterNotFound")
	}
	if !slices.Contains(heldBy(c), actorID) {
		return cs.Result{}, cs.Fail("notYourCharacter")
	}
	if _, err := plan(ctx, rc, spendID, actorID, inputs); err != nil {
		return cs.Result{}, err
	}
	if !c.HasGM() {
		table := c
		table.Seat = cs.Seat{Kind: cs.SeatAdmin}
		id, err := doSpend(ctx, tx, table, spendID, actorID, inputs)
		return cs.Done(id), err
	}
	var asked bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM spend_request WHERE campaign_id = $1 AND actor_id = $2
		AND spend_id = $3 AND status = 'pending')`, c.CampaignID, actorID, spendID).Scan(&asked); err != nil {
		return cs.Result{}, err
	}
	if asked {
		return cs.Result{}, cs.Fail("spendAsked")
	}
	if err := underLimit(ctx, tx, c, max); err != nil {
		return cs.Result{}, err
	}
	stored, err := json.Marshal(inputs)
	if err != nil {
		return cs.Result{}, err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO spend_request (campaign_id, user_id, actor_id, spend_id, inputs, note)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
		c.CampaignID, *c.UserID, actorID, spendID, stored, a.Str("note")).Scan(&id)
	return cs.Done(id), err
}

// Clear cancels the room's pending asks of every spend that clears on event (house decision #84), with the answer a
// cancel gives. Every pending request is already cancelled when a session ends, so only encounterEnd reaches here.
func Clear(ctx context.Context, tx core.Conn, campaignID, event string) error {
	rules, err := compiled.Load(ctx, tx, campaignID)
	if err != nil || rules == nil {
		return err
	}
	ids := []string{}
	for _, s := range rules.Ruleset.Spends {
		if slices.Contains(s.ClearOn, event) {
			ids = append(ids, s.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE spend_request SET status = 'cancelled', resolved_at = now()
		WHERE campaign_id = $1 AND status = 'pending' AND spend_id = ANY($2)`, campaignID, ids)
	return err
}
