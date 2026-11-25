package engine

import (
	"fmt"
	"maps"
	"math"
	"slices"
)

// Strikes (packages/rules-engine/src/strike.ts and manifest.ts Strike; house decision #99): the kinds of strike a game
// has, what the guide shows for one, and what a typed total applies. The api checks a strike.apply with PlanStrike, so a
// client cannot apply a hit the strike does not give.

type (
	// StrikeMeans is where a strike's means come from: From "ledger" (Lines of the saved sheet), "list" (the pack
	// entries of type Entry whose keys the attacker's list field Field holds) or "items" (the items of kind Kind the
	// attacker holds, house decision #95).
	StrikeMeans struct {
		From  string `json:"from"`
		Lines string `json:"lines"`
		Field string `json:"field"`
		Entry string `json:"entry"`
		Kind  string `json:"kind"`
	}
	// StrikeAdd is one addition to a figure, applied when When holds.
	StrikeAdd struct {
		Label string  `json:"label"`
		By    string  `json:"by"`
		When  *string `json:"when"`
		Cite  *string `json:"cite"`
	}
	// StrikeFigure is a number the guide shows: its base, then its additions.
	StrikeFigure struct {
		Label string      `json:"label"`
		Expr  string      `json:"expr"`
		Cite  *string     `json:"cite"`
		Adds  []StrikeAdd `json:"adds"`
	}
	// StrikeShow is a further number the guide shows (manifest.ts StrikeShow): a figure with an id.
	StrikeShow struct {
		ID string `json:"id"`
		StrikeFigure
	}
	// StrikeOutcome is what a typed total does when When holds.
	StrikeOutcome struct {
		ID     string  `json:"id"`
		Label  string  `json:"label"`
		When   string  `json:"when"`
		Wounds *string `json:"wounds"`
		Shock  *string `json:"shock"`
		Cite   *string `json:"cite"`
	}
	// StrikeValue is one value a strike reads of its means.
	StrikeValue struct {
		Key  string `json:"key"`
		Type string `json:"type"`
	}
	// StrikeNote is a short line shown after the strike.
	StrikeNote struct {
		Text string  `json:"text"`
		When *string `json:"when"`
		Cite *string `json:"cite"`
	}
	// Strike is one entry of the manifest's strikes.
	Strike struct {
		ID       string                 `json:"id"`
		Label    string                 `json:"label"`
		Cite     *string                `json:"cite"`
		Entities *[]string              `json:"entities"`
		Targets  *[]string              `json:"targets"`
		Means    []StrikeMeans          `json:"means"`
		Values   map[string]StrikeValue `json:"values"`
		Inputs   []TableInput           `json:"inputs"`
		Pool     StrikeFigure           `json:"pool"`
		Beat     StrikeFigure           `json:"beat"`
		Soak     *StrikeFigure          `json:"soak"`
		Shows    []StrikeShow           `json:"shows"`
		Outcomes []StrikeOutcome        `json:"outcomes"`
		Notes    []StrikeNote           `json:"notes"`
		Then     *SpendThen             `json:"then"`
		// ByOwner lets the seat that holds the attacker send it (house decision #112); Limit is #91's per-round count.
		ByOwner bool        `json:"byOwner"`
		Limit   *SpendLimit `json:"limit"`
	}

	// StrikeLine is one line of a figure (breakdown.ts BreakdownLine).
	StrikeLine struct {
		Source string  `json:"source"`
		Amount float64 `json:"amount"`
		Cite   *string `json:"cite"`
	}
	// StrikeFigureRead is a figure worked out: its total and its lines.
	StrikeFigureRead struct {
		Total float64      `json:"total"`
		Lines []StrikeLine `json:"lines"`
	}
	// StrikeShowRead is a further number worked out, with its id.
	StrikeShowRead struct {
		ID string `json:"id"`
		StrikeFigureRead
	}
	// StrikeResult is the outcome a typed total reads.
	StrikeResult struct {
		ID    string  `json:"id"`
		Label string  `json:"label"`
		Cite  *string `json:"cite"`
	}
	// StrikeHarm is the hit an outcome applies.
	StrikeHarm struct {
		Wounds float64 `json:"wounds"`
		Shock  float64 `json:"shock"`
	}
	// StrikeNoteRead is a note that holds.
	StrikeNoteRead struct {
		Text string  `json:"text"`
		Cite *string `json:"cite"`
	}
	// StrikePlan is planStrike's answer.
	StrikePlan struct {
		Pool    StrikeFigureRead  `json:"pool"`
		Beat    StrikeFigureRead  `json:"beat"`
		Soak    *StrikeFigureRead `json:"soak"`
		Shows   []StrikeShowRead  `json:"shows"`
		Outcome *StrikeResult     `json:"outcome"`
		Harm    *StrikeHarm       `json:"harm"`
		Notes   []StrikeNoteRead  `json:"notes"`
	}
	// StrikeSide is one side of a strike: its actor type and its expression scope.
	StrikeSide struct {
		Entity string  `json:"entity"`
		Scope  *Record `json:"scope"`
	}
)

