package engine

import (
	"errors"
	"maps"
	"math"
	"slices"
)

// Lookups (packages/rules-engine/src/lookups.ts; house decision #87): a typed result, the inputs and the target pick
// one line, and the line's effects become steps the api applies through the ordinary operations.

type (
	// LookupStep is one step of an applied line, worked out for the target. Kind is harm (Wounds, Shock), condition
	// (Condition, Immune), resource (Resource, By) or pool (Pool, By); the JSON is lookups.ts LookupStep.
	LookupStep struct {
		Kind      string
		Wounds    int
		Shock     int
		Condition string
		Immune    bool
		Resource  string
		Pool      string
		By        int
		Held      string
		Entry     string
		// Has is a grant of an entry the target already holds, which the api refuses (house decision #88).
		Has bool
	}
	// LookupRefusal is why a typed result cannot be read: Code is tableNotFound, tableResultOut (Min, Max), tableInput
	// (Input) or unreadable (Detail).
	LookupRefusal struct {
		Code     string
		Min, Max int
		Input    string
		Detail   string
	}
	// LookupRead is what a typed result reads: the total, the line's index and the inputs as `ctx`.
	LookupRead struct {
		Total, Entry int
		Ctx          map[string]any
	}
)

// JSON is the step as lookups.ts writes it.
func (s LookupStep) JSON() map[string]any {
	switch s.Kind {
	case "harm":
		return map[string]any{"kind": s.Kind, "wounds": s.Wounds, "shock": s.Shock}
	case "condition":
		return map[string]any{"kind": s.Kind, "condition": s.Condition, "immune": s.Immune}
	case "resource":
		return map[string]any{"kind": s.Kind, "resource": s.Resource, "by": s.By}
	case "grant":
		return map[string]any{"kind": s.Kind, "held": s.Held, "entry": s.Entry, "has": s.Has}
	}
	return map[string]any{"kind": s.Kind, "pool": s.Pool, "by": s.By}
}

// LookupInputs is the inputs as the lookup reads them (lookups.ts lookupInputs): each declared one given or its default
// (a switch off, a stepper at its min or 0). The name of the first that is undeclared, of the wrong type, not whole or
// outside its bounds, else "".
func LookupInputs(t *RandomTable, given map[string]any) (map[string]any, string) {
	ctx := map[string]any{}
	declared := map[string]bool{}
	for _, x := range t.Inputs {
		declared[x.ID] = true
	}
	for _, key := range sortedKeys(given) {
		if !declared[key] {
			return nil, key
		}
	}
	for _, x := range t.Inputs {
		v, has := given[x.ID]
		if x.Type == "bool" {
			b, isBool := v.(bool)
			if has && !isBool {
				return nil, x.ID
			}
			ctx[x.ID] = b
			continue
		}
		n := 0.0
		switch {
		case has:
			f, isNumber := v.(float64)
			if !isNumber || f != math.Trunc(f) {
				return nil, x.ID
			}
			n = f
		case x.Min != nil:
			n = float64(*x.Min)
		}
		if (x.Min != nil && n < float64(*x.Min)) || (x.Max != nil && n > float64(*x.Max)) {
			return nil, x.ID
		}
		ctx[x.ID] = n
	}
	return ctx, ""
}

// ReadLookup is what a typed result reads on a table (lookups.ts readLookup): the total and the line. A nil scope is
// no target, which a table with a modifier cannot be read without.
func (c *CompiledRuleset) ReadLookup(tableID string, result float64, inputs map[string]any, scope *Record) (*LookupRead, *LookupRefusal) {
	t, known := c.Ruleset.Tables[tableID]
	lookup := c.Lookups[tableID]
	if !known || lookup == nil || t.Die == nil {
		return nil, &LookupRefusal{Code: "tableNotFound"}
	}
	die, ok := TableDie(*t.Die)
	if !ok {
		return nil, &LookupRefusal{Code: "tableNotFound"}
	}
	if result != math.Trunc(result) || !die.Has(int(result)) {
		return nil, &LookupRefusal{Code: "tableResultOut", Min: die.Min, Max: die.Max}
	}
	ctx, bad := LookupInputs(&t, inputs)
	if bad != "" {
		return nil, &LookupRefusal{Code: "tableInput", Input: bad}
	}
	total := int(result)
	if lookup.Modifier != nil {
		if scope == nil {
			return nil, &LookupRefusal{Code: "unreadable", Detail: "the modifier reads a target"}
		}
		n, err := evaluateInt(lookup.Modifier, lookupScope(c.withHeld(scope), ctx))
		if err != nil {
			return nil, unreadable(err)
		}
		total += int(n)
	}
	return &LookupRead{Total: total, Entry: RowOf(t.Entries, total), Ctx: ctx}, nil
}

