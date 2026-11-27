package engine

import (
	"fmt"
	"maps"
	"math"
	"slices"
	"strings"
)

// Spends (packages/rules-engine/src/spend.ts, house decision #84): what a spend costs and runs for one actor now, or why
// not. The api takes the costs and runs the ops as one action.

// PlannedCost is one cost, its amount read: Pool or Resource (of the asking actor). ByRun: a run op takes it itself.
type PlannedCost struct {
	Pool     string  `json:"pool,omitempty"`
	Resource string  `json:"resource,omitempty"`
	Amount   float64 `json:"amount"`
	ByRun    bool    `json:"byRun"`
}

// PlannedStep is one op, its input read.
type PlannedStep struct {
	Primitive string         `json:"primitive"`
	Op        string         `json:"op"`
	Input     map[string]any `json:"input"`
}

// SpendPlan is planSpend's answer.
type SpendPlan struct {
	Costs []PlannedCost `json:"costs"`
	Run   []PlannedStep `json:"run"`
	// Used is the turn's `used` list once the spend is done (house decision #91); nil without a limit or a fight.
	Used []string `json:"used,omitempty"`
}

// UsedKey is spend.ts usedKey: one use of a spend limited per round, as the turn's `used` list holds it.
func UsedKey(round float64, actorID, spendID string) string {
	return esNumber(round) + ":" + actorID + ":" + spendID
}

// RoundUse is one more use of id by the actor in this round of the fight (house decision #91): the turn's `used` list
// with it, this round's entries only, or usedThisRound once max stand. Nil outside a fight or for an actor not in it,
// where nothing is counted. A strike limited per round counts under "strike:<id>" (house decision #113), which no
// spend id can be.
func RoundUse(t *TurnState, actorID, id, label string, max float64) ([]string, *Refusal) {
	if t == nil || !slices.Contains(t.Order, actorID) {
		return nil, nil
	}
	key, round := UsedKey(t.Round, actorID, id), esNumber(t.Round)+":"
	now, times := []string{}, 0.0
	for _, u := range t.Used {
		if strings.HasPrefix(u, round) {
			now = append(now, u)
			if u == key {
				times++
			}
		}
	}
	if times >= max {
		return nil, refuse("usedThisRound", `"%s", round %s`, label, esNumber(t.Round))
	}
	return append(now, key), nil
}

// SpendOf is the ruleset's spend by id, or nil.
func (r *Ruleset) SpendOf(id string) *Spend {
	for i := range r.Spends {
		if r.Spends[i].ID == id {
			return &r.Spends[i]
		}
	}
	return nil
}

// fightOf is spend.ts fightOf, ctx.fight: a fight runs, the actor is in it, the round, the actor is barred this round;
// and (house decision #116) it acts now, holds an action, and in the fight a combatant of another side acts now.
func fightOf(state *RuleState, id string) *Record {
	t := state.Turn
	if t == nil {
		return &Record{map[string]any{"on": false, "in": false, "round": 0.0, "barred": false,
			"acting": false, "held": false, "foeActing": false}}
	}
	in := slices.Contains(t.Order, id)
	acting := t.CurrentID != nil && *t.CurrentID == id
	return &Record{map[string]any{
		"on": true, "in": in, "round": t.Round, "barred": slices.Contains(t.Barred, id),
		"acting": acting, "held": slices.Contains(t.Held, id),
		"foeActing": in && t.CurrentID != nil && !acting && t.SideOf[*t.CurrentID] != t.SideOf[id],
	}}
}

// withCtx is the actor's scope with ctx set; the actor's own record is not changed.
func withCtx(scope *Record, ctx map[string]any) *Record {
	fields := maps.Clone(scope.Fields)
	fields["ctx"] = &Record{ctx}
	return &Record{fields}
}

