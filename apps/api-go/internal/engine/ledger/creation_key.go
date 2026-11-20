package ledger

import (
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// CreationKey is creationKey (packages/rules-engine/src/build/creation-key.ts, house decision #64) on a build parsed
// by its schema (ParseRecord with Schemas().CharacterBuild): the creation part of the build as a stable string, which
// is everything but the advancement, the choices under `advance/` and the GM's part, with keys sorted at every depth
// by UTF-16 code units, as the TypeScript compares them.
func CreationKey(build *schema.Obj) string {
	part := schema.NewObj()
	for _, k := range build.Keys() {
		if k != "advancement" && k != "gm" {
			v, _ := build.Get(k)
			part.Set(k, v)
		}
	}
	choices := schema.NewObj()
	for _, k := range sub(build, "choices").Keys() {
		if !strings.HasPrefix(k, "advance/") {
			v, _ := sub(build, "choices").Get(k)
			choices.Set(k, v)
		}
	}
	part.Set("choices", choices)
	return stringify(sortedKeys(part), false)
}

// sortedKeys is v with every object's keys set in sorted order, at every depth (the replacer of creationKey). An
// object still lists array indexes first, as JavaScript's does.
func sortedKeys(v any) any {
	switch x := v.(type) {
	case *schema.Obj:
		keys := slices.Clone(x.Keys())
		slices.SortStableFunc(keys, func(a, b string) int { return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b))) })
		out := schema.NewObj()
		for _, k := range keys {
			item, _ := x.Get(k)
			out.Set(k, sortedKeys(item))
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = sortedKeys(item)
		}
		return out
	}
	return v
}
