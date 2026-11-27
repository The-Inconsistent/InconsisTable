package schema

import (
	"math"
	"strings"
)

// FloatSchema is z.number() that need not be whole, with its bounds.
type FloatSchema struct {
	positive bool
	max      *float64
}

// Float is z.number().
func Float() *FloatSchema { return &FloatSchema{} }

// Positive is .positive(): above 0.
func (s *FloatSchema) Positive() *FloatSchema { return &FloatSchema{true, s.max} }

// Max is .max(n).
func (s *FloatSchema) Max(n float64) *FloatSchema { return &FloatSchema{s.positive, &n} }

func (s *FloatSchema) parse(value any, c *context) any {
	n, ok := value.(float64)
	if !ok || math.IsInf(n, 0) || math.IsNaN(n) {
		c.wrongType("number", value)
		return nil
	}
	if s.positive && n <= 0 {
		c.fail("Too small: expected number to be >0")
	}
	if s.max != nil && n > *s.max {
		c.fail("Too big: expected number to be <=%v", *s.max)
	}
	return n
}

type unknownSchema struct{}

// Unknown is z.unknown(): anything passes, as it came.
func Unknown() Schema { return unknownSchema{} }

func (unknownSchema) parse(value any, _ *context) any { return value }

type nullSchema struct{}

// Null is z.null().
func Null() Schema { return nullSchema{} }

func (nullSchema) parse(value any, c *context) any {
	if value != nil {
		c.wrongType("null", value)
	}
	return nil
}

type nullableSchema struct{ inner Schema }

// Nullable is .nullable(): null passes, anything else goes to the inner schema.
func Nullable(inner Schema) Schema { return nullableSchema{inner} }

func (s nullableSchema) parse(value any, c *context) any {
	if value == nil {
		return nil
	}
	return s.inner.parse(value, c)
}

// zod 4's z.iso.datetime({ offset: true }): RFC 3339 with seconds, a Z or a numeric offset.
const dateSource = `(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))`

// DateTime is z.iso.datetime({ offset: true }).
func DateTime() *StringSchema {
	return String().Regex(`^`+dateSource+`T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$`,
		"Invalid ISO datetime")
}

type refinedSchema struct {
	inner   Schema
	check   func(any) bool
	message string
}

// Refined is .refine(check, message) on a whole value: the check runs only when the inner schema accepted it.
func Refined(inner Schema, check func(any) bool, message string) Schema {
	return refinedSchema{inner, check, message}
}

type uniqueListSchema struct {
	item     Schema
	min, max int
	message  string
}

// UniqueList is z.array(item).min(min).max(max).refine(no repeats, message). Zod measures the length first: a list too
// long or too short is refused for that alone, with no look at its items.
func UniqueList(item Schema, min, max int, message string) Schema {
	return uniqueListSchema{item, min, max, message}
}

func (s uniqueListSchema) parse(value any, c *context) any {
	items, ok := value.([]any)
	if !ok {
		c.wrongType("array", value)
		// The same length checks, reading a string sent for an array, as ArraySchema does.
		if text, isText := value.(string); isText {
			tooShort("string", length(text), s.min, c)
			tooLong("string", length(text), s.max, c)
		}
		return nil
	}
	if len(items) < s.min || len(items) > s.max {
		tooShort("array", len(items), s.min, c)
		tooLong("array", len(items), s.max, c)
		return items
	}
	before := len(c.issues)
	out := make([]any, len(items))
	for i, it := range items {
		c.at(i, func() { out[i] = s.item.parse(it, c) })
	}
	if len(c.issues) > before {
		return out
	}
	seen := map[any]bool{}
	for _, v := range out {
		if seen[v] {
			c.fail("%s", s.message)
			break
		}
		seen[v] = true
	}
	return out
}

type softRefinedSchema struct {
	inner   Schema
	check   func(any) bool
	message string
}

// RefinedSoft is .refine(check, message) the way zod runs it: skipped only when the inner value was the wrong kind, not
// when it merely failed a bound (a number above its max is still a number to compare).
func RefinedSoft(inner Schema, check func(any) bool, message string) Schema {
	return softRefinedSchema{inner, check, message}
}

func (s softRefinedSchema) parse(value any, c *context) any {
	before := len(c.issues)
	out := s.inner.parse(value, c)
	for _, issue := range c.issues[before:] {
		if issue.hard {
			return out
		}
	}
	if !s.check(out) {
		c.fail("%s", s.message)
	}
	return out
}

func (s refinedSchema) parse(value any, c *context) any {
	before := len(c.issues)
	out := s.inner.parse(value, c)
	if len(c.issues) == before && !s.check(out) {
		c.fail("%s", s.message)
	}
	return out
}

type superRefinedSchema struct {
	inner Schema
	check func(any) []string
}

// SuperRefined is .superRefine((v, ctx) => …) the way zod runs it: skipped when the inner value was the wrong kind, as
// RefinedSoft is, and each message it returns an issue at the value's own path.
func SuperRefined(inner Schema, check func(any) []string) Schema {
	return superRefinedSchema{inner, check}
}

type wordsSchema struct {
	words  Schema
	either Schema
	langs  []string
}

// Words is words.ts Words$ and TermWords: the words themselves, for every language, or a map from language (langs, in
// fallback order) to words, which must name one. Under ParseIn the map is read as one language's words.
func Words(words Schema, langs ...string) Schema {
	// The map goes through a transform in zod, and a pipe whose input failed aborts: a map that fails is Invalid input.
	return wordsSchema{words, AnyOf(words, aborting{byLanguage(words, langs)}), langs}
}

// ByLanguage is words.ts TermWords: the same choice as Words, never read in one language by ParseIn, because its
// reader looks a language up itself.
func ByLanguage(words Schema, langs ...string) Schema {
	return AnyOf(words, byLanguage(words, langs))
}

func byLanguage(words Schema, langs []string) Schema {
	return RefinedSoft(PartialRecord(words, langs...), func(v any) bool {
		m, _, _ := mapOf(v)
		return len(m) > 0
	}, "give the words in at least one language")
}

// aborting is the input of a zod pipe: a failed check aborts there, so a union reads it as the wrong kind. An unknown
// key does not (zod 4.6 reports it through the union, as the vectors show).
type aborting struct{ inner Schema }

func (s aborting) parse(value any, c *context) any {
	before := len(c.issues)
	out := s.inner.parse(value, c)
	for i := before; i < len(c.issues); i++ {
		if !strings.HasPrefix(c.issues[i].Message, "Unrecognized key") {
			c.issues[i].hard = true
		}
	}
	return out
}

func (s wordsSchema) parse(value any, c *context) any {
	out := s.either.parse(value, c)
	if c.read == nil || out == nil {
		return out
	}
	if _, issues := Parse(s.words, value); len(issues) == 0 {
		return out
	}
	m, _, _ := mapOf(out)
	for _, lang := range append([]string{c.read.lang, c.read.fallback}, s.langs...) {
		if v, ok := m[lang]; ok {
			return v
		}
	}
	return out
}

func (s superRefinedSchema) parse(value any, c *context) any {
	before := len(c.issues)
	out := s.inner.parse(value, c)
	for _, issue := range c.issues[before:] {
		if issue.hard {
			return out
		}
	}
	for _, message := range s.check(out) {
		c.fail("%s", message)
	}
	return out
}
