package codex

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// fieldPatch is what codex.save writes of an entry's declared fields (house decision #71): the values to set, as a
// jsonb object, and the ids to clear.
type fieldPatch struct {
	set   []byte
	clear []string
}

// checkFields reads codex.save's `fields` against the room's ruleset: each key a field the ruleset declares for this kind,
// each value of its type (null clears), a `gm` field only from a seat that reads the GM notes, a ref only to an entry of
// its type that the room's packs serve and that the field's readers may read. Nil when `fields` was not sent.
func checkFields(ctx context.Context, tx core.Conn, c cs.Ctx, kind string, a cs.Action) (*fieldPatch, error) {
	given, sent := a["fields"].(map[string]any)
	if !sent {
		return nil, nil
	}
	rules, err := compiled.Load(ctx, tx, c.CampaignID)
	if err != nil {
		return nil, err
	}
	var defs map[string]engine.FieldDef
	if rules != nil && rules.Ruleset.Codex != nil {
		defs = rules.Ruleset.Codex.Kinds[kind].Fields
	}
	set := map[string]any{}
	patch := &fieldPatch{clear: []string{}}
	ids := make([]string, 0, len(given))
	for id := range given {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		def, declared := defs[id]
		if !declared {
			return nil, cs.Fail("noSuchEntryField", cs.Params{"field": id})
		}
		if def.Visibility != "party" && !cs.CanInCampaign(c, "codex:read_secret", "") {
			return nil, cs.Fail("needSecretsScope")
		}
		value := given[id]
		if value == nil {
			patch.clear = append(patch.clear, id)
			continue
		}
		if problem := engine.CheckFieldValue(&def, value); problem != "" {
			return nil, cs.Fail("badEntryField", cs.Params{"field": def.Label, "detail": problem})
		}
		if def.Type == "ref" {
			// A party field names only an entry the party may read, so its key never tells a player of a gm entry.
			lookup, err := pack.ServedLookup(ctx, tx, c.CampaignID, []string{def.Entity}, def.Visibility == "gm" && view.ReadsGM(c))
			if err != nil {
				return nil, err
			}
			if lookup(def.Entity, value.(string)) == nil {
				return nil, cs.Fail("badEntryField", cs.Params{"field": def.Label, "detail": "no such entry in this room's packs"})
			}
		}
		set[id] = value
	}
	if patch.set, err = json.Marshal(set); err != nil {
		return nil, err
	}
	return patch, nil
}
