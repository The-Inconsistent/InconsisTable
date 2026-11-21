package engine

import (
	"fmt"
	"math"
	"slices"
	"strings"
)

// ActorValues is what DeriveValues reads for one actor. Fields hold decoded JSON values.
type ActorValues struct {
	Fields map[string]any
	// Resources holds current values of the entity-scoped resources (res.hp).
	Resources map[string]float64
	// Conditions holds active condition ids; their effects apply in design order.
	Conditions []string
	// Entries holds the pack entries the actor chose (house decision #61); their effects apply with the conditions',
	// in design order.
	Entries []ActiveEntry
	// Options holds the spawn options the actor took (house decision #92); their effects apply with the conditions'.
	Options []string
	// Characters is party.characters.
	Characters float64
	// Campaign holds the campaign's field values (campaign.danger) as CampaignValues gives them; nil leaves campaign
	// out of the scope.
	Campaign map[string]any
}

// NestFields turns {"attr.str": 14} into {attr: {str: 14}}, the shape expressions read.
func NestFields(fields map[string]any) *Record {
	out := &Record{map[string]any{}}
	groups := map[string]map[string]any{}
	for id, value := range fields {
		head, rest, dotted := strings.Cut(id, ".")
		if !dotted {
			// An unset field stays absent, so has(x) is false and reading it is a missing-value error.
			if value != nil {
				out.Fields[id] = ValueFromJSON(value)
			}
			continue
		}
		if groups[head] == nil {
			groups[head] = map[string]any{}
		}
		groups[head][rest] = value
	}
	for head, sub := range groups {
		out.Fields[head] = NestFields(sub)
	}
	return out
}

func numbersRecord(values map[string]float64) *Record {
	out := &Record{make(map[string]any, len(values))}
	for k, v := range values {
		out.Fields[k] = v
	}
	return out
}

// ActorScope is the runtime scope for an actor expression. The derived record is read live, so filling it in order is
// enough. A nil ctx leaves ctx out of the scope.
func ActorScope(fields map[string]any, derived *Record, resources map[string]float64, characters float64, ctx *Record) *Record {
	return ActorScopeWith(fields, derived, resources, characters, nil, ctx)
}

// ActorScopeWith is ActorScope with the campaign's values; a nil campaign leaves the campaign root out of the scope.
func ActorScopeWith(fields map[string]any, derived *Record, resources map[string]float64, characters float64, campaign map[string]any, ctx *Record) *Record {
	scope := NestFields(fields)
	if derived == nil {
		derived = &Record{map[string]any{}}
	}
	scope.Fields["derived"] = derived
	scope.Fields["res"] = numbersRecord(resources)
	scope.Fields["party"] = &Record{map[string]any{"characters": characters}}
	if campaign != nil {
		scope.Fields["campaign"] = &Record{campaign}
	}
	if ctx != nil {
		scope.Fields["ctx"] = ctx
	}
	return scope
}

// CampaignValues returns the campaign values to read: for each declared field the stored value when it fits, else the
// field's default. Unknown stored ids are dropped. It is empty (not nil) when the manifest declares no fields.
func CampaignValues(c *CompiledRuleset, stored map[string]any) map[string]any {
	out := map[string]any{}
	for id, def := range c.Ruleset.CampaignFields {
		def := def
		if v, ok := stored[id]; ok && CheckCampaignValue(&def, v) == "" {
			out[id] = v
		} else {
			out[id] = def.Default
		}
	}
	return out
}

// EvaluateInt runs an expression that must give a number (expr.ts evaluateInt); anything else is an ExprError.
func EvaluateInt(expr *CompiledExpr, scope *Record) (float64, error) { return evaluateInt(expr, scope) }

func evaluateInt(expr *CompiledExpr, scope *Record) (float64, error) {
	v, err := Evaluate(expr.AST, scope)
	if err != nil {
		return 0, err
	}
	n, ok := v.(float64)
	if !ok {
		return 0, ExprError{Message: fmt.Sprintf(`"%s" did not give an integer`, expr.Source)}
	}
	return n, nil
}

// EvaluateBool runs an expression that must give a boolean (expr.ts evaluateBool); anything else is an ExprError.
func EvaluateBool(expr *CompiledExpr, scope *Record) (bool, error) { return evaluateBool(expr, scope) }

func evaluateBool(expr *CompiledExpr, scope *Record) (bool, error) {
	v, err := Evaluate(expr.AST, scope)
	if err != nil {
		return false, err
	}
	b, ok := v.(bool)
	if !ok {
		return false, ExprError{Message: fmt.Sprintf(`"%s" did not give a boolean`, expr.Source)}
	}
	return b, nil
}

