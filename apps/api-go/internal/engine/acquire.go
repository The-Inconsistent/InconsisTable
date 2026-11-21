package engine

import (
	"fmt"
	"maps"
	"math"
	"slices"
)

// Acquiring an item by a Test (packages/rules-engine/src/acquire.ts, house decision #102): what acquiring a pack entry
// asks of the actor's Test, as labelled parts, and what a pass grants.

// acquire compiles the acquisition's expressions (compile.ts acquire): in the scope of each actor type holding a kind it
// grants, with `item` (that kind's entry fields and its tags) and `ctx` (the picks).
func (c *compiler) acquire(entities map[string]*CompiledEntity) {
	b := c.r.Items
	if b == nil || b.Acquire == nil {
		return
	}
	a := b.Acquire
	const path = "items.acquire"
	var bases []map[string]ExprType
	for _, k := range b.AcquiredKinds() {
		item := map[string]ExprType{}
		if entry := entityByID(c.r, k.Entry); entry != nil {
			item = fieldScope(entry.Fields)
		}
		item["tags"] = ListType{textType}
		holders := k.Entities
		_, scopes := c.actorsOf(&holders, entities)
		bases = append(bases, withScope(scopes, "item", RecordType{item})...)
	}
	scopes := func(withPicks bool) []map[string]ExprType {
		ctx := map[string]ExprType{}
		if withPicks {
			for name := range a.Picks {
				ctx[name] = intType
			}
		}
		return withScope(bases, "ctx", RecordType{ctx})
	}
	for _, name := range sortedKeys(a.Picks) {
		c.expr(a.Picks[name].Max, scopes(false), intType, path+".picks."+name+".max")
	}
	if a.If != nil {
		c.expr(*a.If, scopes(true), boolType, path+".if")
	}
	for _, name := range sortedKeys(a.Inputs) {
		for j, part := range a.Inputs[name] {
			c.expr(part.Value, scopes(true), intType, fmt.Sprintf("%s.inputs.%s[%d].value", path, name, j))
		}
	}
	if a.TopUp != nil && a.TopUp.Max != nil {
		c.expr(*a.TopUp.Max, scopes(true), intType, path+".topUp.max")
	}
	if a.Quantity != nil {
		c.expr(*a.Quantity, scopes(true), intType, path+".quantity")
	}
	if a.Load != nil {
		c.expr(a.Load.Quantity, scopes(true), intType, path+".load.quantity")
	}
}

// AcquireItem is the pack entry asked for, as the room serves it.
type AcquireItem struct {
	Type string         `json:"type"`
	Key  string         `json:"key"`
	Name string         `json:"name"`
	Tags []string       `json:"tags"`
	Body map[string]any `json:"body"`
}

// AcquirePartValue is one part of an input, worked out.
type AcquirePartValue struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

// AcquireInput is one of the Test's inputs: its total and the parts it adds up from.
type AcquireInput struct {
	Total float64            `json:"total"`
	Parts []AcquirePartValue `json:"parts"`
}

// AcquirePlan is planAcquire's answer.
type AcquirePlan struct {
	Kind   string                  `json:"kind"`
	Inputs map[string]AcquireInput `json:"inputs"`
	TopUp  *struct {
		Resource string  `json:"resource"`
		Max      float64 `json:"max"`
	} `json:"topUp"`
	Quantity *float64 `json:"quantity"`
	Load     *struct {
		Key      string  `json:"key"`
		Quantity float64 `json:"quantity"`
	} `json:"load"`
}

// ItemScope is the entry's values as `item` reads them (acquire.ts itemScope): its type's declared fields from its
// body (an unset list reads as empty), and its tags.
func ItemScope(r *Ruleset, item AcquireItem) *Record {
	values := map[string]any{}
	if e := entityByID(r, item.Type); e != nil {
		for _, id := range sortedKeys(e.Fields) {
			if v, set := item.Body[id]; set && v != nil {
				values[id] = v
			} else if e.Fields[id].Type == "list" {
				values[id] = []any{}
			}
		}
	}
	out := NestFields(values)
	tags := make([]any, len(item.Tags))
	for i, t := range item.Tags {
		tags[i] = t
	}
	out.Fields["tags"] = &List{tags}
	return out
}

