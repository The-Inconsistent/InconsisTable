package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Generators (house decision #98; rules-engine generators.ts and the Generator schema in manifest.ts): ordered steps the
// GM runs in prep, ending in entries the server makes. CheckRun checks a confirmed run and plans what it makes.

// Caps of a generator (rules-engine MAX_GENERATORS and the rest).
const (
	maxGenerators     = 20
	maxGeneratorSteps = 12
	maxEachSteps      = 8
	MaxGenerated      = 60
	MaxChain          = 8
	maxJoinedSteps    = 4
)

type (
	// GeneratorStep is one step: a roll on a table, a pick of a served pack entry, or a number, choice or text set by
	// hand; When is a boolean over the steps above it.
	GeneratorStep struct {
		ID        string            `json:"id"`
		Label     string            `json:"label"`
		Kind      string            `json:"kind"`
		When      *string           `json:"when"`
		Table     string            `json:"table"`
		Entity    string            `json:"entity"`
		Filter    *string           `json:"filter"`
		Min       float64           `json:"min"`
		Max       float64           `json:"max"`
		Options   []string          `json:"options"`
		Labels    map[string]string `json:"labels"`
		MaxLength *float64          `json:"maxLength"`
		// Trail: a roll's words are every line of its chain, in order (house decision #179).
		Trail bool `json:"trail"`
	}
	// StepRefs is the steps that fill one field: one id, or 2 to 4 joined as words (house decision #179).
	StepRefs []string
	// GeneratedEntry is what one made entry takes: a title and fields from steps, and From a pick step whose pack
	// entry it is made from (house decision #97).
	GeneratedEntry struct {
		Title  string              `json:"title"`
		From   *string             `json:"from"`
		Fields map[string]StepRefs `json:"fields"`
	}
	// Generator is one declared generator.
	Generator struct {
		ID    string          `json:"id"`
		Label string          `json:"label"`
		Cite  *string         `json:"cite"`
		Steps []GeneratorStep `json:"steps"`
		Each  *struct {
			Times string          `json:"times"`
			Steps []GeneratorStep `json:"steps"`
		} `json:"each"`
		Make struct {
			GeneratedEntry
			Kind string          `json:"kind"`
			Each *GeneratedEntry `json:"each"`
			// Root false: the run makes only its rounds' entries (house decision #202).
			Root *bool `json:"root"`
		} `json:"make"`
	}
)

// UnmarshalJSON reads one step id or a list of them.
func (s *StepRefs) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*s = StepRefs{one}
		return nil
	}
	return json.Unmarshal(b, (*[]string)(s))
}

// MarshalJSON writes one id as itself, as the manifest says it.
func (s StepRefs) MarshalJSON() ([]byte, error) {
	if len(s) == 1 {
		return json.Marshal(s[0])
	}
	return json.Marshal([]string(s))
}

func generatorStepVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("when", exprSource),
		schema.Req("kind", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var (
	generatorStep = schema.Union("kind",
		generatorStepVariant("roll", schema.Req("table", idSchema), schema.Opt("trail", schema.Bool())),
		generatorStepVariant("pick", schema.Req("entity", idSchema), schema.Opt("filter", exprSource)),
		generatorStepVariant("number", schema.Req("min", schema.Int().Min(-1000).Max(1000)),
			schema.Req("max", schema.Int().Min(-1000).Max(1000))),
		generatorStepVariant("choice", schema.Req("options", schema.Array(idSchema).Min(1).Max(20)),
			schema.Opt("labels", schema.Record(idSchema, label(60)))),
		generatorStepVariant("text", schema.Opt("maxLength", schema.Int().Min(1).Max(200))),
	)
	generatedEntry = []schema.Field{
		schema.Req("title", idSchema),
		schema.Opt("from", idSchema),
		schema.Opt("fields", schema.Record(idSchema, schema.AnyOf(idSchema, schema.Array(idSchema).Min(2)))),
	}
	generatorSchema = schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Req("steps", schema.Array(generatorStep).Min(1).Max(maxGeneratorSteps)),
		schema.Opt("each", schema.Object(
			schema.Req("times", exprSource),
			schema.Req("steps", schema.Array(generatorStep).Min(1).Max(maxEachSteps)),
		)),
		schema.Req("make", schema.Object(append(slices.Clone(generatedEntry),
			schema.Req("kind", schema.Enum(CodexKinds...)),
			schema.Opt("each", schema.Object(generatedEntry...)),
			schema.Opt("root", schema.Literal(false)),
		)...)),
	)
)