// The lowest and highest total a strike takes (strike.ts STRIKE_TOTAL_MIN, STRIKE_TOTAL_MAX).
const (
	StrikeTotalMin = -1000
	StrikeTotalMax = 1000
)

// strikeCtxRoots are the names a strike's ctx gives its own values (STRIKE_CTX_ROOTS).
var strikeCtxRoots = []string{"means", "target", "attackerMob", "targetMob", "pool", "beat", "soak", "total", "outcome"}

// StrikeOf is the ruleset's strike by id, and its index; nil and -1 when it has none.
func (r *Ruleset) StrikeOf(id string) (*Strike, int) {
	for i := range r.Strikes {
		if r.Strikes[i].ID == id {
			return &r.Strikes[i], i
		}
	}
	return nil, -1
}

// StrikeTargets is manifest.ts strikeTargets: the strike's targets, or every actor type a harm profile holds (every
// actor type without harm).
func (r *Ruleset) StrikeTargets(s *Strike) []string {
	if s.Targets != nil {
		return slices.Clone(*s.Targets)
	}
	out := []string{}
	for _, e := range r.Entities {
		if e.Base != "actor" {
			continue
		}
		if r.Health.Harm == nil || slices.ContainsFunc(r.Health.Harm.Profiles, func(p HarmProfile) bool { return slices.Contains(p.Entities, e.ID) }) {
			out = append(out, e.ID)
		}
	}
	return out
}

