package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// MaxManifestBytes bounds a user-written import before anything else reads it.
const MaxManifestBytes = 512 * 1024

// MaxFields caps the fields and derived values across a manifest.
const MaxFields = 2000

// Problem is one reason a manifest was refused, with the path of the offending entry, as importers read it.
type Problem struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

func formatPath(parts []any) string {
	var b strings.Builder
	for _, p := range parts {
		switch x := p.(type) {
		case int:
			fmt.Fprintf(&b, "[%d]", x)
		case string:
			if b.Len() > 0 {
				b.WriteByte('.')
			}
			b.WriteString(x)
		}
	}
	if b.Len() == 0 {
		return "(root)"
	}
	return b.String()
}

// The typed views below hold a manifest after the schema has parsed it, so they trust its shape. A union is one flat
// struct, read by its tag.
type (
	// FieldDef is one declared field.
	FieldDef struct {
		Type       string   `json:"type"`
		Label      string   `json:"label"`
		EditableBy string   `json:"editableBy"`
		Visibility string   `json:"visibility"`
		Min        *float64 `json:"min"`
		Max        *float64 `json:"max"`
		Entity     string   `json:"entity"`
		MaxLength  *float64 `json:"maxLength"`
		Values     []string `json:"values"`
		MaxItems   *float64 `json:"maxItems"`
	}
	// DerivedDef is one derived value.
	DerivedDef struct {
		ID         string `json:"id"`
		Label      string `json:"label"`
		Expr       string `json:"expr"`
		Visibility string `json:"visibility"`
	}
	// EntityType is one kind of actor or entry.
	EntityType struct {
		ID      string              `json:"id"`
		Base    string              `json:"base"`
		Fields  map[string]FieldDef `json:"fields"`
		Derived []DerivedDef        `json:"derived"`
	}
	// ResetRule is one resetOn entry.
	ResetRule struct {
		Event string `json:"event"`
		To    string `json:"to"`
	}
	// Resource is one declared resource.
	Resource struct {
		ID         string      `json:"id"`
		Label      string      `json:"label"`
		EditableBy string      `json:"editableBy"`
		Cite       *string     `json:"cite"`
		Scope      string      `json:"scope"`
		Entities   *[]string   `json:"entities"`
		Min        string      `json:"min"`
		Max        *string     `json:"max"`
		Capped     bool        `json:"capped"`
		ResetOn    []ResetRule `json:"resetOn"`
		Start      *string     `json:"start"`
		Visibility string      `json:"visibility"`
	}
	// Effect is one effect of a condition.
	Effect struct {
		Path     string   `json:"path"`
		Mode     string   `json:"mode"`
		Value    string   `json:"value"`
		Phase    string   `json:"phase"`
		Priority *float64 `json:"priority"`
		When     *string  `json:"when"`
		Cite     *string  `json:"cite"`
	}
	// Condition is one declared condition.
	Condition struct {
		ID         string   `json:"id"`
		Label      string   `json:"label"`
		Duration   string   `json:"duration"`
		Stacking   string   `json:"stacking"`
		MaxStacks  *float64 `json:"maxStacks"`
		Cite       *string  `json:"cite"`
		Effects    []Effect `json:"effects"`
		Visibility string   `json:"visibility"`
	}
	poolBandDef struct {
		ID    string  `json:"id"`
		From  float64 `json:"from"`
		To    float64 `json:"to"`
		Worth float64 `json:"worth"`
	}
	faceRangeDef struct {
		From float64 `json:"from"`
		To   float64 `json:"to"`
	}
	// ReportedOutcome is one result of a reported Test, best first.
	ReportedOutcome struct {
		ID    string  `json:"id"`
		Label string  `json:"label"`
		Cite  *string `json:"cite"`
	}
	// Test is a sumVsTarget, poolSuccesses or reported declaration.
	Test struct {
		Outcomes     []ReportedOutcome `json:"outcomes"`
		Kind         string            `json:"kind"`
		Target       string            `json:"target"`
		Inputs       map[string]string `json:"inputs"`
		InputOptions map[string]any    `json:"inputOptions"`
		// Entities names the actor types that take the Test (house decision #50); nil is every actor type.
		Entities  *[]string `json:"entities"`
		Cite      *string   `json:"cite"`
		Modifier  string    `json:"modifier"`
		Dice      string    `json:"dice"`
		Advantage bool      `json:"advantage"`
		CritOn    []float64 `json:"critOn"`
		Degrees   *struct {
			Step         float64 `json:"step"`
			NaturalShift bool    `json:"naturalShift"`
			Cite         *string `json:"cite"`
		} `json:"degrees"`
		Pool    string        `json:"pool"`
		Die     float64       `json:"die"`
		Bands   []poolBandDef `json:"bands"`
		Special *struct {
			Label string                  `json:"label"`
			Count float64                 `json:"count"`
			Flags map[string]faceRangeDef `json:"flags"`
		} `json:"special"`
		Shift *string `json:"shift"`
	}
	// Initiative is a ranked or seated declaration.
	Initiative struct {
		Strategy        string   `json:"strategy"`
		FirstPlayer     string   `json:"firstPlayer"`
		RerollEachRound bool     `json:"rerollEachRound"`
		Score           string   `json:"score"`
		Tiebreak        []string `json:"tiebreak"`
		Cite            *string  `json:"cite"`
	}
	// Scoring is a game's scoring declaration.
	Scoring struct {
		Mode      string `json:"mode"`
		Order     string `json:"order"`
		Score     string `json:"score"`
		Tiebreaks []struct {
			Expr  string `json:"expr"`
			Order string `json:"order"`
		} `json:"tiebreaks"`
		EndWhen []struct {
			When    string  `json:"when"`
			Outcome *string `json:"outcome"`
			Cite    *string `json:"cite"`
		} `json:"endWhen"`
		Cite *string `json:"cite"`
	}
	// HealthTrack is one health track.
	HealthTrack struct {
		Resource             string          `json:"resource"`
		Temp                 *string         `json:"temp"`
		DeathSaves           json.RawMessage `json:"deathSaves"`
		InstantDeathOverflow *string         `json:"instantDeathOverflow"`
	}
	// Health is the manifest's health block.
	Health struct {
		Tracks []HealthTrack `json:"tracks"`
		States []struct {
			ID    string  `json:"id"`
			Label *string `json:"label"`
			When  string  `json:"when"`
			// Entities names the actor types the state applies to (house decision #50); nil is every actor type.
			Entities *[]string `json:"entities"`
		} `json:"states"`
		Cite *string `json:"cite"`
	}
	copyRule struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	// CreationStep is one step of the builder.
	CreationStep struct {
		ID       string     `json:"id"`
		Actor    string     `json:"actor"`
		Cite     *string    `json:"cite"`
		Optional bool       `json:"optional"`
		Kind     string     `json:"kind"`
		Pick     string     `json:"pick"`
		Count    float64    `json:"count"`
		Copy     []copyRule `json:"copy"`
		Fields   []string   `json:"fields"`
		Method   *struct {
			Kind   string             `json:"kind"`
			Budget float64            `json:"budget"`
			Values []float64          `json:"values"`
			Min    float64            `json:"min"`
			Max    float64            `json:"max"`
			Costs  map[string]float64 `json:"costs"`
		} `json:"method"`
	}
	idAndCite struct {
		ID   string  `json:"id"`
		Cite *string `json:"cite"`
	}
	// Phase is one phase of a round.
	Phase struct {
		idAndCite
		Label string `json:"label"`
		Mode  string `json:"mode"`
	}
	// Ruleset is a parsed manifest. Normalized is the same document as decoded JSON, defaults applied: what gets stored
	// and hashed.
	Ruleset struct {
		Normalized map[string]any `json:"-"`

		ID      string `json:"id"`
		Extends *struct {
			ID string `json:"id"`
		} `json:"extends"`
		Sources []struct {
			ID      string `json:"id"`
			License string `json:"license"`
		} `json:"sources"`
		Options    []idAndCite            `json:"options"`
		Entities   []EntityType           `json:"entities"`
		Resources  []Resource             `json:"resources"`
		Conditions []Condition            `json:"conditions"`
		Tests      map[string]Test        `json:"tests"`
		Initiative *Initiative            `json:"initiative"`
		Phases     []Phase                `json:"phases"`
		Scoring    *Scoring               `json:"scoring"`
		Tables     map[string]RandomTable `json:"tables"`
		Health     Health                 `json:"health"`
		Creation   []CreationStep         `json:"creation"`
		Decisions  []idAndCite            `json:"decisions"`
		Game       *GameInfo              `json:"game"`
	}
	// GameInfo is the manifest's `game` block: what the game is and how a table can sit for it.
	GameInfo struct {
		Title  string   `json:"title"`
		Family *string  `json:"family"`
		Genres []string `json:"genres"`
		Modes  []string `json:"modes"`
		Cite   *string  `json:"cite"`
	}
)