// PlanSpend is spend.ts planSpend. The refusals are its: noSuchSpend, badInput, spendNotNow, cannotPay, usedThisRound (and
// unknownResource, unknownPool, wrongState for what cannot be read).
func PlanSpend(r *Ruleset, spendID string, actor *ActorState, state *RuleState, inputs map[string]any) (*SpendPlan, *Refusal) {
	spend := r.SpendOf(spendID)
	if spend == nil {
		return nil, refuse("noSuchSpend", `no spend "%s"`, spendID)
	}
	path := fmt.Sprintf("spends[%d]", slices.IndexFunc(r.Spends, func(s Spend) bool { return s.ID == spendID }))
	if actor.Entity == "" || (spend.Entities != nil && !slices.Contains(*spend.Entities, actor.Entity)) {
		return nil, refuse("noSuchSpend", `"%s" cannot spend "%s"`, actor.ID, spendID)
	}
	if actor.Scope == nil {
		return nil, refuse("wrongState", `"%s" has values that cannot be read yet`, actor.ID)
	}
	base := map[string]any{"self": actor.ID, "fight": fightOf(state, actor.ID)}
	for _, name := range sortedKeys(inputs) {
		if _, declared := spend.Inputs[name]; !declared {
			return nil, refuse("badInput", `"%s" is not an input`, name)
		}
	}
	ctx := maps.Clone(base)
	for _, name := range sortedKeys(spend.Inputs) {
		def := spend.Inputs[name]
		max, refusal := readNumber(def.Max, withCtx(actor.Scope, base), path+".inputs."+name+".max")
		if refusal != nil {
			return nil, refusal
		}
		v, isNumber := inputs[name].(float64)
		if !isNumber || v != math.Trunc(v) || v < def.Min || v > max {
			return nil, refuse("badInput", `"%s" must be a whole number from %s to %s`, name, esNumber(def.Min), esNumber(max))
		}
		ctx[name] = v
	}
	scope := withCtx(actor.Scope, ctx)
	if spend.If != nil {
		v, refusal := read(*spend.If, scope, path+".if")
		if refusal != nil {
			return nil, refusal
		}
		if v != true {
			return nil, refuse("spendNotNow", `"%s" cannot be done now`, spend.Label)
		}
	}
	plan := &SpendPlan{Costs: []PlannedCost{}, Run: []PlannedStep{}}
	if spend.Limit != nil {
		used, refusal := RoundUse(state.Turn, actor.ID, spendID, spend.Label, spend.Limit.Max)
		if refusal != nil {
			return nil, refusal
		}
		plan.Used = used
	}
	owed := map[string]float64{}
	for j, c := range spend.Cost {
		amount, refusal := readNumber(c.Amount, scope, fmt.Sprintf("%s.cost[%d].amount", path, j))
		if refusal != nil {
			return nil, refusal
		}
		if amount < 0 {
			return nil, refuse("badInput", "%s.cost[%d].amount is below 0", path, j)
		}
		if amount == 0 {
			continue
		}
		var res *ResourceState
		cost := PlannedCost{Amount: amount, ByRun: c.ByRun}
		key, name := "", ""
		if c.Pool != nil {
			cost.Pool, key, name, res = *c.Pool, "pool:"+*c.Pool, *c.Pool, state.pool(*c.Pool)
			if res == nil {
				return nil, refuse("unknownPool", `no pool "%s"`, name)
			}
		} else {
			name = ""
			if c.Resource != nil {
				name = *c.Resource
			}
			cost.Resource, key, res = name, "resource:"+name, actor.resource(name)
			if res == nil {
				return nil, refuse("unknownResource", `"%s" has no resource "%s"`, actor.ID, name)
			}
		}
		owed[key] += amount
		if res.Value-owed[key] < res.Min {
			return nil, refuse("cannotPay", `cannot pay from "%s"`, name)
		}
		plan.Costs = append(plan.Costs, cost)
	}
	for j, step := range spend.Run {
		input := map[string]any{}
		for _, key := range sortedKeys(step.Input) {
			source, isText := step.Input[key].(string)
			if !isText {
				input[key] = step.Input[key]
				continue
			}
			v, refusal := read(source, scope, fmt.Sprintf("%s.run[%d].input.%s", path, j, key))
			if refusal != nil {
				return nil, refusal
			}
			input[key] = v
		}
		plan.Run = append(plan.Run, PlannedStep{step.Primitive, step.Op, input})
	}
	return plan, nil
}
