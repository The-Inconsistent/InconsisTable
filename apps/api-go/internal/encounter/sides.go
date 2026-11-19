package encounter

import (
	"context"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The sides order (`initiative.sides`, house decisions #57 and #60). The primitive says what an op writes; what a turn's
// end owes is decided here, once, for every op.

// RunOp runs one op against the state a plan was handed.
type RunOp func(primitive, op string, input any) ([]engine.Delta, error)

// PlanSides is the deltas of one `initiative.sides` op, in the order house decision #15 fixes: the op's own deltas, then
// `conditions.expire` `turnEnd` for the actor whose turn they ended, then `roundEnd` when they wrapped the round. An op
// ends a turn when someone is acting and it writes `currentId` (`next`, `hold`, `pick`, `seize`, `newRound`); it wraps
// the round when it writes `round`. t is nil with no fight, where the primitive refuses.
func PlanSides(run RunOp, t *turn.Turn, op string, input any) ([]engine.Delta, error) {
	deltas, err := run("initiative.sides", op, input)
	if err != nil || t == nil {
		return deltas, err
	}
	writes := func(key string) bool {
		return slices.ContainsFunc(deltas, func(d engine.Delta) bool { return isTurn(d, key) })
	}
	out := deltas
	if t.CurrentID != nil && writes(turn.CurrentID) {
		end, err := run("conditions.expire", "turnEnd", map[string]any{"actorId": *t.CurrentID})
		if err != nil {
			return nil, err
		}
		out = slices.Concat(out, end)
	}
	if writes(turn.Round) {
		end, err := run("conditions.expire", "roundEnd", map[string]any{})
		if err != nil {
			return nil, err
		}
		out = slices.Concat(out, end)
	}
	return out, nil
}

// RuleOp is `rule.op`: an `initiative.sides` op is planned by PlanSides, every other op by ruleset.RuleOp.
func RuleOp(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	primitive, op := a.Str("primitive"), a.Str("op")
	if primitive != "initiative.sides" {
		return ruleset.RuleOp(ctx, tx, c, a)
	}
	perm, known := engine.OpPerm(primitive, op)
	if !known {
		return cs.Result{}, cs.Fail("noOperation", cs.Params{"primitive": primitive, "op": op})
	}
	input, _ := a["input"].(map[string]any)
	if refused := cs.RequirePerm(c, perm, ""); refused != nil {
		return cs.Result{}, refused
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	t, err := rc.Turn(ctx)
	if err != nil {
		return cs.Result{}, err
	}
	deltas, err := PlanSides(func(p, o string, in any) ([]engine.Delta, error) {
		return rc.Run(ctx, ruleset.Run{Primitive: p, Op: o, Input: in})
	}, t, op, input)
	if err != nil {
		return cs.Result{}, err
	}
	// The op's own permission authorises its pool charge (`seize`, `lift`), as for every op but a hand adjust.
	id, err := rc.ApplyCharged(ctx, deltas)
	return cs.Done(id), err
}

// strategyOf is the room's turn order ("ranked", "seated", "sides"), or "" with none.
func strategyOf(ctx context.Context, conn core.Conn, campaignID string) (string, error) {
	rules, err := compiled.Load(ctx, conn, campaignID)
	if err != nil || rules == nil || rules.Ruleset.Initiative == nil {
		return "", err
	}
	return rules.Ruleset.Initiative.Strategy, nil
}