// PlanAcquire is acquire.ts planAcquire. The refusals are its: noAcquire, itemNotAnItem, acquireNotFor, badInput,
// acquireNotNow (and wrongState for what cannot be read).
func PlanAcquire(r *Ruleset, actor *ActorState, item AcquireItem, picks map[string]any) (*AcquirePlan, *Refusal) {
	b := r.Items
	if b == nil || b.Acquire == nil {
		return nil, refuse("noAcquire", "no acquisition")
	}
	a := b.Acquire
	kind := b.KindOf(item.Type, item.Tags)
	if kind == nil {
		return nil, refuse("itemNotAnItem", `"%s" is of no item kind`, item.Name)
	}
	if !slices.Contains(b.AcquiredKinds(), kind) || actor.Entity == "" || !slices.Contains(kind.Entities, actor.Entity) {
		return nil, refuse("acquireNotFor", `"%s" is not acquired by "%s"`, item.Name, actor.ID)
	}
	if actor.Scope == nil {
		return nil, refuse("wrongState", `"%s" has values that cannot be read yet`, actor.ID)
	}
	const path = "items.acquire"
	fields := maps.Clone(actor.Scope.Fields)
	fields["item"] = ItemScope(r, item)
	base := &Record{fields}
	for _, name := range sortedKeys(picks) {
		if _, declared := a.Picks[name]; !declared {
			return nil, refuse("badInput", `"%s" is not a pick`, name)
		}
	}
	picked := map[string]any{}
	for _, name := range sortedKeys(a.Picks) {
		def := a.Picks[name]
		max, refusal := readNumber(def.Max, withCtx(base, map[string]any{}), path+".picks."+name+".max")
		if refusal != nil {
			return nil, refusal
		}
		v, isNumber := picks[name].(float64)
		if !isNumber || v != math.Trunc(v) || v < def.Min || v > max {
			return nil, refuse("badInput", `"%s" must be a whole number from %s to %s`, name, esNumber(def.Min), esNumber(max))
		}
		picked[name] = v
	}
	scope := withCtx(base, picked)
	if a.If != nil {
		v, refusal := read(*a.If, scope, path+".if")
		if refusal != nil {
			return nil, refusal
		}
		if v != true {
			return nil, refuse("acquireNotNow", `"%s" cannot be acquired now`, item.Name)
		}
	}
	plan := &AcquirePlan{Kind: kind.ID, Inputs: map[string]AcquireInput{}}
	for _, name := range sortedKeys(a.Inputs) {
		in := AcquireInput{Parts: []AcquirePartValue{}}
		for j, part := range a.Inputs[name] {
			v, refusal := readNumber(part.Value, scope, fmt.Sprintf("%s.inputs.%s[%d].value", path, name, j))
			if refusal != nil {
				return nil, refusal
			}
			in.Parts = append(in.Parts, AcquirePartValue{part.Label, v})
			in.Total += v
		}
		plan.Inputs[name] = in
	}
	if t := a.TopUp; t != nil {
		max := 1000.0
		if t.Max != nil {
			v, refusal := readNumber(*t.Max, scope, path+".topUp.max")
			if refusal != nil {
				return nil, refusal
			}
			max = v
		}
		plan.TopUp = &struct {
			Resource string  `json:"resource"`
			Max      float64 `json:"max"`
		}{t.Resource, math.Max(0, max)}
	}
	if kind.Counted() {
		q := 1.0
		if a.Quantity != nil {
			v, refusal := readNumber(*a.Quantity, scope, path+".quantity")
			if refusal != nil {
				return nil, refusal
			}
			q = v
		}
		q = math.Min(999, math.Max(1, q))
		plan.Quantity = &q
	}
	if l := a.Load; l != nil && !kind.Counted() {
		if named, _ := item.Body[l.Field].(string); named != "" {
			q, refusal := readNumber(l.Quantity, scope, path+".load.quantity")
			if refusal != nil {
				return nil, refusal
			}
			if q > 0 {
				plan.Load = &struct {
					Key      string  `json:"key"`
					Quantity float64 `json:"quantity"`
				}{named, math.Min(999, q)}
			}
		}
	}
	return plan, nil
}