// TableModes are the modes the ruleset allows; one with no `game` block is played with a GM.
func (r *Ruleset) TableModes() []string {
	if r.Game == nil {
		return []string{"gm"}
	}
	return r.Game.Modes
}

// Tests and fields are JSON objects, whose key order decoded JSON no longer knows, so problems about them come in
// sorted order. Which problems come back does not change.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.SortFunc(keys, compareUnits)
	return keys
}

type problems []Problem

func (p *problems) add(path, format string, args ...any) {
	*p = append(*p, Problem{path, fmt.Sprintf(format, args...)})
}

func (p *problems) duplicates(path string, ids []string) {
	seen := map[string]bool{}
	for i, id := range ids {
		if seen[id] {
			p.add(fmt.Sprintf("%s[%d].id", path, i), `duplicate id "%s"`, id)
		}
		seen[id] = true
	}
}

func idsOf[T any](items []T, id func(T) string) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = id(item)
	}
	return out
}

func (r *Ruleset) entity(id string) *EntityType {
	for i := range r.Entities {
		if r.Entities[i].ID == id {
			return &r.Entities[i]
		}
	}
	return nil
}

// Steps name real actor entities, pack entity types and fields, and no field has two writers.
func (p *problems) creation(r *Ruleset) {
	written := map[string]string{}
	claim := func(actor, field, step, path string) {
		key := actor + "/" + field
		if prev, taken := written[key]; taken {
			p.add(path, `"%s" is already set by step "%s"`, field, prev)
		} else {
			written[key] = step
		}
	}
	for i, step := range r.Creation {
		at := fmt.Sprintf("creation[%d]", i)
		actor := r.entity(step.Actor)
		if actor == nil || actor.Base != "actor" {
			p.add(at+".actor", `"%s" is not an actor entity`, step.Actor)
			continue
		}
		fieldOf := func(id, path string) *FieldDef {
			def, ok := actor.Fields[id]
			if !ok {
				p.add(path, `%s has no field "%s"`, actor.ID, id)
				return nil
			}
			return &def
		}
		if step.Kind == "choose" {
			picked := r.entity(step.Pick)
			if picked == nil {
				p.add(at+".pick", `unknown entity "%s"`, step.Pick)
			}
			if len(step.Copy) > 0 && step.Count != 1 {
				p.add(at+".copy", "copy needs count 1: with several picks it is ambiguous")
			}
			for j, c := range step.Copy {
				to := fieldOf(c.To, fmt.Sprintf("%s.copy[%d].to", at, j))
				var from *FieldDef
				if picked != nil {
					if def, ok := picked.Fields[c.From]; ok {
						from = &def
					} else {
						p.add(fmt.Sprintf("%s.copy[%d].from", at, j), `%s has no field "%s"`, picked.ID, c.From)
					}
				}
				if from != nil && to != nil && from.Type != to.Type {
					p.add(fmt.Sprintf("%s.copy[%d]", at, j), "a %s field cannot fill a %s field", from.Type, to.Type)
				}
				claim(actor.ID, c.To, step.ID, fmt.Sprintf("%s.copy[%d].to", at, j))
			}
			continue
		}
		for j, id := range step.Fields {
			path := fmt.Sprintf("%s.fields[%d]", at, j)
			def := fieldOf(id, path)
			if step.Kind == "assign" && def != nil && def.Type != "int" {
				p.add(path, "a scored field must be an int")
			}
			claim(actor.ID, id, step.ID, path)
		}
		if step.Kind != "assign" {
			continue
		}
		m := step.Method
		if m.Kind == "table" && len(m.Values) != len(step.Fields) {
			p.add(at+".method.values", "%d values for %d fields", len(m.Values), len(step.Fields))
		}
		if m.Kind == "pointBuy" {
			if m.Max < m.Min {
				p.add(at+".method.max", "max is below min")
			}
			// min and max are capped at ±1000 by the schema, so this loop is short.
			for score := m.Min; score <= m.Max; score++ {
				if _, ok := m.Costs[esNumber(score)]; !ok {
					p.add(at+".method.costs", "no cost for the score %s", esNumber(score))
					break
				}
			}
		}
	}
}

