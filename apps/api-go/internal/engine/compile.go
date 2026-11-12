package engine

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

var visibilityRank = map[string]int{"public": 0, "party": 1, "owner": 2, "gm": 3}

func strictestVisibility(list []string) string {
	out := "public"
	for _, v := range list {
		if visibilityRank[v] > visibilityRank[out] {
			out = v
		}
	}
	return out
}

type (
	// CompiledDerived is one derived value.
	CompiledDerived struct {
		ID, Label, Visibility string
		Expr                  *CompiledExpr
		// Deps holds the derived ids it reads.
		Deps []string
	}
	// CompiledEffect is one effect, attached to each entity it applies to.
	CompiledEffect struct {
		ConditionID, Phase, Mode string
		// Target is a field id (phase base) or derived id (phase derived).
		Target   string
		Priority float64
		Value    *CompiledExpr
		When     *CompiledExpr
	}
	// CompiledEntity is one entity type.
	CompiledEntity struct {
		Def *EntityType
		// Resources holds the entity-scoped resources it carries.
		Resources []string
		// Derived is in topological order: each one comes after everything it reads.
		Derived []CompiledDerived
		// Effects is in application order: priority, then condition id, then declaration order.
		Effects []CompiledEffect
		Scope   map[string]ExprType
	}
	// CompiledReset is one resetOn entry.
	CompiledReset struct {
		Event string
		To    *CompiledExpr
	}
	// CompiledResource is one resource.
	CompiledResource struct {
		Def      *Resource
		Min, Max *CompiledExpr
		ResetOn  []CompiledReset
	}
	// CompiledTest is one Test. Visibility maps go by actor type: the strictest of anything the expression reads.
	CompiledTest struct {
		Def                                  *Test
		Modifier, Target, Pool               *CompiledExpr
		ModifierVisibility, TargetVisibility map[string]string
	}
	// CompiledInitiative is ranked when Score is set, and seated otherwise.
	CompiledInitiative struct {
		Def      *Initiative
		Score    *CompiledExpr
		Tiebreak []*CompiledExpr
	}
	// CompiledScoring is a game's scoring.
	CompiledScoring struct {
		Def                *Scoring
		Score              *CompiledExpr
		Tiebreaks, EndWhen []*CompiledExpr
	}
	// CompiledHealthState is one display health state.
	CompiledHealthState struct {
		ID    string
		Label *string
		When  *CompiledExpr
	}
	// CompiledRuleset is a manifest ready for play.
	CompiledRuleset struct {
		Ruleset      *Ruleset
		Entities     map[string]*CompiledEntity
		Resources    map[string]*CompiledResource
		Conditions   map[string]*Condition
		Tests        map[string]*CompiledTest
		Initiative   *CompiledInitiative // nil when the manifest has no turn order
		Scoring      *CompiledScoring
		HealthStates []CompiledHealthState
		// InstantDeath goes by the track's resource id.
		InstantDeath map[string]*CompiledExpr
	}
)

// `party.*` reads only how many characters sit at the table, which every seat already sees.
//
// ponytail: only the character count today; party pools and averages join when a ruleset needs them.
var partyScope = RecordType{map[string]ExprType{"characters": intType}}

func fieldType(def FieldDef) ExprType {
	switch def.Type {
	case "int":
		return intType
	case "bool":
		return boolType
	case "list":
		return ListType{textType}
	}
	return textType
}

// Dotted field ids become a nested record type, so attr.str and attr[ctx.ability] both resolve.
func fieldScope(fields map[string]FieldDef) map[string]ExprType {
	out := map[string]ExprType{}
	groups := map[string]map[string]FieldDef{}
	for id, def := range fields {
		head, rest, dotted := strings.Cut(id, ".")
		if !dotted {
			out[id] = fieldType(def)
			continue
		}
		if groups[head] == nil {
			groups[head] = map[string]FieldDef{}
		}
		groups[head][rest] = def
	}
	// ValidateRuleset refuses a field that is also a group, so no group overwrites a leaf here.
	for head, sub := range groups {
		out[head] = RecordType{fieldScope(sub)}
	}
	return out
}

