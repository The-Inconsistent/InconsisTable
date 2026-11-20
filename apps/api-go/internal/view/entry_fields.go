package view

import (
	"maps"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// An entry's declared fields as a seat receives them (house decision #71; seatEntryFields in vectors/reference/view.seat.ts):
// only what the room's ruleset declares for the kind and what is still valid for it, `gm` ones only to the side that
// reads GM notes. Without a ruleset, none.
//
// ponytail: a value the ruleset no longer declares, or that no longer fits, stays stored and reaches nobody; the
// compatible upgrade (house decision #51) is where it would be carried or cleared.
func seatEntryFields(codex cs.Codex, compiled *engine.CompiledRuleset, secrets bool) cs.Codex {
	var kinds map[string]engine.CodexKind
	if compiled != nil && compiled.Ruleset.Codex != nil {
		kinds = compiled.Ruleset.Codex.Kinds
	}
	entries := make([]cs.CodexEntry, len(codex.Entries))
	for i, e := range codex.Entries {
		defs := kinds[e.Kind].Fields
		fields := map[string]any{}
		for id, value := range e.Fields {
			def, declared := defs[id]
			if declared && (secrets || def.Visibility == "party") && engine.CheckFieldValue(&def, value) == "" {
				fields[id] = value
			}
		}
		e.Fields = fields
		entries[i] = e
	}
	return cs.Codex{Entries: entries, Recaps: codex.Recaps}
}

// The codex block as a seat may read it (house decision #71): the side that reads GM notes every field, anyone else the
// `party` ones. Independent of the actor definitions: a co-GM with `combat` but not `codex.secrets` reads no `gm` one.
func seatCodexDefs(manifest map[string]any, secrets bool) map[string]any {
	codex, has := manifest["codex"].(map[string]any)
	if !has || secrets {
		return manifest
	}
	kinds := map[string]any{}
	all, _ := codex["kinds"].(map[string]any)
	for kind, v := range all {
		k, _ := v.(map[string]any)
		defs, _ := k["fields"].(map[string]any)
		fields := map[string]any{}
		for id, def := range defs {
			if d, _ := def.(map[string]any); d["visibility"] == "party" {
				fields[id] = def
			}
		}
		kinds[kind] = map[string]any{"fields": fields}
	}
	out := maps.Clone(manifest)
	out["codex"] = map[string]any{"kinds": kinds}
	return out
}
