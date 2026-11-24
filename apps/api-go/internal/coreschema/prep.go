package coreschema

import (
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// A scene's prepared lines (packages/core-schema/src/prep.ts, house decision #73): each line is an action the table
// already has, parked until the GM sends it. Only shapes and limits are checked here.

// The limits of the document: lines of each kind, its size serialized, a test line's outcome texts.
const (
	MaxPrepLines    = 40
	MaxPrepBytes    = 32 * 1024
	maxTestOutcomes = 6
)

// SceneStatuses are a scene's statuses; QuestStatuses a quest's. At most one scene of a room is active.
var (
	SceneStatuses = []string{"planned", "active", "done", "skipped"}
	QuestStatuses = questStatuses
	entryStatuses = []string{"open", "done", "failed", "planned", "active", "skipped"}
)

// spawnOptionIDs are the ruleset's spawn options a spawn takes, each once (prep.ts SpawnOptionIds, house decision #92).
var spawnOptionIDs = schema.Refined(schema.Array(schema.String().Min(1).Max(64)).Max(10), func(v any) bool {
	list, _ := v.([]any)
	seen := map[any]bool{}
	for _, x := range list {
		if seen[x] {
			return false
		}
		seen[x] = true
	}
	return true
}, "An option is listed twice")

// PrepKinds are the document's keys, the six kinds of line.
var PrepKinds = []string{"roster", "tests", "pools", "exits", "reveals", "picks"}

// prepLine is what every line carries, then its own fields (an exit's own label in the shared one's place).
func prepLine(fields ...schema.Field) *schema.ObjectSchema {
	return schema.Object(
		schema.Req("id", schema.String().Min(1).Max(40)),
		schema.Opt("label", schema.String().Max(80)),
		schema.Opt("note", schema.String().Max(500)),
	).Extend(fields...)
}

// ScenePrep is the whole document; a kind it does not know is refused, never dropped.
var ScenePrep = schema.Refined(
	schema.Refined(
		schema.Object(
			lines("roster", prepLine(
				schema.Req("pack", schema.String().Min(1).Max(64)),
				schema.Req("key", schema.String().Min(1).Max(80)),
				schema.Req("count", schema.Int().Min(1).Max(50)),
				schema.Opt("mob", schema.Int().Min(2).Max(500)),
				schema.Def("visibility", schema.Enum(combatVisibility...), "hidden"),
				schema.Def("temporary", schema.Bool(), true),
				schema.Opt("marker", schema.Enum(Markers...)),
				schema.Opt("options", spawnOptionIDs),
			)),
			lines("tests", prepLine(
				schema.Req("testId", schema.String().Min(1).Max(64)),
				schema.Def("inputs", testInputs, map[string]any{}),
				schema.Def("takers", schema.Enum("party", "listed", "pick"), "party"),
				schema.Def("actorIds", schema.Array(id).Max(50), []any{}),
				schema.Def("hideTarget", schema.Bool(), false),
				schema.Def("outcomes", schema.Array(schema.Object(
					schema.Req("label", schema.String().Min(1).Max(40)),
					schema.Req("text", schema.String().Max(500)),
				)).Max(maxTestOutcomes), []any{}),
			)),
			lines("pools", prepLine(
				schema.Req("pool", schema.String().Min(1).Max(64)),
				schema.Req("amount", schema.Refined(schema.Int().Min(-1000).Max(1000),
					func(v any) bool { n, _ := v.(float64); return n != 0 }, "An amount is never 0")),
				schema.Def("text", schema.String().Max(500), ""),
			)),
			lines("exits", prepLine(
				schema.Req("label", schema.String().Trim().Min(1).Max(80)),
				schema.Req("sceneId", id),
			)),
			lines("reveals", prepLine(schema.Req("entryId", id))),
			// Rows a scene picks from another entry's rows field, each with its switch (house decision #89).
			lines("picks", prepLine(
				schema.Req("entryId", id),
				schema.Req("field", schema.String().Min(1).Max(64)),
				schema.Def("rows", schema.Refined(schema.Array(schema.Object(
					schema.Req("rowId", schema.String().Min(1).Max(40)),
					schema.Def("on", schema.Bool(), false),
				)).Max(MaxPickedRows), uniqueRowIDs, "A row is picked twice"), []any{}),
			)),
		).Strict(),
		uniqueLineIDs, "Two lines share an id",
	),
	// JSON.stringify's UTF-8 length; key order does not change it, so canonical JSON measures the same.
	func(v any) bool { return len(engine.CanonicalJSON(v)) <= MaxPrepBytes },
	"The scene's prepared lines are over 32 KB",
)

// MaxPickedRows caps the rows one pick line holds (core-schema MAX_PICKED_ROWS).
const MaxPickedRows = 30

// uniqueRowIDs: a pick line names a row once.
func uniqueRowIDs(v any) bool {
	list, _ := schema.Plain(v).([]any)
	seen := map[string]bool{}
	for _, r := range list {
		row, _ := r.(map[string]any)
		rowID, _ := row["rowId"].(string)
		if seen[rowID] {
			return false
		}
		seen[rowID] = true
	}
	return true
}

func lines(kind string, line *schema.ObjectSchema) schema.Field {
	return schema.Def(kind, schema.Array(line).Max(MaxPrepLines), []any{})
}

// uniqueLineIDs: a line's id names one line of the document.
func uniqueLineIDs(v any) bool {
	doc := schema.Plain(v).(map[string]any)
	seen := map[string]bool{}
	for _, kind := range PrepKinds {
		list, _ := doc[kind].([]any)
		for _, l := range list {
			line, _ := l.(map[string]any)
			lineID, _ := line["id"].(string)
			if seen[lineID] {
				return false
			}
			seen[lineID] = true
		}
	}
	return true
}