// strikes is manifest.ts strikeProblems.
func (p *problems) strikes(r *Ruleset, actorTypes func(*[]string, string), needCite func(*string, string)) {
	p.duplicates("strikes", idsOf(r.Strikes, func(s Strike) string { return s.ID }))
	harm := r.Health.Harm
	for i, s := range r.Strikes {
		path := fmt.Sprintf("strikes[%d]", i)
		needCite(s.Cite, path)
		actorTypes(s.Entities, path+".entities")
		actorTypes(s.Targets, path+".targets")
		for j, m := range s.Means {
			at := fmt.Sprintf("%s.means[%d]", path, j)
			if m.From == "ledger" {
				if r.Build == nil {
					p.add(at, "the ruleset has no build")
				}
				continue
			}
			if m.From == "items" {
				kind := r.Items.Kind(m.Kind)
				if kind == nil {
					p.add(at+".kind", `unknown item kind "%s"`, m.Kind)
				} else if !slices.ContainsFunc(kind.Entities, func(id string) bool {
					e := r.entity(id)
					return e != nil && e.Base == "actor" && (s.Entities == nil || slices.Contains(*s.Entities, id))
				}) {
					p.add(at+".kind", `no attacker holds "%s"`, m.Kind)
				}
				continue
			}
			listed := false
			for _, e := range r.Entities {
				if e.Base == "actor" && (s.Entities == nil || slices.Contains(*s.Entities, e.ID)) {
					if f, has := e.Fields[m.Field]; has && f.Type == "list" {
						listed = true
					}
				}
			}
			if !listed {
				p.add(at+".field", `"%s" is not a list field of an attacker`, m.Field)
			}
			if r.entity(m.Entry) == nil {
				p.add(at+".entry", `unknown entity "%s"`, m.Entry)
			}
		}
		if s.Values != nil && s.Means == nil {
			p.add(path+".values", "values are read from a means")
		}
		p.duplicates(path+".inputs", idsOf(s.Inputs, func(x TableInput) string { return x.ID }))
		for j, x := range s.Inputs {
			at := fmt.Sprintf("%s.inputs[%d]", path, j)
			if slices.Contains(strikeCtxRoots, x.ID) {
				p.add(at+".id", `"%s" is reserved`, x.ID)
			}
			if x.Type == "bool" && (x.Min != nil || x.Max != nil) {
				p.add(at, "a switch has no bounds")
			}
			if x.Type == "choice" && (x.Min != nil || x.Max != nil) {
				p.add(at, "a choice has no bounds")
			}
			if x.Type == "choice" && x.Options == nil {
				p.add(at, "a choice needs options")
			}
			if x.Type != "choice" && x.Options != nil {
				p.add(at+".options", "only a choice has options")
			}
			for k, o := range x.Options {
				if slices.IndexFunc(x.Options, func(q InputOption) bool { return q.Value == o.Value }) != k {
					p.add(fmt.Sprintf("%s.options[%d].value", at, k), "duplicate value %s", esNumber(o.Value))
				}
			}
			if x.Min != nil && x.Max != nil && *x.Max < *x.Min {
				p.add(at+".max", "max is below min")
			}
		}
		p.duplicates(path+".shows", idsOf(s.Shows, func(x StrikeShow) string { return x.ID }))
		p.duplicates(path+".outcomes", idsOf(s.Outcomes, func(o StrikeOutcome) string { return o.ID }))
		hits := false
		for j, o := range s.Outcomes {
			at := fmt.Sprintf("%s.outcomes[%d]", path, j)
			if o.Wounds == nil && o.Shock == nil {
				continue
			}
			hits = true
			if harm == nil {
				p.add(at, "a hit needs health.harm")
			} else if o.Shock != nil && harm.Shock == nil {
				p.add(at+".shock", "this ruleset has no shock")
			}
		}
		if hits && harm != nil && s.Targets != nil {
			for j, id := range *s.Targets {
				if r.entity(id) != nil && !slices.ContainsFunc(harm.Profiles, func(hp HarmProfile) bool { return slices.Contains(hp.Entities, id) }) {
					p.add(fmt.Sprintf("%s.targets[%d]", path, j), `"%s" has no harm profile`, id)
				}
			}
		}
		if s.Then != nil {
			table, hasTable := r.Tables[s.Then.Table]
			if !hasTable {
				p.add(path+".then.table", `unknown table "%s"`, s.Then.Table)
			}
			for _, key := range sortedKeys(s.Then.Inputs) {
				from := s.Then.Inputs[key]
				if !slices.ContainsFunc(s.Inputs, func(x TableInput) bool { return x.ID == from }) {
					p.add(path+".then.inputs."+key, `"%s" is not an input of the strike`, from)
				}
				if hasTable && !slices.ContainsFunc(table.Inputs, func(x TableInput) bool { return x.ID == key }) {
					p.add(path+".then.inputs."+key, `"%s" is not an input of the table`, key)
				}
			}
		}
	}
}

// strikes is compile.ts Compiler.strikes: every expression over each attacker type and each target type.
func (c *compiler) strikes(entities map[string]*CompiledEntity) {
	for i := range c.r.Strikes {
		s := &c.r.Strikes[i]
		path := fmt.Sprintf("strikes[%d]", i)
		targetIDs := c.r.StrikeTargets(s)
		_, targets := c.actorsOf(&targetIDs, entities)
		_, attackers := c.actorsOf(s.Entities, entities)
		values := map[string]ExprType{}
		for k, v := range s.Values {
			values[k] = Scalar(v.Type)
		}
		base := map[string]ExprType{"means": RecordType{values}, "attackerMob": intType, "targetMob": intType}
		for _, x := range s.Inputs {
			if x.Type == "choice" {
				base[x.ID] = intType
			} else {
				base[x.ID] = Scalar(x.Type)
			}
		}
		scopes := func(extra map[string]ExprType) []map[string]ExprType {
			out := []map[string]ExprType{}
			for _, a := range attackers {
				for _, t := range targets {
					ctx := maps.Clone(base)
					ctx["target"] = RecordType{t}
					maps.Copy(ctx, extra)
					scope := maps.Clone(a)
					scope["ctx"] = RecordType{ctx}
					out = append(out, scope)
				}
			}
			return out
		}
		figures := scopes(nil)
		figure := func(f *StrikeFigure, at string) {
			if f == nil {
				return
			}
			c.expr(f.Expr, figures, intType, at+".expr")
			for j, a := range f.Adds {
				if a.When != nil {
					c.expr(*a.When, figures, boolType, fmt.Sprintf("%s.adds[%d].when", at, j))
				}
				c.expr(a.By, figures, intType, fmt.Sprintf("%s.adds[%d].by", at, j))
			}
		}
		figure(&s.Pool, path+".pool")
		figure(&s.Beat, path+".beat")
		figure(s.Soak, path+".soak")
		for j := range s.Shows {
			figure(&s.Shows[j].StrikeFigure, fmt.Sprintf("%s.shows[%d]", path, j))
		}
		read := map[string]ExprType{"pool": intType, "beat": intType, "total": intType}
		if s.Soak != nil {
			read["soak"] = intType
		}
		typed := scopes(read)
		for j, o := range s.Outcomes {
			at := fmt.Sprintf("%s.outcomes[%d]", path, j)
			c.expr(o.When, typed, boolType, at+".when")
			if o.Wounds != nil {
				c.expr(*o.Wounds, typed, intType, at+".wounds")
			}
			if o.Shock != nil {
				c.expr(*o.Shock, typed, intType, at+".shock")
			}
		}
		withOutcome := maps.Clone(read)
		withOutcome["outcome"] = textType
		after := scopes(withOutcome)
		for j, n := range s.Notes {
			if n.When != nil {
				c.expr(*n.When, after, boolType, fmt.Sprintf("%s.notes[%d].when", path, j))
			}
		}
	}
}

