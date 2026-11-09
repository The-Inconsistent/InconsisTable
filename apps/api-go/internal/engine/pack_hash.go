package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// Stored hashes must match TypeScript's byte for byte, so this prints exactly what JSON.stringify prints.
// esNumber is ES Number::toString.
func esNumber(f float64) string {
	if f == 0 {
		return "0"
	}
	sign := ""
	if f < 0 {
		sign = "-"
		f = -f
	}
	if f > 1.7976931348623157e308 {
		return sign + "Infinity"
	}
	mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	exp, _ := strconv.Atoi(exponent)
	digits := strings.Replace(mantissa, ".", "", 1)
	k, n := len(digits), exp+1
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	expSign := "+"
	if n-1 < 0 {
		expSign = "-"
	}
	mag := strconv.Itoa(max(n-1, 1-n))
	if k == 1 {
		return sign + digits + "e" + expSign + mag
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + expSign + mag
}

func esString(s string) string {
	var b strings.Builder
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
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// JavaScript's default sort compares UTF-16 units, which orders astral characters unlike bytes do.
func compareUnits(a, b string) int { return slices.Compare(stringToUnits(a), stringToUnits(b)) }

// CanonicalJSON is JSON with object keys sorted at every depth, so equal content is equal text. It takes decoded JSON.
//
// ponytail: a lone surrogate hashes unlike TypeScript, because encoding/json has already replaced it with U+FFFD; refuse
// such strings where the api decodes its input (ADR 0008), which does not exist yet.
func CanonicalJSON(value any) string {
	switch x := value.(type) {
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return esNumber(x)
	case string:
		return esString(x)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = CanonicalJSON(e)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		slices.SortFunc(keys, compareUnits)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = esString(k) + ":" + CanonicalJSON(x[k])
		}
		return "{" + strings.Join(parts, ",") + "}"
	}
	panic(fmt.Sprintf("engine: CanonicalJSON got %T, which is not decoded JSON", value))
}

// Sha256Hex is the SHA-256 of UTF-8 text, as lowercase hex.
func Sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// ContentHash hashes what a pack entry says: stable under key order and the order of its tags, so a re-import of the
// same content hashes the same. It takes a parsed entry (defaults applied), so an omitted default and a written one agree.
func ContentHash(entry map[string]any) string {
	sorted := make(map[string]any, len(entry))
	for k, v := range entry {
		sorted[k] = v
	}
	tags, ok := entry["tags"].([]any)
	if !ok {
		panic(fmt.Sprintf("engine: ContentHash got tags of %T, which is not a parsed entry", entry["tags"]))
	}
	strs := make([]string, len(tags))
	for i, t := range tags {
		if strs[i], ok = t.(string); !ok {
			panic(fmt.Sprintf("engine: ContentHash got a tag of %T, which is not a parsed entry", t))
		}
	}
	slices.SortStableFunc(strs, compareUnits)
	out := make([]any, len(strs))
	for i, s := range strs {
		out[i] = s
	}
	sorted["tags"] = out
	return Sha256Hex(CanonicalJSON(sorted))
}
