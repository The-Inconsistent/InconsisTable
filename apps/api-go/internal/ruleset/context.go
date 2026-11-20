package ruleset

import (
	"context"
	"errors"
	"maps"
	"slices"

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
	"initiative.sides":  func(r *engine.Ruleset) any { return r.Normalized["initiative"] },
	"health.tracks":     func(r *engine.Ruleset) any { return r.Normalized["health"] },
	"health.harm": func(r *engine.Ruleset) any {
		health, _ := r.Normalized["health"].(map[string]any)
		return health["harm"]
	},
	"resource.capped":   func(*engine.Ruleset) any { return map[string]any{} },
	"conditions.expire": func(*engine.Ruleset) any { return map[string]any{} },
	"rest":              func(*engine.Ruleset) any { return map[string]any{} },
}

// Primitives that read the turn: they wait for a session (house decision #28).
var turnPrimitives = map[string]bool{"initiative.ranked": true, "initiative.seated": true, "initiative.sides": true, "conditions.expire": true}

// RunPrimitive parses, validates and applies one op; its deltas are checked against the op's targets. It refuses with
// the engine's words as the detail.
func RunPrimitive(r *engine.Ruleset, state *engine.RuleState, primitive, op string, input any) ([]engine.Delta, error) {
	params, known := primitiveParams[primitive]
	if !known {
		return nil, cs.Fail("notRunThisWay", cs.Params{"primitive": primitive})
	}
	if primitive == "health.harm" && r.Health.Harm == nil {
		return nil, cs.Fail("noHarmHere")
	}
	if primitive == "resource.capped" {
		if in, isObject := input.(map[string]any); isObject {
			target, has := in["resource"]
			if has && slices.Contains(throughDamage(r), target) {
				return nil, cs.Fail("hpThroughDamage")
			}
		}
	}
	result, refusal := engine.RunOp(primitive, op, params(r), input, state)
	if refusal != nil {
		return nil, cs.Fail(refusal.Code, cs.Params{"detail": refusal.Message})
	}
	return result.Deltas, nil
}

// throughDamage is the resources the plain stepper may not change, for any seat: a health track's, and the ones
// health.harm counts (house decision #66). Rests and other trusted writes still reach them.
func throughDamage(r *engine.Ruleset) []any {
	out := []any{}
	for _, t := range r.Health.Tracks {
		out = append(out, t.Resource)
	}
	if h := r.Health.Harm; h != nil {
		out = append(out, h.Wounds)
		if h.Shock != nil {
			out = append(out, *h.Shock)
		}
		if h.Mob != nil {
			out = append(out, h.Mob.Members)
		}
	}
	return out
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
	// Pools are the room's shared pools as they stand, by resource id, and PoolOrder their ids in the state's order.
	Pools     map[string]actor.Pool
	PoolOrder []string
	// characters and campaign are what the actors were built with, for bounds evaluated again (rebound).
	characters float64
	campaign   map[string]any
	c          cs.Ctx
	tx         core.Conn
	turn       *turn.Turn
	read       bool
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
	campaign, err := actor.LoadCampaign(ctx, tx, c.CampaignID, rules)
	if err != nil {
		return nil, err
	}
	built, err := actor.Build(rules, rows, campaign)
	if err != nil {
		return nil, err
	}
	order := make([]string, len(rows))
	for i, r := range rows {
		order[i] = r.Actor.ID
	}
	poolRows, err := actor.LoadPools(ctx, tx, c.CampaignID)
	if err != nil {
		return nil, err
	}
	pools, err := actor.BuildPools(rules, poolRows, actor.CountCharacters(rows), campaign)
	if err != nil {
		return nil, err
	}
	rc := &Context{Compiled: rules, Built: built, Order: order, Pools: map[string]actor.Pool{}, c: c, tx: tx,
		characters: actor.CountCharacters(rows), campaign: campaign}
	for _, p := range pools {
		rc.Pools[p.ID] = p
		rc.PoolOrder = append(rc.PoolOrder, p.ID)
	}
	return rc, nil
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
		if t != nil {
			t.Unable = Unable(rc.Compiled, rc.Built, t.Order)
		}
		rc.turn, rc.read = t, true
	}
	return rc.turn, nil
}

// Unable is the actors among ids that cannot act: those with any of a sides order's `unableStates` now (house decision
// #60). A state whose condition cannot be evaluated does not count. nil for any other order. It takes the built actors,
// so it lives here and not in the turn package, which the actor package sits above.
func Unable(compiled *engine.CompiledRuleset, built map[string]*actor.Built, ids []string) []string {
	out := []string{}
	i := compiled.Ruleset.Initiative
	if i == nil || i.Strategy != "sides" || i.UnableStates == nil {
		return out
	}
	for _, id := range ids {
		b := built[id]
		if b == nil || b.Scope == nil {
			continue
		}
		states, err := compiled.HealthStatesOf(b.Entity, b.Scope)
		if err == nil && slices.ContainsFunc(*i.UnableStates, func(s string) bool { return slices.Contains(states, s) }) {
			out = append(out, id)
		}
	}
	return out
}