func carries(res *Resource, e *EntityType) bool {
	if res.Scope != "entity" {
		return false
	}
	if res.Entities == nil {
		return e.Base == "actor"
	}
	return slices.Contains(*res.Entities, e.ID)
}

// The visibility of a scope path: the strictest of every value it can reach.
func pathVisibility(ref string, e *EntityType, carried map[string]*Resource, derived map[string]string) string {
	prefix := ref
	// A computed index (attr.*) may reach anything under its prefix.
	if star := strings.IndexByte(ref, '*'); star >= 0 {
		prefix = ref[:max(0, star-1)]
	}
	root, rest, _ := strings.Cut(prefix, ".")
	switch root {
	case "party":
		return "party"
	case "ctx":
		return "public" // call-time inputs, supplied by whoever calls the Test
	case "derived":
		if rest != "" {
			if v, ok := derived[rest]; ok {
				return v
			}
			return "gm"
		}
		return strictestVisibility(slices.Collect(maps.Values(derived)))
	case "res":
		if rest != "" {
			if x, ok := carried[rest]; ok {
				return x.Visibility
			}
			return "gm"
		}
		all := make([]string, 0, len(carried))
		for _, x := range carried {
			all = append(all, x.Visibility)
		}
		return strictestVisibility(all)
	}
	var hits []string
	for id, def := range e.Fields {
		if id == prefix || strings.HasPrefix(id, prefix+".") || strings.HasPrefix(prefix, id+".") {
			hits = append(hits, def.Visibility)
		}
	}
	if len(hits) == 0 {
		return "gm"
	}
	return strictestVisibility(hits)
}

// Kahn's sort over derived ids: the order, or the ids left in a cycle. Ready nodes go in declaration order, so the
// result is stable across runs.
func topoSort(ids []string, deps map[string][]string) (order, cycle []string) {
	indegree := map[string]int{}
	users := map[string][]string{}
	for _, id := range ids {
		indegree[id] = len(deps[id])
		for _, dep := range deps[id] {
			users[dep] = append(users[dep], id)
		}
	}
	var ready []string
	for _, id := range ids {
		if indegree[id] == 0 {
			ready = append(ready, id)
		}
	}
	for len(ready) > 0 {
		id := ready[0]
		ready = ready[1:]
		order = append(order, id)
		for _, user := range users[id] {
			indegree[user]--
			if indegree[user] == 0 {
				ready = append(ready, user)
			}
		}
	}
	for _, id := range ids {
		if !slices.Contains(order, id) {
			cycle = append(cycle, id)
		}
	}
	return order, cycle
}

type compiler struct {
	problems problems
	r        *Ruleset
}

// Compile one source against every scope it must hold in; the first scope's result is kept (same AST).
func (c *compiler) expr(source string, scopes []map[string]ExprType, expect ExprType, path string) *CompiledExpr {
	var kept *CompiledExpr
	for _, scope := range scopes {
		compiled, err := CompileExpr(source, scope, expect)
		if err != nil {
			c.problems.add(path, "%s", err.Error())
			return nil
		}
		if kept == nil {
			kept = compiled
		}
	}
	return kept
}

func (c *compiler) actorEntities() []*EntityType {
	var out []*EntityType
	for i := range c.r.Entities {
		if c.r.Entities[i].Base == "actor" {
			out = append(out, &c.r.Entities[i])
		}
	}
	return out
}

func (c *compiler) carried(e *EntityType) (ids []string, byID map[string]*Resource) {
	byID = map[string]*Resource{}
	for i := range c.r.Resources {
		x := &c.r.Resources[i]
		if carries(x, e) {
			if _, seen := byID[x.ID]; !seen {
				ids = append(ids, x.ID)
			}
			byID[x.ID] = x
		}
	}
	return ids, byID
}