// figureOf is a figure worked out: its base line, then each addition whose When holds and whose amount is not 0.
func figureOf(f *StrikeFigure, scope *Record, path string) (*StrikeFigureRead, *Refusal) {
	base, refusal := readNumber(f.Expr, scope, path+".expr")
	if refusal != nil {
		return nil, refusal
	}
	out := &StrikeFigureRead{Total: base, Lines: []StrikeLine{{Source: f.Label, Amount: base, Cite: f.Cite}}}
	for j, a := range f.Adds {
		if a.When != nil {
			holds, refusal := readBool(*a.When, scope, fmt.Sprintf("%s.adds[%d].when", path, j))
			if refusal != nil {
				return nil, refusal
			}
			if !holds {
				continue
			}
		}
		by, refusal := readNumber(a.By, scope, fmt.Sprintf("%s.adds[%d].by", path, j))
		if refusal != nil {
			return nil, refusal
		}
		if by != 0 {
			out.Lines = append(out.Lines, StrikeLine{Source: a.Label, Amount: by, Cite: a.Cite})
			out.Total += by
		}
	}
	return out, nil
}

// strikeMembers is a mob's members standing, read from the scope; 0 for anyone who is not a mob.
func (r *Ruleset) strikeMembers(scope *Record) float64 {
	if r.Health.Harm == nil || r.Health.Harm.Mob == nil || scope == nil {
		return 0
	}
	res, _ := scope.Fields["res"].(*Record)
	if res == nil {
		return 0
	}
	n, _ := res.Fields[r.Health.Harm.Mob.Members].(float64)
	return n
}

// MeansValues is strike.ts meansValues: each declared value's key, 0, false or "" where the means has none of that type.
func MeansValues(values map[string]StrikeValue, means map[string]any) map[string]any {
	out := map[string]any{}
	for id, v := range values {
		x := means[v.Key]
		switch v.Type {
		case "bool":
			b, _ := x.(bool)
			out[id] = b
			continue
		case "text":
			text, _ := x.(string)
			out[id] = text
			continue
		}
		n, isNumber := x.(float64)
		if !isNumber || n != math.Trunc(n) || math.IsInf(n, 0) {
			n = 0
		}
		out[id] = n
	}
	return out
}

