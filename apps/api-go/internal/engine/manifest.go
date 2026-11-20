package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// MaxManifestBytes bounds a user-written import before anything else reads it.
const MaxManifestBytes = 512 * 1024

// MaxCampaignFields caps the campaign fields of a manifest.
const MaxCampaignFields = 50

// MaxFields caps the fields and derived values across a manifest.
const MaxFields = 2000

// CodexKinds are the kinds of codex entry (rules-engine CodexEntryKind; coreschema's list is this one).
var CodexKinds = []string{"adventure", "scene", "npc", "location", "faction", "item", "handout", "quest", "lore"}

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
		// Labels and Notes are an enum's words for its values (house decision #71); nil when it declares none.
		Labels map[string]string `json:"labels"`
		Notes  map[string]string `json:"notes"`
	}
	// CampaignFieldDef is one campaign field: an int has Min and Max, an enum Values; Default is a number, a word or a
	// bool by the type.
	CampaignFieldDef struct {
		Type    string            `json:"type"`
		Label   string            `json:"label"`
		Cite    *string           `json:"cite"`
		Min     float64           `json:"min"`
		Max     float64           `json:"max"`
		Values  []string          `json:"values"`
		Labels  map[string]string `json:"labels"`
		Notes   map[string]string `json:"notes"`
		Default any               `json:"default"`
	}
	// CodexBlock is the manifest's codex block (house decision #71): the fields each kind of entry carries, by kind.
	// Its FieldDefs have no EditableBy and are never a list.
	CodexBlock struct {
		Kinds map[string]CodexKind `json:"kinds"`
	}
	// CodexKind is what one kind of codex entry carries.
	CodexKind struct {
		Fields map[string]FieldDef `json:"fields"`
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
	// SideCost is a shared pool paid for a side's action out of turn, or to lift a bar.
	SideCost struct {
		Pool   string  `json:"pool"`
		Amount float64 `json:"amount"`
	}
	// Side is one side of a sides initiative.
	Side struct {
		ID       string    `json:"id"`
		Label    string    `json:"label"`
		Entities *[]string `json:"entities"`
	}
	// Initiative is a ranked, seated or sides declaration. Setup, OutOfTurn, Hold and Barred are nil when absent.
	Initiative struct {
		Strategy        string    `json:"strategy"`
		FirstPlayer     string    `json:"firstPlayer"`
		RerollEachRound bool      `json:"rerollEachRound"`
		Score           string    `json:"score"`
		Tiebreak        []string  `json:"tiebreak"`
		Cite            *string   `json:"cite"`
		Sides           []Side    `json:"sides"`
		UnableStates    *[]string `json:"unableStates"`
		FirstSide       string    `json:"firstSide"`
		RoundEnd        string    `json:"roundEnd"`
		Setup           *struct {
			Cite *string `json:"cite"`
		} `json:"setup"`
		OutOfTurn *struct {
			Cost map[string]SideCost `json:"cost"`
			Cite *string             `json:"cite"`
		} `json:"outOfTurn"`
		Hold *struct {
			Cite *string `json:"cite"`
		} `json:"hold"`
		Barred *struct {
			ThroughRound float64             `json:"throughRound"`
			LiftCost     map[string]SideCost `json:"liftCost"`
			Cite         *string             `json:"cite"`
		} `json:"barred"`
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
		States []HealthState `json:"states"`
		Cite   *string       `json:"cite"`
		// Harm is nil when the ruleset declares no damage that counts up (house decision #66).
		Harm *Harm `json:"harm"`
	}
	// Harm is health.harm: damage that counts up toward a limit, and mobs (house decision #66).
	Harm struct {
		Cite   *string `json:"cite"`
		Wounds string  `json:"wounds"`
		Shock  *string `json:"shock"`
		Mob    *struct {
			Members string `json:"members"`
			Start   string `json:"start"`
		} `json:"mob"`
		Profiles []HarmProfile `json:"profiles"`
	}
	// HarmProfile is how one group of actor types takes a hit.
	HarmProfile struct {
		Entities  []string `json:"entities"`
		Shockless *string  `json:"shockless"`
		Spent     *struct {
			When       *string  `json:"when"`
			Conditions []string `json:"conditions"`
		} `json:"spent"`
		Felled *struct {
			When      string  `json:"when"`
			Injuries  *string `json:"injuries"`
			Condition *string `json:"condition"`
			HealTo    *string `json:"healTo"`
		} `json:"felled"`
		Destroyed *struct {
			Over  string `json:"over"`
			Field string `json:"field"`
		} `json:"destroyed"`
	}
	// HealthState is one display state of the health block.
	HealthState struct {
		ID    string  `json:"id"`
		Label *string `json:"label"`
		When  string  `json:"when"`
		// Entities names the actor types the state applies to (house decision #50); nil is every actor type.
		Entities *[]string `json:"entities"`
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
		Options   []idAndCite  `json:"options"`
		Entities  []EntityType `json:"entities"`
		Resources []Resource   `json:"resources"`
		// CampaignFields is nil when the manifest declares none.
		CampaignFields map[string]CampaignFieldDef `json:"campaignFields"`
		Conditions     []Condition                 `json:"conditions"`
		Tests          map[string]Test             `json:"tests"`
		Initiative     *Initiative                 `json:"initiative"`
		Phases         []Phase                     `json:"phases"`
		Scoring        *Scoring                    `json:"scoring"`
		Tables         map[string]RandomTable      `json:"tables"`
		Health         Health                      `json:"health"`
		Creation       []CreationStep              `json:"creation"`
		// Build is nil when no actor type is built by the ledger builder.
		Build     *LedgerBuild `json:"build"`
		Decisions []idAndCite  `json:"decisions"`
		Game      *GameInfo    `json:"game"`
		// Codex is nil when entries carry no declared fields (house decision #71).
		Codex *CodexBlock `json:"codex"`
	}
	// LedgerBuild is the manifest's build block (house decision #62). Params is parsed by ValidateRuleset.
	LedgerBuild struct {
		Actor  string            `json:"actor"`
		Params *ledger.Params    `json:"-"`
		Kinds  map[string]string `json:"kinds"`
		Sheet  struct {
			Attributes   map[string]string `json:"attributes"`
			Skills       map[string]string `json:"skills"`
			Mods         map[string]string `json:"mods"`
			ArmourRating string            `json:"armourRating"`
			Powered      string            `json:"powered"`
			Speed        string            `json:"speed"`
			Species      string            `json:"species"`
			Archetype    string            `json:"archetype"`
			Keywords     string            `json:"keywords"`
			Wealth       *string           `json:"wealth"`
			Corruption   *string           `json:"corruption"`
		} `json:"sheet"`
		Tier string  `json:"tier"`
		XP   *string `json:"xp"`
		// Ascension, Gone and Award are play after creation (house decision #64): nil, empty and nil when absent.
		Ascension *struct {
			XP float64 `json:"xp"`
		} `json:"ascension"`
		Gone  []string `json:"gone"`
		Award *struct {
			Max       float64   `json:"max"`
			Suggested []float64 `json:"suggested"`
		} `json:"award"`
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
// harm is harmProblems of manifest.ts: health.harm's resources, fields and conditions (house decision #66).
func (p *problems) harm(r *Ruleset, harm *Harm, actorTypes func(*[]string, string)) {
	// The last declaration wins, as in TypeScript's Map built from the list.
	resources := map[string]*Resource{}
	for i := range r.Resources {
		resources[r.Resources[i].ID] = &r.Resources[i]
	}
	tracked := map[string]bool{}
	for _, t := range r.Health.Tracks {
		tracked[t.Resource] = true
		if t.Temp != nil {
			tracked[*t.Temp] = true
		}
	}
	type named struct {
		key    string
		id     *string
		capped bool
	}
	list := []named{{"wounds", &harm.Wounds, false}, {"shock", harm.Shock, false}}
	if harm.Mob != nil {
		list = append(list, named{"mob.members", &harm.Mob.Members, true})
	}
	used := map[string]string{}
	for _, n := range list {
		if n.id == nil {
			continue
		}
		id, path := *n.id, "health.harm."+n.key
		res := resources[id]
		other, taken := used[id]
		switch {
		case res == nil:
			p.add(path, `unknown resource "%s"`, id)
		case res.Scope != "entity":
			p.add(path, `"%s" must be an entity-scoped resource`, id)
		case tracked[id]:
			p.add(path, `"%s" is already a health track`, id)
		case taken:
			p.add(path, `"%s" is already health.harm.%s`, id, other)
		case res.Capped != n.capped && n.capped:
			p.add(path, `"%s" must be capped`, id)
		case res.Capped != n.capped:
			p.add(path, `"%s" must be declared capped: false`, id)
		}
		if !taken {
			used[id] = n.key
		}
	}
	var actors []*EntityType
	for i := range r.Entities {
		if r.Entities[i].Base == "actor" {
			actors = append(actors, &r.Entities[i])
		}
	}
	fieldOf := func(e *EntityType, id, typ, path string) {
		if def, ok := e.Fields[id]; !ok || def.Type != typ {
			p.add(path, `"%s" has no %s field "%s"`, e.ID, typ, id)
		}
	}
	if mob := harm.Mob; mob != nil {
		if members := resources[mob.Members]; members != nil && members.Scope == "entity" {
			for _, e := range actors {
				if members.Entities == nil || slices.Contains(*members.Entities, e.ID) {
					fieldOf(e, mob.Start, "int", "health.harm.mob.start")
				}
			}
		}
	}
	condition := func(id, path string) {
		if !slices.ContainsFunc(r.Conditions, func(c Condition) bool { return c.ID == id }) {
			p.add(path, `unknown condition "%s"`, id)
		}
	}
	profiled := map[string]int{}
	for i, x := range harm.Profiles {
		path := fmt.Sprintf("health.harm.profiles[%d]", i)
		actorTypes(&x.Entities, path+".entities")
		for j, id := range x.Entities {
			if other, taken := profiled[id]; taken {
				p.add(fmt.Sprintf("%s.entities[%d]", path, j), `"%s" is already in profiles[%d]`, id, other)
			} else {
				profiled[id] = i
			}
		}
		for _, e := range actors {
			if !slices.Contains(x.Entities, e.ID) {
				continue
			}
			if x.Felled != nil && x.Felled.Injuries != nil {
				fieldOf(e, *x.Felled.Injuries, "int", path+".felled.injuries")
			}
			if x.Destroyed != nil {
				fieldOf(e, x.Destroyed.Field, "bool", path+".destroyed.field")
			}
		}
		if x.Spent != nil {
			for j, id := range x.Spent.Conditions {
				condition(id, fmt.Sprintf("%s.spent.conditions[%d]", path, j))
			}
		}
		if x.Felled != nil && x.Felled.Condition != nil {
			condition(*x.Felled.Condition, path+".felled.condition")
		}
	}
}

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

var reservedRoots = []string{"derived", "res", "party", "campaign", "ctx", "max", "min", "true", "false"}

// Words an expression reads as themselves, so a campaign field may not take them.
var expressionWords = []string{"true", "false", "max", "min"}

func (p *problems) campaignFields(r *Ruleset, needCite func(*string, string)) {
	for _, id := range sortedKeys(r.CampaignFields) {
		def := r.CampaignFields[id]
		path := "campaignFields." + id
		if slices.Contains(expressionWords, id) {
			p.add(path, `"%s" is reserved for expressions`, id)
		}
		needCite(def.Cite, path)
		switch def.Type {
		case "int":
			if def.Max < def.Min {
				p.add(path+".max", "max is below min")
			}
			if n := def.Default.(float64); n < def.Min || n > def.Max {
				p.add(path+".default", "the default is not allowed")
			}
		case "enum":
			seen := map[string]bool{}
			for i, v := range def.Values {
				if seen[v] {
					p.add(fmt.Sprintf("%s.values[%d]", path, i), `duplicate id "%s"`, v)
				}
				seen[v] = true
			}
			if !slices.Contains(def.Values, def.Default.(string)) {
				p.add(path+".default", "the default is not allowed")
			}
			p.enumWords(path, def.Values, def.Labels, def.Notes)
		}
	}
}

// enumWords checks that an enum's labels and notes name only its own values.
func (p *problems) enumWords(path string, values []string, labels, notes map[string]string) {
	for key, words := range map[string]map[string]string{"labels": labels, "notes": notes} {
		for _, value := range sortedKeys(words) {
			if !slices.Contains(values, value) {
				p.add(path+"."+key+"."+value, `"%s" is not a value`, value)
			}
		}
	}
}

// codex checks the codex block (house decision #71): a ref names a declared entity, an int range is the right way up,
// an enum's words name its values.
func (p *problems) codex(r *Ruleset) {
	if r.Codex == nil {
		return
	}
	for _, kind := range sortedKeys(r.Codex.Kinds) {
		fields := r.Codex.Kinds[kind].Fields
		for _, id := range sortedKeys(fields) {
			def, path := fields[id], "codex.kinds."+kind+".fields."+id
			if def.Type == "ref" && r.entity(def.Entity) == nil {
				p.add(path+".entity", `unknown entity "%s"`, def.Entity)
			}
			if def.Type == "int" && def.Min != nil && def.Max != nil && *def.Max < *def.Min {
				p.add(path+".max", "max is below min")
			}
			if def.Type == "enum" {
				p.enumWords(path, def.Values, def.Labels, def.Notes)
			}
		}
	}
}

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
	p.campaignFields(r, needCite)
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
		if i := r.Initiative; i.Strategy == "sides" {
			if i.Setup != nil {
				needCite(i.Setup.Cite, "initiative.setup")
			}
			if i.OutOfTurn != nil {
				needCite(i.OutOfTurn.Cite, "initiative.outOfTurn")
			}
			if i.Hold != nil {
				needCite(i.Hold.Cite, "initiative.hold")
			}
			if i.Barred != nil {
				needCite(i.Barred.Cite, "initiative.barred")
			}
		}
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
	if r.Health.Harm != nil {
		needCite(r.Health.Harm.Cite, "health.harm")
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
	if i := r.Initiative; i != nil && i.Strategy == "sides" {
		p.duplicates("initiative.sides", idsOf(i.Sides, func(x Side) string { return x.ID }))
		if r.Phases != nil {
			p.add("phases", "sides do not combine with phases yet")
		}
	}
	p.duplicates("options", idsOf(r.Options, idOf))
	p.duplicates("creation", idsOf(r.Creation, func(x CreationStep) string { return x.ID }))
	p.duplicates("decisions", idsOf(r.Decisions, idOf))
	p.creation(r)
	p.build(r)

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
			if def.Type == "enum" {
				p.enumWords(path, def.Values, def.Labels, def.Notes)
			}
		}
	}
	p.codex(r)

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

	if i := r.Initiative; i != nil && i.Strategy == "sides" {
		p.sideCosts(r, i)
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
	if r.Health.Harm != nil {
		p.harm(r, r.Health.Harm, actorTypes)
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
	if r.Build != nil {
		// The schema has run ledger.ParamsSchema, refinements included, so these parse.
		if r.Build.Params, err = ledger.ParseParams(r.Normalized["build"].(map[string]any)["params"]); err != nil {
			panic(err)
		}
	}
	if found := r.semanticProblems(); len(found) > 0 {
		return nil, found
	}
	return r, nil
}

// sideCosts checks that every cost of a sides initiative names a declared side and a shared pool.
func (p *problems) sideCosts(r *Ruleset, init *Initiative) {
	listed := map[string]string{}
	for i, side := range init.Sides {
		if side.Entities == nil {
			continue
		}
		for j, id := range *side.Entities {
			path := fmt.Sprintf("initiative.sides[%d].entities[%d]", i, j)
			if e := r.entity(id); e == nil {
				p.add(path, `unknown entity "%s"`, id)
			} else if e.Base != "actor" {
				p.add(path, `"%s" is not an actor entity`, id)
			}
			if other, taken := listed[id]; taken {
				p.add(path, `"%s" is already on side "%s"`, id, other)
			} else {
				listed[id] = side.ID
			}
		}
	}
	if init.UnableStates != nil {
		for i, id := range *init.UnableStates {
			declared := false
			for _, st := range r.Health.States {
				declared = declared || st.ID == id
			}
			if !declared {
				p.add(fmt.Sprintf("initiative.unableStates[%d]", i), `unknown health state "%s"`, id)
			}
		}
	}
	declared := map[string]bool{}
	for _, side := range init.Sides {
		declared[side.ID] = true
	}
	costs := func(record map[string]SideCost, path string) {
		for _, side := range sortedKeys(record) {
			cost := record[side]
			if !declared[side] {
				p.add(path+"."+side, `unknown side "%s"`, side)
			}
			// The last declaration wins, as in TypeScript's Map built from the list.
			var res *Resource
			for i := range r.Resources {
				if r.Resources[i].ID == cost.Pool {
					res = &r.Resources[i]
				}
			}
			if res == nil {
				p.add(path+"."+side+".pool", `unknown resource "%s"`, cost.Pool)
			} else if res.Scope == "entity" {
				p.add(path+"."+side+".pool", `"%s" must be a shared pool`, cost.Pool)
			}
		}
	}
	if init.OutOfTurn != nil {
		costs(init.OutOfTurn.Cost, "initiative.outOfTurn.cost")
	}
	if init.Barred != nil {
		costs(init.Barred.LiftCost, "initiative.barred.liftCost")
	}
}