// The full scope for an entity: its fields, its derived values, its resources' current values, the party.
func (c *compiler) entityScope(e *EntityType, withDerived, withRes bool) map[string]ExprType {
	scope := fieldScope(e.Fields)
	scope["party"] = partyScope
	if withDerived {
		fields := map[string]ExprType{}
		for _, d := range e.Derived {
			fields[d.ID] = intType
		}
		scope["derived"] = RecordType{fields}
	}
	if withRes {
		ids, _ := c.carried(e)
		fields := map[string]ExprType{}
		for _, id := range ids {
			fields[id] = intType
		}
		scope["res"] = RecordType{fields}
	}
	return scope
}

// Refs that are fields of e no creation step writes, when the ruleset builds e at all. A ref only read inside has() is
// flagged too.
//
// ponytail: refs do not tell has() apart, split them in the checker if a ruleset needs it.
func (c *compiler) unsetByCreation(e *EntityType, refs []string) []string {
	written := map[string]bool{}
	built := false
	for _, s := range c.r.Creation {
		if s.Actor != e.ID {
			continue
		}
		built = true
		if s.Kind == "choose" {
			for _, rule := range s.Copy {
				written[rule.To] = true
			}
		} else {
			for _, f := range s.Fields {
				written[f] = true
			}
		}
	}
	if !built {
		return nil
	}
	var out []string
	for _, ref := range refs {
		if _, isField := e.Fields[ref]; isField && !written[ref] {
			out = append(out, ref)
		}
	}
	return out
}

func (c *compiler) entity(e *EntityType, index int) *CompiledEntity {
	scope := c.entityScope(e, true, true)
	before := len(c.problems)
	scopes := []map[string]ExprType{scope}
	exprs := map[string]*CompiledExpr{}
	defs := map[string]int{}
	deps := map[string][]string{}
	var ids []string
	for j, d := range e.Derived {
		path := fmt.Sprintf("entities[%d].derived[%d].expr", index, j)
		expr := c.expr(d.Expr, scopes, intType, path)
		if expr == nil {
			continue
		}
		for _, ref := range c.unsetByCreation(e, expr.Refs) {
			c.problems.add(path, `creation never sets "%s", which this reads; add it to a creation step`, ref)
		}
		var read []string
		for _, ref := range expr.Refs {
			if ref == "derived.*" || ref == "derived" {
				for _, x := range e.Derived {
					read = append(read, x.ID)
				}
			} else if rest, ok := strings.CutPrefix(ref, "derived."); ok {
				head, _, _ := strings.Cut(rest, ".")
				read = append(read, head)
			}
		}
		if _, seen := exprs[d.ID]; !seen {
			ids = append(ids, d.ID)
		}
		exprs[d.ID], defs[d.ID] = expr, j
		deps[d.ID] = unique(read)
	}
	if len(c.problems) > before {
		return nil
	}
	order, cycle := topoSort(ids, deps)
	if len(cycle) > 0 {
		c.problems.add(fmt.Sprintf("entities[%d].derived", index), "derived values form a cycle: %s", strings.Join(cycle, ", "))
		return nil
	}
	// Taint: a derived value is as hidden as its most hidden input; declaring it looser is a load error.
	visibility := map[string]string{}
	var derived []CompiledDerived
	carriedIDs, carried := c.carried(e)
	for _, id := range order {
		expr, def := exprs[id], e.Derived[defs[id]]
		inputs := make([]string, len(expr.Refs))
		for i, ref := range expr.Refs {
			inputs[i] = pathVisibility(ref, e, carried, visibility)
		}
		taint := strictestVisibility(inputs)
		if visibilityRank[def.Visibility] < visibilityRank[taint] {
			c.problems.add(fmt.Sprintf("entities[%d].derived[%d].visibility", index, firstDerived(e, def.ID)),
				`declared "%s" but reads "%s" values`, def.Visibility, taint)
		}
		visibility[id] = def.Visibility
		derived = append(derived, CompiledDerived{id, def.Label, def.Visibility, expr, deps[id]})
	}
	return &CompiledEntity{Def: e, Resources: carriedIDs, Derived: derived, Scope: scope}
}

func firstDerived(e *EntityType, id string) int {
	return slices.IndexFunc(e.Derived, func(d DerivedDef) bool { return d.ID == id })
}

