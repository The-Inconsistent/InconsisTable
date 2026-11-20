package ledger

import (
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// What the TypeScript gets from JavaScript itself, done the same way: numbers are float64 throughout (so an undefined
// price row is NaN and a sum rounds as it does there), strings are cut and measured in UTF-16 units, and the parsed
// records are read as the trees schema.Parse answers with.

// num is String(n) for a number: ECMAScript's Number::toString.
func num(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n == 0:
		return "0"
	}
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	// The shortest digits that read back as n, and where the decimal point sits after the first of them.
	mant, exp, _ := strings.Cut(strconv.FormatFloat(n, 'e', -1, 64), "e")
	digits := strings.Replace(mant, ".", "", 1)
	e, _ := strconv.Atoi(exp)
	k, p := len(digits), e+1
	switch {
	case k <= p && p <= 21:
		return sign + digits + strings.Repeat("0", p-k)
	case 0 < p && p <= 21:
		return sign + digits[:p] + "." + digits[p:]
	case -6 < p && p <= 0:
		return sign + "0." + strings.Repeat("0", -p) + digits
	}
	expSign := "+"
	if p-1 < 0 {
		expSign = "-"
	}
	if k == 1 {
		return sign + digits + "e" + expSign + strconv.Itoa(abs(p-1))
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + expSign + strconv.Itoa(abs(p-1))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// text is String(x) for what a template literal holds here: a string or a number.
func text(x any) string {
	switch v := x.(type) {
	case string:
		return v
	case float64:
		return num(v)
	case bool:
		return strconv.FormatBool(v)
	case nil:
		return "null"
	}
	return "?"
}

// cut is .slice(0, n) on a string, in UTF-16 units. A pair cut in half leaves U+FFFD, which is how the decoder reads a
// lone surrogate too, so lengths stay as JavaScript counts them.
func cut(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// end is where .slice(0, n) on a list of length size stops: a negative n counts from the end.
func end(size int, n float64) int {
	switch {
	case math.IsNaN(n):
		return 0
	case n < 0:
		return max(size+int(math.Max(n, -float64(size))), 0)
	case n > float64(size):
		return size
	}
	return int(n)
}

var lowerJS, upperJS = cases.Lower(language.Und), cases.Upper(language.Und)

// norm is labels.ts norm: lower case, then only a-z and 0-9.
func norm(s string) string {
	var b strings.Builder
	for _, r := range s {
		r = unicode.ToLower(r) // a character that lowers to ASCII does so alone (İ, K): the rest is dropped anyway
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// capital is labels.ts capital: the first UTF-16 unit upper-cased, as JavaScript does it (ß is SS).
// Every caller passes a non-empty string (a schema's min(1)), where s[0] exists.
func capital(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)[0]
	if r > 0xffff {
		return s // the first unit is a high surrogate, which upper-cases to itself
	}
	return upperJS.String(string(r)) + s[len(string(r)):]
}

var (
	decimalLiteral = regexp.MustCompile(`^[+-]?(Infinity|([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?)$`)
	radixLiteral   = regexp.MustCompile(`^0([xXoObB])(.+)$`)
	radixDigits    = map[byte]*regexp.Regexp{
		'x': regexp.MustCompile(`^[0-9a-fA-F]+$`), 'o': regexp.MustCompile(`^[0-7]+$`), 'b': regexp.MustCompile(`^[01]+$`),
	}
	radixBase = map[byte]int{'x': 16, 'o': 8, 'b': 2}
)

// toNumber is Number(text) on a string.
func toNumber(s string) float64 {
	s = schema.TrimJS(s)
	if s == "" {
		return 0
	}
	if m := radixLiteral.FindStringSubmatch(s); m != nil {
		letter := m[1][0] | 0x20 // lower case
		if !radixDigits[letter].MatchString(m[2]) {
			return math.NaN()
		}
		n, _ := new(big.Int).SetString(m[2], radixBase[letter])
		f, _ := new(big.Float).SetInt(n).Float64()
		return f
	}
	if !decimalLiteral.MatchString(s) {
		return math.NaN()
	}
	if strings.HasSuffix(s, "Infinity") {
		if s[0] == '-' {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	n, _ := strconv.ParseFloat(s, 64)
	return n
}

// stringify is JSON.stringify on a parsed tree; dropLabel is the replacer that leaves every `label` key out.
func stringify(v any, dropLabel bool) string {
	var b strings.Builder
	writeJSON(&b, v, dropLabel)
	return b.String()
}

func writeJSON(b *strings.Builder, v any, dropLabel bool) {
	switch x := v.(type) {
	case *schema.Obj:
		b.WriteByte('{')
		first := true
		for _, k := range x.Keys() {
			if dropLabel && k == "label" {
				continue
			}
			if !first {
				b.WriteByte(',')
			}
			first = false
			quote(b, k)
			b.WriteByte(':')
			item, _ := x.Get(k)
			writeJSON(b, item, dropLabel)
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i, item := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSON(b, item, dropLabel)
		}
		b.WriteByte(']')
	case []string:
		list := make([]any, len(x))
		for i, s := range x {
			list[i] = s
		}
		writeJSON(b, list, dropLabel)
	case string:
		quote(b, x)
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			b.WriteString("null")
		} else {
			b.WriteString(num(x))
		}
	case bool:
		b.WriteString(strconv.FormatBool(x))
	default:
		b.WriteString("null")
	}
}

// quote is JSON.stringify's string: only the quote, the backslash and the control characters are escaped.
func quote(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteString(strconv.FormatInt(int64(r)>>4, 16))
				b.WriteString(strconv.FormatInt(int64(r)&15, 16))
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// ── reading the parsed trees ──

func get(o *schema.Obj, k string) any {
	v, _ := o.Get(k)
	return v
}

func str(o *schema.Obj, k string) string {
	s, _ := get(o, k).(string)
	return s
}

func number(o *schema.Obj, k string) float64 {
	n, _ := get(o, k).(float64)
	return n
}

func boolean(o *schema.Obj, k string) bool {
	b, _ := get(o, k).(bool)
	return b
}

func sub(o *schema.Obj, k string) *schema.Obj {
	x, _ := get(o, k).(*schema.Obj)
	return x
}

func list(o *schema.Obj, k string) []any {
	x, _ := get(o, k).([]any)
	return x
}

func objs(o *schema.Obj, k string) []*schema.Obj { return asObjs(list(o, k)) }

func asObjs(items []any) []*schema.Obj {
	out := make([]*schema.Obj, 0, len(items))
	for _, item := range items {
		if x, ok := item.(*schema.Obj); ok {
			out = append(out, x)
		}
	}
	return out
}

func strs(o *schema.Obj, k string) []string { return asStrs(list(o, k)) }

func asStrs(items []any) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// optStr is an optional string field: nil when absent.
func optStr(o *schema.Obj, k string) *string {
	if s, ok := get(o, k).(string); ok {
		return &s
	}
	return nil
}

// truthy is JavaScript's truthiness, for the values a parsed tree holds.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// at is table[i] for a price table: undefined, so NaN in a sum, outside it.
func at(table []float64, i float64) float64 {
	if i < 0 || i != math.Trunc(i) || i >= float64(len(table)) {
		return math.NaN()
	}
	return table[int(i)]
}

func newObj(pairs ...any) *schema.Obj {
	o := schema.NewObj()
	for i := 0; i+1 < len(pairs); i += 2 {
		o.Set(pairs[i].(string), pairs[i+1])
	}
	return o
}

func anyList[T any](items []T) []any {
	out := make([]any, len(items))
	for i, x := range items {
		out[i] = x
	}
	return out
}
