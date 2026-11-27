package engine

import (
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
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

// summarySchema is a definition's meaning in the importer's own words (house decision #126; rules-engine Summary).
var summarySchema = schema.String().Trim().Min(1).Max(300)

func label(n int) *schema.StringSchema { return schema.String().Min(1).Max(n) }

func fieldDefVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("label", label(80)),
		schema.Def("visibility", visibilityEnum, "gm"),
		schema.Def("editableBy", editableByEnum, "gm"),
		schema.Opt("cite", citeSchema),
		schema.Opt("summary", summarySchema),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

// EnumTones are how a screen may draw an enum's value (house decision #76; rules-engine EnumTone).
var EnumTones = []string{"good", "bad"}

// enumWords are what the screens show for an enum's values (house decision #71): a word, a short note and a tone (house
// decision #76), by value id.
var enumWords = []schema.Field{
	schema.Opt("labels", schema.Record(idSchema, label(60))),
	schema.Opt("notes", schema.Record(idSchema, label(40))),
	schema.Opt("tones", schema.Record(idSchema, schema.Enum(EnumTones...))),
}

var (
	intShape  = []schema.Field{schema.Opt("min", schema.Int()), schema.Opt("max", schema.Int())}
	textShape = []schema.Field{schema.Opt("maxLength", schema.Int().Min(1).Max(10_000))}
	enumShape = append([]schema.Field{schema.Req("values", schema.Array(idSchema).Min(1).Max(200))}, enumWords...)
	refShape  = []schema.Field{schema.Req("entity", idSchema)}
)

var fieldDefSchema = schema.Union("type",
	fieldDefVariant("int", intShape...),
	fieldDefVariant("text", textShape...),
	fieldDefVariant("enum", enumShape...),
	fieldDefVariant("bool"),
	fieldDefVariant("ref", refShape...),
	fieldDefVariant("list", schema.Opt("maxItems", schema.Int().Min(1).Max(500)), schema.Opt("chips", schema.Bool()),
		schema.Opt("picks", schema.AnyOf(
			schema.Object(schema.Req("entity", idSchema)),
			schema.Object(schema.Req("from", schema.Literal("ledger")), schema.Req("lines", schema.Enum(StrikeLedgerLines...))),
		))),
)

func codexFieldVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("label", label(80)),
		schema.Def("visibility", schema.Enum("gm", "party"), "gm"),
		schema.Opt("cite", citeSchema),
		schema.Opt("summary", summarySchema),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

// MaxCodexFields caps the fields one kind of codex entry carries.
const MaxCodexFields = 20

// Ceilings of a tags and a rows field (house decision #89; rules-engine MAX_TAGS and the rest): a declaration's own
// maxItems, maxRows and a text column's maxLength may only tighten them.
const (
	MaxTags          = 30
	MaxTagChars      = 60
	MaxRows          = 30
	MaxRowColumns    = 8
	MaxCellChars     = 500
	maxRowPrefills   = 5
	maxCodexReminder = 20
	// MaxColumnInputs and MaxEachWords bound a Test column's worked-out inputs and a cell's listed words (#173).
	MaxColumnInputs = 5
	MaxEachWords    = 10
)

func columnVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("id", idSchema),
		schema.Req("label", label(60)),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

// rowColumn is one column of a rows field (house decision #89; rules-engine RowColumn).
var rowColumn = schema.Union("type",
	columnVariant("int", intShape...),
	columnVariant("text", schema.Opt("maxLength", schema.Int().Min(1).Max(MaxCellChars))),
	columnVariant("enum", append(slices.Clone(enumShape), schema.Opt("offer", fieldIDSchema))...),
	columnVariant("bool"),
	columnVariant("ref", refShape...),
	columnVariant("test",
		schema.Opt("inputs", schema.Refined(schema.Record(idSchema, exprSource),
			func(v any) bool { return len(v.(map[string]any)) <= MaxColumnInputs }, "at most 5 inputs")),
		schema.Opt("each", idSchema),
	),
)

// codexSchema is the manifest's codex block (house decision #71): the fields each kind of entry carries, and the
// reminders its values raise (house decision #89).
var codexSchema = schema.Object(
	schema.Req("kinds", schema.PartialRecord(schema.Object(
		schema.Req("fields", schema.Refined(schema.Record(idSchema, schema.Union("type",
			codexFieldVariant("int", intShape...),
			codexFieldVariant("text", append(slices.Clone(textShape), schema.Opt("roll", fieldRoll))...),
			codexFieldVariant("enum", enumShape...),
			codexFieldVariant("bool"),
			codexFieldVariant("ref", refShape...),
			codexFieldVariant("entry", schema.Req("kind", schema.Enum(CodexKinds...))),
			codexFieldVariant("tags",
				schema.Opt("maxItems", schema.Int().Min(1).Max(MaxTags)),
				schema.Opt("entities", schema.Array(idSchema).Min(1).Max(10)),
				schema.Opt("options", schema.Array(idSchema).Min(1).Max(200)),
				schema.Opt("labels", schema.Record(idSchema, label(MaxTagChars))),
				schema.Def("writeIn", schema.Bool(), false),
				schema.Opt("upper", schema.Literal(true)),
			),
			codexFieldVariant("rows",
				schema.Req("columns", schema.Array(rowColumn).Min(1).Max(MaxRowColumns)),
				schema.Opt("maxRows", schema.Int().Min(1).Max(MaxRows)),
				schema.Opt("from", schema.Array(schema.Object(
					schema.Req("entity", idSchema),
					schema.Opt("name", idSchema),
					schema.Opt("values", schema.Record(idSchema, fieldIDSchema)),
				)).Min(1).Max(maxRowPrefills)),
				schema.Opt("pick", schema.Object(schema.Req("label", label(40)))),
				schema.Opt("rolls", schema.Object(
					schema.Req("table", idSchema),
					schema.Req("into", idSchema),
					schema.Opt("times", idSchema),
				)),
			),
		)), func(v any) bool { return len(v.(map[string]any)) <= MaxCodexFields }, "at most 20 fields")),
		schema.Opt("reminders", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("if", exprSource),
			schema.Req("text", label(120)),
			schema.Opt("cite", citeSchema),
			schema.Opt("group", idSchema),
		)).Max(maxCodexReminder)),
		// How an entry of this kind is made from a pack entry, and the tables rolled into its title (house decision #97).
		schema.Opt("from", schema.Array(schema.Object(
			schema.Req("entity", idSchema),
			schema.Opt("name", idSchema),
			schema.Opt("values", schema.Record(idSchema, fieldIDSchema)),
			schema.Opt("children", fieldIDSchema),
			schema.Opt("tests", schema.Object(
				schema.Req("field", fieldIDSchema),
				schema.Opt("inputs", schema.Record(idSchema, fieldIDSchema)),
				schema.Opt("per", schema.Record(idSchema, schema.Record(idSchema, fieldIDSchema))),
			)),
			schema.Opt("roster", fieldIDSchema),
		)).Min(1).Max(maxRowPrefills)),
		schema.Opt("titleRoll", fieldRoll),
		// A scene's pool lines made from pack entries (house decision #178).
		schema.Opt("poolLines", schema.Array(schema.Object(
			schema.Req("entity", idSchema),
			schema.Req("pool", idSchema),
			schema.Req("amount", fieldIDSchema),
			schema.Opt("spend", schema.Bool()),
			schema.Opt("text", fieldIDSchema),
		)).Min(1).Max(maxRowPrefills)),
		schema.Opt("ready", schema.Array(idSchema).Min(1).Max(MaxCodexFields)),
	), CodexKinds...)),
)