// PlanStrike is strike.ts planStrike. The refusals are its: noSuchStrike, strikeNotFor, noMeans, badInput, wrongState.
// A nil means is none; a nil total is none typed yet.
func (c *CompiledRuleset) PlanStrike(strikeID string, attacker, target StrikeSide, means map[string]any, inputs map[string]any, total *float64) (*StrikePlan, *Refusal) {
	r := c.Ruleset
	s, at := r.StrikeOf(strikeID)
	if s == nil {
		return nil, refuse("noSuchStrike", `no strike "%s"`, strikeID)
	}
	path := fmt.Sprintf("strikes[%d]", at)
	if s.Entities != nil && !slices.Contains(*s.Entities, attacker.Entity) {
		return nil, refuse("strikeNotFor", `"%s" cannot strike with "%s"`, attacker.Entity, strikeID)
	}
	if !slices.Contains(r.StrikeTargets(s), target.Entity) {
		return nil, refuse("strikeNotFor", `"%s" is not a target of "%s"`, target.Entity, strikeID)
	}
	if s.Means != nil && means == nil {
		return nil, refuse("noMeans", `"%s" needs a means`, strikeID)
	}
	if s.Means == nil && means != nil {
		return nil, refuse("noMeans", `"%s" takes no means`, strikeID)
	}
	picked, bad := LookupInputs(&RandomTable{Inputs: s.Inputs}, inputs)
	if bad != "" {
		return nil, refuse("badInput", `bad input "%s"`, bad)
	}
	if total != nil && (*total != math.Trunc(*total) || *total < StrikeTotalMin || *total > StrikeTotalMax) {
		return nil, refuse("badInput", "the total must be a whole number from %d to %d", StrikeTotalMin, StrikeTotalMax)
	}
	ctx := maps.Clone(picked)
	ctx["means"] = &Record{map[string]any{}}
	if means != nil {
		ctx["means"] = &Record{MeansValues(s.Values, means)}
	}
	ctx["target"] = c.withLists(target.Scope)
	ctx["attackerMob"] = r.strikeMembers(attacker.Scope)
	ctx["targetMob"] = r.strikeMembers(target.Scope)
	mine := c.withLists(attacker.Scope)
	scope := func(extra map[string]any) *Record {
		all := maps.Clone(ctx)
		maps.Copy(all, extra)
		return withCtx(mine, all)
	}
	figures := scope(nil)
	plan := &StrikePlan{Shows: []StrikeShowRead{}, Notes: []StrikeNoteRead{}}
	pool, refusal := figureOf(&s.Pool, figures, path+".pool")
	if refusal != nil {
		return nil, refusal
	}
	beat, refusal := figureOf(&s.Beat, figures, path+".beat")
	if refusal != nil {
		return nil, refusal
	}
	plan.Pool, plan.Beat = *pool, *beat
	read := map[string]any{"pool": pool.Total, "beat": beat.Total, "total": 0.0}
	if s.Soak != nil {
		if plan.Soak, refusal = figureOf(s.Soak, figures, path+".soak"); refusal != nil {
			return nil, refusal
		}
		read["soak"] = plan.Soak.Total
	}
	for j := range s.Shows {
		show, refusal := figureOf(&s.Shows[j].StrikeFigure, figures, fmt.Sprintf("%s.shows[%d]", path, j))
		if refusal != nil {
			return nil, refusal
		}
		plan.Shows = append(plan.Shows, StrikeShowRead{ID: s.Shows[j].ID, StrikeFigureRead: *show})
	}
	if total != nil {
		read["total"] = *total
	}
	typed := scope(read)
	if total != nil {
		for j, o := range s.Outcomes {
			holds, refusal := readBool(o.When, typed, fmt.Sprintf("%s.outcomes[%d].when", path, j))
			if refusal != nil {
				return nil, refusal
			}
			if !holds {
				continue
			}
			amount := func(source *string, key string) (float64, *Refusal) {
				if source == nil {
					return 0, nil
				}
				return readNumber(*source, typed, fmt.Sprintf("%s.outcomes[%d].%s", path, j, key))
			}
			wounds, refusal := amount(o.Wounds, "wounds")
			if refusal != nil {
				return nil, refusal
			}
			shock, refusal := amount(o.Shock, "shock")
			if refusal != nil {
				return nil, refusal
			}
			plan.Outcome = &StrikeResult{ID: o.ID, Label: o.Label, Cite: o.Cite}
			if wounds != 0 || shock != 0 {
				plan.Harm = &StrikeHarm{Wounds: wounds, Shock: shock}
			}
			break
		}
	}
	outcome := ""
	if plan.Outcome != nil {
		outcome = plan.Outcome.ID
	}
	read["outcome"] = outcome
	after := scope(read)
	for j, n := range s.Notes {
		if n.When != nil {
			holds, refusal := readBool(*n.When, after, fmt.Sprintf("%s.notes[%d].when", path, j))
			if refusal != nil {
				return nil, refusal
			}
			if !holds {
				continue
			}
		}
		plan.Notes = append(plan.Notes, StrikeNoteRead{Text: n.Text, Cite: n.Cite})
	}
	return plan, nil
}
