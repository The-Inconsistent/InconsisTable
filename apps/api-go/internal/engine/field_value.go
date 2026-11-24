package engine

import (
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Server-side ceilings for a field value; a manifest's own maxLength or maxItems may only tighten them.
const (
	maxTextChars     = 10_000
	maxListItems     = 500
	maxListItemChars = 1_000
	int4Min          = -2_147_483_648
	int4Max          = 2_147_483_647
)

// A field value as a pack body or a builder answer carries it. Null (unset) is not allowed: omit the field.
var fieldValueInput = schema.AnyOf(
	schema.Number(int4Min, int4Max),
	schema.String().Max(maxTextChars),
	schema.Bool(),
	schema.Array(schema.String().Max(maxListItemChars)).Max(maxListItems),
)

// entryID is the shape of an `entry` field's value, an entry's id (house decision #76).
var entryID = schema.UUID()

func unitLength(s string) int {
	// ASCII is the common case, and there a unit is a byte.
	if utf8.RuneCountInString(s) == len(s) {
		return len(s)
	}
	return len(stringToUnits(s))
}

// CheckFieldValue says why value does not fit def, or returns "" when it does. It is the one place a value is checked
// against a FieldDef.
func CheckFieldValue(def *FieldDef, value any) string {
	switch def.Type {
	case "int":
		n, ok := value.(float64)
		if !ok || n != math.Trunc(n) {
			return "expected a whole number"
		}
		if n < int4Min || n > int4Max {
			return "outside the range of a whole number"
		}
		if def.Min != nil && n < *def.Min {
			return "below the minimum of " + esNumber(*def.Min)
		}
		if def.Max != nil && n > *def.Max {
			return "above the maximum of " + esNumber(*def.Max)
		}
	case "text":
		text, ok := value.(string)
		if !ok {
			return "expected text"
		}
		limit := float64(maxTextChars)
		if def.MaxLength != nil {
			limit = math.Min(*def.MaxLength, limit)
		}
		if size := unitLength(text); float64(size) > limit {
			return fmt.Sprintf("%d characters, over the cap of %s", size, esNumber(limit))
		}
	case "enum":
		text, ok := value.(string)
		if !ok || !slices.Contains(def.Values, text) {
			return "expected one of " + strings.Join(def.Values, ", ")
		}
	case "bool":
		if _, ok := value.(bool); !ok {
			return "expected true or false"
		}
	case "ref":
		// ponytail: only the shape; whether the key exists in a pack is checked where entries are known (the importer).
		text, ok := value.(string)
		if !ok || text == "" || unitLength(text) > 120 {
			return "expected an entry key"
		}
	case "entry":
		// Only the shape; the server checks the id names an entry of the room and of the kind (house decision #76).
		if _, issues := schema.Parse(entryID, value); len(issues) > 0 {
			return "expected an entry id"
		}
	case "list":
		items, ok := value.([]any)
		if !ok {
			return "expected a list of text"
		}
		for _, item := range items {
			if _, isText := item.(string); !isText {
				return "expected a list of text"
			}
		}
		limit := float64(maxListItems)
		if def.MaxItems != nil {
			limit = math.Min(*def.MaxItems, limit)
		}
		if float64(len(items)) > limit {
			return "more than " + esNumber(limit) + " items"
		}
		for _, item := range items {
			if unitLength(item.(string)) > maxListItemChars {
				return fmt.Sprintf("an item is over %d characters", maxListItemChars)
			}
		}
	case "tags":
		return checkTags(def, value)
	case "rows":
		return checkRows(def, value)
	}
	return ""
}

// checkTags is a tags value's shape (house decision #89): words, under the cap, none empty or too long or twice.
// Whether a word is one of the suggestions is checked where the packs are known (codex.save).
func checkTags(def *FieldDef, value any) string {
	items, ok := value.([]any)
	if !ok {
		return "expected a list of words"
	}
	words := make([]string, len(items))
	for i, item := range items {
		if words[i], ok = item.(string); !ok {
			return "expected a list of words"
		}
	}
	limit := float64(MaxTags)
	if def.MaxItems != nil {
		limit = math.Min(*def.MaxItems, limit)
	}
	if float64(len(words)) > limit {
		return "more than " + esNumber(limit) + " words"
	}
	for _, w := range words {
		if schema.TrimJS(w) == "" {
			return "a word is empty"
		}
	}
	for _, w := range words {
		if unitLength(w) > MaxTagChars {
			return fmt.Sprintf("a word is over %d characters", MaxTagChars)
		}
	}
	seen := map[string]bool{}
	for _, w := range words {
		if seen[w] {
			return "a word is there twice"
		}
		seen[w] = true
	}
	return ""
}

func plainObject(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func onlyKeys(m map[string]any, keys ...string) bool {
	for k := range m {
		if !slices.Contains(keys, k) {
			return false
		}
	}
	return true
}

// checkCell says why a cell does not fit its column, or "" (house decision #89; checkCell in field-value.ts).
func checkCell(col *RowColumn, value any) string {
	switch col.Type {
	case "int", "enum", "bool", "ref":
		def := FieldDef{Type: col.Type, Min: col.Min, Max: col.Max, Values: col.Values, Entity: col.Entity}
		return CheckFieldValue(&def, value)
	case "text":
		text, ok := value.(string)
		if !ok {
			return "expected text"
		}
		limit := float64(MaxCellChars)
		if col.MaxLength != nil {
			limit = math.Min(*col.MaxLength, limit)
		}
		if size := unitLength(text); float64(size) > limit {
			return fmt.Sprintf("%d characters, over the cap of %s", size, esNumber(limit))
		}
	case "test":
		// A prepared Test line's testId and inputs (coreschema prep tests): the Test's id and its inputs' values.
		m, ok := plainObject(value)
		if !ok || !onlyKeys(m, "testId", "inputs") {
			return "expected a Test and its inputs"
		}
		testID, ok := m["testId"].(string)
		if !ok || testID == "" || unitLength(testID) > 64 {
			return "expected a Test"
		}
		inputs := map[string]any{}
		if raw, has := m["inputs"]; has {
			if inputs, ok = plainObject(raw); !ok {
				return "expected a Test's inputs"
			}
		}
		for k, v := range inputs {
			fits := false
			switch x := v.(type) {
			case bool, float64:
				fits = true
			case string:
				fits = unitLength(x) <= 100
			}
			if unitLength(k) > 64 || !fits {
				return "an input is not a number, a word or a yes/no"
			}
		}
	}
	return ""
}

// checkRows says why a rows value does not fit its declaration, or ""; a problem names the row and the column (house
// decision #89; checkRows in field-value.ts).
func checkRows(def *FieldDef, value any) string {
	rows, ok := value.([]any)
	if !ok {
		return "expected a list of rows"
	}
	limit := float64(MaxRows)
	if def.MaxRows != nil {
		limit = math.Min(*def.MaxRows, limit)
	}
	if float64(len(rows)) > limit {
		return "more than " + esNumber(limit) + " rows"
	}
	ids := map[string]bool{}
	for i, raw := range rows {
		at := fmt.Sprintf("[%d]", i)
		row, ok := plainObject(raw)
		if !ok || !onlyKeys(row, "id", "from", "values") {
			return at + ": expected id, from and values"
		}
		id, ok := row["id"].(string)
		if !ok || id == "" || unitLength(id) > 40 {
			return at + ".id: expected a row id"
		}
		if ids[id] {
			return fmt.Sprintf(`%s.id: "%s" is there twice`, at, id)
		}
		ids[id] = true
		if from, has := row["from"]; has {
			if why := checkFrom(def, from); why != "" {
				return at + why
			}
		}
		values, ok := plainObject(row["values"])
		if !ok {
			return at + ".values: expected the row's values"
		}
		for _, col := range sortedKeys(values) {
			c := columnOf(def, col)
			if c == nil {
				return at + ".values." + col + ": not a column"
			}
			if why := checkCell(c, values[col]); why != "" {
				return at + ".values." + col + ": " + why
			}
		}
	}
	return ""
}

// checkFrom says why a row's `from` does not fit, after the row's path, or "".
func checkFrom(def *FieldDef, raw any) string {
	from, ok := plainObject(raw)
	if !ok || !onlyKeys(from, "entity", "key", "cite") {
		return ".from: expected entity, key and cite"
	}
	entity, ok := from["entity"].(string)
	filled := false
	for _, f := range def.From {
		filled = filled || (ok && f.Entity == entity)
	}
	if !filled {
		return ".from.entity: not a type this field is filled from"
	}
	if key, ok := from["key"].(string); !ok || key == "" || unitLength(key) > 120 {
		return ".from.key: expected an entry key"
	}
	if cite, has := from["cite"]; has {
		if text, ok := cite.(string); !ok || text == "" || unitLength(text) > 40 {
			return ".from.cite: expected a cite"
		}
	}
	return ""
}

// FitRows is a stored rows value as the ruleset now declares it (house decision #89; fitRows in field-value.ts): rows
// past the cap, rows without a sound id and cells the declaration no longer has or that no longer fit are left out of
// what a seat receives; the rest of each row stays. Nil when it is not a list.
func FitRows(def *FieldDef, value any) []any {
	rows, ok := value.([]any)
	if !ok {
		return nil
	}
	limit := MaxRows
	if def.MaxRows != nil && int(*def.MaxRows) < limit {
		limit = int(*def.MaxRows)
	}
	ids := map[string]bool{}
	out := []any{}
	for _, raw := range rows {
		if len(out) >= limit {
			break
		}
		row, ok := plainObject(raw)
		if !ok {
			continue
		}
		id, ok := row["id"].(string)
		if !ok || id == "" || unitLength(id) > 40 || ids[id] {
			continue
		}
		ids[id] = true
		values := map[string]any{}
		if stored, ok := plainObject(row["values"]); ok {
			for col, cell := range stored {
				if c := columnOf(def, col); c != nil && checkCell(c, cell) == "" {
					values[col] = cell
				}
			}
		}
		kept := map[string]any{"id": id, "values": values}
		if from, has := row["from"]; has && checkFrom(def, from) == "" {
			kept["from"] = from
		}
		out = append(out, kept)
	}
	return out
}

// CheckCampaignValue says why value does not fit a campaign field, or returns "" when it does; worded like
// CheckFieldValue.
func CheckCampaignValue(def *CampaignFieldDef, value any) string {
	switch def.Type {
	case "int":
		n, ok := value.(float64)
		if !ok || n != math.Trunc(n) {
			return "expected a whole number"
		}
		if n < def.Min {
			return "below the minimum of " + esNumber(def.Min)
		}
		if n > def.Max {
			return "above the maximum of " + esNumber(def.Max)
		}
	case "enum":
		text, ok := value.(string)
		if !ok || !slices.Contains(def.Values, text) {
			return "expected one of " + strings.Join(def.Values, ", ")
		}
	case "bool":
		if _, ok := value.(bool); !ok {
			return "expected true or false"
		}
	}
	return ""
}