// fieldRoll is tables rolled into a codex text field or an entry's title (house decision #97; rules-engine FieldRoll).
var fieldRoll = schema.Object(
	schema.Req("tables", schema.Array(idSchema).Min(1).Max(4)),
	schema.Opt("join", schema.String().Max(10)),
	// Tables by the value of one of the entry's fields (house decision #178).
	schema.Opt("per", schema.Object(
		schema.Req("field", fieldIDSchema),
		schema.Req("tables", schema.Refined(schema.Record(schema.String().Min(1).Max(80), schema.Array(idSchema).Min(1).Max(4)),
			func(v any) bool { n := len(v.(map[string]any)); return n >= 1 && n <= 20 }, "1 to 20 values")),
	)),
)

func campaignFieldVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Opt("summary", summarySchema),
		schema.Req("type", schema.Literal(tag)),
	}, extra...)
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var campaignInt = schema.Int().Min(-1000).Max(1000)

// campaignFieldSchema is one campaign field of the manifest (house decision #55).
var campaignFieldSchema = schema.Union("type",
	campaignFieldVariant("int", schema.Req("min", campaignInt), schema.Req("max", campaignInt), schema.Req("default", campaignInt)),
	campaignFieldVariant("enum", append(append([]schema.Field{schema.Req("values", schema.Array(idSchema).Min(1).Max(20))},
		enumWords...), schema.Req("default", idSchema))...),
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
		schema.Opt("summary", summarySchema),
		schema.Opt("override", fieldIDSchema),
	)), []any{}),
)

var resourceSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Opt("summary", summarySchema),
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

var effectSchema = schema.Object(
	schema.Req("path", schema.String().Min(1).Max(130)),
	schema.Req("mode", schema.Enum("add", "multiply", "override", "upgrade", "downgrade")),
	schema.Req("value", exprSource),
	schema.Def("phase", schema.Enum("base", "derived"), "base"),
	schema.Opt("priority", schema.Int()),
	schema.Opt("when", exprSource),
	schema.Opt("cite", citeSchema),
)

var conditionSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Opt("summary", summarySchema),
	schema.Def("effects", schema.Array(effectSchema).Max(50), []any{}),
	schema.Def("stacking", schema.Enum("none", "stack", "refresh"), "none"),
	schema.Opt("maxStacks", schema.Int().Min(1).Max(100)),
	schema.Req("duration", schema.Enum("ownTurnEnd", "roundEnd", "encounterEnd", "manual")),
	schema.Opt("from", schema.Literal("nextOwnTurn")),
	schema.Def("visibility", visibilityEnum, "gm"),
	schema.Opt("at", reminderAtEnum),
	schema.Opt("text", label(120)),
	schema.Opt("immune", schema.AnyOf(exprSource, schema.Object(schema.Req("if", exprSource), schema.Req("entities", actorTypesSchema)))),
)

// ReminderAts are when a reminder line shows (house decision #81; rules-engine ReminderAt).
var ReminderAts = []string{"turnStart", "turnEnd", "roundEnd"}

var reminderAtEnum = schema.Enum(ReminderAts...)

var reminderSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("at", reminderAtEnum),
	schema.Req("text", label(120)),
	schema.Opt("cite", citeSchema),
	schema.Opt("if", exprSource),
	schema.Opt("entities", actorTypesSchema),
)

var restRuleSchema = schema.Object(
	schema.Req("event", resetEventEnum),
	schema.Req("refusedIn", schema.Array(idSchema).Min(1).Max(20)),
	schema.Opt("cite", citeSchema),
)

// The actor entity types a Test or a health state applies to (house decision #50).
var actorTypesSchema = schema.Array(idSchema).Min(1).Max(50)

// testWords are what the screens call a Test, its inputs and a text input's options (house decision #77).
var testWords = []schema.Field{
	schema.Opt("label", label(80)),
	schema.Opt("inputLabels", schema.Record(idSchema, label(60))),
	schema.Opt("inputOptionLabels", schema.Record(idSchema, schema.Record(label(60), label(60)))),
}

// testOutcomes are a Test's marks and offers (house decision #80).
var testOutcomes = []schema.Field{
	schema.Opt("marks", schema.Refined(schema.Record(idSchema, schema.Object(
		schema.Req("label", label(60)),
		schema.Opt("cite", citeSchema),
	)), func(v any) bool { return len(v.(map[string]any)) <= MaxMarks }, "at most 10 marks")),
	schema.Opt("choices", schema.Refined(schema.Record(idSchema, schema.Object(
		schema.Req("label", label(60)),
		schema.Opt("max", schema.Int().Min(1).Max(20)),
		schema.Opt("cite", citeSchema),
	)), func(v any) bool { return len(v.(map[string]any)) <= MaxChoices }, "at most 5 choices")),
	schema.Opt("offers", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(60)),
		schema.Req("when", exprSource),
		schema.Req("changes", schema.Array(schema.Object(
			schema.Opt("pool", idSchema),
			schema.Opt("resource", idSchema),
			schema.Req("by", exprSource),
		)).Min(1).Max(5)),
		schema.Opt("cite", citeSchema),
	)).Max(MaxOffers)),
}