// Every face range fits the die, bands never overlap, and shift names a band.
func (p *problems) pool(t *Test, path string) {
	checkRange := func(from, to float64, at string) {
		if to < from {
			p.add(at+".to", "to is below from")
		}
		if to > t.Die {
			p.add(at+".to", "a d%s has no face %s", esNumber(t.Die), esNumber(to))
		}
	}
	p.duplicates(path+".bands", idsOf(t.Bands, func(b poolBandDef) string { return b.ID }))
	for i, b := range t.Bands {
		checkRange(b.From, b.To, fmt.Sprintf("%s.bands[%d]", path, i))
		for j, o := range t.Bands[:i] {
			if o.From <= b.To && b.From <= o.To {
				p.add(fmt.Sprintf("%s.bands[%d]", path, i), "overlaps bands[%d]", j)
				break
			}
		}
	}
	if t.Special != nil {
		for _, flag := range sortedKeys(t.Special.Flags) {
			f := t.Special.Flags[flag]
			checkRange(f.From, f.To, path+".special.flags."+flag)
		}
	}
	if t.Shift != nil && !slices.ContainsFunc(t.Bands, func(b poolBandDef) bool { return b.ID == *t.Shift }) {
		p.add(path+".shift", `no band "%s"`, *t.Shift)
	}
}