// stepFills says whether a step's answer fits a codex field (stepFills in manifest.ts).
func stepFills(s *GeneratorStep, def *FieldDef) bool {
	switch def.Type {
	case "text":
		return s.Kind != "number"
	case "int":
		return s.Kind == "number"
	case "enum":
		if s.Kind != "choice" {
			return false
		}
		for _, o := range s.Options {
			if !slices.Contains(def.Values, o) {
				return false
			}
		}
		return true
	case "ref":
		return s.Kind == "pick" && s.Entity == def.Entity
	}
	return false
}

// generator checks one generator (generatorProblems in manifest.ts).
func (p *problems) generator(r *Ruleset, g *Generator, path string) {
	p.duplicates(path+".steps", idsOf(g.Steps, func(s GeneratorStep) string { return s.ID }))
	top := map[string]bool{}
	for _, s := range g.Steps {
		top[s.ID] = true
	}
	if g.Each != nil {
		for j, s := range g.Each.Steps {
			if top[s.ID] {
				p.add(fmt.Sprintf("%s.each.steps[%d].id", path, j), `duplicate id "%s"`, s.ID)
			}
		}
		p.duplicates(path+".each.steps", idsOf(g.Each.Steps, func(s GeneratorStep) string { return s.ID }))
	}
	stepChecks := func(steps []GeneratorStep, at string) {
		for j, s := range steps {
			sp := fmt.Sprintf("%s[%d]", at, j)
			if s.Kind == "roll" {
				t, has := r.Tables[s.Table]
				switch {
				case !has:
					p.add(sp+".table", `unknown table "%s"`, s.Table)
				case t.Visibility == "owner":
					p.add(sp+".table", `"%s" is dealt, never rolled`, s.Table)
				}
			}
			if s.Kind == "pick" && r.entity(s.Entity) == nil {
				p.add(sp+".entity", `unknown entity "%s"`, s.Entity)
			}
			if s.Kind == "number" && s.Max < s.Min {
				p.add(sp+".max", "max is below min")
			}
			if s.Kind == "choice" {
				for k, o := range s.Options {
					if slices.Index(s.Options, o) != k {
						p.add(fmt.Sprintf("%s.options[%d]", sp, k), `"%s" is there twice`, o)
					}
				}
				p.enumWords(sp, s.Options, s.Labels, nil, nil)
			}
		}
	}
	stepChecks(g.Steps, path+".steps")
	if g.Each != nil {
		stepChecks(g.Each.Steps, path+".each.steps")
	}
	var kind CodexKind
	if r.Codex != nil {
		kind = r.Codex.Kinds[g.Make.Kind]
	}
	made := func(m *GeneratedEntry, steps []GeneratorStep, at string) {
		step := func(id string) *GeneratorStep {
			for i := range steps {
				if steps[i].ID == id {
					return &steps[i]
				}
			}
			return nil
		}
		if step(m.Title) == nil {
			p.add(at+".title", `"%s" is not a step`, m.Title)
		}
		if m.From != nil {
			s := step(*m.From)
			if s == nil || s.Kind != "pick" || !slices.ContainsFunc(kind.From, func(f EntryPrefill) bool { return f.Entity == s.Entity }) {
				p.add(at+".from", `"%s" is not a pick of a type %s is made from`, *m.From, g.Make.Kind)
			}
		}
		for _, f := range sortedKeys(m.Fields) {
			ids := m.Fields[f]
			def, declared := kind.Fields[f]
			if !declared {
				p.add(at+".fields."+f, `"%s" is not a field of %s`, f, g.Make.Kind)
				continue
			}
			if len(ids) > 1 && def.Type != "text" {
				p.add(at+".fields."+f, "only a text field takes several steps")
				continue
			}
			if len(ids) > maxJoinedSteps {
				p.add(at+".fields."+f, "at most %d steps", maxJoinedSteps)
				continue
			}
			for _, id := range ids {
				if s := step(id); s == nil {
					p.add(at+".fields."+f, `"%s" is not a step`, id)
					break
				} else if !stepFills(s, &def) {
					p.add(at+".fields."+f, `"%s" can't fill "%s"`, id, f)
					break
				}
			}
		}
	}
	made(&g.Make.GeneratedEntry, g.Steps, path+".make")
	if g.Make.Each != nil {
		all := slices.Clone(g.Steps)
		if g.Each != nil {
			all = append(all, g.Each.Steps...)
		}
		made(g.Make.Each, all, path+".make.each")
	}
	if g.Each != nil && g.Make.Each == nil {
		p.add(path+".make", "each round needs what it makes")
	}
	if g.Each == nil && g.Make.Each != nil {
		p.add(path+".make.each", "nothing repeats")
	}
	if g.Make.Root != nil && !*g.Make.Root && g.Make.Each == nil {
		p.add(path+".make.root", "a run that makes no entry of its own makes its rounds' entries")
	}
	if g.Make.Each != nil && g.Make.Kind == "scene" {
		p.add(path+".make.each", "a scene sits under an adventure, not a scene")
	}
}

