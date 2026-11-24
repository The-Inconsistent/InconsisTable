package ruleset

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// ConditionDelta is the write condition.add makes: one row per condition, a new one or the held one stacked or
// refreshed as the manifest says, armed from the holder's next turn when added during its own (house decision #81).
// nil when applying it again does nothing. Refused for an unknown condition or one the actor is immune to. typed is
// the count a seat typed, nil for the condition's own. A lookup's condition step (house decision #87) writes this too.
func (rc *Context) ConditionDelta(ctx context.Context, actorID, condition, source string, typed *float64) (*engine.Delta, error) {
	b, refused := entityActor(rc, actorID)
	if refused != nil {
		return nil, refused
	}
	def, known := rc.Compiled.Conditions[condition]
	if !known {
		return nil, cs.Fail("noCondition", cs.Params{"condition": condition})
	}
	if rc.Compiled.ImmuneTo(condition, b.Scope) {
		return nil, cs.Fail("conditionImmune", cs.Params{"name": b.Row.Name, "condition": def.Label})
	}
	t, err := rc.Turn(ctx)
	if err != nil {
		return nil, err
	}
	acting := t != nil && t.CurrentID != nil && *t.CurrentID == actorID
	var expiresAfter any
	if ticks := engine.ArmedTicks(def, acting, typed); ticks != nil {
		expiresAfter = *ticks
	}
	rowID, row, changes := actor.ConditionApplied(def, b.Conditions, source, def.Duration, expiresAfter)
	if !changes {
		return nil, nil
	}
	return &engine.Delta{Target: conditionTarget(actorID, rowID), Kind: "set", Value: row}, nil
}
