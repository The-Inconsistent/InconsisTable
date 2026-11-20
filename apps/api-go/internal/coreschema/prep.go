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

// PrepKinds are the document's keys, the five kinds of line.
var PrepKinds = []string{"roster", "tests", "pools", "exits", "reveals"}

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
			)),
			lines("tests", prepLine(
				schema.Req("testId", schema.String().Min(1).Max(64)),
				schema.Def("inputs", testInputs, map[string]any{}),
				schema.Def("takers", schema.Enum("party", "listed"), "party"),
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
		).Strict(),
		uniqueLineIDs, "Two lines share an id",
	),
	// JSON.stringify's UTF-8 length; key order does not change it, so canonical JSON measures the same.
	func(v any) bool { return len(engine.CanonicalJSON(v)) <= MaxPrepBytes },
	"The scene's prepared lines are over 32 KB",
)

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
