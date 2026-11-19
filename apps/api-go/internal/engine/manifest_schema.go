package engine

import (
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The schemas of packages/rules-engine/src/manifest.ts, field for field and in the same order, so a refusal matches.

// JavaScript's \s, which unlike Go's also covers Unicode spaces.
const jsSpace = `[\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

const comparator = `(\^|~|>=|<=|>|<|=)?(\d+|x|\*)(\.(\d+|x|\*)){0,2}(-[0-9A-Za-z.-]+)?`

var (
	idSchema      = schema.String().Max(64).Regex(`^[a-z][a-zA-Z0-9]*$`, "use camelCase letters and digits")
	fieldIDSchema = schema.String().Max(120).Regex(`^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`, "use dotted camelCase segments")
	rulesetID     = schema.String().Max(64).Regex(`^[a-z0-9]+(-[a-z0-9]+)*$`, "use kebab-case")
	semVer        = schema.String().Max(64).Regex(
		`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$`, "use a semver version such as 1.2.0")
	semVerRange = schema.String().Max(128).Regex(
		`^`+jsSpace+`*`+comparator+`(`+jsSpace+`+`+comparator+`)*(`+jsSpace+`*\|\|`+jsSpace+`*`+comparator+`(`+jsSpace+`+`+comparator+`)*)*`+jsSpace+`*$`,
		"use a semver range")
	citeSchema   = schema.String().Min(1).Max(40)
	exprSource   = schema.String().Min(1).Max(maxExprLength)
	diceNotation = schema.String().Min(1).Max(200).Refine(func(text string) (string, bool) {
		if _, err := ParseDice(text); err != nil {
			return err.Error(), false
		}
		return "", true
	})

	visibilityEnum  = schema.Enum("public", "party", "owner", "gm")
	editableByEnum  = schema.Enum("gm", "owner", "ownerSpendOnly")
	resetEventEnum  = schema.Enum(resetEvents...)
	tieRuleEnum     = schema.Enum(tieRules...)
	scoreOrderEnum  = schema.Enum("high", "low")
	gameOutcomeEnum = schema.Enum("win", "lose")
)

func label(n int) *schema.StringSchema { return schema.String().Min(1).Max(n) }

func fieldDefVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("label", label(80)),
		schema.Def("visibility", visibilityEnum, "gm"),
		schema.Def("editableBy", editableByEnum, "gm"),
		schema.Opt("cite", citeSchema),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var fieldDefSchema = schema.Union("type",
	fieldDefVariant("int", schema.Opt("min", schema.Int()), schema.Opt("max", schema.Int())),
	fieldDefVariant("text", schema.Opt("maxLength", schema.Int().Min(1).Max(10_000))),
	fieldDefVariant("enum", schema.Req("values", schema.Array(idSchema).Min(1).Max(200))),
	fieldDefVariant("bool"),
	fieldDefVariant("ref", schema.Req("entity", idSchema)),
	fieldDefVariant("list", schema.Opt("maxItems", schema.Int().Min(1).Max(500))),
)

func campaignFieldVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var campaignInt = schema.Int().Min(-1000).Max(1000)

// campaignFieldSchema is one campaign field of the manifest (house decision #55).
var campaignFieldSchema = schema.Union("type",
	campaignFieldVariant("int", schema.Req("min", campaignInt), schema.Req("max", campaignInt), schema.Req("default", campaignInt)),
	campaignFieldVariant("enum", schema.Req("values", schema.Array(idSchema).Min(1).Max(20)), schema.Req("default", idSchema)),
	campaignFieldVariant("bool", schema.Req("default", schema.Bool())),
)

var entityTypeSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Req("base", schema.Enum("actor", "item", "ability", "condition")),
	schema.Def("fields", schema.Record(fieldIDSchema, fieldDefSchema), map[string]any{}),
	schema.Def("derived", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Req("expr", exprSource),
		schema.Def("visibility", visibilityEnum, "gm"),
		schema.Opt("cite", citeSchema),
	)), []any{}),
)

var resourceSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Req("scope", schema.Enum("entity", "party", "gm", "campaign")),
	schema.Opt("entities", schema.Array(idSchema)),
	schema.Def("min", exprSource, "0"),
	schema.Opt("max", exprSource),
	schema.Def("capped", schema.Bool(), true),
	schema.Def("resetOn", schema.Array(schema.Object(
		schema.Req("event", resetEventEnum),
		schema.Req("to", exprSource),
	)), []any{}),
	schema.Opt("start", exprSource),
	schema.Def("visibility", visibilityEnum, "gm"),
	schema.Def("editableBy", editableByEnum, "gm"),
)

var conditionSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Def("effects", schema.Array(schema.Object(
		schema.Req("path", schema.String().Min(1).Max(130)),
		schema.Req("mode", schema.Enum("add", "multiply", "override", "upgrade", "downgrade")),
		schema.Req("value", exprSource),
		schema.Def("phase", schema.Enum("base", "derived"), "base"),
		schema.Opt("priority", schema.Int()),
		schema.Opt("when", exprSource),
		schema.Opt("cite", citeSchema),
	)).Max(50), []any{}),
	schema.Def("stacking", schema.Enum("none", "stack", "refresh"), "none"),
	schema.Opt("maxStacks", schema.Int().Min(1).Max(100)),
	schema.Req("duration", schema.Enum("ownTurnEnd", "roundEnd", "encounterEnd", "manual")),
	schema.Def("visibility", visibilityEnum, "gm"),
)

// The actor entity types a Test or a health state applies to (house decision #50).
var actorTypesSchema = schema.Array(idSchema).Min(1).Max(50)

func testVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("target", exprSource),
		schema.Def("ties", tieRuleEnum, "meetOrBeat"),
		schema.Def("inputs", schema.Record(idSchema, schema.Enum("int", "bool", "text")), map[string]any{}),
		schema.Def("inputOptions", schema.Record(idSchema, schema.Array(label(60)).Min(1).Max(50)), map[string]any{}),
		schema.Opt("entities", actorTypesSchema),
		schema.Opt("cite", citeSchema),
		schema.Req("kind", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

func faceRangeFields() []schema.Field {
	return []schema.Field{
		schema.Req("from", schema.Int().Min(1).Max(MaxSides)),
		schema.Req("to", schema.Int().Min(1).Max(MaxSides)),
	}
}

var diceMechanicSchema = schema.Union("kind",
	testVariant("sumVsTarget",
		schema.Req("dice", diceNotation),
		schema.Def("modifier", exprSource, "0"),
		schema.Def("advantage", schema.Bool(), false),
		schema.Opt("critOn", schema.Array(schema.Int().Min(1)).Max(20)),
		schema.Opt("degrees", schema.Object(
			schema.Req("step", schema.Int().Min(1).Max(20)),
			schema.Def("naturalShift", schema.Bool(), false),
			schema.Opt("cite", citeSchema),
		)),
	),
	testVariant("poolSuccesses",
		schema.Req("pool", exprSource),
		schema.Def("modifier", exprSource, "0"),
		schema.Req("die", schema.Int().Min(2).Max(MaxSides)),
		schema.Req("bands", schema.Array(schema.Object(append(
			[]schema.Field{schema.Req("id", idSchema)},
			append(faceRangeFields(), schema.Req("worth", schema.Int().Min(1).Max(10)))...,
		)...)).Min(1).Max(10)),
		schema.Opt("special", schema.Object(
			schema.Req("label", label(40)),
			schema.Req("count", schema.Int().Min(1).Max(10)),
			schema.Def("flags", schema.PartialRecord(schema.Object(faceRangeFields()...), poolFlags...), map[string]any{}),
		)),
		schema.Opt("shift", idSchema),
	),
	schema.Variant{Tag: "reported", Schema: schema.Object(
		schema.Req("kind", schema.Literal("reported")),
		schema.Req("outcomes", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(60)),
			schema.Opt("cite", citeSchema),
		)).Min(2).Max(8)),
		schema.Def("inputs", schema.Record(idSchema, schema.Enum("int", "bool", "text")), map[string]any{}),
		schema.Def("inputOptions", schema.Record(idSchema, schema.Array(label(60)).Min(1).Max(50)), map[string]any{}),
		schema.Opt("entities", actorTypesSchema),
		schema.Opt("cite", citeSchema),
	)},
)

var initiativeSchema = schema.Union("strategy",
	schema.Variant{Tag: "ranked", Schema: schema.Object(
		schema.Req("strategy", schema.Literal("ranked")),
		schema.Req("score", exprSource),
		schema.Opt("dice", diceNotation),
		schema.Def("tiebreak", schema.Array(exprSource).Max(5), []any{}),
		schema.Def("rerollEachRound", schema.Bool(), false),
		schema.Opt("cite", citeSchema),
	)},
	schema.Variant{Tag: "seated", Schema: schema.Object(
		schema.Req("strategy", schema.Literal("seated")),
		schema.Req("firstPlayer", schema.Enum("fixed", "rotate", "manual")),
		schema.Opt("cite", citeSchema),
	)},
	schema.Variant{Tag: "sides", Schema: schema.Object(
		schema.Req("strategy", schema.Literal("sides")),
		schema.Req("sides", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(40)),
		)).Min(2).Max(4)),
		schema.Def("firstSide", schema.Enum("fixed", "rotate"), "fixed"),
		schema.Def("roundEnd", schema.Enum("auto", "manual"), "auto"),
		schema.Opt("setup", schema.Object(schema.Opt("cite", citeSchema))),
		schema.Opt("outOfTurn", schema.Object(
			schema.Req("cost", schema.Record(idSchema, sideCostSchema)),
			schema.Opt("cite", citeSchema),
		)),
		schema.Opt("hold", schema.Object(schema.Opt("cite", citeSchema))),
		schema.Opt("barred", schema.Object(
			schema.Def("throughRound", schema.Int().Min(1).Max(10), 1.0),
			schema.Def("liftCost", schema.Record(idSchema, sideCostSchema), map[string]any{}),
			schema.Opt("cite", citeSchema),
		)),
		schema.Opt("cite", citeSchema),
	)},
)

var sideCostSchema = schema.Object(
	schema.Req("pool", idSchema),
	schema.Req("amount", schema.Int().Min(1).Max(20)),
)

var scoringSchema = schema.Object(
	schema.Def("mode", schema.Enum("compete", "coop"), "compete"),
	schema.Req("score", exprSource),
	schema.Def("order", scoreOrderEnum, "high"),
	schema.Def("tiebreaks", schema.Array(schema.Object(
		schema.Req("expr", exprSource),
		schema.Req("order", scoreOrderEnum),
	)).Max(5), []any{}),
	schema.Def("endWhen", schema.Array(schema.Object(
		schema.Req("when", exprSource),
		schema.Opt("outcome", gameOutcomeEnum),
		schema.Opt("cite", citeSchema),
	)).Max(10), []any{}),
	schema.Opt("cite", citeSchema),
)

var healthSchema = schema.Object(
	schema.Def("tracks", schema.Array(schema.Object(
		schema.Req("resource", idSchema),
		schema.Opt("temp", idSchema),
		schema.Opt("deathSaves", schema.Object(
			schema.Req("successes", schema.Int().Min(1).Max(20)),
			schema.Req("failures", schema.Int().Min(1).Max(20)),
			schema.Def("criticalFailureCounts", schema.Int().Min(1).Max(20), 1.0),
			schema.Opt("criticalSuccessHeals", schema.Int().Min(1)),
			schema.Opt("failuresOnDamage", schema.Int().Min(1).Max(20)),
			schema.Opt("failuresOnCriticalDamage", schema.Int().Min(1).Max(20)),
		)),
		schema.Opt("instantDeathOverflow", exprSource),
	)).Max(10), []any{}),
	schema.Def("states", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Opt("label", label(80)),
		schema.Req("when", exprSource),
		schema.Opt("entities", actorTypesSchema),
	)).Max(20), []any{}),
	schema.Opt("cite", citeSchema),
)

func stepVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("id", idSchema),
		schema.Req("actor", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Def("optional", schema.Bool(), false),
		schema.Req("kind", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var creationStepSchema = schema.Union("kind",
	stepVariant("choose",
		schema.Req("pick", idSchema),
		schema.Def("count", schema.Int().Min(1).Max(20), 1.0),
		schema.Def("copy", schema.Array(schema.Object(
			schema.Req("from", fieldIDSchema),
			schema.Req("to", fieldIDSchema),
		)).Max(20), []any{}),
	),
	stepVariant("assign",
		schema.Req("fields", schema.Array(fieldIDSchema).Min(1).Max(30)),
		schema.Req("method", schema.Union("kind",
			schema.Variant{Tag: "table", Schema: schema.Object(
				schema.Req("kind", schema.Literal("table")),
				schema.Req("values", schema.Array(schema.Int()).Min(1).Max(30)),
			)},
			schema.Variant{Tag: "pointBuy", Schema: schema.Object(
				schema.Req("kind", schema.Literal("pointBuy")),
				schema.Req("budget", schema.Int().Min(0).Max(1000)),
				schema.Req("min", schema.Int().Min(-1000).Max(1000)),
				schema.Req("max", schema.Int().Min(-1000).Max(1000)),
				schema.Req("costs", schema.Record(
					schema.String().Regex(`^-?[0-9]+$`, "a score such as 8"),
					schema.Int().Min(0).Max(1000),
				)),
			)},
		)),
	),
	stepVariant("fields", schema.Req("fields", schema.Array(fieldIDSchema).Min(1).Max(50))),
)

var sourceSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("title", label(200)),
	schema.Req("license", schema.Enum("srd", "orc", "cc-by", "private", "homebrew")),
	schema.Opt("pageOffset", schema.Int().Min(-1000).Max(1000)),
)

var rulesetSchema = schema.Object(
	schema.Req("id", rulesetID),
	schema.Req("version", semVer),
	schema.Req("core", semVerRange),
	schema.Opt("extends", schema.Object(schema.Req("id", rulesetID), schema.Req("version", semVer))),
	schema.Req("sources", schema.Array(sourceSchema).Min(1).Max(50)),
	schema.Def("terms", schema.Record(idSchema, label(60)), map[string]any{}),
	schema.Def("options", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Def("default", schema.Bool(), false),
	)).Max(200), []any{}),
	schema.Req("entities", schema.Array(entityTypeSchema).Min(1).Max(50)),
	schema.Def("resources", schema.Array(resourceSchema).Max(200), []any{}),
	schema.Opt("campaignFields", schema.Refined(schema.Record(idSchema, campaignFieldSchema), func(v any) bool {
		return len(v.(map[string]any)) <= MaxCampaignFields
	}, "at most 50 campaign fields")),
	schema.Def("conditions", schema.Array(conditionSchema).Max(500), []any{}),
	schema.Def("tests", schema.Record(idSchema, diceMechanicSchema), map[string]any{}),
	schema.Opt("initiative", initiativeSchema),
	schema.Opt("phases", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(40)),
		schema.Req("mode", schema.Enum("turns", "simultaneous")),
		schema.Opt("cite", citeSchema),
	)).Min(1).Max(12)),
	schema.Opt("scoring", scoringSchema),
	schema.Opt("tables", schema.Record(idSchema, tableSchema)),
	schema.Def("health", healthSchema, map[string]any{"tracks": []any{}, "states": []any{}}),
	schema.Def("creation", schema.Array(creationStepSchema).Max(50), []any{}),
	schema.Def("decisions", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("text", schema.String().Min(1).Max(1000)),
		schema.Opt("cite", citeSchema),
	)).Max(200), []any{}),
	schema.Def("layout", schema.Record(idSchema, schema.Object(
		schema.Req("sections", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(80)),
			schema.Req("show", schema.Array(schema.String().Max(130)).Max(100)),
		)).Max(50)),
	)), map[string]any{}),
	schema.Opt("game", gameSchema),
)

// tableSchema is one random table of the manifest (house decision #49).
var tableSchema = schema.Object(
	schema.Req("title", label(80)),
	schema.Opt("die", diceNotation),
	schema.Req("entries", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("range", schema.Array(schema.Int().Min(-100_000).Max(100_000)).Min(2).Max(2)),
		schema.Opt("weight", schema.Int().Min(1).Max(100)),
		schema.Opt("count", schema.Int().Min(1).Max(20)),
	)).Max(200)),
	schema.Req("visibility", schema.Enum("gm", "party", "owner")),
	schema.Opt("cite", citeSchema),
)

// gameSchema is the manifest's `game` block: what the game is and how a table can sit for it.
var gameSchema = schema.Object(
	schema.Req("title", label(80)),
	schema.Opt("family", label(40)),
	schema.Def("genres", schema.Array(label(40)).Max(8), []any{}),
	schema.Req("players", schema.RefinedSoft(schema.Object(
		schema.Req("min", schema.Int().Min(1).Max(20)),
		schema.Req("max", schema.Int().Min(1).Max(20)),
	), func(v any) bool {
		p := v.(map[string]any)
		return p["max"].(float64) >= p["min"].(float64)
	}, "max is below min")),
	schema.Req("modes", schema.UniqueList(schema.Enum("gm", "gmless", "solo"), 1, 3, "a mode is listed twice")),
	schema.Opt("cite", citeSchema),
)
