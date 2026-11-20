package engine

import (
	"fmt"
	"maps"
	"math"
	"strconv"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// A World: the look of one setting, imported beside the ruleset and the pack (docs/adr/0010-game-modules.md, decision 2;
// house decision #65). The twin of packages/rules-engine/src/world.ts: the same lists, the same base colours, the same
// contrast arithmetic, so a World refused on one side is refused on the other with the same text. The vectors hold
// every list and number here equal to the TypeScript.

// MaxWorldBytes is the largest World document the importer reads.
const MaxWorldBytes = 64 * 1024

var (
	worldColourTokens = []string{
		"wood-0", "wood", "wood-2", "wood-3", "brass", "brass-hi", "brass-lo", "brass-ink", "candle", "wax", "cream", "leaf",
		"moss", "parchment", "parchment-hi", "parchment-2", "parchment-ink", "parchment-ink-2", "parchment-line", "ink-blue",
		"halo-light", "halo-dark",
		"paper", "paper-2", "ink", "ink-2", "line", "band", "band-ink", "accent", "accent-ink", "ok", "link", "focus", "focus-halo",
	}
	worldSchemes   = []string{"light", "dark"}
	worldTypefaces = []string{"be-vietnam-pro", "fraunces", "literata", "cinzel", "crimson-pro", "ibm-plex-mono"}
	worldTextures  = []string{"wood", "baize", "paper"}
	// worldShapes keeps WORLD_SHAPES' key order, which is the order zod reports them in.
	worldShapes = []struct {
		key     string
		options []string
	}{
		{"corners", []string{"soft", "square", "pill"}},
		{"cardEdge", []string{"torn", "rounded", "square"}},
		{"cardCrest", []string{"none", "spiked"}},
		{"bandEdge", []string{"straight", "torn"}},
		{"headingRule", []string{"none", "line", "quill"}},
		{"headingCase", []string{"normal", "caps"}},
		{"buttonFrame", []string{"plate", "flat", "double"}},
	}
	worldContrastPairs = []contrastPair{
		{"ink", "paper", 4.5}, {"ink", "paper-2", 4.5}, {"ink-2", "paper", 4.5}, {"ink-2", "paper-2", 4.5},
		{"band-ink", "band", 4.5}, {"accent-ink", "accent", 4.5}, {"accent", "paper", 4.5}, {"link", "paper", 4.5},
		{"ok", "paper", 4.5}, {"brass-ink", "brass", 4.5}, {"brass-ink", "brass-hi", 4.5},
		{"parchment-ink", "parchment", 4.5}, {"parchment-ink", "parchment-2", 4.5}, {"parchment-ink-2", "parchment", 4.5},
		{"focus", "paper", 3}, {"focus", "focus-halo", 3},
	}
)

// contrastPair is one of WORLD_CONTRAST_PAIRS: a foreground on a background, and the least ratio it may have.
type contrastPair struct {
	FG  string  `json:"fg"`
	BG  string  `json:"bg"`
	Min float64 `json:"min"`
}

var worldBasePalette = map[string]string{
	"wood-0": "#170d07", "wood": "#2a1a10", "wood-2": "#3b2517", "wood-3": "#52341f", "brass": "#c99a3e",
	"brass-hi": "#f0c870", "brass-lo": "#8a6322", "brass-ink": "#251509", "candle": "#ffb64f", "wax": "#9c2f23",
	"cream": "#fff6e2", "leaf": "#3e6a2a", "moss": "#a6d68e", "parchment": "#f2e5c6", "parchment-hi": "#f9f0da",
	"parchment-2": "#e7d5ad", "parchment-ink": "#2a1b10", "parchment-ink-2": "#5a4430", "parchment-line": "#b59a68",
	"ink-blue": "#123a8f", "halo-light": "#fff3cf", "halo-dark": "#120a05",
}

func withPalette(semantic map[string]string) map[string]string {
	out := maps.Clone(worldBasePalette)
	maps.Copy(out, semantic)
	return out
}

// worldBaseColours is WORLD_BASE_COLOURS: the base Theme's value of every colour token, per set (lantern.css).
var worldBaseColours = map[string]map[string]string{
	"light": withPalette(map[string]string{
		"paper": "#f2e5c6", "paper-2": "#e7d5ad", "ink": "#2a1b10", "ink-2": "#5a4430", "line": "#b59a68", "band": "#170d07",
		"band-ink": "#f4e8cd", "accent": "#9c2f23", "accent-ink": "#fff6e2", "ok": "#3e6a2a", "link": "#9c2f23",
		"focus": "#123a8f", "focus-halo": "#fff3cf",
	}),
	"dark": withPalette(map[string]string{
		"paper": "#2a1a10", "paper-2": "#3b2517", "ink": "#f4e8cd", "ink-2": "#d2bf99", "line": "#7d5d34", "band": "#170d07",
		"band-ink": "#f4e8cd", "accent": "#c99a3e", "accent-ink": "#251509", "ok": "#a6d68e", "link": "#f0c870",
		"focus": "#f0c870", "focus-halo": "#120a05",
	}),
}

// worldColourSources is WORLD_COLOUR_SOURCES: the palette name each semantic name reads, per set.
var worldColourSources = map[string]map[string]string{
	"light": {
		"paper": "parchment", "paper-2": "parchment-2", "ink": "parchment-ink", "ink-2": "parchment-ink-2",
		"line": "parchment-line", "band": "wood-0", "accent": "wax", "accent-ink": "cream", "ok": "leaf", "link": "wax",
		"focus": "ink-blue", "focus-halo": "halo-light",
	},
	"dark": {
		"paper": "wood", "paper-2": "wood-2", "band": "wood-0", "accent": "brass", "accent-ink": "brass-ink", "ok": "moss",
		"link": "brass-hi", "focus": "brass-hi", "focus-halo": "halo-dark",
	},
}

var worldColour = schema.String().Regex(`^#[0-9a-fA-F]{6}$`, "expected a colour like #1c1b1a")

func worldThemeSchema() *schema.ObjectSchema {
	shapes := make([]schema.Field, len(worldShapes))
	for i, s := range worldShapes {
		shapes[i] = schema.Opt(s.key, schema.Enum(s.options...))
	}
	typeface := schema.Enum(worldTypefaces...)
	return schema.Object(
		schema.Req("schemes", schema.Object(
			schema.Opt("light", schema.PartialRecord(worldColour, worldColourTokens...)),
			schema.Opt("dark", schema.PartialRecord(worldColour, worldColourTokens...)),
		).Refine(func(s map[string]any) bool {
			_, light := s["light"]
			_, dark := s["dark"]
			return light || dark
		}, "a World brings at least one colour set")),
		schema.Def("typefaces", schema.Object(
			schema.Opt("display", typeface), schema.Opt("body", typeface), schema.Opt("mono", typeface),
		), map[string]any{}),
		schema.Opt("texture", schema.Enum(worldTextures...)),
		schema.Def("shapes", schema.Object(shapes...), map[string]any{}),
	)
}

var worldSchema = schema.Object(
	schema.Req("id", rulesetID),
	schema.Req("version", semVer),
	schema.Req("core", semVerRange),
	schema.Req("name", schema.String().Min(1).Max(80)),
	schema.Req("theme", worldThemeSchema()),
)

// worldColours lays a World's values for one set over the base, and resolves the semantic names as the base does: a
// semantic name set directly wins, else it reads its palette name, the World's value or the base's.
func worldColours(scheme string, colours map[string]any) map[string]string {
	base, sources := worldBaseColours[scheme], worldColourSources[scheme]
	value := func(token string) string {
		if v, ok := colours[token].(string); ok {
			return v
		}
		return base[token]
	}
	out := make(map[string]string, len(worldColourTokens))
	for _, token := range worldColourTokens {
		out[token] = value(token)
		if _, set := colours[token]; !set {
			if source, ok := sources[token]; ok {
				out[token] = value(source)
			}
		}
	}
	return out
}

// worldLinear is WORLD_LINEAR: each sRGB channel's linear value in millionths. Rounding once here and doing integer
// arithmetic after is what makes the ratio the same digits on both sides; the vectors compare all 256 entries.
var worldLinear = func() (t [256]int64) {
	for i := range t {
		c := float64(i) / 255
		v := c / 12.92
		if c > 0.03928 {
			v = math.Pow((c+0.055)/1.055, 2.4)
		}
		t[i] = int64(math.Round(1e6 * v))
	}
	return t
}()

// worldFlare is 0.05 in the luminance scale (ten-billionths).
const worldFlare = 500_000_000

func worldLuminance(hex string) int64 {
	channel := func(at int) int64 {
		n, _ := strconv.ParseUint(hex[at:at+2], 16, 8)
		return worldLinear[n]
	}
	return 2126*channel(1) + 7152*channel(3) + 722*channel(5)
}

// contrastHundredths is the WCAG contrast ratio of two six-digit hex colours in hundredths, rounded down.
func contrastHundredths(a, b string) int64 {
	hi, lo := worldLuminance(a), worldLuminance(b)
	if lo > hi {
		hi, lo = lo, hi
	}
	return (hi + worldFlare) * 100 / (lo + worldFlare)
}

func worldContrastProblems(theme map[string]any) []Problem {
	schemes, _ := theme["schemes"].(map[string]any)
	var out []Problem
	for _, scheme := range worldSchemes {
		set, brought := schemes[scheme].(map[string]any)
		if !brought {
			continue
		}
		colour := worldColours(scheme, set)
		for _, p := range worldContrastPairs {
			h := contrastHundredths(colour[p.FG], colour[p.BG])
			if float64(h) >= p.Min*100 {
				continue
			}
			out = append(out, Problem{"theme.schemes." + scheme, fmt.Sprintf(`"%s" on "%s" is %d.%02d:1, under %s:1`,
				p.FG, p.BG, h/100, h%100, strconv.FormatFloat(p.Min, 'f', -1, 64))})
		}
	}
	return out
}

// ValidateWorld is validateWorld: the size cap (as serialised), the schema, then the contrast of every set the World
// brings. It answers the parsed document (defaults applied, plain maps), which is what is stored and hashed.
func ValidateWorld(input any) (map[string]any, []Problem) {
	if size := len(CanonicalJSON(input)); size > MaxWorldBytes {
		return nil, []Problem{{"(root)", fmt.Sprintf("%d bytes, over the cap of %d", size, MaxWorldBytes)}}
	}
	parsed, issues := schema.Parse(worldSchema, input)
	if len(issues) > 0 {
		found := make([]Problem, len(issues))
		for i, issue := range issues {
			found[i] = Problem{formatPath(issue.Path), issue.Message}
		}
		return nil, found
	}
	world := schema.Plain(parsed).(map[string]any)
	theme, _ := world["theme"].(map[string]any)
	if found := worldContrastProblems(theme); len(found) > 0 {
		return nil, found
	}
	return world, nil
}

// WorldHash is worldHash: the hash a World version is stored under, of the canonical parsed document.
func WorldHash(world map[string]any) string {
	return Sha256Hex(CanonicalJSON(world))
}
