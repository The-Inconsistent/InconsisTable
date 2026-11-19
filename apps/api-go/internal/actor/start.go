package actor

import (
	"context"
	"errors"
	"sort"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The first values of an actor (apps/api/src/actor/actor.start.ts): the fields a builder or a pack entry decided, then
// its resources at their starting value. Both go through ApplyDeltas, so they are clamped by the server and logged like
// any other write.

// StartingResource is one resource at its starting value, with the bounds it was evaluated under.
type StartingResource struct {
	Resource string
	Value    float64
	Bounds   Bounds
}

// StartingResources is the entity's resources at the start: the resource's own `start` when it declares one, else full
// when it has a ceiling, else at its floor (house decision #23). A resource whose bounds can't be evaluated yet (a field it reads is unset) is left out, as is
// everything when the derived values can't be computed.
func StartingResources(compiled *engine.CompiledRuleset, entity string, fields map[string]any, characters float64) ([]StartingResource, error) {
	ce, ok := compiled.Entities[entity]
	if !ok {
		return nil, nil
	}
	values := engine.ActorValues{Fields: fields, Resources: map[string]float64{}, Conditions: []string{}, Characters: characters}
	var exprErr engine.ExprError
	derived, err := compiled.DeriveValues(entity, values)
	if errors.As(err, &exprErr) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	base, err := compiled.ApplyBaseEffects(entity, values)
	if errors.As(err, &exprErr) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	live := &engine.Record{Fields: make(map[string]any, len(derived))}
	for k, v := range derived {
		live.Fields[k] = v
	}
	scope := engine.ActorScope(base, live, nil, characters, nil)
	out := []StartingResource{}
	for _, resource := range ce.Resources {
		b, err := compiled.ResourceBounds(resource, scope)
		if errors.As(err, &exprErr) {
			continue
		}
		if err != nil {
			return nil, err
		}
		value := b.Min
		if b.Max != nil {
			value = *b.Max
		}
		begin, err := compiled.StartValue(resource, scope)
		if errors.As(err, &exprErr) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if begin != nil {
			value = *begin
		}
		out = append(out, StartingResource{resource, value, Bounds{b.Min, b.Max, !b.Capped}})
	}
	return out, nil
}

// StartTarget is one actor (with its entity type set) and the fields the creation or the pack decided for it.
type StartTarget struct {
	ActorID string
	Fields  map[string]any
}

// WriteStart writes the starting fields and resources of actors that already exist. One log entry for the lot, so one
// undo reverses it. editableBy is skipped: the creation or the pack decided these values.
func WriteStart(ctx context.Context, tx core.Conn, c cs.Ctx, compiled *engine.CompiledRuleset, targets []StartTarget) (string, error) {
	rows, err := LoadRows(ctx, tx, c.CampaignID)
	if err != nil {
		return "", err
	}
	built, err := Build(compiled, rows)
	if err != nil {
		return "", err
	}
	characters := CountCharacters(rows)
	patched := make(map[string]*Built, len(built))
	for id, b := range built {
		patched[id] = b
	}
	deltas := []engine.Delta{}
	for _, t := range targets {
		b, ok := built[t.ActorID]
		if !ok || b.Entity == "" {
			return "", cs.Fail("characterNotFound")
		}
		// A JavaScript object's own keys, in the order the creation wrote them; Go maps have none, so sorted.
		fields := make([]string, 0, len(t.Fields))
		for field := range t.Fields {
			fields = append(fields, field)
		}
		sort.Strings(fields)
		for _, field := range fields {
			if value := t.Fields[field]; value != nil && FieldDefOf(compiled, b, field) != nil {
				deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{ActorID: t.ActorID, Field: field}, Kind: "set", Value: value})
			}
		}
		start, err := StartingResources(compiled, b.Entity, t.Fields, characters)
		if err != nil {
			return "", err
		}
		copied := *b
		copied.Bounds = make(map[string]Bounds, len(b.Bounds)+len(start))
		for k, v := range b.Bounds {
			copied.Bounds[k] = v
		}
		for _, r := range start {
			copied.Bounds[r.Resource] = r.Bounds
		}
		patched[t.ActorID] = &copied
		for _, r := range start {
			deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{ActorID: t.ActorID, Resource: r.Resource}, Kind: "set", Value: r.Value})
		}
	}
	return ApplyDeltas(ctx, tx, Apply{Ctx: c, Compiled: compiled, Built: patched, Deltas: deltas, Trusted: true})
}
