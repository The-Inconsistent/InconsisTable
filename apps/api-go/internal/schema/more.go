package schema

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

func (s refinedSchema) parse(value any, c *context) any {
	before := len(c.issues)
	out := s.inner.parse(value, c)
	if len(c.issues) == before && !s.check(out) {
		c.fail("%s", s.message)
	}
	return out
}
