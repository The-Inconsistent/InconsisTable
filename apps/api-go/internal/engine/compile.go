package engine

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
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
		// Override is the int field whose value, when set, replaces the worked-out one (house decision #96); "" when none.
		Override string
	}
	// CompiledEffect is one effect, attached to each entity it applies to.
	CompiledEffect struct {
		// SourceID is the condition id, or <type>/<key> of the pack entry the effect comes from.
		SourceID, Phase, Mode string
		// Target is a field id (phase base) or derived id (phase derived).
		Target   string
		Priority float64
		Value    *CompiledExpr
		When     *CompiledExpr
	}
	// ActiveEntry is a pack entry an actor chose and what it adds (house decision #61).
	ActiveEntry struct {
		Type, Key, Name string
		Effects         []Effect
	}
	// CompiledEntity is one entity type.
	CompiledEntity struct {
		Def *EntityType
		// Resources holds the entity-scoped resources it carries.
		Resources []string
		// Derived is in topological order: each one comes after everything it reads.
		Derived []CompiledDerived
		// Effects holds the conditions' effects in application order: priority, then source id, then declaration order.
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
		Start    *CompiledExpr
	}
	// CompiledTest is one Test. Visibility maps go by actor type: the strictest of anything the expression reads.
	CompiledTest struct {
		Def *Test
		// Offers are the Test's offers (house decision #80); empty without any.
		Offers                               []CompiledOffer
		Modifier, Target, Pool               *CompiledExpr
		ModifierVisibility, TargetVisibility map[string]string
		// OfferVisibility is who may be told what the offers work out on a taker (house decision #170).
		OfferVisibility map[string]string
	}
	// CompiledOffer is one offer of a Test: When reads `result` and `ctx`, each change's By the taker's scope too.
	CompiledOffer struct {
		Def     *TestOffer
		When    *CompiledExpr
		Changes []CompiledChange
	}
	// CompiledChange is one write of an offer: Pool or Resource is set.
	CompiledChange struct {
		Pool, Resource *string
		By             *CompiledExpr
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
		// Entities is the actor types the state applies to; nil is every actor type.
		Entities *[]string
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
		// Build is the ledger builder's actor type, parsed params and catalogue kinds (house decision #62), for
		// ledger.Resolve without parsing again; nil when the ruleset has none.
		Build *CompiledBuild
		// Notices are the notice rules (house decision #79) in the manifest's order; empty without a notices block.
		Notices []CompiledNotice
		// Reminders is each of `reminders`' `if` in manifest order, nil where it has none (house decision #81).
		Reminders []*CompiledExpr
		// Immune is each condition's `immune`, by condition id, for those that have one (house decision #81).
		Immune map[string]*CompiledExpr
		// Lookups is every table with a die, by table id, as a typed result reads it (house decision #87).
		Lookups map[string]*CompiledLookup
	}
	// CompiledLookup is a table with a die: its modifier, and each line's effects by index (compile.ts CompiledLookup).
	CompiledLookup struct {
		Modifier *CompiledExpr
		Effects  [][]CompiledTableEffect
		// Maxes are the steppers' maxes written as expressions, by input id, over `pools` and `campaign` (#192).
		Maxes map[string]*CompiledExpr
	}
	// CompiledTableEffect is one effect of a lookup line, its expressions compiled over the target and the inputs; nil
	// where the effect has none.
	CompiledTableEffect struct {
		Def                            *TableEffect
		When, Times, Wounds, Shock, By *CompiledExpr
	}
	// CompiledNotice is one notice rule, with who may be told its If by actor type, as a Test's numbers are.
	CompiledNotice struct {
		ID, When string
		// Entities is the actor types it reads; nil is every actor type.
		Entities *[]string
		If       *CompiledExpr
		Text     string
		// Params, Group and Rises are house decision #168: Params empty without any, Group "" and Rises nil without.
		Params map[string]*CompiledExpr
		Group  string
		Rises  *CompiledExpr
		// Visibility is who may be told it: the strictest of what If, Params and Rises read.
		Visibility map[string]string
	}
	// CompiledBuild is what a caller hands the ledger builder.
	CompiledBuild struct {
		Actor  string
		Params *ledger.Params
		// Kinds is the entity type that holds each kind of record, by kind (LedgerKinds).
		Kinds map[string]string
	}
)