// stepType is what an expression reads a step as.
func stepType(s *GeneratorStep) ExprType {
	if s.Kind == "number" {
		return intType
	}
	return textType
}

// generatorScope is the scope an expression of a step reads (scopeOf in generators.ts).
func generatorScope(r *Ruleset, before []GeneratorStep, entity string) map[string]ExprType {
	steps := map[string]ExprType{}
	for i := range before {
		steps[before[i].ID] = stepType(&before[i])
	}
	scope := map[string]ExprType{"steps": RecordType{steps}}
	if r.CampaignFields != nil {
		scope["campaign"] = campaignScope(r)
	}
	if entity != "" {
		record := map[string]ExprType{}
		if e := r.entity(entity); e != nil {
			for id, def := range e.Fields {
				switch def.Type {
				case "int":
					record[id] = intType
				case "bool":
					record[id] = boolType
				case "list":
					record[id] = ListType{textType}
				default:
					record[id] = textType
				}
			}
		}
		scope["entry"] = RecordType{record}
	}
	return scope
}

// generatorExprs checks a generator's expressions (generatorExprProblems in generators.ts).
func (c *compiler) generatorExprs(g *Generator, path string) {
	walk := func(steps, above []GeneratorStep, at string) {
		for j, s := range steps {
			before := append(slices.Clone(above), steps[:j]...)
			if s.When != nil {
				c.expr(*s.When, []map[string]ExprType{generatorScope(c.r, before, "")}, boolType, fmt.Sprintf("%s[%d].when", at, j))
			}
			if s.Kind == "pick" && s.Filter != nil {
				c.expr(*s.Filter, []map[string]ExprType{generatorScope(c.r, before, s.Entity)}, boolType, fmt.Sprintf("%s[%d].filter", at, j))
			}
		}
	}
	walk(g.Steps, nil, path+".steps")
	if g.Each != nil {
		c.expr(g.Each.Times, []map[string]ExprType{generatorScope(c.r, g.Steps, "")}, intType, path+".each.times")
		walk(g.Each.Steps, g.Steps, path+".each.steps")
	}
}

// StepValue is a step's answer in a run: a roll's lines, a pick's key, a set value.
type StepValue struct {
	Rows  []string `json:"rows"`
	Key   *string  `json:"key"`
	Value any      `json:"value"`
}

// GeneratorRun is a confirmed run: the top steps' answers, and one set per round of `each`.
type GeneratorRun struct {
	Values map[string]StepValue   `json:"values"`
	Each   []map[string]StepValue `json:"each"`
}

// ServedEntry is a served pack entry this seat reads; ServedFn finds one by type and key, nil when none.
type ServedEntry struct {
	Key  string
	Name string
	Body map[string]any
}
type ServedFn func(entity, key string) *ServedEntry

// PlannedEntry is one entry a run makes (PlannedEntry in generators.ts).
type PlannedEntry struct {
	Title  string         `json:"title"`
	Fields map[string]any `json:"fields"`
	From   *struct {
		Entity string `json:"entity"`
		Key    string `json:"key"`
	} `json:"from"`
}

// RunRefusal is why a run is refused: a code of generators.ts GENERATE_REFUSALS and its params.
type RunRefusal struct {
	Code   string
	Params map[string]any
}

func (e *RunRefusal) Error() string { return e.Code }

