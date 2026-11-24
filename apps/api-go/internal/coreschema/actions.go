package coreschema

import (
	"math"
	"slices"
	"unicode/utf16"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Every mutation goes through one socket event, "action" (CLAUDE.md, "The server decides"). These are the core actions
// of packages/core-schema/src/actions.ts, written out a second time; vectors/table.ts holds the two equal on accept and
// refuse (docs/adr/0008-go-api.md).

// Action is a parsed action: decoded JSON with the schema's defaults filled in. Handlers read its fields by key.
type Action map[string]any

// Type is the action's discriminator.
func (a Action) Type() string {
	t, _ := a["type"].(string)
	return t
}

// Str reads a string field; "" when it is absent.
func (a Action) Str(key string) string {
	s, _ := a[key].(string)
	return s
}

// The closed sets the actions use, from packages/core-schema/src/state.ts, seat.ts and encounter.ts.
var (
	actorKinds       = []string{"pc", "companion", "npc", "creature", "group", "vehicle", "hazard"}
	memberRoles      = []string{"gm", "cogm", "player"}
	cogmScopes       = []string{"combat", "codex", "codex.secrets", "party", "session"}
	inviteModes      = []string{"room", "character"}
	codexKinds       = engine.CodexKinds
	codexVisibility  = []string{"gm", "party", "public"}
	questStatuses    = []string{"open", "done", "failed"}
	audienceModes    = []string{"all", "listed"}
	combatSides      = []string{"party", "foe", "other"}
	combatVisibility = []string{"hidden", "bar", "full"}
	// Markers are a combatant's marker colours (encounter.ts Marker, house decision #92).
	Markers         = []string{"red", "amber", "green", "blue", "purple", "white"}
	clockVisibility = []string{"gm", "party"}
)

// maxSpawn is core-schema's MAX_SPAWN: the creatures one actor.spawn places.
const maxSpawn = 50

// MaxClocks is core-schema's MAX_CLOCKS: the clocks one room holds.
const MaxClocks = 30

// The lines and veils of a table: core-schema's MAX_SAFETY_ITEMS and SAFETY_LINE_MAX.
const (
	MaxSafetyItems = 30
	SafetyLineMax  = 80
)

// Whispers (state.ts, house decision #93): the text, a reply, the readers of one, and the whispers one room holds.
const (
	WhisperMax      = 500
	WhisperReplyMax = 200
	WhisperToMax    = 30
	MaxWhispers     = 100
)

// MaxDraftBytes caps a builder draft, serialized.
const MaxDraftBytes = 64 * 1024

// MaxBuildBytes caps a ledger build's JSON text, in UTF-8 bytes (house decision #63).
const MaxBuildBytes = 64 * 1024

var (
	id            = schema.UUID()
	userID        = schema.String().Min(1).Max(100)
	actorName     = schema.String().Trim().Min(1).Max(100)
	sessionTitle  = schema.String().Trim().Max(100)
	recap         = schema.String().Max(10_000)
	clockName     = schema.String().Trim().Min(1).Max(80)
	safetyLine    = schema.String().Trim().Min(1).Max(SafetyLineMax)
	safetyList    = schema.Array(safetyLine).Max(MaxSafetyItems)
	clockSegments = schema.Int().Min(2).Max(12)
	requestText   = schema.String().Trim().Max(140)
	tableID       = schema.String().Min(1).Max(64)
	// tableResult and lookupInputs are a typed roll and a lookup's inputs (state.ts TableResult, LookupInputs).
	tableResult  = schema.Int().Min(-100_000).Max(100_000)
	lookupInputs = schema.Record(schema.String().Max(64), schema.AnyOf(schema.Number(-math.MaxFloat64, math.MaxFloat64), schema.Bool()))
	answers      = schema.Record(schema.String().Max(120), schema.Unknown())

	// BuilderDraftBody is the character being built and the answers so far, read and written whole.
	BuilderDraftBody = schema.Refined(
		schema.Object(schema.Req("actorId", schema.UUID()), schema.Req("answers", answers)),
		// JSON.stringify's UTF-8 length; key order does not change it, so canonical JSON measures the same.
		func(v any) bool { return len(engine.CanonicalJSON(v)) <= MaxDraftBytes },
		"The draft is over 64 KB",
	)

	// LedgerBuildText is a ledger build as JSON text: the api decodes it with schema.DecodeJSON, so its keys keep their
	// order (a socket payload reaches Go as a map).
	LedgerBuildText = schema.Refined(schema.String(), func(v any) bool { s, _ := v.(string); return len(s) <= MaxBuildBytes },
		"The build is over 64 KB")

	fieldValue = schema.AnyOf(
		schema.Int().Min(-2147483648).Max(2147483647),
		schema.String().Max(10_000),
		schema.Bool(),
		schema.Array(schema.String().Max(1_000)).Max(500),
		schema.Null(),
	)
	// codexFieldValue is a codex entry field's value (core-schema CodexFieldValue, house decision #89): a field value, or
	// a rows field's rows, whose shape the ruleset's declaration checks.
	codexFieldValue = schema.AnyOf(fieldValue, schema.Array(schema.Record(schema.String(), schema.Unknown())).Max(30))
	testInputs      = schema.Record(schema.String().Max(64), schema.AnyOf(
		schema.Number(-math.MaxFloat64, math.MaxFloat64),
		schema.String().Max(100),
		schema.Bool(),
	))
)

// spendInputs is actions.ts SpendInputs: the numbers a spend's asker picks (house decision #84).
var spendInputs = schema.Record(schema.String().Min(1).Max(64), schema.Int().Min(-1000).Max(1000))

func variant(tag string, fields ...schema.Field) schema.Variant {
	return schema.Variant{Tag: tag, Schema: schema.Object(append([]schema.Field{schema.Req("type", schema.Literal(tag))}, fields...)...)}
}

// ActionSchema is the Action union.
var ActionSchema = schema.Union("type",
	variant("campaign.update",
		schema.Opt("name", schema.String().Trim().Min(1).Max(100)),
		schema.Opt("nextSessionAt", schema.Nullable(schema.DateTime())),
		schema.Opt("nextSessionPlace", schema.String().Trim().Max(200)),
	),
	variant("campaign.archive"),
	variant("campaign.unarchive"),
	variant("campaign.delete", schema.Req("name", schema.String().Max(100))),
	variant("campaign.transfer", schema.Req("toUserId", userID)),
	variant("campaign.transferCancel"),
	variant("campaign.transferAccept"),
	variant("campaign.setRuleset", schema.Req("rulesetVersionId", id)),
	variant("campaign.unpinRuleset"),
	variant("campaign.setTableMode", schema.Req("mode", schema.Enum("gm", "gmless", "solo"))),
	// A campaign field of the pinned ruleset (house decision #58); the value is checked against its definition.
	variant("campaign.setField",
		schema.Req("fieldId", schema.String().Min(1).Max(64)),
		schema.Req("value", schema.AnyOf(schema.Int().Min(-2147483648).Max(2147483647), schema.String().Max(100), schema.Bool())),
	),
	variant("campaign.attachPack", schema.Req("packVersionId", id)),
	variant("campaign.detachPack", schema.Req("packVersionId", id)),
	// The room's World (house decision #65).
	variant("campaign.setWorld", schema.Req("worldVersionId", id)),
	variant("campaign.unsetWorld"),

	variant("session.start", schema.Def("title", sessionTitle, "")),
	// award: XP to every player character the ledger builder builds (house decision #64).
	variant("session.end", schema.Def("recap", recap, ""), schema.Def("award", schema.Int().Min(0).Max(1000), 0.0)),
	variant("session.edit",
		schema.Req("sessionId", id),
		schema.Opt("title", sessionTitle),
		schema.Opt("recap", recap),
		schema.Opt("notes", schema.String().Max(10_000)),
	),
	// No award step, and deleting only the latest ended session (house decision #85).
	variant("session.abandon", schema.Def("recap", recap, "")),
	variant("session.delete", schema.Req("sessionId", id)),

	variant("actor.create",
		schema.Def("kind", schema.Enum(actorKinds...), "pc"),
		schema.Req("name", actorName),
		schema.Opt("entityType", schema.String().Min(1).Max(64)),
	),
	variant("actor.build", schema.Req("actorId", id), schema.Req("answers", answers)),
	variant("build.save", schema.Req("actorId", id), schema.Req("build", LedgerBuildText), schema.Def("draft", schema.Bool(), false),
		schema.Def("keepSheet", schema.Bool(), false)),
	// The group Ascends one Tier together (house decision #64).
	variant("build.ascend", schema.Req("kind", schema.Enum("experience", "milestone")), schema.Def("waivePackage", schema.Bool(), false)),
	variant("actor.spawn",
		schema.Req("packVersionId", id),
		schema.Req("key", schema.String().Min(1).Max(80)),
		schema.Req("count", schema.Int().Min(1).Max(maxSpawn)),
		schema.Def("temporary", schema.Bool(), false),
		schema.Opt("mob", schema.Int().Min(2).Max(500)),
		// How the table sees them in a running fight, and a name in the entry's place (house decision #75).
		schema.Def("visibility", schema.Enum(combatVisibility...), "hidden"),
		schema.Opt("name", schema.String().Trim().Min(1).Max(80)),
		// The ruleset's spawn options it takes, and its marker when it joins a fight (house decision #92).
		schema.Def("options", spawnOptionIDs, []any{}),
		schema.Opt("marker", schema.Enum(Markers...)),
	),
	variant("draft.save", schema.Req("body", BuilderDraftBody)),
	variant("draft.discard"),
	variant("actor.rename", schema.Req("id", id), schema.Req("name", actorName)),
	variant("actor.delete", schema.Req("id", id)),

	variant("rule.op",
		schema.Req("primitive", schema.String().Min(1).Max(64)),
		schema.Req("op", schema.String().Min(1).Max(64)),
		schema.Def("input", schema.Record(schema.String().Max(64), schema.Unknown()), map[string]any{}),
	),
	variant("field.set",
		schema.Req("actorId", id),
		schema.Req("field", schema.String().Min(1).Max(120)),
		schema.Req("value", fieldValue),
	),
	variant("condition.add",
		schema.Req("actorId", id),
		schema.Req("condition", schema.String().Min(1).Max(64)),
		schema.Def("source", schema.String().Max(100), ""),
		schema.Opt("expiresAfter", schema.Int().Min(1).Max(1000)),
	),
	variant("condition.remove", schema.Req("actorId", id), schema.Req("condition", schema.String().Min(1).Max(64))),
	variant("actor.rest", schema.Req("event", schema.String().Min(1).Max(40)), schema.Opt("actorId", id)),
	variant("event.undo"),
	variant("event.turnBack"),

	variant("encounter.start"),
	variant("encounter.end"),
	variant("encounter.add",
		schema.Req("actorIds", schema.Array(id).Min(1).Max(50)),
		schema.Opt("side", schema.String().Min(1).Max(64)),
		schema.Def("visibility", schema.Enum(combatVisibility...), "bar"),
	),
	variant("encounter.remove", schema.Req("combatantId", id)),
	variant("encounter.setInitiative",
		schema.Req("combatantId", id),
		schema.Req("score", schema.Nullable(schema.Int().Min(-1000).Max(1000))),
	),
	variant("encounter.move", schema.Req("combatantId", id), schema.Req("direction", schema.Enum("up", "down"))),
	variant("encounter.setVisibility", schema.Req("combatantId", id), schema.Req("visibility", schema.Enum(combatVisibility...))),
	variant("encounter.keep", schema.Req("combatantId", id), schema.Req("keep", schema.Bool())),
	variant("encounter.mark", schema.Req("combatantId", id), schema.Req("marker", schema.Nullable(schema.Enum(Markers...)))),
	variant("turn.next"),
	variant("turn.prev"),
	variant("turn.first", schema.Req("combatantId", id)),
	variant("phase.done", schema.Req("actorId", id)),
	variant("game.end"),
	variant("result.set", schema.Req("resultId", id), schema.Req("score", schema.Int().Min(-1_000_000).Max(1_000_000))),

	variant("test.call",
		schema.Req("testId", schema.String().Min(1).Max(64)),
		schema.Req("actorIds", schema.Array(schema.UUID()).Min(1).Max(50)),
		schema.Def("inputs", testInputs, map[string]any{}),
		schema.Def("hideTarget", schema.Bool(), false),
		schema.Def("showOutcome", schema.Bool(), false),
	),
	// Dice (`roll`, with an optional `advantage` the api reads as "none") or an `outcome` id, never both.
	schema.Variant{Tag: "test.report", Schema: schema.Object(
		schema.Req("type", schema.Literal("test.report")),
		schema.Req("callId", schema.UUID()),
		schema.Req("actorId", schema.UUID()),
		schema.Opt("advantage", schema.String().Max(20)),
		schema.Opt("roll", schema.Record(schema.String().Max(20), schema.Unknown())),
		schema.Opt("outcome", schema.String().Min(1).Max(64)),
	).Refine(func(a map[string]any) bool {
		_, hasRoll := a["roll"]
		_, hasOutcome := a["outcome"]
		_, hasAdvantage := a["advantage"]
		return hasRoll != hasOutcome && !(hasOutcome && hasAdvantage)
	}, "Report either a roll or an outcome")},
	variant("test.close", schema.Req("callId", schema.UUID()), schema.Def("reveal", schema.Bool(), false)),
	variant("test.applyOffer",
		schema.Req("callId", schema.UUID()),
		schema.Req("actorId", schema.UUID()),
		schema.Req("offerId", schema.String().Min(1).Max(64)),
	),

	variant("invite.create",
		schema.Req("mode", schema.Enum(inviteModes...)),
		schema.Def("role", schema.Enum(memberRoles...), "player"),
		schema.Opt("actorId", id),
		schema.Def("allowGuests", schema.Bool(), true),
		schema.Def("hours", schema.Int().Min(1).Max(720), 12.0),
	),
	variant("invite.revoke", schema.Req("id", id)),
	variant("member.remove", schema.Req("userId", userID)),
	variant("member.appoint",
		schema.Req("userId", userID),
		schema.Req("role", schema.Enum(memberRoles...)),
		schema.Def("scopes", schema.Array(schema.Enum(cogmScopes...)).Max(len(cogmScopes)), []any{}),
	),
	variant("member.seat", schema.Req("userId", userID)),
	variant("seat.leave"),
	variant("token.issue", schema.Req("actorId", id)),
	variant("token.revoke", schema.Req("actorId", id)),
	variant("screen.issue"),
	variant("screen.revoke"),

	variant("codex.save",
		schema.Opt("id", id),
		schema.Req("kind", schema.Enum(codexKinds...)),
		schema.Opt("title", schema.String().Trim().Min(1).Max(200)),
		schema.Opt("body", schema.String().Max(20_000)),
		schema.Opt("gmNotes", schema.String().Max(20_000)),
		schema.Opt("status", schema.Enum(entryStatuses...)),
		schema.Opt("plannedTests", schema.Array(schema.String().Min(1).Max(100)).Max(10)),
		schema.Opt("imageId", schema.Nullable(id)),
		schema.Opt("fields", schema.Refined(schema.Record(schema.String().Min(1).Max(64), codexFieldValue),
			func(v any) bool { return len(v.(map[string]any)) <= 20 }, "At most 20 fields")),
		schema.Opt("layout", schema.Enum(engine.HandoutLayouts...)),
		schema.Opt("header", schema.String().Max(120)),
		schema.Opt("prep", schema.Nullable(ScenePrep)),
		schema.Opt("source", schema.Nullable(EntrySource)),
	),
	// An entry made from a served pack entry, with the ones inside it and a scene's lines (house decision #97).
	variant("codex.fromPack",
		schema.Req("kind", schema.Enum(codexKinds...)),
		schema.Req("entity", schema.String().Min(1).Max(64)),
		schema.Req("key", schema.String().Min(1).Max(80)),
		schema.Opt("parentId", id),
	),
	variant("codex.move",
		schema.Req("id", id),
		schema.Req("parentId", schema.Nullable(id)),
		schema.Req("position", schema.Int().Min(0).Max(10_000)),
	),
	variant("codex.link", schema.Req("id", id), schema.Req("targetId", id)),
	variant("codex.unlink", schema.Req("id", id), schema.Req("targetId", id)),
	variant("codex.reveal",
		schema.Req("id", id),
		schema.Opt("visibility", schema.Enum(codexVisibility...)),
		schema.Def("audienceMode", schema.Enum(audienceModes...), "all"),
		schema.Def("audience", schema.Array(id).Max(50), []any{}),
		schema.Opt("imageRevealed", schema.Bool()),
	),
	variant("codex.delete", schema.Req("id", id), schema.Opt("withScenes", schema.Bool())),
	// Beginning a scene and taking the begin back (house decision #86).
	variant("scene.begin", schema.Req("sceneId", id)),
	variant("scene.undoBegin", schema.Req("beginId", id)),

	variant("clock.create",
		schema.Req("name", clockName),
		schema.Def("segments", clockSegments, 4.0),
		schema.Def("visibility", schema.Enum(clockVisibility...), "gm"),
		schema.Opt("entryId", id),
	),
	variant("clock.tick", schema.Req("id", id), schema.Req("delta", schema.Int().Min(-12).Max(12))),
	variant("clock.update",
		schema.Req("id", id),
		schema.Opt("name", clockName),
		schema.Opt("segments", clockSegments),
		schema.Opt("visibility", schema.Enum(clockVisibility...)),
		schema.Opt("entryId", schema.Nullable(id)),
	),
	variant("clock.delete", schema.Req("id", id)),

	variant("request.send",
		schema.Opt("actorId", id),
		schema.Opt("resourceId", schema.String().Min(1).Max(64)),
		schema.Opt("amount", schema.Int().Min(1).Max(99)),
		schema.Opt("spendId", schema.String().Min(1).Max(64)),
		schema.Opt("inputs", spendInputs),
		schema.Opt("note", requestText),
	),
	variant("spend.do",
		schema.Req("spendId", schema.String().Min(1).Max(64)),
		schema.Req("actorId", id),
		schema.Opt("inputs", spendInputs),
	),
	variant("request.cancel", schema.Req("id", id)),
	variant("request.approve", schema.Req("id", id)),
	variant("request.deny", schema.Req("id", id), schema.Opt("reason", requestText)),
	variant("campaign.setSafety", schema.Req("lines", safetyList), schema.Req("veils", safetyList), schema.Req("xCard", schema.Bool())),
	variant("safety.suggest", schema.Req("kind", schema.Enum("line", "veil")), schema.Req("text", safetyLine)),
	variant("safety.xcard"),

	variant("table.roll", schema.Req("tableId", tableID), schema.Opt("result", tableResult), schema.Opt("actorId", id),
		schema.Opt("inputs", lookupInputs)),
	variant("table.apply", schema.Req("tableId", tableID), schema.Req("result", tableResult), schema.Req("actorId", id),
		schema.Def("inputs", lookupInputs, map[string]any{})),
	// A strike (house decision #99): the server works out what the total does and applies its hit.
	variant("strike.apply", schema.Req("strikeId", tableID), schema.Req("attackerId", id),
		schema.Opt("means", schema.Object(schema.Req("source", schema.Int().Min(0).Max(3)), schema.Req("ref", schema.String().Min(1).Max(120)))),
		schema.Req("targetId", id), schema.Def("inputs", lookupInputs, map[string]any{}),
		schema.Req("total", schema.Int().Min(-1000).Max(1000))),
	variant("held.remove", schema.Req("actorId", id), schema.Req("held", schema.String().Min(1).Max(64)),
		schema.Req("entry", schema.String().Min(1).Max(80))),
	variant("item.give", schema.Req("entryId", id), schema.Req("actorId", id)),
	variant("item.take", schema.Req("entryId", id)),
	variant("item.add", schema.Req("actorId", id), schema.Req("kind", schema.String().Min(1).Max(64)),
		schema.Opt("entry", schema.String().Min(1).Max(80)), schema.Opt("name", schema.String().Trim().Min(1).Max(120)),
		schema.Def("note", schema.String().Max(200), ""), schema.Def("quantity", schema.Int().Min(1).Max(999), 1.0)),
	variant("item.edit", schema.Req("itemId", id), schema.Req("rev", schema.Int().Min(1)),
		schema.Opt("name", schema.String().Trim().Min(1).Max(120)), schema.Opt("note", schema.String().Max(200)),
		schema.Def("remove", schema.Bool(), false)),
	variant("item.fit", schema.Req("itemId", id), schema.Req("to", schema.Nullable(id))),
	variant("item.adjust", schema.Req("itemId", id), schema.Req("by", schema.Refined(schema.Int().Min(-999).Max(999),
		func(v any) bool { return v.(float64) != 0 }, "a change of 0 changes nothing"))),
	variant("table.deal",
		schema.Req("tableId", tableID),
		schema.Req("actorIds", schema.UniqueList(id, 1, 20, "a character is listed twice")),
	),
	variant("table.reshuffle", schema.Req("tableId", tableID)),

	variant("whisper.send",
		schema.Req("to", schema.UniqueList(id, 1, WhisperToMax, "a character is listed twice")),
		schema.Req("text", schema.String().Trim().Min(1).Max(WhisperMax)),
	),
	variant("whisper.reply",
		schema.Req("whisperId", id),
		schema.Req("actorId", id),
		schema.Req("text", schema.String().Trim().Min(1).Max(WhisperReplyMax)),
	),
	variant("whisper.read", schema.Req("whisperId", id), schema.Req("actorId", id)),
	variant("whisper.delete", schema.Req("id", id)),
)

// ParseAction reads a socket payload as an Action, or the issues that refuse it.
func ParseAction(payload any) (Action, []schema.Issue) {
	out, issues := schema.Parse(ActionSchema, payload)
	if len(issues) > 0 {
		return nil, issues
	}
	return Action(out.(map[string]any)), nil
}

// ActionPerms is the permission each action needs. "" means the action checks its caller itself (the transfer's
// recipient holds no permission yet; rule.op takes its op's; a draft is the signed-in member's own).
var ActionPerms = map[string]string{
	"campaign.update":         "campaign:update",
	"campaign.archive":        "campaign:archive",
	"campaign.unarchive":      "campaign:archive",
	"campaign.delete":         "campaign:delete",
	"campaign.transfer":       "campaign:transfer",
	"campaign.transferCancel": "campaign:transfer",
	"campaign.transferAccept": "",
	"campaign.setRuleset":     "campaign:ruleset",
	"campaign.unpinRuleset":   "campaign:ruleset",
	"campaign.setTableMode":   "campaign:table_mode",
	"campaign.setField":       "campaign:update",
	"campaign.attachPack":     "campaign:ruleset",
	"campaign.detachPack":     "campaign:ruleset",
	"campaign.setWorld":       "campaign:ruleset",
	"campaign.unsetWorld":     "campaign:ruleset",
	"session.start":           "session:run",
	"session.end":             "session:run",
	"session.edit":            "session:run",
	"session.abandon":         "session:run",
	"session.delete":          "session:run",
	"actor.create":            "character:create",
	"actor.build":             "character:edit:own",
	"build.save":              "character:edit:own",
	"build.ascend":            "campaign:update",
	"actor.spawn":             "encounter:run",
	"draft.save":              "",
	"draft.discard":           "",
	"actor.rename":            "character:edit:own",
	"actor.delete":            "character:edit:any",
	"rule.op":                 "",
	"field.set":               "character:edit:own",
	"condition.add":           "encounter:run",
	"condition.remove":        "encounter:run",
	"actor.rest":              "session:run",
	"event.undo":              "encounter:run",
	"event.turnBack":          "encounter:run",
	"encounter.start":         "encounter:run",
	"encounter.end":           "encounter:run",
	"encounter.add":           "encounter:run",
	"encounter.remove":        "encounter:run",
	"encounter.setInitiative": "encounter:run",
	"encounter.move":          "encounter:run",
	"encounter.setVisibility": "encounter:run",
	"encounter.keep":          "encounter:run",
	"encounter.mark":          "encounter:run",
	"turn.next":               "encounter:run",
	"turn.prev":               "encounter:run",
	"turn.first":              "encounter:run",
	"phase.done":              "phase:done:own",
	"game.end":                "encounter:run",
	"result.set":              "encounter:run",
	"test.call":               "test:call",
	"test.report":             "test:report:own",
	"test.close":              "test:call",
	"test.applyOffer":         "test:call",
	"invite.create":           "member:invite",
	"invite.revoke":           "member:invite",
	"member.remove":           "member:remove",
	"member.appoint":          "member:appoint",
	"member.seat":             "member:seat",
	"seat.leave":              "seat:leave",
	"token.issue":             "token:issue",
	"token.revoke":            "token:issue",
	"screen.issue":            "token:issue",
	"screen.revoke":           "token:issue",
	"codex.save":              "codex:write",
	"codex.fromPack":          "codex:write",
	"codex.reveal":            "codex:reveal",
	"codex.delete":            "codex:write",
	"scene.begin":             "codex:write",
	"scene.undoBegin":         "codex:write",
	"codex.move":              "codex:write",
	"codex.link":              "codex:write",
	"codex.unlink":            "codex:write",
	"clock.create":            "clock:run",
	"clock.tick":              "clock:run",
	"clock.update":            "clock:run",
	"clock.delete":            "clock:run",
	"request.send":            "request:send",
	"spend.do":                "request:resolve",
	"request.cancel":          "request:send",
	"request.approve":         "request:resolve",
	"request.deny":            "request:resolve",
	"campaign.setSafety":      "session:run",
	"safety.suggest":          "safety:signal",
	"safety.xcard":            "safety:signal",
	"table.roll":              "session:run",
	"table.apply":             "encounter:run",
	"strike.apply":            "encounter:run",
	"held.remove":             "character:edit:any",
	"table.deal":              "session:run",
	"table.reshuffle":         "session:run",
	"whisper.send":            "session:run",
	"whisper.delete":          "session:run",
	"whisper.reply":           "whisper:receive:own",
	"whisper.read":            "whisper:receive:own",
	"item.give":               "character:edit:any",
	"item.take":               "character:edit:any",
	"item.add":                "character:edit:any",
	"item.edit":               "character:edit:any",
	// item.fit and item.adjust ask character:edit:own of the item's holder in their handler (house decision #95).
	"item.fit":    "",
	"item.adjust": "",
}

// OwnFallback is the GM-side permission that also satisfies an :own one: a GM renames any character.
var OwnFallback = map[string]string{
	"character:edit:own": "character:edit:any",
	"test:report:own":    "test:call",
	"phase:done:own":     "encounter:run",
}

// AdminActions is the housekeeping an admin may send at a room from the console (ADMIN_ACTIONS in actions.ts): seat a
// user, remove one, archive, unarchive, delete, hand on, end the running session with no award, delete the last one.
var AdminActions = []string{
	"member.seat", "member.remove", "campaign.archive", "campaign.unarchive", "campaign.delete", "campaign.transfer",
	"session.abandon", "session.delete",
}

// ArchivedOpen holds the actions an archived room still takes: unarchive, delete, leaving, and revoking access.
var ArchivedOpen = []string{
	"campaign.unarchive", "campaign.delete", "seat.leave", "token.revoke", "invite.revoke", "screen.revoke", "member.remove",
}

// IsArchivedOpen says whether an archived room still takes this action.
func IsArchivedOpen(actionType string) bool { return slices.Contains(ArchivedOpen, actionType) }

// Book pages (packages/core-schema/src/book.ts): a GM tablet renders one page and the api relays it, storing nothing.

// MaxPageBytes caps one relayed page: a JPEG of about 150-400 KB at the width the GM renders.
const MaxPageBytes = 1_500_000

// MaxServedSources caps the sources one GM socket says it serves.
const MaxServedSources = 100

var bookSource = schema.String().Min(1).Max(60).Regex(`^[a-z0-9][a-z0-9-]*$`, "Invalid string: must match pattern /^[a-z0-9][a-z0-9-]*$/")

var (
	// BookPage is a seat's request for one page.
	BookPage = schema.Object(schema.Req("source", bookSource), schema.Req("page", schema.Int().Min(1).Max(5000)))
	// BookServing is what a GM socket serves; an empty list stops serving.
	BookServing = schema.Object(schema.Req("sources", schema.Array(bookSource).Max(MaxServedSources)))
	// refusalParams is RefusalParamsSchema: a relayed refusal is untrusted, so short values only.
	refusalParams = schema.Record(schema.String().Max(40), schema.AnyOf(
		schema.String().Max(200), schema.Number(-math.MaxFloat64, math.MaxFloat64),
	))
)

// BookAck parses a GM tablet's reply. A page comes back as its bytes; a refusal keeps its text (cut to 200 UTF-16 units)
// and drops a code this api does not know, or params it would not send itself. ok is false when the reply is neither.
func BookAck(reply any) (out map[string]any, ok bool) {
	m, isMap := reply.(map[string]any)
	if !isMap {
		return nil, false
	}
	switch m["ok"] {
	case true:
		// The socket hands a binary attachment over as a buffer; tests pass plain bytes.
		var image []byte
		switch b := m["image"].(type) {
		case []byte:
			image = b
		case interface{ Bytes() []byte }:
			image = b.Bytes()
		}
		if len(image) == 0 || len(image) > MaxPageBytes {
			return nil, false
		}
		return map[string]any{"ok": true, "image": image}, true
	case false:
		text, isText := m["error"].(string)
		if !isText {
			return nil, false
		}
		if units := utf16.Encode([]rune(text)); len(units) > 200 {
			text = string(utf16.Decode(units[:200]))
		}
		out := map[string]any{"ok": false, "error": text}
		if code, isCode := m["code"].(string); isCode {
			if _, known := refusals[code]; known {
				out["code"] = code
			}
		}
		if raw, present := m["params"]; present {
			if params, issues := schema.Parse(refusalParams, raw); len(issues) == 0 {
				out["params"] = params
			}
		}
		return out, true
	}
	return nil, false
}