func testVariant(tag string, extra ...schema.Field) schema.Variant {
	fields := append([]schema.Field{
		schema.Req("target", exprSource),
		schema.Def("ties", tieRuleEnum, "meetOrBeat"),
		schema.Def("inputs", schema.Record(idSchema, schema.Enum("int", "bool", "text")), map[string]any{}),
		schema.Def("inputOptions", schema.Record(idSchema, schema.Array(label(60)).Min(1).Max(50)), map[string]any{}),
		schema.Opt("entities", actorTypesSchema),
		schema.Opt("cite", citeSchema),
		testWords[0], testWords[1], testWords[2],
		testOutcomes[0], testOutcomes[1], testOutcomes[2],
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
		testWords[0], testWords[1], testWords[2],
		testOutcomes[0], testOutcomes[1], testOutcomes[2],
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
			schema.Opt("entities", schema.Array(idSchema).Max(20)),
		)).Min(2).Max(4)),
		schema.Opt("unableStates", schema.Array(idSchema).Max(20)),
		schema.Def("firstSide", schema.Enum("fixed", "rotate"), "fixed"),
		schema.Def("roundEnd", schema.Enum("auto", "manual"), "auto"),
		schema.Opt("setup", schema.Object(schema.Opt("cite", citeSchema), schema.Opt("note", label(200)))),
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
		schema.Opt("warn", label(80)),
	)).Max(20), []any{}),
	schema.Opt("cite", citeSchema),
	schema.Opt("harm", harmSchema),
)

// harmSchema is health.harm (house decision #66).
var harmSchema = schema.Object(
	schema.Opt("cite", citeSchema),
	schema.Req("wounds", idSchema),
	schema.Opt("shock", idSchema),
	schema.Opt("mob", schema.Object(schema.Req("members", idSchema), schema.Req("start", fieldIDSchema))),
	schema.Req("profiles", schema.Array(schema.Object(
		schema.Req("entities", schema.Array(idSchema).Min(1).Max(50)),
		schema.Opt("shockless", exprSource),
		schema.Opt("spent", schema.Object(
			schema.Opt("when", exprSource),
			schema.Opt("conditions", schema.Array(idSchema).Max(20)),
		)),
		schema.Opt("felled", schema.Object(
			schema.Req("when", exprSource),
			schema.Opt("injuries", fieldIDSchema),
			schema.Opt("condition", idSchema),
			schema.Opt("healTo", exprSource),
		)),
		schema.Opt("destroyed", schema.Object(schema.Req("over", exprSource), schema.Req("field", fieldIDSchema),
			schema.Opt("when", exprSource))),
		schema.Opt("convert", schema.Bool()),
	)).Min(1).Max(10)),
)

// SpendClearEvents are the table events that cancel a spend's pending asks (manifest.ts SpendClearEvent, #84).
var SpendClearEvents = []string{"sessionStart", "sessionEnd", "encounterEnd", "roundEnd"}

// spendSchema is one entry of the manifest's spends (house decision #84).
var spendSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Opt("entities", schema.Array(idSchema).Min(1).Max(50)),
	schema.Req("cost", schema.Array(schema.Object(
		schema.Opt("pool", idSchema),
		schema.Opt("resource", idSchema),
		schema.Req("amount", exprSource),
		schema.Opt("byRun", schema.Bool()),
	)).Max(5)),
	schema.Opt("inputs", schema.Refined(schema.Record(idSchema, schema.Object(
		schema.Req("label", label(60)),
		schema.Req("min", schema.Int().Min(0).Max(1000)),
		schema.Req("max", exprSource),
	)), func(v any) bool { return len(v.(map[string]any)) <= 3 }, "at most 3 inputs")),
	schema.Opt("if", exprSource),
	schema.Opt("run", schema.Array(schema.Object(
		schema.Req("primitive", label(64)),
		schema.Req("op", label(64)),
		schema.Req("input", schema.Record(label(64), schema.AnyOf(exprSource, schema.Float(), schema.Bool()))),
	)).Max(5)),
	schema.Opt("clearOn", schema.Array(schema.Enum(SpendClearEvents...)).Max(4)),
	// manifest.ts SpendLimitPer (house decision #91): zod words a one-option enum as a literal.
	schema.Opt("limit", schema.Object(schema.Req("per", schema.Literal("round")), schema.Req("max", schema.Int().Min(1).Max(10)))),
	schema.Opt("then", schema.Object(schema.Req("table", idSchema), schema.Opt("inputs", schema.Record(idSchema, idSchema)),
		schema.Opt("if", exprSource))),
)