type answered struct {
	step  *GeneratorStep
	expr  any
	text  string
	key   *string
	value *float64
}

// holds evaluates a boolean expression; one that cannot be read does not hold.
func holds(source string, scope map[string]ExprType, record *Record) bool {
	expr, err := CompileExpr(source, scope, boolType)
	if err != nil {
		return false
	}
	ok, err := EvaluateBool(expr, record)
	return err == nil && ok
}

func bodyRecord(body map[string]any) *Record {
	out := map[string]any{}
	for id, v := range body {
		switch x := v.(type) {
		case float64, string, bool:
			out[id] = x
		case []any:
			words := true
			for _, item := range x {
				_, isText := item.(string)
				words = words && isText
			}
			if words {
				out[id] = ValueFromJSON(x)
			}
		}
	}
	return &Record{out}
}

func stepsRecord(done map[string]*answered, campaign map[string]any) *Record {
	values := map[string]any{}
	for id, a := range done {
		values[id] = a.expr
	}
	return &Record{map[string]any{"steps": &Record{values}, "campaign": ValueFromJSON(campaign)}}
}

// answer reads one round of steps against the run (answer in generators.ts).
func answer(r *Ruleset, steps, above []GeneratorStep, given map[string]StepValue, served ServedFn, campaign map[string]any, done map[string]*answered) error {
	for j := range steps {
		s := &steps[j]
		before := append(slices.Clone(above), steps[:j]...)
		if s.When != nil && !holds(*s.When, generatorScope(r, before, ""), stepsRecord(done, campaign)) {
			continue
		}
		v, has := given[s.ID]
		params := map[string]any{"step": s.Label}
		refuse := func(code string) error { return &RunRefusal{code, params} }
		switch s.Kind {
		case "roll":
			if !has || len(v.Rows) == 0 || len(v.Rows) > MaxChain {
				return refuse("generateMissing")
			}
			tableID, ok := s.Table, true
			var line *TableEntry
			labels := []string{}
			for i, id := range v.Rows {
				if i > 0 {
					ok = line.Next != nil
					if ok {
						tableID = *line.Next
					}
				}
				t, known := r.Tables[tableID]
				line = nil
				if ok && known {
					for k := range t.Entries {
						if t.Entries[k].ID == id {
							line = &t.Entries[k]
						}
					}
				}
				if line == nil {
					return refuse("generateRow")
				}
				labels = append(labels, line.Label)
			}
			// A trail's words are the whole chain's (house decision #179); an expression still reads the last line.
			text := line.Label
			if s.Trail {
				text = strings.Join(labels, " ")
			}
			done[s.ID] = &answered{step: s, expr: line.ID, text: text}
		case "pick":
			if !has || v.Key == nil {
				return refuse("generateMissing")
			}
			e := served(s.Entity, *v.Key)
			if e == nil {
				return refuse("generatePick")
			}
			if s.Filter != nil {
				record := stepsRecord(done, campaign)
				record.Fields["entry"] = bodyRecord(e.Body)
				if !holds(*s.Filter, generatorScope(r, before, s.Entity), record) {
					return refuse("generatePick")
				}
			}
			key := e.Key
			done[s.ID] = &answered{step: s, expr: e.Key, text: e.Name, key: &key}
		case "number":
			n, isNumber := v.Value.(float64)
			if !has || !isNumber {
				return refuse("generateMissing")
			}
			if n != float64(int64(n)) || n < s.Min || n > s.Max {
				return refuse("generateValue")
			}
			n += 0 // -0 prints as 0, as String(-0) does
			done[s.ID] = &answered{step: s, expr: n, text: strconv.FormatFloat(n, 'f', -1, 64), value: &n}
		case "choice":
			c, isText := v.Value.(string)
			if !has || !isText {
				return refuse("generateMissing")
			}
			if !slices.Contains(s.Options, c) {
				return refuse("generateValue")
			}
			text := c
			if label, worded := s.Labels[c]; worded {
				text = label
			}
			done[s.ID] = &answered{step: s, expr: c, text: text}
		case "text":
			t, isText := v.Value.(string)
			if !has || !isText {
				return refuse("generateMissing")
			}
			trimmed := strings.TrimSpace(t)
			limit := 200
			if s.MaxLength != nil {
				limit = int(*s.MaxLength)
			}
			if trimmed == "" || utf8.RuneCountInString(trimmed) > limit {
				return refuse("generateValue")
			}
			done[s.ID] = &answered{step: s, expr: trimmed, text: trimmed}
		}
	}
	return nil
}

