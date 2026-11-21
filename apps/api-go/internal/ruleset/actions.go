package ruleset

import (
	"context"
	"slices"

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
// session:run). pinned is false with no ruleset pinned, when there is nothing to reset. An actor in a health state the
// ruleset's `rests` refuses this event in (house decision #81) is refused by name when named alone, and otherwise left
// out: skipped names them, in name order.
func RestActors(ctx context.Context, tx core.Conn, c cs.Ctx, event, actorID string) (pinned bool, actionID string, skipped []string, err error) {
	rc, err := OpenIfPinned(ctx, tx, c)
	if err != nil || rc == nil {
		return false, "", nil, err
	}
	input := map[string]any{"event": event}
	if actorID != "" {
		input["actorIds"] = []any{actorID}
	}
	refused := restRefused(rc, event)
	if state, in := refused[actorID]; actorID != "" && in {
		return true, "", nil, cs.Fail("restRefused", cs.Params{"name": rc.Built[actorID].Row.Name, "state": state})
	}
	deltas, err := rc.Run(ctx, Run{Primitive: "rest", Op: "apply", Input: input, NoTurn: true})
	if err != nil {
		return true, "", nil, err
	}
	kept := deltas[:0:0]
	for _, d := range deltas {
		if _, out := refused[d.Target.ActorID]; !out {
			kept = append(kept, d)
		}
	}
	for id := range refused {
		skipped = append(skipped, rc.Built[id].Row.Name)
	}
	slices.Sort(skipped)
	actionID, err = rc.ApplyRuled(ctx, kept)
	return true, actionID, skipped, err
}

// restRefused is the actors a rest event leaves out, with the label of the first refusing state each is in.
func restRefused(rc *Context, event string) map[string]string {
	out := map[string]string{}
	for _, rule := range rc.Compiled.Ruleset.Rests {
		if rule.Event != event {
			continue
		}
		for id, b := range rc.Built {
			if b.Scope == nil {
				continue
			}
			held, err := rc.Compiled.HealthStatesOf(b.Entity, b.Scope)
			if err != nil {
				continue
			}
			for _, s := range rc.Compiled.HealthStates {
				if _, done := out[id]; !done && slices.Contains(rule.RefusedIn, s.ID) && slices.Contains(held, s.ID) {
					label := s.ID
					if s.Label != nil {
						label = *s.Label
					}
					out[id] = label
				}
			}
		}
	}
	return out
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
	handPool := primitive == "resource.capped" && op == "adjustPool"
	if handPool {
		notifyPoolFull(ctx, rc, input, deltas)
	}
	// Every op but a hand adjust of a pool is authorised by its own permission; that one is asked who may change the pool.
	return applied(rc, ctx, deltas, !handPool)
}

// notifyPoolFull tells the sender that a hand adjust of a pool was clamped at its max (house decision #79): the op
// proposes only what fits, so what it left out is what was lost.
func notifyPoolFull(ctx context.Context, rc *Context, input map[string]any, deltas []engine.Delta) {
	id, _ := input["resource"].(string)
	asked, _ := input["delta"].(float64)
	took := 0.0
	for _, d := range deltas {
		n, _ := d.Value.(float64)
		took += n
	}
	pool, known := rc.Pools[id]
	if !known || asked <= 0 || took >= asked || pool.Bounds.Ceiling() == nil {
		return
	}
	cs.Notify(ctx, cs.PoolFull(rc.Compiled.Resources[id].Def.Label, asked-took))
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
	var typed *float64
	if n, given := a["expiresAfter"].(float64); given {
		typed = &n
	}
	delta, err := rc.ConditionDelta(ctx, a.Str("actorId"), a.Str("condition"), a.Str("source"), typed)
	if err != nil || delta == nil {
		return cs.Done(""), err // applying it again does nothing
	}
	return applied(rc, ctx, []engine.Delta{*delta}, false)
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
	pinned, id, skipped, err := RestActors(ctx, tx, c, event, a.Str("actorId"))
	if err != nil {
		return cs.Result{}, err
	}
	if !pinned {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	if len(skipped) > 0 {
		cs.Notify(ctx, cs.RestSkipped(skipped))
	}
	return cs.Done(id), nil
}