// `party.*` reads only how many characters sit at the table, which every seat already sees.
//
// ponytail: only the character count today; party pools and averages join when a ruleset needs them.
var partyScope = RecordType{map[string]ExprType{"characters": intType}}

// The campaign root: one member per declared field, typed as the field reads. Nil when the manifest declares none.
func campaignScope(r *Ruleset) ExprType {
	if r.CampaignFields == nil {
		return nil
	}
	fields := make(map[string]ExprType, len(r.CampaignFields))
	for id, def := range r.CampaignFields {
		switch def.Type {
		case "int":
			fields[id] = intType
		case "bool":
			fields[id] = boolType
		default:
			fields[id] = textType
		}
	}
	return RecordType{fields}
}

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
	case "party", "campaign": // campaign.* is a value of the whole table, shown to every seat like the party's size
		return "party"
	case "ctx":
		return "public" // call-time inputs, supplied by whoever calls the Test
	case "result":
		return "public" // a taker's report, as an offer reads it: the call decides what of it a seat is told (#170)
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
	if campaign := campaignScope(c.r); campaign != nil {
		scope["campaign"] = campaign
	}
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
		elsewhere := map[string]ExprType{}
		for _, x := range c.r.Resources {
			if _, carried := fields[x.ID]; !carried {
				elsewhere[x.ID] = intType
			}
		}
		scope[resElsewhere] = RecordType{elsewhere}
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
		// An unset list reads as empty (house decision #91), so creation need not write one.
		if def, isField := e.Fields[ref]; isField && def.Type != "list" && !written[ref] {
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
		refs := expr.Refs
		override := ""
		if def.Override != nil {
			override = *def.Override
			refs = append(slices.Clone(refs), override)
			if f, has := e.Fields[override]; !has || f.Type != "int" {
				c.problems.add(fmt.Sprintf("entities[%d].derived[%d].override", index, firstDerived(e, def.ID)),
					`"%s" is not an int field of %s`, override, e.ID)
			}
		}
		inputs := make([]string, len(refs))
		for i, ref := range refs {
			inputs[i] = pathVisibility(ref, e, carried, visibility)
		}
		taint := strictestVisibility(inputs)
		if visibilityRank[def.Visibility] < visibilityRank[taint] {
			c.problems.add(fmt.Sprintf("entities[%d].derived[%d].visibility", index, firstDerived(e, def.ID)),
				`declared "%s" but reads "%s" values`, def.Visibility, taint)
		}
		visibility[id] = def.Visibility
		derived = append(derived, CompiledDerived{id, def.Label, def.Visibility, expr, deps[id], override})
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

// EntrySourceID is an entry's source id in the application order: <type>/<key>.
func EntrySourceID(e ActiveEntry) string { return e.Type + "/" + e.Key }

// compareEffects is the application order: priority, then source id. Callers sort stably, so declaration order holds
// within one source.
func compareEffects(a, b CompiledEffect) int {
	if a.Priority != b.Priority {
		if a.Priority < b.Priority {
			return -1
		}
		return 1
	}
	return compareUnits(a.SourceID, b.SourceID)
}

func (c *compiler) effects(entities map[string]*CompiledEntity) {
	for i := range c.r.Conditions {
		cond := &c.r.Conditions[i]
		for j := range cond.Effects {
			eff := &cond.Effects[j]
			noHost := fmt.Sprintf(`no actor has an integer "%s"`, eff.Path)
			for _, h := range c.effect(entities, eff, fmt.Sprintf("conditions[%d].effects[%d]", i, j), cond.ID, cond.Visibility, c.actorEntities(), noHost) {
				h.host.Effects = append(h.host.Effects, h.effect)
			}
		}
	}
	// A spawn option's effects run with the conditions' (house decision #92); only the GM side is told an actor has one.
	if s := c.r.Spawn; s != nil {
		for i := range s.Options {
			o := &s.Options[i]
			for j := range o.Effects {
				eff := &o.Effects[j]
				noHost := fmt.Sprintf(`no actor it applies to has an integer "%s"`, eff.Path)
				for _, h := range c.effect(entities, eff, fmt.Sprintf("spawn.options[%d].effects[%d]", i, j), SpawnSourceID(o.ID), "gm", c.spawnOf(o.Entities), noHost) {
					h.host.Effects = append(h.host.Effects, h.effect)
				}
			}
		}
	}
	// Stable sort keeps declaration order within one condition.
	for _, ce := range entities {
		slices.SortStableFunc(ce.Effects, compareEffects)
	}
}

type hostEffect struct {
	host   *CompiledEntity
	effect CompiledEffect
}

// entryEffects compiles the effects of entries against the actor types pool; problems carry pathOf(entry, effect).
func (c *compiler) entryEffects(entities map[string]*CompiledEntity, entries []ActiveEntry, pool []*EntityType, pathOf func(entry, effect int) string) []hostEffect {
	ids := make([]string, len(pool))
	for i, e := range pool {
		ids[i] = e.ID
	}
	var out []hostEffect
	for i, entry := range entries {
		for j := range entry.Effects {
			eff := &entry.Effects[j]
			if strings.HasPrefix(eff.Path, HostPrefix) {
				c.hostEffect(eff, entry.Type, pathOf(i, j))
				continue
			}
			noHost := fmt.Sprintf(`%s has no integer "%s"`, strings.Join(ids, ", "), eff.Path)
			// The entry's own visibility is who may read its page; what it adds to a number is the same for every seat.
			out = append(out, c.effect(entities, eff, pathOf(i, j), EntrySourceID(entry), "public", pool, noHost)...)
		}
	}
	return out
}

// effect compiles one effect of a condition or an entry against the actor types pool that may host it, returning it
// for each host it holds for. Problems are recorded; an effect that fails compiles to nothing.
func (c *compiler) effect(entities map[string]*CompiledEntity, eff *Effect, path, sourceID, sourceVisibility string, pool []*EntityType, noHost string) []hostEffect {
	target := eff.Path
	if eff.Phase == "derived" {
		rest, ok := strings.CutPrefix(eff.Path, "derived.")
		if !ok {
			c.problems.add(path+".path", `a derived-phase effect targets "derived.<id>"`)
			return nil
		}
		target = rest
	}
	// An effect applies to the actor types that have its target; it must reach at least one. Hosts come from the
	// definitions, so an entity that failed to compile (already reported) does not cascade a second error.
	var hosts []*CompiledEntity
	declared := 0
	for _, e := range pool {
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
		c.problems.add(path+".path", "%s", noHost)
		return nil
	}
	if len(hosts) == 0 {
		return nil
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
		return nil
	}
	var out []hostEffect
	for _, h := range hosts {
		// Same rule as a derived value: the target shows the effect's inputs and that its source is on, so it must be
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
		inputs := []string{sourceVisibility}
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
		out = append(out, hostEffect{h, CompiledEffect{sourceID, eff.Phase, eff.Mode, target, priority, value, when}})
	}
	return out
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
		scope := map[string]ExprType{"party": partyScope}
		if campaign := campaignScope(c.r); campaign != nil {
			scope["campaign"] = campaign
		}
		scopes = []map[string]ExprType{scope}
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
	var start *CompiledExpr
	if x.Start != nil {
		start = c.expr(*x.Start, resetScopes, intType, fmt.Sprintf("resources[%d].start", i))
	}
	if lo == nil || (x.Max != nil && hi == nil) {
		return nil
	}
	return &CompiledResource{x, lo, hi, resets, start}
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

// spendCtx is `ctx.self` and `ctx.fight` in a spend's and a panel's expressions (compile.ts SPEND_CTX, house decisions
// #84, #114, #116).
var spendCtx = map[string]ExprType{
	"self": textType,
	"fight": RecordType{map[string]ExprType{
		"on": boolType, "in": boolType, "round": intType, "barred": boolType,
		"acting": boolType, "held": boolType, "foeActing": boolType,
	}},
}

// Spawn scopes (compile.ts SPAWN_PARTY_SCOPE, SPAWN_CTX, BUDGET_COST_CTX; house decision #92).
var (
	spawnPartyScope = RecordType{map[string]ExprType{"characters": intType, "seated": intType}}
	spawnCtx        = map[string]ExprType{"mob": boolType}
	budgetCostCtx   = map[string]ExprType{"count": intType, "mob": boolType}
)

// SpawnSourceID is compile.ts spawnSourceId: a spawn option's effects' source id.
func SpawnSourceID(optionID string) string { return "spawn/" + optionID }

// roomScope is what a spawn reads of the room: campaign, and party with seated.
func (c *compiler) roomScope() map[string]ExprType {
	scope := map[string]ExprType{"party": spawnPartyScope}
	if campaign := campaignScope(c.r); campaign != nil {
		scope["campaign"] = campaign
	}
	return scope
}

// spawnOf is the actor types ids names, or every one.
func (c *compiler) spawnOf(ids *[]string) []*EntityType {
	var out []*EntityType
	for _, e := range c.actorEntities() {
		if ids == nil || slices.Contains(*ids, e.ID) {
			out = append(out, e)
		}
	}
	return out
}

// spawn is compile.ts Compiler.spawn (house decision #92).
func (c *compiler) spawn() {
	s := c.r.Spawn
	if s == nil {
		return
	}
	scopesOf := func(types []*EntityType, ctx map[string]ExprType) []map[string]ExprType {
		out := []map[string]ExprType{}
		for _, e := range types {
			scope := fieldScope(e.Fields)
			maps.Copy(scope, c.roomScope())
			scope["ctx"] = RecordType{ctx}
			out = append(out, scope)
		}
		return out
	}
	for i, o := range s.Options {
		if o.When != nil {
			c.expr(*o.When, scopesOf(c.spawnOf(o.Entities), spawnCtx), boolType, fmt.Sprintf("spawn.options[%d].when", i))
		}
	}
	for i, a := range s.Adjust {
		scopes := scopesOf(c.spawnOf(a.Entities), spawnCtx)
		if a.When != nil {
			c.expr(*a.When, scopes, boolType, fmt.Sprintf("spawn.adjust[%d].when", i))
		}
		for _, key := range sortedKeys(a.Add) {
			c.expr(a.Add[key], scopes, intType, fmt.Sprintf("spawn.adjust[%d].add.%s", i, key))
		}
	}
	if s.Budget == nil {
		return
	}
	built := map[string]bool{}
	for _, step := range c.r.Creation {
		built[step.Actor] = true
	}
	var spawned []*EntityType
	for _, e := range c.actorEntities() {
		if !built[e.ID] {
			spawned = append(spawned, e)
		}
	}
	if len(spawned) == 0 {
		spawned = c.actorEntities()
	}
	costScopes := scopesOf(spawned, budgetCostCtx)
	for i, l := range s.Budget.Lines {
		c.expr(l.Cost, costScopes, intType, fmt.Sprintf("spawn.budget.lines[%d].cost", i))
		c.expr(l.Budget, []map[string]ExprType{c.roomScope()}, intType, fmt.Sprintf("spawn.budget.lines[%d].budget", i))
	}
	for i, w := range s.Budget.Switches {
		scope := c.roomScope()
		scope["ctx"] = RecordType{map[string]ExprType{"budget": intType}}
		c.expr(w.By, []map[string]ExprType{scope}, intType, fmt.Sprintf("spawn.budget.switches[%d].by", i))
	}
}

// spends is compile.ts Compiler.spends: every expression in the scope of each actor type that may spend it plus ctx,
// and every run op one of a primitive the ruleset declares, its input keys that op's.
func (c *compiler) spends(entities map[string]*CompiledEntity) {
	declared := DeclaredPrimitives(c.r)
	for i, s := range c.r.Spends {
		path := fmt.Sprintf("spends[%d]", i)
		_, bases := c.actorsOf(s.Entities, entities)
		scopes := func(withInputs bool) []map[string]ExprType {
			ctx := maps.Clone(spendCtx)
			if withInputs {
				for name := range s.Inputs {
					ctx[name] = intType
				}
			}
			return withScope(bases, "ctx", RecordType{ctx})
		}
		for _, name := range sortedKeys(s.Inputs) {
			c.expr(s.Inputs[name].Max, scopes(false), intType, path+".inputs."+name+".max")
		}
		if s.If != nil {
			c.expr(*s.If, scopes(true), boolType, path+".if")
		}
		if s.Then != nil && s.Then.If != nil {
			c.expr(*s.Then.If, scopes(true), boolType, path+".then.if")
		}
		for j, cost := range s.Cost {
			c.expr(cost.Amount, scopes(true), intType, fmt.Sprintf("%s.cost[%d].amount", path, j))
		}
		for j, step := range s.Run {
			at := fmt.Sprintf("%s.run[%d]", path, j)
			if !slices.Contains(declared, step.Primitive) {
				c.problems.add(at+".primitive", `"%s" is not declared by this ruleset`, step.Primitive)
				continue
			}
			keys, known := OpInputKeys(step.Primitive, step.Op)
			if !known {
				c.problems.add(at+".op", `"%s" has no op "%s"`, step.Primitive, step.Op)
				continue
			}
			for _, key := range sortedKeys(step.Input) {
				if !slices.Contains(keys, key) {
					c.problems.add(at+".input."+key, `"%s" is not an input`, key)
				} else if source, isText := step.Input[key].(string); isText {
					c.expr(source, scopes(true), nil, at+".input."+key)
				}
			}
		}
	}
}

// actorsOf is the compiled actor types a Test or a health state applies to: the ones it names, or all of them.
func (c *compiler) actorsOf(ids *[]string, entities map[string]*CompiledEntity) (types []*EntityType, scopes []map[string]ExprType) {
	for _, e := range c.actorEntities() {
		ce, ok := entities[e.ID]
		if !ok || (ids != nil && !slices.Contains(*ids, e.ID)) {
			continue
		}
		types = append(types, e)
		scopes = append(scopes, ce.Scope)
	}
	return types, scopes
}

// seenBy is, by actor type, the strictest visibility of anything the expressions read: who may be told what they say.
func (c *compiler) seenBy(takers []*EntityType, entities map[string]*CompiledEntity, exprs []*CompiledExpr) map[string]string {
	out := map[string]string{}
	for _, e := range takers {
		ce := entities[e.ID]
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

// NoticeBuildScope is what a notice reads of a ledger actor's play as `build` (house decision #168; compile.ts
// NOTICE_BUILD_SCOPE).
var NoticeBuildScope = RecordType{map[string]ExprType{"xpSpent": intType, "xpAtAscension": intType}}

// NoticeRoseScope is a rising rule's `ctx` in its params: how far its number rose in the action (house decision #174).
var NoticeRoseScope = RecordType{map[string]ExprType{"rose": intType}}

// ResultScope is what an offer reads of a taker's resolved report as `result` (house decision #80; compile.ts
// RESULT_SCOPE): a number the kind of Test has not is 0.
var ResultScope = func() ExprType {
	flags := map[string]ExprType{}
	for _, f := range poolFlags {
		flags[f] = boolType
	}
	return RecordType{map[string]ExprType{
		"passed": boolType, "outcome": textType, "total": intType, "margin": intType, "shifts": intType, "natural": intType,
		"target": intType, "flags": RecordType{flags},
	}}
}()

func (c *compiler) test(id string, t *Test, entities map[string]*CompiledEntity) *CompiledTest {
	inputs := map[string]ExprType{}
	for k, v := range t.Inputs {
		inputs[k] = Scalar(v)
	}
	// A mark reads as a yes-or-no input (house decision #80).
	for k := range t.Marks {
		inputs[k] = boolType
	}
	// A choice the taker sets when reporting (house decision #170) is read by the target and the offers only.
	taken := maps.Clone(inputs)
	for k, ch := range t.Choices {
		taken[k] = boolType
		if ch.Max != nil {
			taken[k] = intType
		}
	}
	takers, actorScopes := c.actorsOf(t.Entities, entities)
	scopes := withScope(actorScopes, "ctx", RecordType{inputs})
	takenScopes := withScope(actorScopes, "ctx", RecordType{taken})
	path := "tests." + id
	// A reported Test has no numbers: the constant 0 keeps every reader of a compiled Test one shape.
	modSource, targetSource := t.Modifier, t.Target
	if t.Kind == "reported" {
		modSource, targetSource = "0", "0"
	}
	modifier := c.expr(modSource, scopes, intType, path+".modifier")
	target := c.expr(targetSource, takenScopes, intType, path+".target")
	var pool *CompiledExpr
	if t.Kind == "poolSuccesses" {
		pool = c.expr(t.Pool, scopes, intType, path+".pool")
	}
	if modifier == nil || target == nil || (t.Kind == "poolSuccesses" && pool == nil) {
		return nil
	}
	offers := []CompiledOffer{}
	whole := true
	for i := range t.Offers {
		o := &t.Offers[i]
		at := fmt.Sprintf("%s.offers[%d]", path, i)
		when := c.expr(o.When, []map[string]ExprType{{"ctx": RecordType{taken}, "result": ResultScope}}, boolType, at+".when")
		compiled := CompiledOffer{Def: o, When: when}
		for j, ch := range o.Changes {
			by := c.expr(ch.By, withScope(takenScopes, "result", ResultScope), intType, fmt.Sprintf("%s.changes[%d].by", at, j))
			whole = whole && by != nil
			compiled.Changes = append(compiled.Changes, CompiledChange{ch.Pool, ch.Resource, by})
		}
		whole = whole && when != nil
		offers = append(offers, compiled)
	}
	if !whole {
		return nil
	}
	// A value the call computes for an actor is as hidden as its most hidden input, like a derived value.
	seen := func(exprs ...*CompiledExpr) map[string]string { return c.seenBy(takers, entities, exprs) }
	modifierVisibility := seen(modifier)
	if pool != nil {
		modifierVisibility = seen(modifier, pool)
	}
	// Who may be told what the offers work out on a taker (house decision #170): their changes read its scope.
	byOf := []*CompiledExpr{}
	for _, o := range offers {
		for _, ch := range o.Changes {
			byOf = append(byOf, ch.By)
		}
	}
	return &CompiledTest{t, offers, modifier, target, pool, modifierVisibility, seen(target), seen(byOf...)}
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
		if ct := c.test(id, &t, entities); ct != nil {
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
		_, scopes := c.actorsOf(s.Entities, entities)
		if when := c.expr(s.When, scopes, boolType, fmt.Sprintf("health.states[%d].when", j)); when != nil {
			healthStates = append(healthStates, CompiledHealthState{s.ID, s.Label, when, s.Entities})
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

	// health.harm (house decision #66): checked here, read by the primitive from the manifest's own text.
	if harm := c.r.Health.Harm; harm != nil {
		for j, x := range harm.Profiles {
			_, scopes := c.actorsOf(&x.Entities, entities)
			path := fmt.Sprintf("health.harm.profiles[%d].", j)
			check := func(source *string, expect ExprType, at string) {
				if source != nil {
					c.expr(*source, scopes, expect, path+at)
				}
			}
			check(x.Shockless, boolType, "shockless")
			if x.Spent != nil {
				check(x.Spent.When, boolType, "spent.when")
			}
			if x.Felled != nil {
				check(&x.Felled.When, boolType, "felled.when")
				check(x.Felled.HealTo, intType, "felled.healTo")
			}
			if x.Destroyed != nil {
				check(&x.Destroyed.Over, intType, "destroyed.over")
				check(x.Destroyed.When, boolType, "destroyed.when")
			}
		}
	}

	notices := []CompiledNotice{}
	for j, n := range c.r.Notices {
		takers, scopes := c.actorsOf(n.Entities, entities)
		// A ledger actor's notices also read its play as `build` (house decision #168).
		if c.r.Build != nil {
			for i, e := range takers {
				if e.ID == c.r.Build.Actor {
					scopes[i] = maps.Clone(scopes[i])
					scopes[i]["build"] = NoticeBuildScope
				}
			}
		}
		path := fmt.Sprintf("notices[%d]", j)
		when := c.expr(n.If, scopes, boolType, path+".if")
		read, whole := []*CompiledExpr{when}, when != nil
		// A rule that rises reads how far it rose in this action as ctx.rose in its params (house decision #174).
		paramScopes := scopes
		if n.Rises != nil {
			paramScopes = withScope(scopes, "ctx", NoticeRoseScope)
		}
		params := map[string]*CompiledExpr{}
		for _, name := range sortedKeys(n.Params) {
			x := c.expr(n.Params[name], paramScopes, nil, path+".params."+name)
			params[name], read, whole = x, append(read, x), whole && x != nil
		}
		var rises *CompiledExpr
		if n.Rises != nil {
			rises = c.expr(*n.Rises, scopes, intType, path+".rises")
			read, whole = append(read, rises), whole && rises != nil
		}
		if whole {
			group := ""
			if n.Group != nil {
				group = *n.Group
			}
			notices = append(notices, CompiledNotice{n.ID, n.When, n.Entities, when, n.Text, params, group, rises,
				c.seenBy(takers, entities, read)})
		}
	}
	reminders := make([]*CompiledExpr, len(c.r.Reminders))
	for j, x := range c.r.Reminders {
		if x.If != nil {
			_, scopes := c.actorsOf(x.Entities, entities)
			reminderScopes := withScope(withScope(withScope(scopes, "round", intType), "held", boolType), "barred", boolType)
			reminders[j] = c.expr(*x.If, reminderScopes, boolType, fmt.Sprintf("reminders[%d].if", j))
		}
	}
	// A codex reminder's `if` reads its kind's fields (house decision #89); checked here, evaluated where it is shown.
	if c.r.Codex != nil {
		for _, kind := range sortedKeys(c.r.Codex.Kinds) {
			k := c.r.Codex.Kinds[kind]
			for j, x := range k.Reminders {
				c.expr(x.If, []map[string]ExprType{CodexScope(k.Fields, false, c.r.CampaignFields)}, boolType, fmt.Sprintf("codex.kinds.%s.reminders[%d].if", kind, j))
			}
		}
	}
	// A rows field's Test inputs read the campaign fields and the row's values (house decision #173).
	if c.r.Codex != nil {
		for _, kind := range sortedKeys(c.r.Codex.Kinds) {
			k := c.r.Codex.Kinds[kind]
			for _, id := range sortedKeys(k.Fields) {
				def := k.Fields[id]
				if def.Type != "rows" {
					continue
				}
				scope := CodexScope(nil, false, c.r.CampaignFields)
				scope["values"] = RowScope(def.Columns)
				for i, col := range def.Columns {
					if col.Type != "test" {
						continue
					}
					for _, name := range sortedKeys(col.Inputs) {
						c.expr(col.Inputs[name], []map[string]ExprType{scope}, nil,
							fmt.Sprintf("codex.kinds.%s.fields.%s.columns[%d].inputs.%s", kind, id, i, name))
					}
				}
			}
		}
	}
	// A checklist step's room value reads the campaign fields (house decision #173).
	for j, x := range c.r.Checklist {
		if x.Now != nil {
			c.expr(*x.Now, []map[string]ExprType{CodexScope(nil, false, c.r.CampaignFields)}, nil, fmt.Sprintf("checklist[%d].now", j))
		}
	}
	// A generator's when, filter and each.times read the steps above them (house decision #98).
	for i := range c.r.Generators {
		c.generatorExprs(&c.r.Generators[i], fmt.Sprintf("generators[%d]", i))
	}
	immune := map[string]*CompiledExpr{}
	for j, x := range c.r.Conditions {
		if x.Immune != nil {
			_, scopes := c.actorsOf(x.Immune.Entities, entities)
			if e := c.expr(x.Immune.If, scopes, boolType, fmt.Sprintf("conditions[%d].immune", j)); e != nil {
				immune[x.ID] = e
			}
		}
	}
	c.spends(entities)
	c.acquire(entities)
	c.spawn()
	c.strikes(entities)
	c.panels(entities)

	lookups := c.lookups(entities)

	if len(c.problems) > 0 || !scoringOK || (init != nil && init.Def.Strategy == "ranked" && init.Score == nil) {
		return nil
	}
	conditions := map[string]*Condition{}
	for i := range c.r.Conditions {
		conditions[c.r.Conditions[i].ID] = &c.r.Conditions[i]
	}
	var build *CompiledBuild
	if b := c.r.Build; b != nil {
		build = &CompiledBuild{b.Actor, b.Params, b.Kinds}
	}
	return &CompiledRuleset{c.r, entities, resources, conditions, tests, init, scoring, healthStates, instantDeath, build, notices,
		reminders, immune, lookups}
}

// lookups compiles each table with a die (compile.ts Compiler.lookups): the modifier and every effect's expressions
// over the target's scope, for each actor type the table applies to, with the inputs as `ctx`.
func (c *compiler) lookups(entities map[string]*CompiledEntity) map[string]*CompiledLookup {
	out := map[string]*CompiledLookup{}
	for _, id := range sortedKeys(c.r.Tables) {
		t := c.r.Tables[id]
		if t.Die == nil {
			continue
		}
		ctx := map[string]ExprType{}
		for _, x := range t.Inputs {
			ctx[x.ID] = Scalar(x.Type)
		}
		_, actorScopes := c.actorsOf(t.Entities, entities)
		scopes := withScope(actorScopes, "ctx", RecordType{ctx})
		at := "tables." + id
		one := func(source *string, expect ExprType, path string) *CompiledExpr {
			if source == nil {
				return nil
			}
			return c.expr(*source, scopes, expect, path)
		}
		// A stepper's max read from the shared pools as they stand (house decision #192).
		pools := map[string]ExprType{}
		for _, x := range c.r.Resources {
			if x.Scope != "entity" {
				pools[x.ID] = intType
			}
		}
		maxScope := map[string]ExprType{"pools": RecordType{pools}}
		if campaign := campaignScope(c.r); campaign != nil {
			maxScope["campaign"] = campaign
		}
		maxes := map[string]*CompiledExpr{}
		for i, x := range t.Inputs {
			if x.MaxExpr == nil {
				continue
			}
			if expr := c.expr(*x.MaxExpr, []map[string]ExprType{maxScope}, intType, fmt.Sprintf("%s.inputs[%d].max", at, i)); expr != nil {
				maxes[x.ID] = expr
			}
		}
		compiled := &CompiledLookup{Modifier: one(t.Modifier, intType, at+".modifier"), Effects: make([][]CompiledTableEffect, len(t.Entries)), Maxes: maxes}
		for i, e := range t.Entries {
			compiled.Effects[i] = []CompiledTableEffect{}
			for j := range e.Apply {
				x := &t.Entries[i].Apply[j]
				path := fmt.Sprintf("%s.entries[%d].apply[%d]", at, i, j)
				compiled.Effects[i] = append(compiled.Effects[i], CompiledTableEffect{Def: x,
					When: one(x.When, boolType, path+".when"), Times: one(x.Times, intType, path+".times"),
					Wounds: one(x.Wounds, intType, path+".wounds"), Shock: one(x.Shock, intType, path+".shock"),
					By: one(x.By, intType, path+".by")})
			}
		}
		out[id] = compiled
	}
	return out
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

// compileEntryEffects compiles the effects of the entries an actor of type entity chose, against that type alone. An
// effect that does not compile for it (the pack was written for another version) contributes nothing, never an error.
func (c *CompiledRuleset) compileEntryEffects(entity string, entries []ActiveEntry) []CompiledEffect {
	ce, ok := c.Entities[entity]
	if !ok || len(entries) == 0 {
		return nil
	}
	hits := (&compiler{r: c.Ruleset}).entryEffects(c.Entities, entries, []*EntityType{ce.Def}, func(int, int) string { return "" })
	out := make([]CompiledEffect, len(hits))
	for i, h := range hits {
		out[i] = h.effect
	}
	return out
}

// entryEffectProblems reports the effects of entries against every actor type in pool (the ones a choose step picks
// them for); pathOf places each one in the pack. Nothing when the ruleset does not compile (it was refused on import).
func entryEffectProblems(r *Ruleset, entries []ActiveEntry, pool []*EntityType, pathOf func(entry, effect int) string) []Problem {
	c := &compiler{r: r}
	compiled := c.run()
	if compiled == nil {
		return nil
	}
	c.problems = nil
	c.entryEffects(compiled.Entities, entries, pool, pathOf)
	return c.problems
}