func unique(items []string) []string {
	out := []string{}
	for _, item := range items {
		if !slices.Contains(out, item) {
			out = append(out, item)
		}
	}
	return out
}

func (c *compiler) effects(entities map[string]*CompiledEntity) {
	for i := range c.r.Conditions {
		cond := &c.r.Conditions[i]
		for j := range cond.Effects {
			c.effect(entities, cond, &cond.Effects[j], fmt.Sprintf("conditions[%d].effects[%d]", i, j))
		}
	}
	// Stable sort keeps declaration order within one condition.
	for _, ce := range entities {
		slices.SortStableFunc(ce.Effects, func(a, b CompiledEffect) int {
			if a.Priority != b.Priority {
				if a.Priority < b.Priority {
					return -1
				}
				return 1
			}
			return compareUnits(a.ConditionID, b.ConditionID)
		})
	}
}

func (c *compiler) effect(entities map[string]*CompiledEntity, cond *Condition, eff *Effect, path string) {
	target := eff.Path
	if eff.Phase == "derived" {
		rest, ok := strings.CutPrefix(eff.Path, "derived.")
		if !ok {
			c.problems.add(path+".path", `a derived-phase effect targets "derived.<id>"`)
			return
		}
		target = rest
	}
	// An effect applies to the actor types that have its target; it must reach at least one. Hosts come from the
	// definitions, so an entity that failed to compile (already reported) does not cascade a second error.
	var hosts []*CompiledEntity
	declared := 0
	for _, e := range c.actorEntities() {
		has := e.Fields[target].Type == "int"
		if eff.Phase == "derived" {
			has = firstDerived(e, target) >= 0
		}
		if !has {
			continue
		}
		declared++
		if ce, ok := entities[e.ID]; ok {
			hosts = append(hosts, ce)
		}
	}
	if declared == 0 {
		c.problems.add(path+".path", `no actor has an integer "%s"`, eff.Path)
		return
	}
	if len(hosts) == 0 {
		return
	}
	// Base effects run before derived values exist, so they cannot read them.
	scopes := make([]map[string]ExprType, len(hosts))
	for i, h := range hosts {
		scopes[i] = h.Scope
		if eff.Phase == "base" {
			scopes[i] = c.entityScope(h.Def, false, true)
		}
	}
	value := c.expr(eff.Value, scopes, intType, path+".value")
	var when *CompiledExpr
	if eff.When != nil {
		when = c.expr(*eff.When, scopes, boolType, path+".when")
	}
	if value == nil || (eff.When != nil && when == nil) {
		return
	}
	for _, h := range hosts {
		// Same rule as a derived value: the target shows the effect's inputs and that the condition is on, so it must be
		// at least as hidden as all of them.
		targetVis := "gm"
		derivedVis := map[string]string{}
		for _, d := range h.Derived {
			derivedVis[d.ID] = d.Visibility
		}
		if eff.Phase == "derived" {
			if v, ok := derivedVis[target]; ok {
				targetVis = v
			}
		} else if def, ok := h.Def.Fields[target]; ok {
			targetVis = def.Visibility
		}
		_, carried := c.carried(h.Def)
		inputs := []string{cond.Visibility}
		for _, ref := range value.Refs {
			inputs = append(inputs, pathVisibility(ref, h.Def, carried, derivedVis))
		}
		if when != nil {
			for _, ref := range when.Refs {
				inputs = append(inputs, pathVisibility(ref, h.Def, carried, derivedVis))
			}
		}
		taint := strictestVisibility(inputs)
		if visibilityRank[targetVis] < visibilityRank[taint] {
			c.problems.add(path+".path", `"%s" on %s is "%s" but the effect reveals "%s" values`, eff.Path, h.Def.ID, targetVis, taint)
			continue
		}
		priority := 0.0
		if eff.Priority != nil {
			priority = *eff.Priority
		}
		h.Effects = append(h.Effects, CompiledEffect{cond.ID, eff.Phase, eff.Mode, target, priority, value, when})
	}
}

