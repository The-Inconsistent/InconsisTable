package view

import (
	"maps"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// SeatManifest is the manifest as a seat may read it, from the normalized manifest (decoded JSON, defaults applied). A
// seat that sees `gm` values reads all of it; any other seat gets the definitions of fields, derived values, resources
// and conditions whose visibility is not `gm` (fail-closed: a definition that declares none is `gm`). The values
// themselves are filtered per actor in Of. The input is never written to.
//
// ponytail: a visible condition's effect formulas are shown as written, even where they name a `gm` field; strip or
// redact them if a ruleset needs that secret kept.
// ponytail: the manifest is not split per entity kind; a co-GM with `party` or `combat` reads every definition.
func SeatManifest(manifest map[string]any, c cs.Ctx) map[string]any {
	sight := SightOf(c)
	out := seatCodexDefs(seatDefinitions(manifest, sight, c), sight.Secrets)
	// The setup checklist (house decision #90) and the generators (house decision #98) are the GM's: only the side that
	// reads GM notes is sent them.
	for _, key := range []string{"checklist", "generators"} {
		if _, has := out[key]; has && !sight.Secrets {
			out = maps.Clone(out)
			delete(out, key)
		}
	}
	if tables, has := manifest["tables"].(map[string]any); has && !sight.Tables {
		out = maps.Clone(out)
		out["tables"] = seatTableDefs(tables)
	}
	return out
}

func seatDefinitions(manifest map[string]any, sight Sight, c cs.Ctx) map[string]any {
	if sight.All || (c.HasGM() && (sight.Combat || sight.Party)) {
		return manifest
	}
	out := maps.Clone(manifest)
	var entities []any
	for _, item := range list(manifest["entities"]) {
		entity, _ := item.(map[string]any)
		shown := maps.Clone(entity)
		fields := map[string]any{}
		if all, ok := entity["fields"].(map[string]any); ok {
			for id, def := range all {
				if shows(def) {
					fields[id] = def
				}
			}
		}
		shown["fields"] = fields
		shown["derived"] = shownOf(entity["derived"])
		entities = append(entities, shown)
	}
	out["entities"] = orEmpty(entities)
	out["resources"] = shownOf(manifest["resources"])
	out["conditions"] = shownOf(manifest["conditions"])
	return out
}

// The table definitions a seat reads (house decision #49): the side that runs the table with a GM reads every entry, anyone else
// only those of a `party` table. The entries of a `gm` or `owner` table are what a roll or a deal keeps secret, so a seat
// that runs a deal without a GM still sees the table's title and no entry.
func seatTableDefs(tables map[string]any) map[string]any {
	out := make(map[string]any, len(tables))
	for id, v := range tables {
		t, _ := v.(map[string]any)
		if visibility, _ := t["visibility"].(string); visibility != "party" {
			t = maps.Clone(t)
			t["entries"] = []any{}
		}
		out[id] = t
	}
	return out
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

func orEmpty(l []any) []any {
	if l == nil {
		return []any{}
	}
	return l
}

func shows(def any) bool {
	d, _ := def.(map[string]any)
	visibility, _ := d["visibility"].(string)
	return visibility != "" && visibility != "gm"
}

func shownOf(v any) []any {
	var out []any
	for _, def := range list(v) {
		if shows(def) {
			out = append(out, def)
		}
	}
	return orEmpty(out)
}
