// Package schema parses decoded JSON the way the project's zod schemas do: the same values pass, the same defaults fill
// in, unknown keys drop, and a refusal carries zod's path and wording, because importers read it
// (docs/adr/0008-go-api.md). It covers what packages/rules-engine and packages/core-schema use, not all of zod.
package schema

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
)

const maxSafeInteger = 9007199254740991

// Issue is one refusal. Path holds strings and ints, as zod's does.
type Issue struct {
	Path    []any
	Message string
	// hard is zod's aborted: the value was the wrong kind, as opposed to the right kind failing a check. A union tells
	// its options apart by this.
	hard bool
}

// Schema reads one value. Undefined stands for a key that is absent.
type Schema interface {
	parse(value any, c *context) any
}

type undefinedValue struct{}

// Undefined is JavaScript's undefined.
var Undefined = undefinedValue{}

type context struct {
	path   []any
	issues []Issue
}

func (c *context) fail(format string, args ...any) {
	c.issues = append(c.issues, Issue{slices.Clone(c.path), fmt.Sprintf(format, args...), false})
}

func (c *context) abort(format string, args ...any) {
	c.issues = append(c.issues, Issue{slices.Clone(c.path), fmt.Sprintf(format, args...), true})
}

func (c *context) at(key any, read func()) {
	c.path = append(c.path, key)
	read()
	c.path = c.path[:len(c.path)-1]
}

// Parse returns the normalized value, or the issues that refused it.
func Parse(s Schema, value any) (any, []Issue) {
	c := &context{}
	out := s.parse(value, c)
	return out, c.issues
}

func received(value any) string {
	switch value.(type) {
	case undefinedValue:
		return "undefined"
	case nil:
		return "null"
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	}
	return "object"
}

func (c *context) wrongType(want string, value any) {
	c.abort("Invalid input: expected %s, received %s", want, received(value))
}

type stringCheck struct {
	onText func(string, *context)
	// Zod's length checks read .length of whatever came in, so an array sent for a string fails them too.
	onList func([]any, *context)
}

// StringSchema is z.string() with its checks, which all run and report in the order they were declared.
type StringSchema struct {
	checks []stringCheck
	trim   bool
}

// String is z.string().
func String() *StringSchema { return &StringSchema{} }

func (s *StringSchema) parse(value any, c *context) any {
	text, ok := value.(string)
	if !ok {
		c.wrongType("string", value)
		if list, isList := value.([]any); isList {
			for _, check := range s.checks {
				if check.onList != nil {
					check.onList(list, c)
				}
			}
		}
		return nil
	}
	if s.trim {
		text = strings.TrimFunc(text, isJSSpace)
	}
	for _, check := range s.checks {
		check.onText(text, c)
	}
	return text
}

func (s *StringSchema) with(check stringCheck) *StringSchema {
	return &StringSchema{append(slices.Clone(s.checks), check), s.trim}
}