func (c *compiler) resource(x *Resource, i int) *CompiledResource {
	var scopes []map[string]ExprType
	if x.Scope == "entity" {
		for j := range c.r.Entities {
			if carries(x, &c.r.Entities[j]) {
				// A bound never reads a current value (res): bounds would move with play and could chase each other.
				scopes = append(scopes, c.entityScope(&c.r.Entities[j], true, false))
			}
		}
	} else {
		scopes = []map[string]ExprType{{"party": partyScope}}
	}
	if len(scopes) == 0 {
		c.problems.add(fmt.Sprintf("resources[%d].entities", i), "no entity carries this resource")
		return nil
	}
	lo := c.expr(x.Min, scopes, intType, fmt.Sprintf("resources[%d].min", i))
	var hi *CompiledExpr
	if x.Max != nil {
		hi = c.expr(*x.Max, scopes, intType, fmt.Sprintf("resources[%d].max", i))
	}
	resetScopes := make([]map[string]ExprType, len(scopes))
	for j, s := range scopes {
		copied := maps.Clone(s)
		copied["min"] = intType
		if x.Max != nil {
			copied["max"] = intType
		}
		resetScopes[j] = copied
	}
	var resets []CompiledReset
	for j, reset := range x.ResetOn {
		if to := c.expr(reset.To, resetScopes, intType, fmt.Sprintf("resources[%d].resetOn[%d].to", i, j)); to != nil {
			resets = append(resets, CompiledReset{reset.Event, to})
		}
	}
	if lo == nil || (x.Max != nil && hi == nil) {
		return nil
	}
	return &CompiledResource{x, lo, hi, resets}
}

func withScope(scopes []map[string]ExprType, key string, t ExprType) []map[string]ExprType {
	out := make([]map[string]ExprType, len(scopes))
	for i, s := range scopes {
		out[i] = maps.Clone(s)
		out[i][key] = t
	}
	return out
}

// ok is false when the scoring block did not compile; the problems are recorded.
func (c *compiler) scoring(scopes []map[string]ExprType) (compiled *CompiledScoring, ok bool) {
	def := c.r.Scoring
	if def == nil {
		return nil, true
	}
	ok = true
	need := func(e *CompiledExpr) *CompiledExpr {
		ok = ok && e != nil
		return e
	}
	out := &CompiledScoring{Def: def, Score: need(c.expr(def.Score, scopes, intType, "scoring.score"))}
	for i, t := range def.Tiebreaks {
		out.Tiebreaks = append(out.Tiebreaks, need(c.expr(t.Expr, scopes, intType, fmt.Sprintf("scoring.tiebreaks[%d].expr", i))))
	}
	withRound := withScope(scopes, "round", intType)
	for i, t := range def.EndWhen {
		out.EndWhen = append(out.EndWhen, need(c.expr(t.When, withRound, boolType, fmt.Sprintf("scoring.endWhen[%d].when", i))))
	}
	return out, ok
}

func (c *compiler) test(id string, t *Test, entities map[string]*CompiledEntity, actorScopes []map[string]ExprType) *CompiledTest {
	inputs := map[string]ExprType{}
	for k, v := range t.Inputs {
		inputs[k] = Scalar(v)
	}
	scopes := withScope(actorScopes, "ctx", RecordType{inputs})
	path := "tests." + id
	// A reported Test has no numbers: the constant 0 keeps every reader of a compiled Test one shape.
	modSource, targetSource := t.Modifier, t.Target
	if t.Kind == "reported" {
		modSource, targetSource = "0", "0"
	}
	modifier := c.expr(modSource, scopes, intType, path+".modifier")
	target := c.expr(targetSource, scopes, intType, path+".target")
	var pool *CompiledExpr
	if t.Kind == "poolSuccesses" {
		pool = c.expr(t.Pool, scopes, intType, path+".pool")
	}
	if modifier == nil || target == nil || (t.Kind == "poolSuccesses" && pool == nil) {
		return nil
	}
	// A value the call computes for an actor is as hidden as its most hidden input, like a derived value.
	seen := func(exprs ...*CompiledExpr) map[string]string {
		out := map[string]string{}
		for _, e := range c.actorEntities() {
			ce, ok := entities[e.ID]
			if !ok {
				continue
			}
			_, carried := c.carried(e)
			derived := map[string]string{}
			for _, d := range ce.Derived {
				derived[d.ID] = d.Visibility
			}
			var refs []string
			for _, expr := range exprs {
				for _, ref := range expr.Refs {
					refs = append(refs, pathVisibility(ref, e, carried, derived))
				}
			}
			out[e.ID] = strictestVisibility(refs)
		}
		return out
	}
	modifierVisibility := seen(modifier)
	if pool != nil {
		modifierVisibility = seen(modifier, pool)
	}
	return &CompiledTest{t, modifier, target, pool, modifierVisibility, seen(target)}
}