var reservedRoots = []string{"derived", "res", "party", "ctx", "max", "min", "true", "false"}

func (r *Ruleset) semanticProblems() problems {
	var p problems
	// CLAUDE.md principle 1: every rule entry cites its printed page, unless the whole ruleset is homebrew.
	homebrew := true
	for _, s := range r.Sources {
		homebrew = homebrew && s.License == "homebrew"
	}
	needCite := func(cite *string, path string) {
		if !homebrew && cite == nil {
			p.add(path+".cite", "a rule entry needs a cite")
		}
	}
	for i, x := range r.Resources {
		needCite(x.Cite, fmt.Sprintf("resources[%d]", i))
	}
	for i, x := range r.Options {
		needCite(x.Cite, fmt.Sprintf("options[%d]", i))
	}
	for i, c := range r.Conditions {
		needCite(c.Cite, fmt.Sprintf("conditions[%d]", i))
		for j, e := range c.Effects {
			cite := e.Cite
			if cite == nil {
				cite = c.Cite
			}
			needCite(cite, fmt.Sprintf("conditions[%d].effects[%d]", i, j))
		}
	}
	for _, id := range sortedKeys(r.Tests) {
		t := r.Tests[id]
		needCite(t.Cite, "tests."+id)
		if t.Degrees != nil {
			needCite(t.Degrees.Cite, "tests."+id+".degrees")
		}
		for j, o := range t.Outcomes {
			needCite(o.Cite, fmt.Sprintf("tests.%s.outcomes[%d]", id, j))
		}
	}
	if r.Initiative != nil {
		needCite(r.Initiative.Cite, "initiative")
	}
	for i, x := range r.Phases {
		needCite(x.Cite, fmt.Sprintf("phases[%d]", i))
	}
	for _, id := range sortedKeys(r.Tables) {
		t := r.Tables[id]
		needCite(t.Cite, "tables."+id)
		p.table(id, &t)
	}
	if s := r.Scoring; s != nil {
		needCite(s.Cite, "scoring")
		for i, x := range s.EndWhen {
			needCite(x.Cite, fmt.Sprintf("scoring.endWhen[%d]", i))
		}
		wins := false
		for i, x := range s.EndWhen {
			path := fmt.Sprintf("scoring.endWhen[%d].outcome", i)
			if s.Mode == "compete" && x.Outcome != nil {
				p.add(path, "only a cooperative game has an outcome")
			}
			if s.Mode == "coop" && x.Outcome == nil {
				p.add(path, "a cooperative trigger names its outcome")
			}
			wins = wins || (x.Outcome != nil && *x.Outcome == "win")
		}
		if s.Mode == "coop" && !wins {
			p.add("scoring.endWhen", "a cooperative game needs a trigger that wins")
		}
	}
	// Playing without a GM or alone is a rule of the game, so it is cited (principle 1).
	if r.Game != nil && slices.ContainsFunc(r.Game.Modes, func(m string) bool { return m != "gm" }) {
		needCite(r.Game.Cite, "game")
	}
	// Death saves and damage order are rules too.
	if len(r.Health.Tracks) > 0 {
		needCite(r.Health.Cite, "health")
	}
	for i, x := range r.Creation {
		needCite(x.Cite, fmt.Sprintf("creation[%d]", i))
	}

	fieldCount := 0
	for _, e := range r.Entities {
		fieldCount += len(e.Fields) + len(e.Derived)
	}
	if fieldCount > MaxFields {
		p.add("entities", "%d fields, over the cap of %d", fieldCount, MaxFields)
	}
	if r.Extends != nil && r.Extends.ID == r.ID {
		p.add("extends.id", "a ruleset cannot extend itself")
	}
	idOf := func(x idAndCite) string { return x.ID }
	p.duplicates("sources", func() []string {
		out := make([]string, len(r.Sources))
		for i, s := range r.Sources {
			out[i] = s.ID
		}
		return out
	}())
	p.duplicates("entities", idsOf(r.Entities, func(e EntityType) string { return e.ID }))
	p.duplicates("resources", idsOf(r.Resources, func(x Resource) string { return x.ID }))
	p.duplicates("conditions", idsOf(r.Conditions, func(x Condition) string { return x.ID }))
	p.duplicates("phases", idsOf(r.Phases, func(x Phase) string { return x.ID }))
	p.duplicates("options", idsOf(r.Options, idOf))
	p.duplicates("creation", idsOf(r.Creation, func(x CreationStep) string { return x.ID }))
	p.duplicates("decisions", idsOf(r.Decisions, idOf))
	p.creation(r)

	for i, e := range r.Entities {
		p.duplicates(fmt.Sprintf("entities[%d].derived", i), idsOf(e.Derived, func(d DerivedDef) string { return d.ID }))
		ids := sortedKeys(e.Fields)
		for _, id := range ids {
			path := fmt.Sprintf("entities[%d].fields.%s", i, id)
			root, _, _ := strings.Cut(id, ".")
			if slices.Contains(reservedRoots, root) {
				p.add(path, `"%s" is reserved for expressions`, root)
			}
			// attr and attr.str cannot both be fields: attr would be a value and a group at once.
			if slices.ContainsFunc(ids, func(other string) bool { return strings.HasPrefix(other, id+".") }) {
				p.add(path, "is also a group of other fields")
			}
			def := e.Fields[id]
			if def.Type == "ref" && r.entity(def.Entity) == nil {
				p.add(path+".entity", `unknown entity "%s"`, def.Entity)
			}
			if def.Type == "int" && def.Min != nil && def.Max != nil && *def.Max < *def.Min {
				p.add(path+".max", "max is below min")
			}
		}
	}

	for i, x := range r.Resources {
		if x.Entities != nil {
			for j, id := range *x.Entities {
				if r.entity(id) == nil {
					p.add(fmt.Sprintf("resources[%d].entities[%d]", i, j), `unknown entity "%s"`, id)
				}
			}
			if x.Scope != "entity" {
				p.add(fmt.Sprintf("resources[%d].entities", i), "only an entity-scoped resource names entities")
			}
		}
	}

	trackResource := func(id, path string) {
		// The last declaration wins, as in TypeScript's Map built from the list.
		var res *Resource
		for i := range r.Resources {
			if r.Resources[i].ID == id {
				res = &r.Resources[i]
			}
		}
		if res == nil {
			p.add(path, `unknown resource "%s"`, id)
		} else if res.Scope != "entity" {
			p.add(path, `"%s" must be an entity-scoped resource`, id)
		}
	}
	withDeathSaves := 0
	for i, t := range r.Health.Tracks {
		trackResource(t.Resource, fmt.Sprintf("health.tracks[%d].resource", i))
		if t.Temp != nil {
			trackResource(*t.Temp, fmt.Sprintf("health.tracks[%d].temp", i))
		}
		if t.DeathSaves != nil {
			withDeathSaves++
		}
	}
	// One dying/stable/dead status per actor, so only one track can run death saves.
	if withDeathSaves > 1 {
		p.add("health.tracks", "only one track may have deathSaves")
	}

	actorTypes := func(ids *[]string, path string) {
		if ids == nil {
			return
		}
		for j, id := range *ids {
			if e := r.entity(id); e == nil {
				p.add(fmt.Sprintf("%s[%d]", path, j), `unknown entity "%s"`, id)
			} else if e.Base != "actor" {
				p.add(fmt.Sprintf("%s[%d]", path, j), `"%s" is not an actor entity`, id)
			}
		}
	}
	for i, s := range r.Health.States {
		actorTypes(s.Entities, fmt.Sprintf("health.states[%d].entities", i))
	}

	for _, id := range sortedKeys(r.Tests) {
		t := r.Tests[id]
		path := "tests." + id
		actorTypes(t.Entities, path+".entities")
		for _, key := range sortedKeys(t.InputOptions) {
			if t.Inputs[key] != "text" {
				p.add(path+".inputOptions."+key, "options are only for text inputs")
			}
		}
		if t.Kind == "poolSuccesses" {
			p.pool(&t, path)
			continue
		}
		if t.Kind == "reported" {
			seen := map[string]bool{}
			for j, o := range t.Outcomes {
				if seen[o.ID] {
					p.add(fmt.Sprintf("%s.outcomes[%d].id", path, j), `duplicate outcome "%s"`, o.ID)
				}
				seen[o.ID] = true
			}
			continue
		}
		count, sides, ok := PlainDice(t.Dice)
		if !ok {
			p.add(path+".dice", "sumVsTarget takes plain NdX dice")
			continue
		}
		if t.Advantage && count != 1 {
			p.add(path+".advantage", "advantage needs a single die (1dX)")
		}
		for j, n := range t.CritOn {
			if n > float64(count*sides) {
				p.add(fmt.Sprintf("%s.critOn[%d]", path, j), "%s cannot be rolled", esNumber(n))
			}
		}
		if t.Degrees != nil {
			if t.CritOn != nil {
				p.add(path+".critOn", "degrees replace critOn")
			}
			if t.Degrees.NaturalShift && count != 1 {
				p.add(path+".degrees.naturalShift", "a natural shift needs a single die (1dX)")
			}
		}
	}
	return p
}

// ValidateRuleset takes a manifest as decoded JSON: size cap, schema, then the rules a schema can't say.
func ValidateRuleset(input any) (*Ruleset, []Problem) {
	if size := len(CanonicalJSON(input)); size > MaxManifestBytes {
		return nil, []Problem{{"(root)", fmt.Sprintf("%d bytes, over the cap of %d", size, MaxManifestBytes)}}
	}
	parsed, issues := schema.Parse(rulesetSchema, input)
	if len(issues) > 0 {
		out := make([]Problem, len(issues))
		for i, issue := range issues {
			out[i] = Problem{formatPath(issue.Path), issue.Message}
		}
		return nil, out
	}
	raw, err := json.Marshal(parsed)
	if err != nil {
		panic(err)
	}
	r := &Ruleset{Normalized: parsed.(map[string]any)}
	if err := json.Unmarshal(raw, r); err != nil {
		panic(err)
	}
	if found := r.semanticProblems(); len(found) > 0 {
		return nil, found
	}
	return r, nil
}
