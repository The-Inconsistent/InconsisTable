package ledger

import (
	"errors"
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// ParseRecord parses one value with s, from a tree schema.DecodeJSON read so the order survives.
func ParseRecord(s schema.Schema, input any) (*schema.Obj, error) {
	out, issues := schema.Parse(s, input)
	if len(issues) > 0 {
		return nil, errors.New(schema.Prettify(issues))
	}
	o, ok := out.(*schema.Obj)
	if !ok {
		return nil, errors.New("ledger: decode the input with schema.DecodeJSON, so its order is kept")
	}
	return o, nil
}

// ParseCreation parses the record lists of the creation types (keyed as the TypeScript Creation is), each record by its
// type's schema. A list that is absent is empty.
func ParseCreation(p *Params, raw any) (Creation, error) {
	in, _ := raw.(*schema.Obj)
	s := p.schemas
	var c Creation
	for _, l := range []struct {
		key    string
		schema schema.Schema
		into   *[]*schema.Obj
	}{
		{"keywords", s.Keyword, &c.Keywords},
		{"factions", s.Faction, &c.Factions},
		{"sub-factions", s.SubFaction, &c.SubFactions},
		{"species", s.Species, &c.Species},
		{"backgrounds", s.BackgroundTable, &c.Backgrounds},
		{"option-groups", s.OptionGroup, &c.OptionGroups},
		{"archetypes", s.Archetype, &c.Archetypes},
		{"talents", s.Talent, &c.Talents},
		{"packages", s.Package, &c.Packages},
		{"disciplines", s.Discipline, &c.Disciplines},
		{"powers", s.PsychicPower, &c.Powers},
		{"languages", s.Language, &c.Languages},
	} {
		*l.into = []*schema.Obj{}
		for i, item := range list(in, l.key) {
			r, err := ParseRecord(l.schema, item)
			if err != nil {
				return Creation{}, fmt.Errorf("%s[%d]: %w", l.key, i, err)
			}
			*l.into = append(*l.into, r)
		}
	}
	return c, nil
}

// ParseWargear parses a list of wargear records into the catalogue's lookup by id (a repeated id keeps the last).
func ParseWargear(p *Params, raw []any) (map[string]*schema.Obj, error) {
	out := map[string]*schema.Obj{}
	for i, item := range raw {
		w, err := ParseRecord(p.schemas.Wargear, item)
		if err != nil {
			return nil, fmt.Errorf("wargear[%d]: %w", i, err)
		}
		out[str(w, "id")] = w
	}
	return out, nil
}

// The twin of packages/rules-engine/src/build/schemas.ts, schema for schema and field for field in the same order: the
// order of a parsed object is read (a requirement serialised into an approval path, the keywords a record could give),
// so it is part of the result. What does not depend on the ruleset is a package variable; the rest is built from the
// params by buildSchemas.

var (
	idS        = schema.String().Regex(`^[a-z0-9-]+$`, "Invalid string: must match pattern /^[a-z0-9-]+$/")
	idsS       = schema.Array(idS).Min(1)
	keywordS   = schema.String().Regex(`^(\[[A-Z0-9' -]+\]|[A-Z0-9' -]+)$`, "Invalid keyword")
	diceS      = schema.String().Regex(`^\d*d\d+([+-]\d+)?$`, "Invalid dice")
	summaryS   = schema.String().Max(300)
	shortWords = schema.String().Min(1).Max(120)
	intS       = schema.Int()
	emptyList  = []any{}
)

func obj(fields ...schema.Field) *schema.ObjectSchema { return schema.Object(fields...) }

func req(k string, s schema.Schema) schema.Field { return schema.Req(k, s) }
func opt(k string, s schema.Schema) schema.Field { return schema.Opt(k, s) }
func def(k string, s schema.Schema, v any) schema.Field {
	return schema.Def(k, s, v)
}

// pre is .prefault(v): an absent key parses v, an empty object or list here.
func pre(k string, s schema.Schema, v any) schema.Field { return schema.Pre(k, s, v) }

func kind(tag string) schema.Field { return req("kind", schema.Literal(tag)) }

// Scaled is a number that can scale: per Tier ascended, times the Tier, per Rank (and more), or Rank plus a number.
var Scaled = schema.AnyOf(
	intS,
	obj(req("perTier", intS)),
	obj(req("timesTier", intS)),
	obj(req("perRank", intS), opt("plus", intS)),
	obj(req("rankPlus", intS)),
)

// Amount is an amount that may be rolled.
var Amount = schema.AnyOf(Scaled, diceS, obj(req("perTier", diceS)), obj(req("roll", diceS), req("times", Scaled)))

func weaponMods(amount schema.Schema) schema.Schema {
	traitID := schema.String().Min(1)
	return schema.AnyOf(
		obj(kind("trait"), req("traitId", traitID), opt("rating", amount)),
		obj(kind("removeTrait"), req("traitId", traitID)),
		obj(kind("traitRating"), req("traitId", traitID), req("delta", amount)),
		obj(kind("damage"), req("delta", amount)),
		obj(kind("ed"), req("delta", amount)),
		obj(kind("ap"), req("delta", amount)),
		obj(kind("setAp"), req("value", schema.Int().Max(0))),
		obj(kind("salvo"), req("delta", amount)),
		obj(kind("range"),
			opt("multiply", schema.Float().Positive()),
			opt("delta", intS),
			opt("bands", schema.Array(intS).Min(1).Max(3)),
		),
		obj(kind("ar"), req("delta", intS)),
		obj(kind("bonusDice"), req("dice", amount), req("when", schema.String().Min(1).Max(200))),
		obj(kind("gm"), req("what", schema.String().Min(1).Max(200))),
	)
}

var (
	// UpgradeMod is a change an upgrade makes to a profile.
	UpgradeMod = weaponMods(intS)
	// RankAmount is a Talent's amount: fixed, per Rank, and maybe more.
	RankAmount = schema.AnyOf(intS, obj(req("perRank", intS), opt("plus", intS)))
	// WeaponMod is a change a record makes to a weapon.
	WeaponMod = weaponMods(RankAmount)
)

// Weapon is a weapon profile.
var Weapon = obj(
	req("name", schema.String()),
	opt("count", schema.Int().Min(1)),
	req("damage", intS),
	req("ed", schema.AnyOf(intS, schema.String())),
	opt("ap", schema.Int().Max(0)),
	req("range", schema.Array(schema.Int().Min(1)).Min(1).Max(3)),
	opt("salvo", schema.Nullable(schema.Int().Min(0))),
	def("traits", schema.Array(schema.String()), emptyList),
	opt("melee", schema.Bool()),
	opt("countsStrength", schema.Literal(true)),
	opt("thrown", schema.Int().Min(1)),
	opt("wargearId", schema.String()),
	opt("upgrades", schema.Array(schema.String()).Max(8)),
	opt("fitted", schema.Array(schema.String()).Max(8)),
	opt("asPrinted", schema.Literal(true)),
	opt("mods", schema.Array(UpgradeMod).Max(10)),
	opt("upgradeNames", schema.Array(schema.String())),
	opt("effects", schema.Array(schema.String())),
	opt("notes", schema.Array(schema.String())),
)

var threatFilter = obj(
	opt("classes", schema.Array(schema.String().Min(1).Max(20)).Min(1)),
	opt("maxSize", schema.String().Min(1).Max(20)),
	opt("keywords", schema.Array(keywordS).Min(1)),
)

// XpCost is what a record costs.
var XpCost = schema.AnyOf(
	schema.Int().Min(0),
	obj(req("perTier", schema.Int().Min(1))),
	obj(req("base", schema.Int().Min(0)), req("plus", shortWords)),
	obj(req("atCreation", schema.Int().Min(0)), req("later", schema.Int().Min(0))),
	obj(req("byChoice", schema.Array(obj(req("xp", schema.Int().Min(0)), req("when", shortWords))).Min(2))),
)

// WargearItem is a catalogue item a record gives.
var WargearItem = obj(
	req("name", schema.String().Min(1).Max(200)),
	def("qty", schema.AnyOf(schema.Int().Min(1), diceS), 1.0),
	opt("wargearId", idS),
	opt("upgrades", idsS),
	opt("traitIds", idsS),
	opt("mundane", schema.Literal(true)),
	def("scope", schema.Enum("character", "group"), "character"),
)

// BuildChoice is the answer to one choice in a grant.
var BuildChoice = schema.Array(schema.AnyOf(schema.Int().Min(0), schema.String().Min(1).Max(100))).Max(20)

// AdvancedBuild is Advanced Creation: a build with no Archetype.
var AdvancedBuild = obj(opt("factionId", idS), opt("abilityOf", idS), pre("wargear", schema.Array(idS).Max(60), emptyList))

const (
	maxMutations = 20
	maxAmmoTypes = 12
)

// Schemas are the record schemas, the build and the sheet for one ruleset's parameters.
type Schemas struct {
	Tier, Source, Rarity, WargearKind, Mods, Bonus, BackgroundRow, TalentCategory, SubFactionType   schema.Schema
	WargearFilter, WeaponEffect, RequirementOne, Requirement, Grant, Rule                           schema.Schema
	Keyword, Faction, SubFaction, Species, BackgroundTable, OptionGroup, Archetype, Talent, Package schema.Schema
	Discipline, PsychicPower, Language, WargearWeapon, Wargear, SheetWeaponEffect, CharacterStats   schema.Schema
	Advancement, CharacterBuild                                                                     schema.Schema
}

// Schemas are the params' schemas, built once by ParseParams.
func (p *Params) Schemas() *Schemas { return p.schemas }

func dedupe(list []string) []string {
	out := []string{}
	for _, x := range list {
		if !slices.Contains(out, x) {
			out = append(out, x)
		}
	}
	return out
}

func optional(keys []string, s schema.Schema) *schema.ObjectSchema {
	fields := make([]schema.Field, len(keys))
	for i, k := range keys {
		fields[i] = opt(k, s)
	}
	return obj(fields...)
}

func required(keys []string, s schema.Schema) *schema.ObjectSchema {
	fields := make([]schema.Field, len(keys))
	for i, k := range keys {
		fields[i] = req(k, s)
	}
	return obj(fields...)
}

func buildSchemas(p *Params) *Schemas {
	v := p.Vocabulary
	attrIDs, skillNames, modKeys := p.vocab.attributes, p.vocab.skills, p.vocab.modKeys
	attrTop := float64(len(p.AttributeXp.Table) - 1)
	skillTop := float64(len(p.SkillXp.Table) - 1)

	attribute := schema.Enum(attrIDs...)
	skill := schema.Enum(skillNames...)
	rating := schema.Int().Min(0).Max(attrTop)
	skillRating := schema.Int().Min(0).Max(skillTop)
	capS := schema.Int().Min(1).Max(p.SpeciesMax.CapTop)
	tier := schema.Int().Min(p.Tiers.Min).Max(p.Tiers.Max)
	var sourceIDs []string
	for _, s := range p.Sources.List {
		sourceIDs = append(sourceIDs, s.ID)
	}
	source := schema.Enum(sourceIDs...)
	rarity := schema.Enum(p.Rarity.Order...)
	wargearKind := schema.Enum(v.WargearKinds...)
	upgradeSlot := schema.Enum(v.UpgradeSlots...)
	talentCategory := schema.Enum(v.TalentCategories...)
	subFactionType := schema.Enum(v.SubFactionTypes...)
	backgroundRow := schema.Enum(v.BackgroundRows...)

	mods := optional(dedupe(modKeys), intS)
	var bonusKeys []string
	for _, m := range v.Mods {
		if m.BackgroundBonus {
			bonusKeys = append(bonusKeys, m.Key)
		}
	}
	bonus := schema.Enum(append(bonusKeys, "wealth", "corruption")...)

	strList := schema.Array(schema.String().Min(1)).Min(1)
	wargearFilter := obj(
		opt("kinds", schema.Array(wargearKind).Min(1)),
		opt("weapon", schema.Enum("melee", "ranged")),
		opt("categories", strList),
		opt("nameIncludes", schema.String().Min(1)),
		opt("wargearKeywords", strList),
		opt("allKeywords", strList),
		opt("weaponTraits", strList),
		opt("notWeaponTraits", strList),
		opt("maxValue", schema.AnyOf(schema.Int().Min(0), obj(req("tierPlus", intS)), obj(req("newTierPlus", intS)))),
		opt("rarity", obj(opt("atMost", rarity), opt("atLeast", rarity))),
		opt("upgrade", shortWords),
		opt("condition", shortWords),
	)
	weaponFits := wargearFilter.Extend(
		opt("chosen", schema.Literal(true)), opt("granted", schema.Literal(true)), opt("unarmed", schema.Literal(true)),
	)
	weaponEffect := obj(req("fits", weaponFits), req("mods", schema.Array(WeaponMod).Min(1)))

	keywords := schema.Array(keywordS).Min(1)
	minOrMax := func(m map[string]any) bool {
		_, hasMin := m["min"]
		_, hasMax := m["max"]
		return hasMin || hasMax
	}
	variant := func(tag string, fields ...schema.Field) schema.Variant {
		return schema.Variant{Tag: tag, Schema: obj(append([]schema.Field{kind(tag)}, fields...)...)}
	}
	requirements := []schema.Variant{
		variant("attribute", req("attribute", attribute), req("min", rating)),
		variant("skill", req("skill", skill), req("min", rating)),
		variant("chosenAttribute", req("min", rating)),
		variant("chosenSkill", req("min", rating)),
		variant("influence", req("min", intS)),
		variant("keyword", req("anyOf", keywords)),
		variant("notKeyword", req("anyOf", keywords)),
		variant("species", req("anyOf", idsS)),
		variant("notSpecies", req("anyOf", idsS)),
		variant("archetype", req("anyOf", idsS)),
		variant("notArchetype", req("anyOf", idsS)),
		{Tag: "memorableInjuries", Schema: obj(
			kind("memorableInjuries"), opt("min", schema.Int().Min(1)), opt("max", schema.Int().Min(0)),
		).Refine(minOrMax, "memorableInjuries needs min or max")},
		variant("subFaction", req("anyOf", idsS)),
		variant("talent", req("anyOf", idsS)),
		variant("notTalent", req("anyOf", idsS)),
		variant("talentCategory", req("category", talentCategory), req("min", schema.Int().Min(1))),
		variant("option", req("groupId", idS), req("anyOf", strList)),
		variant("power", req("anyOf", idsS)),
		variant("powerCount", req("min", schema.Int().Min(1)), def("sameDiscipline", schema.Bool(), false)),
		variant("wargear", req("anyOf", strList)),
		variant("wargearKeyword", req("anyOf", keywords)),
		variant("wargearCount", req("of", wargearFilter), req("min", schema.Int().Min(1))),
		variant("rank", req("min", schema.Int().Min(1))),
		{Tag: "tier", Schema: obj(kind("tier"), opt("min", tier), opt("max", tier)).Refine(minOrMax, "tier needs min or max")},
		variant("gm", req("id", schema.String().Min(1).Max(200)), req("label", schema.String().Min(1).Max(120))),
	}
	requirementOne := schema.Union("kind", requirements...)
	requirementAll := obj(kind("all"), req("of", schema.Array(requirementOne).Min(2)))
	requirement := schema.Union("kind", append(slices.Clone(requirements),
		schema.Variant{Tag: "all", Schema: requirementAll},
		variant("either", req("of", schema.Array(schema.AnyOf(requirementOne, requirementAll)).Min(2))),
	)...)
	requiresOne := schema.Array(requirementOne)
	requiresAny := schema.Array(requirement)

	grantOne := schema.AnyOf(
		obj(req("talent", idS)),
		obj(req("keyword", keywordS)),
		obj(req("keywords", schema.Array(keywordS).Min(2))),
		obj(req("power", idS)),
		obj(req("wargear", WargearItem), opt("requires", requiresOne)),
		obj(req("bundle", schema.Array(WargearItem).Min(2))),
		obj(req("pick", Scaled), req("wargearOf", wargearFilter), opt("requires", requiresOne)),
		obj(req("weapon", Weapon.Extend(def("addStrength", schema.Bool(), false)))),
		obj(req("weaponTrait", schema.String().Min(1))),
		obj(req("trinkets", Amount)),
		obj(req("wealth", Amount)),
		obj(req("influence", Scaled)),
		obj(req("corruption", Amount)),
		obj(req("faith", Scaled)),
		obj(req("languages", schema.AnyOf(Scaled, obj(req("skill", skill)))), opt("xenos", schema.Literal(true))),
		obj(req("memorableInjuries", Amount)),
		obj(req("traumaticInjuries", Amount)),
		obj(req("mutations", Amount)),
		obj(req("wrathPerSession", Scaled)),
		obj(req("wealthPerSession", Scaled)),
		obj(req("ammoPer", schema.Enum("session", "mission")), req("ammo", schema.Int().Min(1))),
		obj(req("mods", schema.PartialRecord(Scaled, append(slices.Clone(modKeys), "armourRating")...))),
		obj(
			req("attribute", schema.AnyOf(attribute, schema.Array(attribute).Min(2), schema.Enum("any", "lowest"))),
			opt("add", intS),
			opt("to", rating),
		),
		obj(req("chosenTrait", Scaled)),
		obj(req("skills", schema.Array(skill).Min(1)), req("add", intS)),
		obj(req("optionAccess", idS)),
		obj(req("neverKeyword", keywordS)),
		obj(req("never", schema.Enum("faith", "corruption"))),
		obj(req("gmRuin", Scaled)),
		obj(req("talentAccess", talentCategory), opt("asKeyword", keywordS)),
		obj(req("disciplineAccess", idsS)),
		obj(req("loseKeyword", keywordS)),
		obj(req("influenceAttribute", attribute)),
		obj(req("xpDiscount", schema.AnyOf(
			obj(req("talent", idS), req("xp", schema.Int().Min(0))),
			obj(opt("discipline", idS), req("multiplier", schema.Float().Positive().Max(1))),
		))),
		obj(
			req("followers", Scaled),
			req("kind", schema.Enum("mob", "companion", "familiar", "devotees", "minion")),
			opt("threatId", idS),
			opt("variant", schema.String().Min(1)),
			opt("threatOf", threatFilter),
			opt("genericStats", Scaled),
		),
		obj(req("bonusDice", Scaled), opt("skills", schema.Array(skill)), req("when", shortWords)),
		obj(req("chooseDisciplines", schema.Int().Min(1)), opt("from", idsS)),
		obj(req("onlyDisciplines", idsS), opt("untilTier", schema.Int().Min(p.Tiers.Min+1).Max(p.Tiers.Max))),
		obj(req("noArmour", schema.Literal(true))),
		obj(req("choose", Scaled), req("fromDisciplines", idsS), def("random", schema.Bool(), false)),
		obj(req("story", schema.String().Min(1).Max(120))),
	)
	grantAll := obj(req("all", schema.Array(grantOne).Min(1)), opt("requires", requiresOne))
	grant := schema.AnyOf(
		grantOne,
		grantAll,
		obj(
			req("choose", schema.Int().Min(1)),
			req("rating", schema.Int().Min(1).Max(skillTop)),
			opt("skills", schema.Array(skill).Min(2)),
		),
		obj(
			req("choose", Scaled),
			req("from", schema.Array(schema.AnyOf(grantOne, grantAll)).Min(1)),
			def("optional", schema.Bool(), false),
			def("repeat", schema.Bool(), false),
		),
	)
	grants := schema.Array(grant)

	record := []schema.Field{
		req("id", idS),
		req("name", schema.String().Min(1).Max(100)),
		req("source", source),
		req("page", schema.Int().Min(1)),
		opt("summary", summaryS),
	}
	recordWith := func(fields ...schema.Field) *schema.ObjectSchema { return obj(record...).Extend(fields...) }

	rule := obj(
		req("name", schema.String().Min(1).Max(100)),
		opt("summary", summaryS),
		opt("page", schema.Int().Min(1)),
		opt("source", source),
		opt("mods", mods),
		opt("grants", grants),
		opt("weapons", schema.Array(weaponEffect)),
	)
	rules := schema.Array(rule)
	keywordList := schema.Array(keywordS)

	keywordRecord := recordWith(
		req("name", keywordS),
		opt("placeholder", subFactionType),
		def("writeIn", schema.Bool(), false),
		def("grants", grants, emptyList),
	)
	faction := recordWith(
		def("keywords", keywordList, emptyList),
		def("rules", rules, emptyList),
		def("backgroundsFrom", schema.Array(idS), emptyList),
	)
	subFaction := recordWith(
		req("type", subFactionType),
		req("factionId", idS),
		req("keyword", keywordS),
		def("requires", requiresAny, emptyList),
		opt("successorOf", idS),
		def("traits", schema.Array(rule.Extend(def("geneSeed", schema.Bool(), false))), emptyList),
	)

	attributes := schema.PartialRecord(rating, attrIDs...)
	skills := schema.PartialRecord(skillRating, skillNames...)

	species := recordWith(
		req("xp", schema.Int().Min(0)),
		req("speed", schema.Int().Min(1)),
		opt("size", schema.Enum(v.SpeciesSizes...)),
		req("attributes", attributes),
		req("skills", skills),
		opt("max", required(dedupe(append(slices.Clone(attrIDs), "speed")), capS)),
		def("keywords", keywordList, emptyList),
		def("abilities", rules, emptyList),
		def("grants", grants, emptyList),
		def("countsAs", schema.Array(idS), emptyList),
	)

	owner := schema.AnyOf(
		obj(req("factionId", idS)),
		obj(req("speciesId", idS)),
		obj(req("speciesIds", idsS)),
		obj(req("subFactionId", idS)),
	)
	backgroundEntry := obj(
		req("name", schema.String().Min(1)),
		opt("summary", summaryS),
		opt("bonus", bonus),
		opt("grants", grants),
		opt("requires", requiresAny),
	)
	columns := make([]schema.Field, len(v.BackgroundRows))
	for i, r := range v.BackgroundRows {
		columns[i] = def(r, schema.Array(backgroundEntry), emptyList)
	}
	backgroundTable := recordWith(req("owner", owner)).Extend(columns...)

	optionGroup := recordWith(
		req("owner", owner),
		req("pick", schema.AnyOf(schema.Int().Min(1), schema.Literal("tier"), schema.Literal("any"))),
		def("xp", schema.Array(schema.Int().Min(0)).Min(1), []any{0.0}),
		req("options", schema.Array(rule.Extend(
			def("requires", requiresAny, emptyList),
			def("notAtCreation", schema.Bool(), false),
		)).Min(1)),
	)

	archetype := recordWith(
		req("factionId", idS),
		req("tier", tier),
		req("speciesIds", idsS),
		def("requires", requiresAny, emptyList),
		req("xp", schema.Int().Min(0)),
		def("keywords", keywordList, emptyList),
		def("grants", grants, emptyList),
		req("attributes", attributes),
		req("skills", skills),
		req("abilities", schema.Array(rule).Min(1)),
		def("wargear", grants, emptyList),
		opt("influence", intS),
	)

	firstCategory := ""
	if len(v.TalentCategories) > 0 {
		firstCategory = v.TalentCategories[0]
	}
	talent := recordWith(
		def("category", talentCategory, firstCategory),
		req("xp", XpCost),
		def("requires", requiresAny, emptyList),
		def("repeatable", schema.AnyOf(schema.Bool(), schema.Literal("perChoice")), false),
		opt("options", schema.Array(schema.String().Min(1).Max(60)).Min(2)),
		opt("mods", mods),
		opt("grants", grants),
		opt("weapons", schema.Array(weaponEffect)),
	)

	pkg := recordWith(
		req("kind", schema.Enum("ascension", "advancement")),
		req("xp", XpCost),
		def("requires", requiresAny, emptyList),
		def("notAtCreation", schema.Bool(), false),
		opt("atCreationWith", keywordS),
		def("influence", schema.AnyOf(intS, obj(req("perTier", intS))), 0.0),
		def("grants", grants, emptyList),
		opt("weapons", schema.Array(weaponEffect)),
		opt("becomesArchetypeId", idS),
	)

	discipline := recordWith(def("requires", requiresAny, emptyList))

	short := schema.String().Min(1).Max(60)
	psychicPower := recordWith(
		req("disciplineId", idS),
		def("alsoIn", schema.Array(idS), emptyList),
		req("xp", XpCost),
		req("dn", schema.AnyOf(schema.Int().Min(1), short)),
		req("activation", short),
		req("duration", short),
		req("range", short),
		req("multiTarget", schema.AnyOf(schema.Bool(), schema.String().Min(1))),
		def("tags", schema.Array(schema.String().Min(1)), emptyList),
		def("requires", requiresAny, emptyList),
		def("useRequires", requiresAny, emptyList),
	)

	languageRecord := recordWith(req("keywords", keywords), opt("xenos", schema.Literal(true)))

	// ── wargear ──
	rangeS := schema.Array(schema.Int().Min(1)).Min(1).Max(3)
	wargearWeapon := Weapon.Omit("name", "range").Extend(
		def("addStrength", schema.Bool(), false),
		opt("range", rangeS),
		opt("thrown", schema.Int().Min(1)),
	).Refine(func(m map[string]any) bool {
		_, hasRange := m["range"]
		_, hasThrown := m["thrown"]
		return hasRange || hasThrown
	}, "a weapon needs range or thrown")
	wargearArmour := obj(
		req("ar", schema.Int().Min(0).Max(20)),
		def("invulnerable", schema.Bool(), false),
		def("powered", schema.Int().Min(0).Max(10), 0.0),
		def("traits", schema.Array(schema.String()), emptyList),
	)
	upgrade := obj(
		req("slot", upgradeSlot),
		req("fits", wargearFilter),
		def("mods", schema.Array(UpgradeMod), emptyList),
		opt("exempt", schema.Enum("max", "slot")),
		opt("copies", schema.Int().Min(2)),
		opt("slotOn", schema.PartialRecord(upgradeSlot, "weapon", "armour")),
		opt("gmOnly", schema.Bool()),
	)
	wargear := obj(
		req("id", idS),
		req("name", schema.String().Min(1).Max(100)),
		req("source", source),
		req("page", schema.Int().Min(1)),
		opt("summary", summaryS),
		req("category", schema.String().Min(1).Max(60)),
		req("kind", wargearKind),
		req("value", schema.Nullable(schema.Int().Min(0).Max(30))),
		req("rarity", schema.Nullable(rarity)),
		def("keywords", schema.Array(schema.String().Min(1)), emptyList),
		opt("weapon", wargearWeapon),
		opt("armour", wargearArmour),
		opt("upgrade", upgrade),
		opt("threatId", idS),
		opt("variant", schema.String().Min(1)),
		opt("requires", requiresAny),
	)

	// ── the sheet ──
	attr := schema.Int().Min(1).Max(attrTop)
	sheetRule := obj(req("name", schema.String().Max(100)), opt("summary", summaryS), opt("page", schema.String().Max(40)))
	sheetWeapon := Weapon.Extend(def("addStrength", schema.Bool(), false))
	sheetPower := obj(
		req("name", schema.String().Max(100)),
		req("page", schema.String().Max(40)),
		opt("summary", summaryS),
		req("dn", schema.AnyOf(schema.Int().Min(1), schema.String().Max(60))),
		req("activation", schema.String().Max(60)),
		req("duration", schema.String().Max(60)),
		req("range", schema.String().Max(60)),
	)
	small := schema.Int().Min(-5).Max(5)
	mutationMods := obj(
		def("attributes", schema.PartialRecord(small, attrIDs...), schema.NewObj()),
		def("skills", schema.PartialRecord(small, skillNames...), schema.NewObj()),
		def("traits", mods, schema.NewObj()),
	)
	sheetMutation := obj(
		req("id", idS),
		req("name", schema.String().Min(1).Max(200)),
		req("page", schema.Int().Min(1)),
		opt("summary", summaryS),
		req("mods", mutationMods),
		def("weapons", schema.Array(sheetWeapon).Max(4), emptyList),
	)
	sheetWeaponEffect := obj(
		req("source", schema.String().Min(1).Max(100)),
		opt("cite", schema.String().Max(40)),
		req("fits", wargearFilter.Extend(
			opt("wargearIds", schema.Array(schema.String().Min(1)).Max(10)),
			opt("names", schema.Array(schema.String().Min(1).Max(100)).Max(10)),
		)),
		req("mods", schema.Array(WeaponMod).Min(1).Max(10)),
	)
	ones := schema.NewObj()
	for _, a := range attrIDs {
		ones.Set(a, 1.0)
	}
	characterStats := obj(
		def("species", schema.String().Max(60), ""),
		def("archetype", schema.String().Max(100), ""),
		def("keywords", schema.Array(schema.String().Max(60)).Max(20), emptyList),
		def("attributes", required(dedupe(attrIDs), attr), ones),
		def("skills", skills, schema.NewObj()),
		def("armour", obj(
			req("name", schema.String().Max(100)),
			req("ar", schema.Int().Min(0).Max(20)),
			def("invulnerable", schema.Bool(), false),
			def("powered", schema.Int().Min(0).Max(10), 0.0),
			def("traits", schema.Array(schema.String().Max(60)), emptyList),
			opt("wargearId", schema.String()),
			opt("upgrades", schema.Array(schema.String()).Max(8)),
			opt("fitted", schema.Array(schema.String()).Max(8)),
			opt("upgradeNames", schema.Array(schema.String())),
			opt("notes", schema.Array(schema.String())),
		), newObj("name", "", "ar", 0.0, "invulnerable", false, "powered", 0.0, "traits", emptyList)),
		def("speed", schema.Int().Min(0).Max(20), p.DefaultSpeed),
		def("mods", mods, schema.NewObj()),
		def("abilities", schema.Array(sheetRule).Max(30), emptyList),
		def("talents", schema.Array(sheetRule).Max(30), emptyList),
		def("weapons", schema.Array(sheetWeapon).Max(20), emptyList),
		opt("powers", schema.Array(sheetPower).Max(30)),
		def("gear", schema.Array(schema.String().Max(200)).Max(60), emptyList),
		opt("weaponEffects", schema.Array(sheetWeaponEffect).Max(60)),
		def("wealth", schema.Int().Min(0), 0.0),
		def("corruption", schema.Int().Min(0), 0.0),
		def("mutations", schema.Array(sheetMutation).Max(maxMutations), emptyList),
		def("ammo", schema.Refined(
			schema.Record(schema.String().Min(1).Max(60), schema.Int().Min(0).Max(99)),
			func(a any) bool {
				o, isObj := a.(*schema.Obj)
				m, _ := a.(map[string]any)
				return (isObj && o.Len() <= maxAmmoTypes) || (!isObj && len(m) <= maxAmmoTypes)
			},
			"At most 12 ammo types",
		), schema.NewObj()),
		def("requisitioned", schema.PartialRecord(schema.String(), "wargear", "ammo"), schema.NewObj()),
	)

	// ── the build ──
	ratings := schema.PartialRecord(schema.Int().Min(1).Max(attrTop), attrIDs...)
	talentPicks := schema.Array(obj(req("id", idS), opt("choice", schema.String().Min(1).Max(60))))
	languageNames := schema.Array(schema.String().Min(1).Max(60))
	advancement := obj(
		pre("attributes", ratings, schema.NewObj()),
		pre("skills", skills, schema.NewObj()),
		pre("talents", talentPicks, emptyList),
		pre("powers", schema.Array(idS), emptyList),
		pre("packages", schema.Array(idS), emptyList),
		pre("languages", languageNames, emptyList),
		opt("archetypeAscension", obj(req("archetypeId", idS))),
		pre("boughtIn", schema.Record(schema.String().Min(1).Max(200), schema.Int().Min(1).Max(10_000)), schema.NewObj()),
	)
	rowFields := make([]schema.Field, len(v.BackgroundRows))
	for i, r := range v.BackgroundRows {
		rowFields[i] = opt(r, schema.String().Min(1))
	}
	background := obj(req("tableId", idS)).Extend(rowFields...).Extend(opt("bonus", backgroundRow))
	characterBuild := obj(
		req("tier", tier),
		opt("budget", schema.Int().Min(0).Max(1000)),
		opt("archetypeId", idS),
		opt("advanced", AdvancedBuild),
		opt("speciesId", idS),
		pre("fills", schema.Record(keywordS, schema.AnyOf(obj(req("id", idS)), obj(req("writeIn", keywordS)))), schema.NewObj()),
		opt("background", background),
		pre("options", schema.Array(obj(req("groupId", idS), req("name", schema.String().Min(1)))), emptyList),
		pre("attributes", ratings, schema.NewObj()),
		pre("skills", skills, schema.NewObj()),
		pre("talents", talentPicks, emptyList),
		pre("powers", schema.Array(idS), emptyList),
		pre("packages", schema.Array(idS), emptyList),
		pre("languages", obj(pre("picks", languageNames, emptyList), pre("bought", languageNames, emptyList)), schema.NewObj()),
		pre("wealth", schema.Int().Min(0).Max(p.Wealth.MaxBought), 0.0),
		pre("choices", schema.Record(schema.String().Min(1).Max(200), BuildChoice), schema.NewObj()),
		pre("advancement", advancement, schema.NewObj()),
		pre("gm", obj(
			opt("species", idS),
			pre("keywords", keywordList, emptyList),
			pre("gear", obj(
				pre("remove", schema.Array(schema.String().Min(1)), emptyList),
				pre("add", schema.Array(WargearItem), emptyList),
			), schema.NewObj()),
			pre("approved", schema.Array(schema.String().Min(1).Max(200)), emptyList),
			pre("mods", mods, schema.NewObj()),
		), schema.NewObj()),
	).Refine(func(b map[string]any) bool {
		_, hasArchetype := b["archetypeId"]
		_, hasAdvanced := b["advanced"]
		return hasArchetype != hasAdvanced
	}, "A build takes an Archetype or Advanced Creation, not both and not neither")

	return &Schemas{
		Tier: tier, Source: source, Rarity: rarity, WargearKind: wargearKind, Mods: mods, Bonus: bonus,
		BackgroundRow: backgroundRow, TalentCategory: talentCategory, SubFactionType: subFactionType,
		WargearFilter: wargearFilter, WeaponEffect: weaponEffect, RequirementOne: requirementOne, Requirement: requirement,
		Grant: grant, Rule: rule, Keyword: keywordRecord, Faction: faction, SubFaction: subFaction, Species: species,
		BackgroundTable: backgroundTable, OptionGroup: optionGroup, Archetype: archetype, Talent: talent, Package: pkg,
		Discipline: discipline, PsychicPower: psychicPower, Language: languageRecord, WargearWeapon: wargearWeapon,
		Wargear: wargear, SheetWeaponEffect: sheetWeaponEffect, CharacterStats: characterStats,
		Advancement: advancement, CharacterBuild: characterBuild,
	}
}