// spawnSchema is the manifest's spawn block (manifest.ts SpawnBlock, house decision #92).
var spawnSchema = schema.Object(
	schema.Opt("options", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Opt("entities", schema.Array(idSchema).Min(1).Max(50)),
		schema.Opt("when", exprSource),
		schema.Def("effects", schema.Array(effectSchema).Max(20), []any{}),
	)).Max(20)),
	schema.Opt("adjust", schema.Array(schema.Object(
		schema.Opt("option", idSchema),
		schema.Opt("entities", schema.Array(idSchema).Min(1).Max(50)),
		schema.Opt("when", exprSource),
		schema.Req("add", schema.Refined(schema.Record(label(130), exprSource), func(v any) bool {
			n := len(v.(map[string]any))
			return n >= 1 && n <= 10
		}, "1 to 10 values")),
		schema.Opt("cite", citeSchema),
	)).Max(10)),
	schema.Opt("budget", schema.Object(
		schema.Opt("cite", citeSchema),
		schema.Req("lines", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(80)),
			schema.Req("cost", exprSource),
			schema.Req("budget", exprSource),
		)).Min(1).Max(8)),
		schema.Opt("switches", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(60)),
			schema.Req("by", exprSource),
		)).Max(4)),
	)),
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

// LedgerKinds are the kinds of catalogue record the ledger builder reads, named as the keys of its Creation, plus
// wargear (manifest.ts LEDGER_KINDS).
var LedgerKinds = []string{
	"keywords", "factions", "sub-factions", "species", "backgrounds", "option-groups", "archetypes", "talents",
	"packages", "disciplines", "powers", "languages", "wargear",
}

// LibraryLineKinds are the kinds the resolved sheet names one record of (LIBRARY_LINE_KINDS, manifest.ts): a library
// card's line (house decision #187).
var LibraryLineKinds = []string{"archetypes", "species"}

func ledgerKindsSchema() schema.Schema {
	fields := make([]schema.Field, len(LedgerKinds))
	for i, k := range LedgerKinds {
		fields[i] = schema.Req(k, idSchema)
	}
	return schema.Object(fields...)
}

var vocabName = label(60)