// fillOf is what a step puts in a field of its kind (fillOf in generators.ts).
func fillOf(a *answered, def *FieldDef) any {
	switch def.Type {
	case "ref":
		if a.key != nil {
			return *a.key
		}
	case "int":
		if a.value != nil {
			return *a.value
		}
	case "enum":
		if a.step.Kind == "choice" {
			return a.expr
		}
	case "text":
		return a.text
	}
	return nil
}

// plan is the entry one round makes (planned in generators.ts).
func plan(r *Ruleset, g *Generator, made *GeneratedEntry, done map[string]*answered) PlannedEntry {
	var defs map[string]FieldDef
	if r.Codex != nil {
		defs = r.Codex.Kinds[g.Make.Kind].Fields
	}
	out := PlannedEntry{Title: g.Label, Fields: map[string]any{}}
	if a, has := done[made.Title]; has {
		out.Title = a.text
	}
	if runes := []rune(out.Title); len(runes) > 200 {
		out.Title = string(runes[:200])
	}
	for _, id := range sortedKeys(made.Fields) {
		def, declared := defs[id]
		all := []*answered{}
		for _, step := range made.Fields[id] {
			if a, has := done[step]; has {
				all = append(all, a)
			}
		}
		if !declared || len(all) == 0 {
			continue
		}
		// Several steps fill a text field with the words of those answered, joined by a space (house decision #179).
		var value any
		if len(all) == 1 {
			value = fillOf(all[0], &def)
		} else {
			words := make([]string, len(all))
			for i, a := range all {
				words[i] = a.text
			}
			value = strings.Join(words, " ")
		}
		if value != nil && CheckFieldValue(&def, value) == "" {
			out.Fields[id] = value
		}
	}
	if made.From != nil {
		if a, has := done[*made.From]; has && a.step.Kind == "pick" && a.key != nil && *a.key != "" {
			out.From = &struct {
				Entity string `json:"entity"`
				Key    string `json:"key"`
			}{a.step.Entity, *a.key}
		}
	}
	return out
}

// CheckRun checks a confirmed run against its generator and plans what it makes (checkRun in generators.ts).
func CheckRun(r *Ruleset, g *Generator, run GeneratorRun, served ServedFn, campaign map[string]any) (*PlannedEntry, []PlannedEntry, *RunRefusal) {
	if campaign == nil {
		campaign = map[string]any{}
	}
	top := map[string]*answered{}
	refusal := func(err error) *RunRefusal {
		var refused *RunRefusal
		if errors.As(err, &refused) {
			return refused
		}
		return &RunRefusal{"generateMissing", map[string]any{}}
	}
	if err := answer(r, g.Steps, nil, run.Values, served, campaign, top); err != nil {
		return nil, nil, refusal(err)
	}
	// A run with no entry of its own makes only its rounds' (house decision #202).
	var root *PlannedEntry
	if g.Make.Root == nil || *g.Make.Root {
		p := plan(r, g, &g.Make.GeneratedEntry, top)
		root = &p
	}
	if g.Each == nil || g.Make.Each == nil {
		if len(run.Each) > 0 {
			return nil, nil, &RunRefusal{"generateCount", map[string]any{"count": 0.0}}
		}
		return root, []PlannedEntry{}, nil
	}
	times := 0.0
	if expr, err := CompileExpr(g.Each.Times, generatorScope(r, g.Steps, ""), intType); err == nil {
		if n, err := EvaluateInt(expr, stepsRecord(top, campaign)); err == nil {
			times = n
		}
	}
	if times < 0 || times > MaxGenerated || float64(len(run.Each)) != times {
		return nil, nil, &RunRefusal{"generateCount", map[string]any{"count": max(0, min(times, MaxGenerated))}}
	}
	each := make([]PlannedEntry, len(run.Each))
	for i, given := range run.Each {
		done := map[string]*answered{}
		for id, a := range top {
			done[id] = a
		}
		if err := answer(r, g.Each.Steps, g.Steps, given, served, campaign, done); err != nil {
			return nil, nil, refusal(err)
		}
		each[i] = plan(r, g, g.Make.Each, done)
	}
	return root, each, nil
}
