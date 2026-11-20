package ruleset

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The rule actions (apps/api/src/ruleset/ruleset.actions.ts): rule.op, field.set, condition.add/remove, actor.rest.

// The actor and its entity, or a refusal: values are only written to an actor the ruleset has a type for.
func entityActor(rc *Context, actorID string) (*actor.Built, *cs.Error) {
	b, ok := rc.Built[actorID]
	if !ok {
		return nil, cs.Fail("characterNotFound")
	}
	if b.Entity == "" {
		return nil, cs.Fail("notBuilt", cs.Params{"name": b.Row.Name})
	}
	return b, nil
}

// RestActors applies a rest or boundary event to one actor (actorID) or to all of them ("") through the engine's
// `rest` primitive, and logs it as one action. Used by actor.rest and by session start and end (the caller holds
// session:run). pinned is false with no ruleset pinned, when there is nothing to reset.
func RestActors(ctx context.Context, tx core.Conn, c cs.Ctx, event, actorID string) (pinned bool, actionID string, err error) {
	rc, err := OpenIfPinned(ctx, tx, c)
	if err != nil || rc == nil {
		return false, "", err
	}
	input := map[string]any{"event": event}
	if actorID != "" {
		input["actorIds"] = []any{actorID}
	}
	deltas, err := rc.Run(ctx, Run{Primitive: "rest", Op: "apply", Input: input, NoTurn: true})
	if err != nil {
		return true, "", err
	}
	actionID, err = rc.ApplyRuled(ctx, deltas)
	return true, actionID, err
}

func applied(rc *Context, ctx context.Context, deltas []engine.Delta, charged bool) (cs.Result, error) {
	apply := rc.Apply
	if charged {
		apply = rc.ApplyCharged
	}
	id, err := apply(ctx, deltas)
	if err != nil {
		return cs.Result{}, err
	}
	return cs.Done(id), nil
}

// RuleOp is rule.op, steps 3-7 of docs/design.md §5.3: the op's own permission, the op, then every delta through the
// pipeline. The context refuses turn-driven ops while the session is paused (house decision #28).
func RuleOp(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	primitive, op := a.Str("primitive"), a.Str("op")
	perm, known := engine.OpPerm(primitive, op)
	if !known {
		return cs.Result{}, cs.Fail("noOperation", cs.Params{"primitive": primitive, "op": op})
	}
	input, _ := a["input"].(map[string]any)
	target, _ := input["actorId"].(string)
	if refused := cs.RequirePerm(c, perm, target); refused != nil {
		return cs.Result{}, refused
	}
	rc, err := Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	deltas, err := rc.Run(ctx, Run{Primitive: primitive, Op: op, Input: input})
	if err != nil {
		return cs.Result{}, err
	}
	// Every op but a hand adjust of a pool is authorised by its own permission; that one is asked who may change the pool.
	return applied(rc, ctx, deltas, !(primitive == "resource.capped" && op == "adjustPool"))
}

// FieldSet is field.set: one declared field of an actor with an entity.
func FieldSet(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	actorID, field := a.Str("actorId"), a.Str("field")
	b, refused := entityActor(rc, actorID)
	if refused != nil {
		return cs.Result{}, refused
	}
	if actor.FieldDefOf(rc.Compiled, b, field) == nil {
		return cs.Result{}, cs.Fail("noField", cs.Params{"name": b.Row.Name, "field": field})
	}
	return applied(rc, ctx, []engine.Delta{{Target: engine.DeltaTarget{ActorID: actorID, Field: field}, Kind: "set", Value: a["value"]}}, false)
}

func conditionTarget(actorID, rowID string) engine.DeltaTarget {
	return engine.DeltaTarget{ActorID: actorID, Condition: rowID}
}

// ConditionAdd is condition.add. One row per condition: applying it again stacks or refreshes that row, as the manifest
// says.
func ConditionAdd(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	actorID, condition, source := a.Str("actorId"), a.Str("condition"), a.Str("source")
	b, refused := entityActor(rc, actorID)
	if refused != nil {
		return cs.Result{}, refused
	}
	def, known := rc.Compiled.Conditions[condition]
	if !known {
		return cs.Result{}, cs.Fail("noCondition", cs.Params{"condition": condition})
	}
	rowID, row, changes := actor.ConditionApplied(def, b.Conditions, source, def.Duration, a["expiresAfter"])
	if !changes {
		return cs.Done(""), nil // applying it again does nothing
	}
	return applied(rc, ctx, []engine.Delta{{Target: conditionTarget(actorID, rowID), Kind: "set", Value: row}}, false)
}

// ConditionRemove is condition.remove: every row of that condition on the actor.
func ConditionRemove(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	actorID, condition := a.Str("actorId"), a.Str("condition")
	b, refused := entityActor(rc, actorID)
	if refused != nil {
		return cs.Result{}, refused
	}
	deltas := []engine.Delta{}
	for _, had := range b.Conditions {
		if had.ConditionID == condition {
			deltas = append(deltas, engine.Delta{Target: conditionTarget(actorID, had.ID), Kind: "set", Value: nil})
		}
	}
	if len(deltas) == 0 {
		return cs.Result{}, cs.Fail("lacksCondition", cs.Params{"name": b.Row.Name})
	}
	return applied(rc, ctx, deltas, false)
}

// ActorRest is actor.rest: a rest event for one actor, or for everyone.
func ActorRest(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	event := a.Str("event")
	if !engine.IsResetEvent(event) {
		return cs.Result{}, cs.Fail("noRest", cs.Params{"event": event})
	}
	pinned, id, err := RestActors(ctx, tx, c, event, a.Str("actorId"))
	if err != nil {
		return cs.Result{}, err
	}
	if !pinned {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	return cs.Done(id), nil
}