// buildSchema is the manifest's build block: the ledger builder picked for one actor type (house decision #62).
var buildSchema = schema.Object(
	schema.Req("strategy", schema.Literal("ledger")),
	schema.Req("actor", idSchema),
	schema.Req("params", ledger.ParamsSchema),
	schema.Req("kinds", ledgerKindsSchema()),
	schema.Req("sheet", schema.Object(
		schema.Req("attributes", schema.Record(vocabName, fieldIDSchema)),
		schema.Req("skills", schema.Record(vocabName, fieldIDSchema)),
		schema.Req("mods", schema.Record(vocabName, fieldIDSchema)),
		schema.Req("armourRating", fieldIDSchema),
		schema.Req("powered", fieldIDSchema),
		schema.Req("speed", fieldIDSchema),
		schema.Req("species", fieldIDSchema),
		schema.Req("archetype", fieldIDSchema),
		schema.Req("keywords", fieldIDSchema),
		schema.Opt("wealth", idSchema),
		schema.Opt("corruption", idSchema),
	)),
	schema.Req("tier", idSchema),
	schema.Opt("xp", fieldIDSchema),
	schema.Opt("ascension", schema.Object(schema.Req("xp", schema.Int().Min(1)), schema.Req("cite", citeSchema))),
	schema.Opt("gone", schema.Array(idSchema).Max(10)),
	schema.Opt("award", schema.Object(
		schema.Req("max", schema.Int().Min(1).Max(1000)),
		schema.Req("suggested", schema.Array(schema.Int().Min(0)).Max(6)),
		schema.Req("cite", citeSchema),
	)),
	schema.Opt("keep", schema.Object(
		schema.Def("fields", schema.Array(fieldIDSchema).Max(50), []any{}),
		schema.Def("resources", schema.Array(idSchema).Max(20), []any{}),
		schema.Opt("greater", schema.Array(fieldIDSchema).Max(50)),
		schema.Opt("merge", schema.Array(fieldIDSchema).Max(50)),
	)),
	schema.Opt("libraryLine", schema.Enum(LibraryLineKinds...)),
	schema.Opt("first", schema.Enum("build", "steps")),
	schema.Req("cite", citeSchema),
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
	schema.Opt("header", schema.Object(
		schema.Opt("fields", schema.Array(idSchema).Min(1).Max(3)),
		schema.Opt("round", schema.Literal(true)),
	)),
	schema.Def("conditions", schema.Array(conditionSchema).Max(500), []any{}),
	schema.Opt("reminders", schema.Array(reminderSchema).Max(100)),
	schema.Opt("rests", schema.Array(restRuleSchema).Max(5)),
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
	schema.Opt("held", schema.Refined(schema.Record(idSchema, heldKindSchema),
		func(v any) bool { return len(v.(map[string]any)) <= MaxHeldKinds }, "at most 10 kinds")),
	schema.Opt("items", itemsSchema),
	schema.Def("health", healthSchema, map[string]any{"tracks": []any{}, "states": []any{}}),
	schema.Def("creation", schema.Array(creationStepSchema).Max(50), []any{}),
	schema.Opt("build", buildSchema),
	schema.Def("decisions", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("text", schema.String().Min(1).Max(1000)),
		schema.Opt("cite", citeSchema),
	)).Max(200), []any{}),
	schema.Def("layout", schema.Record(idSchema, schema.Object(
		schema.Req("sections", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(80)),
			schema.Req("show", layoutRows),
		)).Max(50)),
		schema.Opt("phoneTurn", layoutRows),
		schema.Opt("trackerRow", layoutRows),
		schema.Opt("screen", layoutRows),
		schema.Opt("phoneStrip", layoutRows),
	)), map[string]any{}),
	schema.Opt("game", gameSchema),
	schema.Opt("codex", codexSchema),
	schema.Opt("notices", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("when", schema.Enum(append(slices.Clone(resetEvents), "crossed")...)),
		schema.Opt("entities", actorTypesSchema),
		schema.Req("if", exprSource),
		schema.Req("text", label(MaxNoticeText)),
		schema.Opt("params", schema.Refined(schema.Record(idSchema, exprSource),
			func(v any) bool { return len(v.(map[string]any)) <= MaxNoticeParams }, "at most 5 params")),
		schema.Opt("group", schema.Enum("every", "any")),
		schema.Opt("rises", exprSource),
		schema.Opt("cite", citeSchema),
	)).Max(MaxNotices)),
	schema.Opt("spends", schema.Array(spendSchema).Max(50)),
	schema.Opt("requests", schema.Object(schema.Req("max", schema.Int().Min(1).Max(20)))),
	schema.Opt("checklist", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Req("done", checklistCount),
		schema.Opt("goto", schema.Object(
			schema.Req("tab", schema.Enum(ChecklistTabs...)),
			schema.Opt("kind", schema.Enum(CodexKinds...)),
		)),
		schema.Opt("note", label(200)),
		schema.Opt("optional", schema.Bool()),
		schema.Opt("now", exprSource),
	)).Max(maxChecklistSteps)),
	schema.Opt("spawn", spawnSchema),
	schema.Opt("strikes", schema.Array(strikeSchema).Max(MaxStrikes)),
	schema.Opt("generators", schema.Array(generatorSchema).Max(maxGenerators)),
	schema.Opt("panels", schema.Array(panelSchema).Max(maxPanels)),
)

// Panels (manifest.ts Panel, house decision #114).
const maxPanels = 20

var panelSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(80)),
	schema.Opt("cite", citeSchema),
	schema.Opt("entities", actorTypesSchema),
	schema.Opt("foe", idSchema),
	schema.Opt("when", exprSource),
	schema.Opt("holds", idSchema),
	schema.Opt("unless", idSchema),
	schema.Opt("opensOn", schema.Object(schema.Req("rises", idSchema))),
	schema.Opt("lines", schema.Array(schema.Object(
		schema.Req("text", label(200)),
		schema.Opt("when", exprSource),
		schema.Opt("cite", citeSchema),
	)).Max(10)),
	schema.Opt("figures", schema.Array(schema.Object(
		schema.Req("label", label(60)),
		schema.Req("expr", exprSource),
		schema.Opt("cite", citeSchema),
	)).Max(6)),
	schema.Opt("spends", schema.Array(idSchema).Min(1).Max(4)),
	schema.Opt("options", schema.Object(
		schema.Req("entry", idSchema),
		schema.Opt("group", fieldIDSchema),
		schema.Opt("usable", exprSource),
		schema.Opt("needs", fieldIDSchema),
	)),
)

// The setup checklist (house decision #90; rules-engine CHECKLIST_TABS, CHECKLIST_PREP_KINDS, ChecklistCount).
const maxChecklistSteps = 30

// ChecklistTabs are the places of the GM's app a step's GO TO may open.
var ChecklistTabs = []string{"track", "prep", "codex", "party", "tests", "map", "rules"}

