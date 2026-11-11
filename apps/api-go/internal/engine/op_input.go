package engine

import (
	"regexp"
	"slices"
)

// Op input arrives as decoded JSON from a player's phone, so this is the trust boundary zod is in TypeScript. It accepts
// and refuses what the schemas in packages/rules-engine accept and refuse. Refusal text differs from zod's: the api
// sends clients the code, and the message only as detail.

var idPattern = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)

// objectReader reads an object's fields and remembers the first one that was bad.
type objectReader struct {
	fields map[string]any
	bad    string
}

// readObject is z.object: unknown keys are ignored.
func readObject(v any) (*objectReader, bool) {
	fields, ok := v.(map[string]any)
	return &objectReader{fields: fields}, ok
}

// A key with null is present: zod's optional and default only cover undefined.
func (r *objectReader) has(key string) bool {
	_, ok := r.fields[key]
	return ok
}

func (r *objectReader) fail(key string) { r.bad = firstNonEmpty(r.bad, key) }

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (r *objectReader) refusal(code string) *Refusal {
	if r.bad == "" {
		return nil
	}
	return refuse(code, "%s is not valid", r.bad)
}

// str reads a required string of at least one character.
func (r *objectReader) str(key string) string {
	s, ok := r.fields[key].(string)
	if !ok || s == "" {
		r.fail(key)
	}
	return s
}

func isID(v any) bool {
	s, ok := v.(string)
	return ok && len(s) <= 64 && idPattern.MatchString(s)
}

func (r *objectReader) id(key string) string {
	if !isID(r.fields[key]) {
		r.fail(key)
		return ""
	}
	return r.fields[key].(string)
}

func (r *objectReader) optID(key string) *string {
	if !r.has(key) {
		return nil
	}
	id := r.id(key)
	return &id
}

func isIntIn(v any, lo, hi float64) bool {
	f, ok := v.(float64)
	return ok && isSafeInteger(f) && f >= lo && f <= hi
}

func (r *objectReader) intIn(key string, lo, hi float64) float64 {
	if !isIntIn(r.fields[key], lo, hi) {
		r.fail(key)
		return 0
	}
	return r.fields[key].(float64)
}

func (r *objectReader) optInt(key string, lo, hi float64) *float64 {
	if !r.has(key) {
		return nil
	}
	n := r.intIn(key, lo, hi)
	return &n
}

func (r *objectReader) intOr(key string, lo, hi, fallback float64) float64 {
	if !r.has(key) {
		return fallback
	}
	return r.intIn(key, lo, hi)
}

func (r *objectReader) boolOr(key string, fallback bool) bool {
	if !r.has(key) {
		return fallback
	}
	b, ok := r.fields[key].(bool)
	if !ok {
		r.fail(key)
	}
	return b
}

func (r *objectReader) enum(key string, options []string) string {
	s, ok := r.fields[key].(string)
	if !ok || !slices.Contains(options, s) {
		r.fail(key)
	}
	return s
}

func (r *objectReader) enumOr(key string, options []string, fallback string) string {
	if !r.has(key) {
		return fallback
	}
	return r.enum(key, options)
}

// list reads a required array with a length between lo and hi.
func (r *objectReader) list(key string, lo, hi int) []any {
	items, ok := r.fields[key].([]any)
	if !ok || len(items) < lo || len(items) > hi {
		r.fail(key)
		return nil
	}
	return items
}

func (r *objectReader) intList(key string, lo, hi int, min, max float64) []float64 {
	items := r.list(key, lo, hi)
	out := make([]float64, len(items))
	for i, item := range items {
		if !isIntIn(item, min, max) {
			r.fail(key)
			return nil
		}
		out[i] = item.(float64)
	}
	return out
}

// nested reads a required object and folds its first bad field into this reader.
func (r *objectReader) nested(key string) *objectReader {
	inner, ok := readObject(r.fields[key])
	if !ok {
		r.fail(key)
	}
	return inner
}

func (r *objectReader) absorb(key string, inner *objectReader) {
	if inner.bad != "" {
		r.fail(key + "." + inner.bad)
	}
}

// parseEmpty is z.strictObject({}): no keys at all.
func parseEmpty(code string) func(any) (struct{}, *Refusal) {
	return func(v any) (struct{}, *Refusal) {
		fields, ok := v.(map[string]any)
		if !ok || len(fields) != 0 {
			return struct{}{}, refuse(code, "takes no values")
		}
		return struct{}{}, nil
	}
}