func (c *compiler) run() *CompiledRuleset {
	entities := map[string]*CompiledEntity{}
	for i := range c.r.Entities {
		if ce := c.entity(&c.r.Entities[i], i); ce != nil {
			entities[c.r.Entities[i].ID] = ce
		}
	}
	c.effects(entities)

	resources := map[string]*CompiledResource{}
	for i := range c.r.Resources {
		if cr := c.resource(&c.r.Resources[i], i); cr != nil {
			resources[c.r.Resources[i].ID] = cr
		}
	}

	var actorScopes []map[string]ExprType
	for _, e := range c.actorEntities() {
		if ce, ok := entities[e.ID]; ok {
			actorScopes = append(actorScopes, ce.Scope)
		}
	}
	if len(actorScopes) == 0 {
		c.problems.add("entities", "no actor entity type")
	}

	tests := map[string]*CompiledTest{}
	for _, id := range sortedKeys(c.r.Tests) {
		t := c.r.Tests[id]
		if ct := c.test(id, &t, entities, actorScopes); ct != nil {
			tests[id] = ct
		}
	}

	var init *CompiledInitiative
	if def := c.r.Initiative; def != nil {
		init = &CompiledInitiative{Def: def}
		if def.Strategy == "ranked" {
			init.Score = c.expr(def.Score, actorScopes, intType, "initiative.score")
			for j, src := range def.Tiebreak {
				if e := c.expr(src, actorScopes, intType, fmt.Sprintf("initiative.tiebreak[%d]", j)); e != nil {
					init.Tiebreak = append(init.Tiebreak, e)
				}
			}
		}
	}

	scoring, scoringOK := c.scoring(actorScopes)
	var healthStates []CompiledHealthState
	for j, s := range c.r.Health.States {
		if when := c.expr(s.When, actorScopes, boolType, fmt.Sprintf("health.states[%d].when", j)); when != nil {
			healthStates = append(healthStates, CompiledHealthState{s.ID, s.Label, when})
		}
	}
	instantDeath := map[string]*CompiledExpr{}
	for j, t := range c.r.Health.Tracks {
		if t.InstantDeathOverflow == nil {
			continue
		}
		path := fmt.Sprintf("health.tracks[%d].instantDeathOverflow", j)
		if e := c.expr(*t.InstantDeathOverflow, actorScopes, intType, path); e != nil {
			instantDeath[t.Resource] = e
		}
	}

	if len(c.problems) > 0 || !scoringOK || (init != nil && init.Def.Strategy == "ranked" && init.Score == nil) {
		return nil
	}
	conditions := map[string]*Condition{}
	for i := range c.r.Conditions {
		conditions[c.r.Conditions[i].ID] = &c.r.Conditions[i]
	}
	return &CompiledRuleset{c.r, entities, resources, conditions, tests, init, scoring, healthStates, instantDeath}
}

// CompileRuleset loads a manifest given as decoded JSON: validate it, then compile every expression against its scope,
// sort each entity's derived values and check their visibility taint. Every problem comes back with its path; nothing
// half-compiled is returned.
func CompileRuleset(input any) (*CompiledRuleset, []Problem) {
	r, found := ValidateRuleset(input)
	if len(found) > 0 {
		return nil, found
	}
	c := &compiler{r: r}
	compiled := c.run()
	if compiled == nil {
		return nil, c.problems
	}
	return compiled, nil
}