var (
	checklistPrepKinds = []string{"roster", "tests", "pools", "exits", "reveals", "picks"}
	atLeast            = schema.Opt("min", schema.Int().Min(1).Max(100))
	checklistCount     = schema.Union("count",
		countVariant("entries",
			schema.Req("kind", schema.Enum(CodexKinds...)),
			schema.Opt("field", idSchema),
			schema.Opt("equals", schema.AnyOf(schema.String().Min(1).Max(120), schema.Int(), schema.Bool())),
			schema.Opt("prep", schema.Enum(checklistPrepKinds...)),
			atLeast),
		countVariant("actors", schema.Req("entity", idSchema), schema.Opt("built", schema.Bool()), atLeast),
		countVariant("campaignField", schema.Req("field", idSchema)),
		countVariant("pool", schema.Req("pool", idSchema), atLeast),
		countVariant("sessions", atLeast),
		countVariant("packs", schema.Opt("slug", schema.String().Min(1).Max(64)), atLeast),
		countVariant("safety"),
	)
)

func countVariant(tag string, extra ...schema.Field) schema.Variant {
	return schema.Variant{Tag: tag, Schema: schema.Object(append([]schema.Field{schema.Req("count", schema.Literal(tag))}, extra...)...)}
}

// layoutPath is a layout row that names a value; layoutRows a layout's list of rows, each a path or a widget row
// (house decision #83, manifest.ts WidgetRow).
var (
	layoutPath = schema.String().Max(130)
	layoutRows = schema.Array(schema.AnyOf(layoutPath, schema.Object(
		schema.Req("widget", idSchema),
		schema.Opt("variant", idSchema),
		schema.Opt("label", label(80)),
		schema.Def("bind", schema.Record(idSchema, schema.AnyOf(layoutPath, schema.Array(layoutPath).Min(1).Max(40))),
			map[string]any{}),
		schema.Opt("steps", schema.Array(schema.Object(
			schema.Req("label", label(40)),
			schema.Req("size", schema.Int().Min(1).Max(MaxPipsPerStep)),
		)).Min(1).Max(MaxPipSteps)),
	))).Max(100)
)

// tableEffectVariant is one kind of effect a lookup line applies (house decision #87), with its own fields first.
func tableEffectVariant(tag string, fields ...schema.Field) schema.Variant {
	fields = append([]schema.Field{schema.Req("kind", schema.Literal(tag))}, fields...)
	fields = append(fields, schema.Opt("when", exprSource), schema.Opt("times", exprSource))
	return schema.Variant{Tag: tag, Schema: schema.Object(fields...)}
}

var tableEffectSchema = schema.Union("kind",
	tableEffectVariant("harm", schema.Opt("wounds", exprSource), schema.Opt("shock", exprSource)),
	tableEffectVariant("condition", schema.Req("condition", idSchema)),
	tableEffectVariant("resource", schema.Req("resource", idSchema), schema.Req("by", exprSource)),
	tableEffectVariant("pool", schema.Req("pool", idSchema), schema.Req("by", exprSource)),
	tableEffectVariant("grant", schema.Req("held", idSchema), schema.Req("entry", packKeySchema)),
)

// tableSchema is one random table of the manifest (house decision #49), or a lookup (house decision #87).
var tableSchema = schema.Object(
	schema.Req("title", label(80)),
	schema.Opt("die", diceNotation),
	schema.Req("entries", schema.Array(schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("range", schema.Array(schema.Int().Min(-100_000).Max(100_000)).Min(1).Max(2)),
		schema.Opt("weight", schema.Int().Min(1).Max(100)),
		schema.Opt("count", schema.Int().Min(1).Max(20)),
		schema.Opt("apply", schema.Array(tableEffectSchema).Min(1).Max(MaxRowEffects)),
		schema.Opt("note", label(200)),
		schema.Opt("cite", citeSchema),
		schema.Opt("next", idSchema),
	)).Max(200)),
	schema.Req("visibility", schema.Enum("gm", "party", "owner")),
	schema.Opt("cite", citeSchema),
	schema.Opt("typedOnly", schema.Bool()),
	schema.Opt("inputs", schema.Array(tableInputSchema).Min(1).Max(MaxLookupInputs)),
	schema.Opt("modifier", exprSource),
	schema.Opt("entities", schema.Array(idSchema).Min(1).Max(50)),
)

// tableInputSchema is a value set before applying a lookup or a strike (manifest.ts TableInput).
var tableInputSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(60)),
	schema.Req("type", schema.Enum("bool", "int")),
	schema.Opt("min", schema.Int().Min(-1000).Max(1000)),
	schema.Opt("max", schema.AnyOf(schema.Int().Min(-1000).Max(1000), exprSource)),
	schema.Opt("dice", label(20)),
	schema.Opt("cite", citeSchema),
)