// State is what the ops read: every actor as it is now, less exclude, the shared pools, and the turn (nil with none).
func (rc *Context) State(exclude map[string]bool, t *engine.TurnState) *engine.RuleState {
	state := &engine.RuleState{Actors: []*engine.ActorState{}, Turn: t, Pools: []engine.NamedResource{}}
	for _, id := range rc.PoolOrder {
		state.Pools = append(state.Pools, engine.NamedResource{Name: id, State: rc.Pools[id].State})
	}
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
	in, _ := r.Input.(map[string]any)
	actorID, _ := in["actorId"].(string)
	// A sheet the rules cannot read yet takes no hit: refused in the words a called Test uses, not the engine's.
	if b := rc.Built[actorID]; r.Primitive == "health.harm" && b != nil && b.Entity != "" && b.Scope == nil {
		return nil, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
	}
	deltas, err := RunPrimitive(rc.Compiled.Ruleset, rc.State(r.Exclude, t), r.Primitive, r.Op, r.Input)
	var refused *cs.Error
	if errors.As(err, &refused) && namesActor[refused.Code] && rc.Built[actorID] != nil {
		params := cs.Params{"name": rc.Built[actorID].Row.Name}
		maps.Copy(params, refused.Params)
		refused.Params = params
	}
	if err == nil && r.Primitive == "health.harm" && r.Op == "muster" {
		err = rc.rebound(actorID, deltas)
	}
	return deltas, err
}

// The engine refusals whose text names the actor (house decision #66).
var namesActor = map[string]bool{"noHarmHere": true, "neverShocked": true, "notAMob": true}

// rebound evaluates an actor's resource bounds again with the fields the deltas are about to write, so a resource
// whose max reads one of them (a mob's members, up to its start) is clamped by the new value in the same action.
// ponytail: muster only, and a held resource's max override is not kept; widen to every op that writes a field a
// bound reads if another needs it.
func (rc *Context) rebound(actorID string, deltas []engine.Delta) error {
	b := rc.Built[actorID]
	if b == nil || b.Entity == "" {
		return nil
	}
	fields := maps.Clone(b.Fields)
	for _, d := range deltas {
		if d.Target.ActorID == actorID && d.Target.Field != "" {
			fields[d.Target.Field] = d.Value
		}
	}
	start, err := actor.StartingResources(rc.Compiled, b.Entity, fields, rc.characters, rc.campaign, b.Entries)
	if err != nil {
		return err
	}
	copied := *b
	copied.Bounds = maps.Clone(b.Bounds)
	for _, r := range start {
		if _, held := copied.Bounds[r.Resource]; held {
			copied.Bounds[r.Resource] = r.Bounds
		}
	}
	rc.Built[actorID] = &copied
	return nil
}

// Apply is the only write of a context: every delta through the pipeline. It returns the logged action id, "" when
// nothing changed. A pool delta here is a hand edit and is asked who may make it.
func (rc *Context) Apply(ctx context.Context, deltas []engine.Delta) (string, error) {
	return rc.apply(ctx, deltas, false)
}

// ApplyCharged is Apply for deltas an op proposed under its own permission: a pool delta is not asked for a hand edit.
func (rc *Context) ApplyCharged(ctx context.Context, deltas []engine.Delta) (string, error) {
	return rc.apply(ctx, deltas, true)
}

func (rc *Context) apply(ctx context.Context, deltas []engine.Delta, charged bool) (string, error) {
	return actor.ApplyDeltas(ctx, rc.tx, actor.Apply{
		Ctx: rc.c, Compiled: rc.Compiled, Built: rc.Built, Deltas: deltas, Pools: rc.Pools, Charged: charged,
	})
}

// ApplyRuled writes what a table event's own rules decided: the resets and expiries of a session start or end, an
// encounter's end or a rest (house decision #53). The seat's permission to run the event is the authority, so
// editableBy, which says who may edit a value by hand, is not asked. Never for a delta a seat chose.
func (rc *Context) ApplyRuled(ctx context.Context, deltas []engine.Delta) (string, error) {
	return actor.ApplyDeltas(ctx, rc.tx,
		actor.Apply{Ctx: rc.c, Compiled: rc.Compiled, Built: rc.Built, Deltas: deltas, Pools: rc.Pools, Trusted: true, Charged: true})
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