func applyMode(mode string, current, value float64) float64 {
	switch mode {
	case "add":
		return current + value
	case "multiply":
		return current * value
	case "upgrade":
		return math.Max(current, value)
	case "downgrade":
		return math.Min(current, value)
	}
	return value // override
}

// The conditions' effects that are active and the chosen entries', in design order. An effect applies once per active
// condition, whatever its stacks.
//
// ponytail: no per-stack scaling, add it when a ruleset declares one. Entry effects compile on every call; cache by
// entry when a profile shows it.
func (c *CompiledRuleset) activeEffects(entity string, ce *CompiledEntity, values ActorValues) []CompiledEffect {
	var out []CompiledEffect
	for _, e := range ce.Effects {
		option, isOption := strings.CutPrefix(e.SourceID, "spawn/")
		if (isOption && slices.Contains(values.Options, option)) || (!isOption && slices.Contains(values.Conditions, e.SourceID)) {
			out = append(out, e)
		}
	}
	fromEntries := c.compileEntryEffects(entity, values.Entries)
	if len(fromEntries) == 0 {
		return out
	}
	out = append(out, fromEntries...)
	slices.SortStableFunc(out, compareEffects)
	return out
}

// Applies one effect if its when holds, returning the new value.
func applyEffect(e CompiledEffect, current float64, scope *Record) (float64, error) {
	if e.When != nil {
		holds, err := evaluateBool(e.When, scope)
		if err != nil || !holds {
			return current, err
		}
	}
	value, err := evaluateInt(e.Value, scope)
	if err != nil {
		return current, err
	}
	return applyMode(e.Mode, current, value), nil
}

func (c *CompiledRuleset) entityOf(entity string) (*CompiledEntity, error) {
	ce, ok := c.Entities[entity]
	if !ok {
		return nil, fmt.Errorf(`unknown entity type "%s"`, entity)
	}
	return ce, nil
}

// ApplyBaseEffects returns base fields with the base-phase effects of active conditions applied, then clamped to each
// int field's range.
func (c *CompiledRuleset) ApplyBaseEffects(entity string, values ActorValues) (map[string]any, error) {
	ce, err := c.entityOf(entity)
	if err != nil {
		return nil, err
	}
	fields := make(map[string]any, len(values.Fields))
	for k, v := range values.Fields {
		fields[k] = v
	}
	for _, eff := range c.activeEffects(entity, ce, values) {
		if eff.Phase != "base" {
			continue
		}
		current, isNumber := fields[eff.Target].(float64)
		// An unset field has nothing to modify; an override needs nothing and sets it (house decision #92).
		if !isNumber && eff.Mode != "override" {
			continue
		}
		scope := ActorScopeWith(fields, nil, values.Resources, values.Characters, values.Campaign, nil)
		if !isNumber {
			if eff.When != nil {
				holds, err := evaluateBool(eff.When, scope)
				if err != nil {
					return nil, err
				}
				if !holds {
					continue
				}
			}
			value, err := evaluateInt(eff.Value, scope)
			if err != nil {
				return nil, err
			}
			fields[eff.Target] = value
			continue
		}
		next, err := applyEffect(eff, current, scope)
		if err != nil {
			return nil, err
		}
		fields[eff.Target] = next
	}
	for id, def := range ce.Def.Fields {
		// An unset list reads as empty (house decision #91), as withLists reads it: counted from nothing.
		if v, set := fields[id]; def.Type == "list" && (!set || v == nil) {
			fields[id] = []any{}
		}
		v, isNumber := fields[id].(float64)
		if def.Type != "int" || !isNumber {
			continue
		}
		if def.Min != nil {
			v = math.Max(*def.Min, v)
		}
		if def.Max != nil {
			v = math.Min(*def.Max, v)
		}
		fields[id] = v
	}
	return fields, nil
}

// DeriveValues returns every derived value of an actor, in design order: base fields, base effects, derived
// (topological order), derived effects. It is pure, and returns an ExprError when a needed value is missing.
func (c *CompiledRuleset) DeriveValues(entity string, values ActorValues) (map[string]float64, error) {
	ce, err := c.entityOf(entity)
	if err != nil {
		return nil, err
	}
	fields, err := c.ApplyBaseEffects(entity, values)
	if err != nil {
		return nil, err
	}
	live := &Record{map[string]any{}}
	scope := ActorScopeWith(fields, live, values.Resources, values.Characters, values.Campaign, nil)
	out := map[string]float64{}
	for _, d := range ce.Derived {
		n, err := evaluateInt(d.Expr, scope)
		if err != nil {
			return nil, err
		}
		out[d.ID] = n
		live.Fields[d.ID] = n
	}
	for _, eff := range c.activeEffects(entity, ce, values) {
		current, known := out[eff.Target]
		if eff.Phase != "derived" || !known {
			continue
		}
		next, err := applyEffect(eff, current, scope)
		if err != nil {
			return nil, err
		}
		out[eff.Target] = next
		live.Fields[eff.Target] = next
	}
	// A GM's override replaces the worked-out value, effects and all (derived.ts; house decision #96).
	for _, d := range ce.Derived {
		if set, isNumber := values.Fields[d.Override].(float64); d.Override != "" && isNumber {
			out[d.ID] = set
		}
	}
	return out, nil
}