// Strikes (manifest.ts Strike, house decision #99).
const (
	MaxStrikes      = 20
	maxStrikeValues = 20
	maxStrikeShows  = 6
)

var (
	// StrikeLedgerLines are the saved sheet's lists a strike's means may come from (STRIKE_LEDGER_LINES).
	StrikeLedgerLines  = []string{"weapons", "powers"}
	strikeFigureSchema = schema.Object(
		schema.Req("label", label(60)),
		schema.Req("expr", exprSource),
		schema.Opt("cite", citeSchema),
		strikeAdds,
	)
	strikeAdds = schema.Opt("adds", schema.Array(schema.Object(
		schema.Req("label", label(60)),
		schema.Req("by", exprSource),
		schema.Opt("when", exprSource),
		schema.Opt("cite", citeSchema),
	)).Max(10))
	strikeShowSchema = schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(60)),
		schema.Req("expr", exprSource),
		schema.Opt("cite", citeSchema),
		strikeAdds,
	)
	strikeSchema = schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(80)),
		schema.Opt("cite", citeSchema),
		schema.Opt("entities", actorTypesSchema),
		schema.Opt("targets", actorTypesSchema),
		schema.Opt("means", schema.Array(schema.Union("from",
			schema.Variant{Tag: "ledger", Schema: schema.Object(
				schema.Req("from", schema.Literal("ledger")),
				schema.Req("lines", schema.Enum(StrikeLedgerLines...)),
			)},
			schema.Variant{Tag: "list", Schema: schema.Object(
				schema.Req("from", schema.Literal("list")),
				schema.Req("field", fieldIDSchema),
				schema.Req("entry", idSchema),
			)},
			schema.Variant{Tag: "items", Schema: schema.Object(
				schema.Req("from", schema.Literal("items")),
				schema.Req("kind", idSchema),
			)},
		)).Min(1).Max(4)),
		schema.Opt("values", schema.Refined(schema.Record(idSchema, schema.Object(
			schema.Req("key", label(64)),
			schema.Req("type", schema.Enum("int", "bool", "text", "list")),
		)), func(v any) bool { return len(v.(map[string]any)) <= maxStrikeValues }, "at most 20 values")),
		schema.Opt("inputs", schema.Array(strikeInputSchema).Min(1).Max(MaxLookupInputs)),
		schema.Req("pool", strikeFigureSchema),
		schema.Req("beat", strikeFigureSchema),
		schema.Opt("soak", strikeFigureSchema),
		schema.Opt("shows", schema.Array(strikeShowSchema).Max(maxStrikeShows)),
		schema.Req("outcomes", schema.Array(schema.Object(
			schema.Req("id", idSchema),
			schema.Req("label", label(60)),
			schema.Req("when", exprSource),
			schema.Opt("wounds", exprSource),
			schema.Opt("shock", exprSource),
			schema.Opt("cite", citeSchema),
			schema.Opt("warn", label(80)),
		)).Min(1).Max(10)),
		schema.Opt("notes", schema.Array(schema.Object(
			schema.Req("text", label(200)),
			schema.Opt("when", exprSource),
			schema.Opt("cite", citeSchema),
		)).Max(10)),
		schema.Opt("then", schema.Object(schema.Req("table", idSchema), schema.Opt("inputs", schema.Record(idSchema, idSchema)))),
		schema.Opt("byOwner", schema.Literal(true)),
		schema.Opt("limit", schema.Object(schema.Req("per", schema.Literal("round")), schema.Req("max", schema.Int().Min(1).Max(10)))),
	)
	// strikeInputSchema is a lookup's input or a choice (manifest.ts StrikeInput, house decision #113).
	strikeInputSchema = schema.Object(
		schema.Req("id", idSchema),
		schema.Req("label", label(60)),
		schema.Req("type", schema.Enum("bool", "int", "choice")),
		schema.Opt("min", schema.Int().Min(-1000).Max(1000)),
		schema.Opt("max", schema.Int().Min(-1000).Max(1000)),
		schema.Opt("cite", citeSchema),
		schema.Opt("options", schema.Array(schema.Object(
			schema.Req("label", label(60)),
			schema.Req("value", schema.Int().Min(-1000).Max(1000)),
		)).Min(2).Max(10)),
	)
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
