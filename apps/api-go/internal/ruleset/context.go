package ruleset

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Steps 4-5 of docs/design.md §5.3 (apps/api/src/ruleset/ruleset.run.ts and ruleset.context.ts): an op runs against
// the state it is handed, and every delta it proposes goes through the actor pipeline.

// Where each primitive reads its params in the pinned ruleset (docs/design.md §4.1): `rule.op` never takes params from
// the client. A primitive missing here is not run through `rule.op` yet. dice.sumVsTarget takes its params from a named
// Test, not from the ruleset's one block, so it runs through the test.* actions.
var primitiveParams = map[string]func(r *engine.Ruleset) any{
	"initiative.ranked": func(r *engine.Ruleset) any { return r.Normalized["initiative"] },
	"initiative.seated": func(r *engine.Ruleset) any { return r.Normalized["initiative"] },
	"health.tracks":     func(r *engine.Ruleset) any { return r.Normalized["health"] },
	"resource.capped":   func(*engine.Ruleset) any { return map[string]any{} },
	"conditions.expire": func(*engine.Ruleset) any { return map[string]any{} },
	"rest":              func(*engine.Ruleset) any { return map[string]any{} },
}

// Primitives that read the turn: they wait for a session (house decision #28).
var turnPrimitives = map[string]bool{"initiative.ranked": true, "initiative.seated": true, "conditions.expire": true}

// RunPrimitive parses, validates and applies one op; its deltas are checked against the op's targets. It refuses with
// the engine's words as the detail.
func RunPrimitive(r *engine.Ruleset, state *engine.RuleState, primitive, op string, input any) ([]engine.Delta, error) {
	params, known := primitiveParams[primitive]
	if !known {
		return nil, cs.Fail("notRunThisWay", cs.Params{"primitive": primitive})
	}
	if primitive == "resource.capped" {
		if in, isObject := input.(map[string]any); isObject {
			for _, t := range r.Health.Tracks {
				if target, has := in["resource"]; has && target == t.Resource {
					return nil, cs.Fail("hpThroughDamage")
				}
			}
		}
	}
	result, refusal := engine.RunOp(primitive, op, params(r), input, state)
	if refusal != nil {
		return nil, cs.Fail(refusal.Code, cs.Params{"detail": refusal.Message})
	}
	return result.Deltas, nil
}

// IsPaused is house decision #28: an encounter may stay open across sessions, but nothing moves until the next one
// starts.
func IsPaused(ctx context.Context, conn core.Conn, campaignID string) (bool, error) {
	e, err := turn.Active(ctx, conn, campaignID)
	if err != nil || e == nil {
		return false, err
	}
	session, err := eventlog.RunningSessionID(ctx, conn, campaignID)
	return session == nil, err
}

// Context is the pinned ruleset and every actor of the campaign built, for one action's transaction.
type Context struct {
	Compiled *engine.CompiledRuleset
	Built    map[string]*actor.Built
	// Order is the actors' ids in load order, which the ops' state follows (the rest op's deltas do).
	Order []string
	c     cs.Ctx
	tx    core.Conn
	turn  *turn.Turn
	read  bool
}

// OpenIfPinned is the campaign's ruleset context, or nil when it has no ruleset.
func OpenIfPinned(ctx context.Context, tx core.Conn, c cs.Ctx) (*Context, error) {
	rules, err := LoadCompiled(ctx, tx, c.CampaignID)
	if err != nil || rules == nil {
		return nil, err
	}
	rows, err := actor.LoadRows(ctx, tx, c.CampaignID)
	if err != nil {
		return nil, err
	}
	built, err := actor.Build(rules, rows)
	if err != nil {
		return nil, err
	}
	order := make([]string, len(rows))
	for i, r := range rows {
		order[i] = r.Actor.ID
	}
	return &Context{Compiled: rules, Built: built, Order: order, c: c, tx: tx}, nil
}

// Open is OpenIfPinned, refusing when the campaign has no ruleset.
func Open(ctx context.Context, tx core.Conn, c cs.Ctx) (*Context, error) {
	rc, err := OpenIfPinned(ctx, tx, c)
	if err == nil && rc == nil {
		return nil, cs.Fail("noRuleset")
	}
	return rc, err
}

// Turn is the running encounter's turn, loaded on first ask; nil with no encounter.
func (rc *Context) Turn(ctx context.Context) (*turn.Turn, error) {
	if !rc.read {
		t, err := turn.Load(ctx, rc.tx, rc.c.CampaignID)
		if err != nil {
			return nil, err
		}
		rc.turn, rc.read = t, true
	}
	return rc.turn, nil
}

// State is what the ops read: every actor as it is now, less exclude, and the turn (nil with none).
func (rc *Context) State(exclude map[string]bool, t *engine.TurnState) *engine.RuleState {
	state := &engine.RuleState{Actors: []*engine.ActorState{}, Turn: t}
	for _, id := range rc.Order {
		if !exclude[id] {
			state.Actors = append(state.Actors, rc.Built[id].State)
		}
	}
	return state
}

// Run is one op to run: its primitive, op and input, the actors to leave out of its state (creatures about to be
// deleted), and NoTurn to run without the turn (rest at a session boundary).
type Run struct {
	Primitive, Op string
	Input         any
	Exclude       map[string]bool
	NoTurn        bool
}

// Run runs one op. Like `rule.op`, the turn is loaded and passed for every primitive unless NoTurn; the session is only
// asked for the turn primitives, which refuse while it is paused.
func (rc *Context) Run(ctx context.Context, r Run) ([]engine.Delta, error) {
	var t *engine.TurnState
	if !r.NoTurn {
		loaded, err := rc.Turn(ctx)
		if err != nil {
			return nil, err
		}
		if loaded != nil {
			t = &loaded.TurnState
		}
	}
	if t != nil && turnPrimitives[r.Primitive] {
		session, err := eventlog.RunningSessionID(ctx, rc.tx, rc.c.CampaignID)
		if err != nil {
			return nil, err
		}
		if session == nil {
			return nil, cs.Fail("sessionPaused")
		}
	}
	return RunPrimitive(rc.Compiled.Ruleset, rc.State(r.Exclude, t), r.Primitive, r.Op, r.Input)
}

// Apply is the only write of a context: every delta through the pipeline. It returns the logged action id, "" when
// nothing changed.
func (rc *Context) Apply(ctx context.Context, deltas []engine.Delta) (string, error) {
	return actor.ApplyDeltas(ctx, rc.tx, actor.Apply{Ctx: rc.c, Compiled: rc.Compiled, Built: rc.Built, Deltas: deltas})
}

// CheckRuleset is a manifest as the owner pasted it: validated and every expression compiled, returned normalized
// (defaults applied) with the hash of that document (apps/api/src/ruleset/ruleset.check.ts). The hash is the compiled
// cache key and tells a repeat import from a changed one.
func CheckRuleset(input any) (normalized *engine.Ruleset, hash string, problems []engine.Problem) {
	rules, problems := engine.CompileRuleset(input)
	if len(problems) > 0 {
		return nil, "", problems
	}
	return rules.Ruleset, engine.Sha256Hex(engine.CanonicalJSON(rules.Ruleset.Normalized)), nil
}