func isJSSpace(r rune) bool {
	switch r {
	case 9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// TrimJS is JavaScript's String.prototype.trim.
func TrimJS(text string) string { return strings.TrimFunc(text, isJSSpace) }

// Trim is .trim(), which runs before the checks, as every schema here writes it.
func (s *StringSchema) Trim() *StringSchema { return &StringSchema{s.checks, true} }

// UUID is z.uuid().
func UUID() *StringSchema {
	return String().Regex(
		`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`,
		"Invalid UUID",
	)
}

func tooShort(what string, size, n int, c *context) {
	if size < n {
		c.fail("Too small: expected %s to have >=%d %s", what, n, unitOf(what))
	}
}

func tooLong(what string, size, n int, c *context) {
	if size > n {
		c.fail("Too big: expected %s to have <=%d %s", what, n, unitOf(what))
	}
}

func unitOf(what string) string {
	if what == "array" {
		return "items"
	}
	return "characters"
}

// Zod counts UTF-16 units, as JavaScript's length does.
func length(text string) int { return len(utf16.Encode([]rune(text))) }

// Min is .min(n).
func (s *StringSchema) Min(n int) *StringSchema {
	return s.with(stringCheck{
		func(text string, c *context) { tooShort("string", length(text), n, c) },
		func(list []any, c *context) { tooShort("array", len(list), n, c) },
	})
}

// Max is .max(n).
func (s *StringSchema) Max(n int) *StringSchema {
	return s.with(stringCheck{
		func(text string, c *context) { tooLong("string", length(text), n, c) },
		func(list []any, c *context) { tooLong("array", len(list), n, c) },
	})
}

// Regex is .regex(pattern, message).
func (s *StringSchema) Regex(pattern, message string) *StringSchema {
	re := regexp.MustCompile(pattern)
	return s.with(stringCheck{onText: func(text string, c *context) {
		if !re.MatchString(text) {
			c.fail("%s", message)
		}
	}})
}

// Refine is .superRefine: check returns a message when the text is refused.
func (s *StringSchema) Refine(check func(string) (message string, ok bool)) *StringSchema {
	return s.with(stringCheck{onText: func(text string, c *context) {
		if message, ok := check(text); !ok {
			c.fail("%s", message)
		}
	}})
}

// IntSchema is z.int() with its bounds.
type IntSchema struct{ min, max *float64 }

// Int is z.int().
func Int() *IntSchema { return &IntSchema{} }

// Min is .min(n).
func (s *IntSchema) Min(n float64) *IntSchema { return &IntSchema{&n, s.max} }

// Max is .max(n).
func (s *IntSchema) Max(n float64) *IntSchema { return &IntSchema{s.min, &n} }

func (s *IntSchema) parse(value any, c *context) any {
	n, ok := value.(float64)
	if !ok {
		c.wrongType("number", value)
		return nil
	}
	if n != math.Trunc(n) {
		c.abort("Invalid input: expected int, received number")
		return nil
	}
	// Unlike a fraction, an unsafe integer does not stop the bounds from being checked too.
	if n > maxSafeInteger {
		c.fail("Too big: expected int to be <=%d", int64(maxSafeInteger))
	}
	if n < -maxSafeInteger {
		c.fail("Too small: expected int to be >=%d", int64(-maxSafeInteger))
	}
	if s.min != nil && n < *s.min {
		c.fail("Too small: expected number to be >=%d", int64(*s.min))
	}
	if s.max != nil && n > *s.max {
		c.fail("Too big: expected number to be <=%d", int64(*s.max))
	}
	return n
}

type numberSchema struct{ min, max float64 }

// Number is z.number().min(min).max(max), for whole-number bounds.
func Number(min, max float64) Schema { return numberSchema{min, max} }

func (s numberSchema) parse(value any, c *context) any {
	n, ok := value.(float64)
	if !ok {
		c.wrongType("number", value)
		return nil
	}
	if n < s.min {
		c.fail("Too small: expected number to be >=%d", int64(s.min))
	}
	if n > s.max {
		c.fail("Too big: expected number to be <=%d", int64(s.max))
	}
	return n
}

type anyOfSchema struct{ options []Schema }

// AnyOf is z.union(options): the first option that accepts the value wins. When only one option took the value for its
// kind and then failed a check, the refusal is that check; otherwise it says nothing more than Invalid input.
func AnyOf(options ...Schema) Schema { return anyOfSchema{options} }

func (s anyOfSchema) parse(value any, c *context) any {
	var soft [][]Issue
	for _, option := range s.options {
		out, issues := Parse(option, value)
		if len(issues) == 0 {
			return out
		}
		if !slices.ContainsFunc(issues, func(i Issue) bool { return i.hard }) {
			soft = append(soft, issues)
		}
	}
	if len(soft) != 1 {
		c.abort("Invalid input")
		return nil
	}
	for _, issue := range soft[0] {
		c.issues = append(c.issues, Issue{append(slices.Clone(c.path), issue.Path...), issue.Message, false})
	}
	return nil
}

type boolSchema struct{}

// Bool is z.boolean().
func Bool() Schema { return boolSchema{} }

func (boolSchema) parse(value any, c *context) any {
	if _, ok := value.(bool); !ok {
		c.wrongType("boolean", value)
	}
	return value
}

type enumSchema struct{ options []string }

// Enum is z.enum(options).
func Enum(options ...string) Schema { return enumSchema{options} }

func quoted(options []string, quote, separator string) string {
	parts := make([]string, len(options))
	for i, o := range options {
		parts[i] = quote + o + quote
	}
	return strings.Join(parts, separator)
}

func (s enumSchema) parse(value any, c *context) any {
	if text, ok := value.(string); !ok || !slices.Contains(s.options, text) {
		c.abort("Invalid option: expected one of %s", quoted(s.options, `"`, "|"))
	}
	return value
}

type literalSchema struct{ want any }

// Literal is z.literal(want), for a string or a boolean.
func Literal(want any) Schema { return literalSchema{want} }

func (s literalSchema) parse(value any, c *context) any {
	if value != s.want {
		if text, ok := s.want.(string); ok {
			c.abort(`Invalid input: expected "%s"`, text)
		} else {
			c.abort("Invalid input: expected %v", s.want)
		}
	}
	return value
}

// ArraySchema is z.array(item) with its bounds.
type ArraySchema struct {
	item     Schema
	min, max *int
}

// Array is z.array(item).
func Array(item Schema) *ArraySchema { return &ArraySchema{item: item} }

// Min is .min(n).
func (s *ArraySchema) Min(n int) *ArraySchema { return &ArraySchema{s.item, &n, s.max} }

// Max is .max(n).
func (s *ArraySchema) Max(n int) *ArraySchema { return &ArraySchema{s.item, s.min, &n} }

func (s *ArraySchema) parse(value any, c *context) any {
	items, ok := value.([]any)
	if !ok {
		c.wrongType("array", value)
		// The same length checks, reading a string sent for an array.
		if text, isText := value.(string); isText {
			if s.min != nil {
				tooShort("string", length(text), *s.min, c)
			}
			if s.max != nil {
				tooLong("string", length(text), *s.max, c)
			}
		}
		return nil
	}
	if s.min != nil {
		tooShort("array", len(items), *s.min, c)
	}
	if s.max != nil {
		tooLong("array", len(items), *s.max, c)
	}
	out := make([]any, len(items))
	for i, item := range items {
		c.at(i, func() { out[i] = s.item.parse(item, c) })
	}
	return out
}

type presence int

const (
	required presence = iota
	optional
	defaulted
	prefaulted
)

// Field is one key of an object.
type Field struct {
	key      string
	schema   Schema
	presence presence
	fallback any
}

// Req is a required key.
func Req(key string, s Schema) Field { return Field{key: key, schema: s} }

// Opt is .optional(): an absent key stays absent, and null is still refused.
func Opt(key string, s Schema) Field { return Field{key: key, schema: s, presence: optional} }

// Def is .default(fallback): an absent key takes the fallback unparsed, and null is still refused.
func Def(key string, s Schema, fallback any) Field {
	return Field{key, s, defaulted, fallback}
}

// Pre is .prefault(fallback): an absent key reads the fallback through the schema, so its own defaults fill in. Give an
// Obj, not a Go map, where the parse is ordered.
func Pre(key string, s Schema, fallback any) Field {
	return Field{key, s, prefaulted, fallback}
}

// ObjectSchema is z.object(fields). Unknown keys drop, or are refused when it is strict.
type ObjectSchema struct {
	fields  []Field
	check   func(map[string]any) bool
	message string
	strict  bool
}

// Object is z.object(fields).
func Object(fields ...Field) *ObjectSchema { return &ObjectSchema{fields: fields} }

// Refine is .refine(check, message) on the whole object: the check runs only when every field was accepted.
func (s *ObjectSchema) Refine(check func(map[string]any) bool, message string) *ObjectSchema {
	return &ObjectSchema{s.fields, check, message, s.strict}
}

// Strict is z.strictObject(fields): a key the shape does not name is refused, not dropped.
func (s *ObjectSchema) Strict() *ObjectSchema {
	return &ObjectSchema{s.fields, s.check, s.message, true}
}

// Extend is .extend(fields): a key already there takes the new schema in its place, a new key goes last, as an object
// spread places them.
func (s *ObjectSchema) Extend(fields ...Field) *ObjectSchema {
	out := slices.Clone(s.fields)
	for _, f := range fields {
		if i := slices.IndexFunc(out, func(g Field) bool { return g.key == f.key }); i >= 0 {
			out[i] = f
		} else {
			out = append(out, f)
		}
	}
	return &ObjectSchema{fields: out}
}

// Omit is .omit({ keys }).
func (s *ObjectSchema) Omit(keys ...string) *ObjectSchema {
	return &ObjectSchema{fields: slices.DeleteFunc(slices.Clone(s.fields), func(f Field) bool {
		return slices.Contains(keys, f.key)
	})}
}

// mapOf reads an object as a map, and whether it came as an Obj, whose order the answer keeps.
func mapOf(value any) (input map[string]any, ordered *Obj, ok bool) {
	if o, isObj := value.(*Obj); isObj && o != nil {
		return o.vals, o, true
	}
	input, ok = value.(map[string]any)
	return input, nil, ok
}

func (s *ObjectSchema) parse(value any, c *context) any {
	input, ordered, ok := mapOf(value)
	if !ok {
		c.wrongType("object", value)
		return nil
	}
	before := len(c.issues)
	if s.strict {
		for _, k := range keysOf(input, ordered) {
			if !slices.ContainsFunc(s.fields, func(f Field) bool { return f.key == k }) {
				c.fail("Unrecognized key: %q", k)
			}
		}
	}
	out := make(map[string]any, len(s.fields))
	for _, f := range s.fields {
		v, present := input[f.key]
		switch {
		case present:
			c.at(f.key, func() { out[f.key] = f.schema.parse(v, c) })
		case f.presence == defaulted:
			out[f.key] = f.fallback
		case f.presence == prefaulted:
			c.at(f.key, func() { out[f.key] = f.schema.parse(f.fallback, c) })
		case f.presence == required:
			c.at(f.key, func() { f.schema.parse(Undefined, c) })
		}
	}
	if s.check != nil && len(c.issues) == before && !s.check(out) {
		c.fail("%s", s.message)
	}
	if ordered == nil {
		return out
	}
	// zod writes the fields in the shape's order.
	o := NewObj()
	for _, f := range s.fields {
		if v, set := out[f.key]; set {
			o.Set(f.key, v)
		}
	}
	return o
}

// keysOf are the keys to walk: an Obj's in order, a map's as they come.
func keysOf(input map[string]any, ordered *Obj) []string {
	if ordered != nil {
		return ordered.keys
	}
	keys := make([]string, 0, len(input))
	for k := range input {
		keys = append(keys, k)
	}
	return keys
}

// answer is a record's result: an Obj in the input's order when the input was one.
func answer(out map[string]any, ordered *Obj) any {
	if ordered == nil {
		return out
	}
	o := NewObj()
	for _, k := range ordered.keys {
		if v, set := out[k]; set {
			o.Set(k, v)
		}
	}
	return o
}

type recordSchema struct{ key, value Schema }

// Record is z.record(key, value). A key the key schema refuses reports only that, under the key's own path.
func Record(key, value Schema) Schema { return recordSchema{key, value} }

func (s recordSchema) parse(value any, c *context) any {
	input, ordered, ok := mapOf(value)
	if !ok {
		c.wrongType("record", value)
		return nil
	}
	out := make(map[string]any, len(input))
	for _, key := range keysOf(input, ordered) {
		v := input[key]
		if key == "__proto__" {
			continue
		}
		_, keyIssues := Parse(s.key, key)
		c.at(key, func() {
			if len(keyIssues) > 0 {
				c.abort("Invalid key in record")
				return
			}
			out[key] = s.value.parse(v, c)
		})
	}
	return answer(out, ordered)
}

type partialRecordSchema struct {
	keys  []string
	value Schema
}

// PartialRecord is z.partialRecord(z.enum(keys), value).
func PartialRecord(value Schema, keys ...string) Schema { return partialRecordSchema{keys, value} }

func (s partialRecordSchema) parse(value any, c *context) any {
	input, ordered, ok := mapOf(value)
	if !ok {
		c.wrongType("record", value)
		return nil
	}
	out := make(map[string]any, len(input))
	for _, key := range s.keys {
		if v, present := input[key]; present {
			c.at(key, func() { out[key] = s.value.parse(v, c) })
		}
	}
	var unknown []string
	for _, key := range keysOf(input, ordered) {
		if !slices.Contains(s.keys, key) {
			unknown = append(unknown, key)
		}
	}
	slices.Sort(unknown)
	switch len(unknown) {
	case 0:
	case 1:
		c.fail(`Unrecognized key: "%s"`, unknown[0])
	default:
		c.fail("Unrecognized keys: %s", quoted(unknown, `"`, ", "))
	}
	return answer(out, ordered)
}

// Variant is one member of a discriminated union.
type Variant struct {
	Tag    string
	Schema *ObjectSchema
}

type unionSchema struct {
	key      string
	variants []Variant
}

// Union is z.discriminatedUnion(key, variants).
func Union(key string, variants ...Variant) Schema { return unionSchema{key, variants} }

func (s unionSchema) parse(value any, c *context) any {
	input, _, ok := mapOf(value)
	if !ok {
		c.wrongType("object", value)
		return nil
	}
	for _, v := range s.variants {
		if input[s.key] == v.Tag {
			return v.Schema.parse(value, c)
		}
	}
	tags := make([]string, len(s.variants))
	for i, v := range s.variants {
		tags[i] = v.Tag
	}
	c.at(s.key, func() { c.abort("Invalid discriminator value. Expected %s", quoted(tags, "'", " | ")) })
	return nil
}

var plainKey = regexp.MustCompile(`^[\w$]+$`)

// Prettify is z.prettifyError: shortest paths first, each message with where it is.
func Prettify(issues []Issue) string {
	sorted := slices.Clone(issues)
	slices.SortStableFunc(sorted, func(a, b Issue) int { return len(a.Path) - len(b.Path) })
	var lines []string
	for _, issue := range sorted {
		lines = append(lines, "✖ "+issue.Message)
		if len(issue.Path) == 0 {
			continue
		}
		var at strings.Builder
		for i, part := range issue.Path {
			switch x := part.(type) {
			case int:
				fmt.Fprintf(&at, "[%d]", x)
			case string:
				if !plainKey.MatchString(x) {
					fmt.Fprintf(&at, "[%q]", x)
				} else {
					if i > 0 {
						at.WriteByte('.')
					}
					at.WriteString(x)
				}
			}
		}
		lines = append(lines, "  → at "+at.String())
	}
	return strings.Join(lines, "\n")
}
