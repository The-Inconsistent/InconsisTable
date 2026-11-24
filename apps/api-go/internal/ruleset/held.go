package ruleset

import (
	"context"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// HeldRemove is held.remove (house decision #88; the source app's CUT OFF): the entry's key taken out of the kind's
// list field, the write field.set makes, so it is logged and Undo gives the record back. The field's own editableBy
// decides who may (the GM side, when it says nothing). Refused for a kind the ruleset does not have, an actor type it is
// not for, or a record the actor does not hold.
func HeldRemove(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	actorID, held, entry := a.Str("actorId"), a.Str("held"), a.Str("entry")
	b, refused := entityActor(rc, actorID)
	if refused != nil {
		return cs.Result{}, refused
	}
	kind, known := rc.Compiled.Ruleset.Held[held]
	if !known {
		return cs.Result{}, cs.Fail("noHeldKind", cs.Params{"held": held})
	}
	if !slices.Contains(kind.Entities, b.Entity) {
		return cs.Result{}, cs.Fail("heldNotFor", cs.Params{"name": b.Row.Name, "kind": kind.Label})
	}
	items, _ := b.Fields[kind.Field].([]any)
	kept := []any{}
	for _, item := range items {
		if item != entry {
			kept = append(kept, item)
		}
	}
	if len(kept) == len(items) {
		return cs.Result{}, cs.Fail("heldNotHeld", cs.Params{"name": b.Row.Name})
	}
	return applied(rc, ctx, []engine.Delta{{Target: engine.DeltaTarget{ActorID: actorID, Field: kind.Field}, Kind: "set", Value: kept}}, false)
}
