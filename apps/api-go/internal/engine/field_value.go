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
	}
	return ""
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