// Bounds are a resource's limits for one holder. Max is nil when there is no ceiling.
type Bounds struct {
	Min    float64
	Max    *float64
	Capped bool
}

// ResourceBounds evaluates a resource's bounds. A max below the min collapses to the min.
func (c *CompiledRuleset) ResourceBounds(resource string, scope *Record) (Bounds, error) {
	cr, ok := c.Resources[resource]
	if !ok {
		return Bounds{}, fmt.Errorf(`unknown resource "%s"`, resource)
	}
	lo, err := evaluateInt(cr.Min, scope)
	if err != nil {
		return Bounds{}, err
	}
	out := Bounds{lo, nil, cr.Def.Capped}
	if cr.Max != nil {
		hi, err := evaluateInt(cr.Max, scope)
		if err != nil {
			return Bounds{}, err
		}
		hi = math.Max(lo, hi)
		out.Max = &hi
	}
	return out, nil
}

// ResetValues returns every event a resource resets on, with the value it resets to for one holder. Reset expressions
// may read the resource's own min and max.
func (c *CompiledRuleset) ResetValues(resource string, scope *Record) (map[string]float64, error) {
	out := map[string]float64{}
	cr, ok := c.Resources[resource]
	if !ok {
		return out, nil
	}
	for _, reset := range cr.ResetOn {
		bounds, err := c.ResourceBounds(resource, scope)
		if err != nil {
			return nil, err
		}
		inner := &Record{make(map[string]any, len(scope.Fields)+2)}
		for k, v := range scope.Fields {
			inner.Fields[k] = v
		}
		inner.Fields["min"] = bounds.Min
		if bounds.Max != nil {
			inner.Fields["max"] = *bounds.Max
		}
		// The first rule for an event wins, so a repeat of an event gets the first rule's value.
		rule := reset
		for _, r := range cr.ResetOn {
			if r.Event == reset.Event {
				rule = r
				break
			}
		}
		n, err := evaluateInt(rule.To, inner)
		if err != nil {
			return nil, err
		}
		out[reset.Event] = n
	}
	return out, nil
}

// StartValue is the value a new holder starts with, held to the bounds (never below min; above max only when capped),
// or nil when the resource declares no start (house decision #23 then decides).
func (c *CompiledRuleset) StartValue(resource string, scope *Record) (*float64, error) {
	cr, ok := c.Resources[resource]
	if !ok || cr.Start == nil {
		return nil, nil
	}
	bounds, err := c.ResourceBounds(resource, scope)
	if err != nil {
		return nil, err
	}
	inner := &Record{make(map[string]any, len(scope.Fields)+2)}
	for k, v := range scope.Fields {
		inner.Fields[k] = v
	}
	inner.Fields["min"] = bounds.Min
	if bounds.Max != nil {
		inner.Fields["max"] = *bounds.Max
	}
	n, err := evaluateInt(cr.Start, inner)
	if err != nil {
		return nil, err
	}
	if bounds.Max != nil && bounds.Capped {
		n = math.Min(*bounds.Max, n)
	}
	n = math.Max(bounds.Min, n)
	return &n, nil
}

// InstantDeathAt returns the overflow that kills outright for a health track's resource, or nil when there is none.
func (c *CompiledRuleset) InstantDeathAt(resource string, scope *Record) (*float64, error) {
	expr, ok := c.InstantDeath[resource]
	if !ok {
		return nil, nil
	}
	n, err := evaluateInt(expr, scope)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// HealthStatesOf returns the display health states that apply to an actor of this type and whose condition holds for it.
func (c *CompiledRuleset) HealthStatesOf(entity string, scope *Record) ([]string, error) {
	out := []string{}
	for _, s := range c.HealthStates {
		if s.Entities != nil && !slices.Contains(*s.Entities, entity) {
			continue
		}
		holds, err := evaluateBool(s.When, scope)
		if err != nil {
			return nil, err
		}
		if holds {
			out = append(out, s.ID)
		}
	}
	return out, nil
}
