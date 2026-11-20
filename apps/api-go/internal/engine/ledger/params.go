package ledger

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/params.ts: everything the ledger builder takes from a ruleset instead of
// from code. Numbers are float64, as JavaScript holds them.

// Params is a parsed BuildParams. Build one with ParseParams.
type Params struct {
	Vocabulary struct {
		Attributes []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"attributes"`
		Skills []struct {
			Name      string `json:"name"`
			Attribute string `json:"attribute"`
		} `json:"skills"`
		Mods []struct {
			Key             string  `json:"key"`
			Label           *string `json:"label,omitempty"`
			BackgroundBonus bool    `json:"backgroundBonus"`
		} `json:"mods"`
		SubFactionTypes  []string `json:"subFactionTypes"`
		TalentCategories []string `json:"talentCategories"`
		SpeciesSizes     []string `json:"speciesSizes"`
		WargearKinds     []string `json:"wargearKinds"`
		UpgradeSlots     []string `json:"upgradeSlots"`
		BackgroundRows   []string `json:"backgroundRows"`
	} `json:"vocabulary"`
	Sources struct {
		PageSep string `json:"pageSep"`
		List    []struct {
			ID       string `json:"id"`
			Cite     string `json:"cite"`
			Official bool   `json:"official"`
		} `json:"list"`
	} `json:"sources"`
	Tiers struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
	} `json:"tiers"`
	StartingXp struct {
		PerTier float64 `json:"perTier"`
		Cite    string  `json:"cite"`
	} `json:"startingXp"`
	Rank struct {
		XpPerRank float64 `json:"xpPerRank"`
		Top       float64 `json:"top"`
		Cite      string  `json:"cite"`
	} `json:"rank"`
	AttributeXp priceTable `json:"attributeXp"`
	SkillXp     priceTable `json:"skillXp"`
	SpeciesMax  struct {
		CapTop float64 `json:"capTop"`
		Cite   string  `json:"cite"`
	} `json:"speciesMax"`
	TreeOfLearning struct {
		Enabled bool   `json:"enabled"`
		Cite    string `json:"cite"`
	} `json:"treeOfLearning"`
	Wealth struct {
		Xp              float64 `json:"xp"`
		MaxBought       float64 `json:"maxBought"`
		StartingPerTier float64 `json:"startingPerTier"`
		Cite            string  `json:"cite"`
	} `json:"wealth"`
	Languages struct {
		Xp               float64 `json:"xp"`
		FreeFromKeywords float64 `json:"freeFromKeywords"`
		Cite             string  `json:"cite"`
	} `json:"languages"`
	Background struct {
		BonusAmount float64 `json:"bonusAmount"`
	} `json:"background"`
	Advanced struct {
		BonusXpPerTier   float64 `json:"bonusXpPerTier"`
		AbilityXpPerTier float64 `json:"abilityXpPerTier"`
		Wargear          struct {
			Rows []struct {
				Total    float64  `json:"total"`
				Max      *float64 `json:"max"`
				Rare     float64  `json:"rare"`
				VeryRare float64  `json:"veryRare"`
			} `json:"rows"`
			Cite string `json:"cite"`
		} `json:"wargear"`
	} `json:"advanced"`
	ArchetypeAscension struct {
		MinRank float64 `json:"minRank"`
		Cite    string  `json:"cite"`
	} `json:"archetypeAscension"`
	Rarity struct {
		Order    []string `json:"order"`
		Rare     string   `json:"rare"`
		VeryRare string   `json:"veryRare"`
		Refused  []string `json:"refused"`
	} `json:"rarity"`
	Keywords struct {
		GeneSeedSkip      string `json:"geneSeedSkip"`
		Any               string `json:"any"`
		AnyTwo            string `json:"anyTwo"`
		PlaceholderMarker string `json:"placeholderMarker"`
		PlaceholderCite   string `json:"placeholderCite"`
	} `json:"keywords"`
	Links struct {
		Influence     string `json:"influence"`
		PoweredArmour string `json:"poweredArmour"`
	} `json:"links"`
	Weapon struct {
		MeleeMaxReach float64 `json:"meleeMaxReach"`
		ThrownTrait   string  `json:"thrownTrait"`
	} `json:"weapon"`
	MovementTrait string  `json:"movementTrait"`
	DefaultSpeed  float64 `json:"defaultSpeed"`
	Cites         struct {
		ArchetypeTier          string `json:"archetypeTier"`
		AdvancedCreation       string `json:"advancedCreation"`
		AdvancedWargear        string `json:"advancedWargear"`
		CreationAscension      string `json:"creationAscension"`
		AscensionSteps         string `json:"ascensionSteps"`
		ArchetypeAscension     string `json:"archetypeAscension"`
		ArchetypeAscensionRank string `json:"archetypeAscensionRank"`
		AdvancementXp          string `json:"advancementXp"`
		Background             string `json:"background"`
		SpeciesMax             string `json:"speciesMax"`
		GM                     string `json:"gm"`
		BackgroundBonus        string `json:"backgroundBonus"`
		WriteInKeyword         string `json:"writeInKeyword"`
		WriteInLanguage        string `json:"writeInLanguage"`
	} `json:"cites"`

	vocab    vocab
	movement *regexp.Regexp
	schemas  *Schemas
}

// A cumulative price table: the XP to reach each rating, by rating.
type priceTable struct {
	Table []float64 `json:"table"`
	Cite  string    `json:"cite"`
}

var (
	citeS    = schema.String().Min(1).Max(80)
	nameS    = schema.String().Min(1).Max(60)
	countS   = schema.Int().Min(0)
	pricingS = schema.Array(countS).Min(2)
	atLeast1 = schema.Int().Min(1)
)

func priced() schema.Schema {
	return schema.Object(schema.Req("table", pricingS), schema.Req("cite", citeS))
}

func withCite(fields ...schema.Field) schema.Schema {
	return schema.Object(append(fields, schema.Req("cite", citeS))...)
}

var paramsSchema = schema.Object(
	schema.Req("vocabulary", schema.Object(
		schema.Req("attributes", schema.Array(schema.Object(schema.Req("id", nameS), schema.Req("name", nameS))).Min(1)),
		schema.Req("skills", schema.Array(schema.Object(schema.Req("name", nameS), schema.Req("attribute", nameS))).Min(1)),
		schema.Req("mods", schema.Array(schema.Object(
			schema.Req("key", nameS), schema.Opt("label", nameS), schema.Def("backgroundBonus", schema.Bool(), true),
		)).Min(1)),
		schema.Req("subFactionTypes", schema.Array(nameS).Min(1)),
		schema.Req("talentCategories", schema.Array(nameS).Min(1)),
		schema.Req("speciesSizes", schema.Array(nameS).Min(1)),
		schema.Req("wargearKinds", schema.Array(nameS).Min(1)),
		schema.Req("upgradeSlots", schema.Array(nameS).Min(1)),
		schema.Req("backgroundRows", schema.Array(nameS).Min(1)),
	)),
	schema.Req("sources", schema.Object(
		schema.Req("pageSep", schema.String().Min(1).Max(10)),
		schema.Req("list", schema.Array(schema.Object(
			schema.Req("id", schema.String().Regex(`^[a-z0-9-]+$`, "Invalid string: must match pattern /^[a-z0-9-]+$/")),
			schema.Req("cite", nameS),
			schema.Req("official", schema.Bool()),
		)).Min(1)),
	)),
	schema.Req("tiers", schema.Object(schema.Req("min", atLeast1), schema.Req("max", atLeast1))),
	schema.Req("startingXp", withCite(schema.Req("perTier", countS))),
	schema.Req("rank", withCite(schema.Req("xpPerRank", atLeast1), schema.Req("top", atLeast1))),
	schema.Req("attributeXp", priced()),
	schema.Req("skillXp", priced()),
	schema.Req("speciesMax", withCite(schema.Req("capTop", atLeast1))),
	schema.Req("treeOfLearning", withCite(schema.Req("enabled", schema.Bool()))),
	schema.Req("wealth", withCite(
		schema.Req("xp", countS), schema.Req("maxBought", countS), schema.Req("startingPerTier", countS),
	)),
	schema.Req("languages", withCite(schema.Req("xp", countS), schema.Req("freeFromKeywords", countS))),
	schema.Req("background", schema.Object(schema.Req("bonusAmount", atLeast1))),
	schema.Req("advanced", schema.Object(
		schema.Req("bonusXpPerTier", countS),
		schema.Req("abilityXpPerTier", countS),
		schema.Req("wargear", schema.Object(
			schema.Req("rows", schema.Array(schema.Object(
				schema.Req("total", countS),
				schema.Req("max", schema.Nullable(countS)),
				schema.Req("rare", countS),
				schema.Req("veryRare", countS),
			)).Min(1)),
			schema.Req("cite", citeS),
		)),
	)),
	schema.Req("archetypeAscension", withCite(schema.Req("minRank", atLeast1))),
	schema.Req("rarity", schema.Object(
		schema.Req("order", schema.Array(nameS).Min(1)),
		schema.Req("rare", nameS),
		schema.Req("veryRare", nameS),
		schema.Req("refused", schema.Array(nameS)),
	)),
	schema.Req("keywords", schema.Object(
		schema.Req("geneSeedSkip", nameS),
		schema.Req("any", nameS),
		schema.Req("anyTwo", nameS),
		schema.Req("placeholderMarker", schema.String().Min(1).Max(4)),
		schema.Req("placeholderCite", citeS),
	)),
	schema.Req("links", schema.Object(schema.Req("influence", nameS), schema.Req("poweredArmour", nameS))),
	schema.Req("weapon", schema.Object(
		schema.Req("meleeMaxReach", atLeast1),
		schema.Req("thrownTrait", schema.String().Min(1).Max(60)),
	)),
	schema.Req("movementTrait", schema.String().Min(1).Max(120)),
	schema.Req("defaultSpeed", countS),
	schema.Req("cites", schema.Object(
		schema.Req("archetypeTier", citeS),
		schema.Req("advancedCreation", citeS),
		schema.Req("advancedWargear", citeS),
		schema.Req("creationAscension", citeS),
		schema.Req("ascensionSteps", citeS),
		schema.Req("archetypeAscension", citeS),
		schema.Req("archetypeAscensionRank", citeS),
		schema.Req("advancementXp", citeS),
		schema.Req("background", citeS),
		schema.Req("speciesMax", citeS),
		schema.Req("gm", citeS),
		schema.Req("backgroundBonus", citeS),
		schema.Req("writeInKeyword", citeS),
		schema.Req("writeInLanguage", citeS),
	)),
)

// ParseParams is BuildParams.parse: the schema, then its superRefine, then the schemas built from the vocabularies.
//
// ponytail: movementTrait is compiled by Go's regexp (RE2), not JavaScript's RegExp; the two agree on anchors, classes,
// groups and quantifiers, and differ on lookaround, backreferences and some escapes. Write patterns in the shared part.
func ParseParams(input any) (*Params, error) {
	out, issues := schema.Parse(paramsSchema, input)
	if len(issues) > 0 {
		return nil, errors.New(schema.Prettify(issues))
	}
	p, err := decodeParams(out)
	if err != nil {
		return nil, err
	}
	if why := p.refinements(); len(why) > 0 {
		return nil, fmt.Errorf("ledger params: %v", why)
	}
	p.vocab = vocabOf(p)
	p.schemas = buildSchemas(p)
	return p, nil
}

// ParamsSchema is BuildParams, superRefine included, for a schema that holds params (a ruleset's build block): each
// refinement is an issue at the params' own path, as zod reports it. ParseParams then builds the Params from its output.
var ParamsSchema = schema.SuperRefined(paramsSchema, func(out any) []string {
	p, err := decodeParams(out)
	if err != nil {
		return nil // out is the right kind at every depth, which decodes; nothing else reaches here
	}
	return p.refinements()
})

func decodeParams(out any) (*Params, error) {
	raw, err := schema.AppendJSON(nil, out)
	if err != nil {
		return nil, err
	}
	p := &Params{}
	if err := json.Unmarshal(raw, p); err != nil {
		return nil, err
	}
	return p, nil
}

// refinements is BuildParams' superRefine, in its order; it compiles movementTrait on the way.
func (p *Params) refinements() []string {
	attrs := make([]string, len(p.Vocabulary.Attributes))
	for i, a := range p.Vocabulary.Attributes {
		attrs[i] = a.ID
	}
	var why []string
	for _, s := range p.Vocabulary.Skills {
		if !slices.Contains(attrs, s.Attribute) {
			why = append(why, fmt.Sprintf("skill %s: unknown attribute %s", s.Name, s.Attribute))
		}
	}
	mods := make([]string, len(p.Vocabulary.Mods))
	for i, m := range p.Vocabulary.Mods {
		mods[i] = m.Key
	}
	for _, k := range []string{"influence", "speed"} {
		if !slices.Contains(mods, k) {
			why = append(why, "mods must list "+k)
		}
	}
	for _, a := range []string{p.Links.Influence, p.Links.PoweredArmour} {
		if !slices.Contains(attrs, a) {
			why = append(why, "links: unknown attribute "+a)
		}
	}
	for _, r := range append([]string{p.Rarity.Rare, p.Rarity.VeryRare}, p.Rarity.Refused...) {
		if !slices.Contains(p.Rarity.Order, r) {
			why = append(why, fmt.Sprintf("rarity %s is not in the order", r))
		}
	}
	if !slices.Contains(p.Vocabulary.WargearKinds, "upgrade") {
		why = append(why, "wargearKinds must list upgrade")
	}
	if p.Tiers.Max < p.Tiers.Min {
		why = append(why, "tiers.max is below tiers.min")
	}
	var err error
	if p.movement, err = regexp.Compile(p.MovementTrait); err != nil {
		why = append(why, "movementTrait is not a regular expression")
	}
	return why
}

// vocab is the vocabularies as lookups.
type vocab struct {
	attributes     []string
	attributeNames map[string]string
	skills         []string
	modKeys        []string
}

func vocabOf(p *Params) vocab {
	v := vocab{attributeNames: map[string]string{}}
	for _, a := range p.Vocabulary.Attributes {
		v.attributes = append(v.attributes, a.ID)
		v.attributeNames[a.ID] = a.Name
	}
	for _, s := range p.Vocabulary.Skills {
		v.skills = append(v.skills, s.Name)
	}
	for _, m := range p.Vocabulary.Mods {
		v.modKeys = append(v.modKeys, m.Key)
	}
	return v
}

func (p *Params) source(id string) (cite string, official, found bool) {
	for _, s := range p.Sources.List {
		if s.ID == id {
			return s.Cite, s.Official, true
		}
	}
	return "", false, false
}

func (p *Params) isOfficial(source string) bool {
	_, official, _ := p.source(source)
	return official
}

func (p *Params) sourceName(source string) string {
	if cite, _, found := p.source(source); found {
		return cite
	}
	return source
}

// sourceCite is a record's cite: its source's cite and the page.
func (p *Params) sourceCite(source string, page float64) string {
	return p.sourceName(source) + p.Sources.PageSep + num(page)
}

// cite is sourceCite of a record.
func (p *Params) cite(r *schema.Obj) string { return p.sourceCite(str(r, "source"), number(r, "page")) }