// PlanLookup is a typed result applied to a target (lookups.ts planLookup): the line and its effects as steps, in the
// line's order, each repeated Times and left out when its When does not hold or its amounts are all 0.
func (c *CompiledRuleset) PlanLookup(tableID string, result float64, inputs map[string]any, scope *Record) (*LookupRead, []LookupStep, *LookupRefusal) {
	read, refused := c.ReadLookup(tableID, result, inputs, scope)
	if refused != nil {
		return nil, nil, refused
	}
	full := lookupScope(c.withHeld(scope), read.Ctx)
	steps := []LookupStep{}
	effects := c.Lookups[tableID].Effects
	if read.Entry < 0 || read.Entry >= len(effects) {
		return read, steps, nil
	}
	for i := range effects[read.Entry] {
		x := &effects[read.Entry][i]
		if x.When != nil {
			holds, err := evaluateBool(x.When, full)
			if err != nil {
				return nil, nil, unreadable(err)
			}
			if !holds {
				continue
			}
		}
		times := 1.0
		if x.Times != nil {
			n, err := evaluateInt(x.Times, full)
			if err != nil {
				return nil, nil, unreadable(err)
			}
			times = math.Max(0, math.Min(MaxEffectTimes, n))
		}
		step, err := c.stepOf(x, full, scope)
		if err != nil {
			return nil, nil, unreadable(err)
		}
		if step == nil {
			continue
		}
		for range int(times) {
			steps = append(steps, *step)
		}
	}
	return read, steps, nil
}

// stepOf is one effect worked out once; nil when its amounts are all 0. Immunity reads the target without the inputs.
func (c *CompiledRuleset) stepOf(x *CompiledTableEffect, scope, target *Record) (*LookupStep, error) {
	var failed error
	num := func(e *CompiledExpr) int {
		if e == nil || failed != nil {
			return 0
		}
		n, err := evaluateInt(e, scope)
		failed = err
		return int(n)
	}
	d := x.Def
	var step LookupStep
	switch d.Kind {
	case "harm":
		step = LookupStep{Kind: "harm", Wounds: num(x.Wounds), Shock: num(x.Shock)}
		if step.Wounds == 0 && step.Shock == 0 {
			return nil, failed
		}
	case "condition":
		return &LookupStep{Kind: "condition", Condition: d.Condition, Immune: c.ImmuneTo(d.Condition, target)}, nil
	case "grant":
		return &LookupStep{Kind: "grant", Held: d.Held, Entry: d.Entry, Has: slices.Contains(c.HeldKeys(d.Held, target), d.Entry)}, nil
	case "resource":
		step = LookupStep{Kind: "resource", Resource: d.Resource, By: num(x.By)}
	default:
		step = LookupStep{Kind: "pool", Pool: d.Pool, By: num(x.By)}
	}
	if failed != nil {
		return nil, failed
	}
	if step.Kind != "harm" && step.By == 0 {
		return nil, nil
	}
	return &step, nil
}

// lookupScope is the target's scope with the inputs as ctx (spend.go's withCtx takes records as they are; these are JSON).
func lookupScope(scope *Record, ctx map[string]any) *Record {
	out := &Record{Fields: maps.Clone(scope.Fields)}
	out.Fields["ctx"] = ValueFromJSON(ctx)
	return out
}

// unreadable is an expression that could not be read on the target; anything else is a bug and panics, as ImmuneTo does.
func unreadable(err error) *LookupRefusal {
	var exprErr ExprError
	if !errors.As(err, &exprErr) {
		panic(err)
	}
	return &LookupRefusal{Code: "unreadable", Detail: exprErr.Message}
}
