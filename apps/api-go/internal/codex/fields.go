package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

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
		if def.Type == "entry" {
			detail, err := linkProblem(ctx, tx, c.CampaignID, a, def.Kind, value.(string))
			if err != nil {
				return nil, err
			}
			if detail != "" {
				return nil, cs.Fail("badEntryField", cs.Params{"field": def.Label, "detail": detail})
			}
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
		if def.Type == "tags" || def.Type == "rows" {
			detail, err := listProblem(ctx, tx, c, rules, &def, value)
			if err != nil {
				return nil, err
			}
			if detail != "" {
				return nil, cs.Fail("badEntryField", cs.Params{"field": def.Label, "detail": detail})
			}
		}
		set[id] = value
	}
	if patch.set, err = json.Marshal(set); err != nil {
		return nil, err
	}
	return patch, nil
}

// listProblem says why a tags or rows value, already of the right shape, names what the room does not have (house
// decision #89), or "" when it does not: a word outside a tags field's suggestions when it takes no write-in; a row's
// `from` or a ref cell naming no entry the room's packs serve to the field's readers; a Test cell naming no Test of
// the ruleset. Each refusal names the row or the word by its place.
func listProblem(ctx context.Context, tx core.Conn, c cs.Ctx, rules *engine.CompiledRuleset, def *engine.FieldDef, value any) (string, error) {
	gm := def.Visibility == "gm" && view.ReadsGM(c)
	if def.Type == "tags" {
		if def.WriteIn {
			return "", nil
		}
		names := map[string]bool{}
		if len(def.Entities) > 0 {
			entries, err := pack.LoadServedEntries(ctx, tx, c.CampaignID, pack.ServedOptions{Types: def.Entities})
			if err != nil {
				return "", err
			}
			for _, e := range entries {
				names[e.Name] = names[e.Name] || pack.SeesEntry(e.Visibility, gm)
			}
		}
		// A word is one of the suggestions folded (house decision #197).
		offered := map[string]bool{}
		for _, o := range def.Options {
			offered[strings.ToLower(o)] = true
		}
		for name, seen := range names {
			offered[strings.ToLower(name)] = offered[strings.ToLower(name)] || seen
		}
		for i, w := range value.([]any) {
			if word := w.(string); !offered[strings.ToLower(word)] {
				return fmt.Sprintf(`[%d]: "%s" is not one of the suggestions`, i, word), nil
			}
		}
		return "", nil
	}
	types := []string{}
	for _, f := range def.From {
		types = append(types, f.Entity)
	}
	for _, col := range def.Columns {
		if col.Type == "ref" {
			types = append(types, col.Entity)
		}
	}
	lookup, err := pack.ServedLookup(ctx, tx, c.CampaignID, types, gm)
	if err != nil {
		return "", err
	}
	for i, raw := range value.([]any) {
		row := raw.(map[string]any)
		if from, has := row["from"].(map[string]any); has && lookup(from["entity"].(string), from["key"].(string)) == nil {
			return fmt.Sprintf("[%d].from.key: no such entry in this room's packs", i), nil
		}
		values := row["values"].(map[string]any)
		for _, col := range def.Columns {
			cell, has := values[col.ID]
			switch {
			case !has:
			case col.Type == "ref" && lookup(col.Entity, cell.(string)) == nil:
				return fmt.Sprintf("[%d].values.%s: no such entry in this room's packs", i, col.ID), nil
			case col.Type == "test":
				if _, known := rules.Tests[cell.(map[string]any)["testId"].(string)]; !known {
					return fmt.Sprintf("[%d].values.%s: no such Test in this room's ruleset", i, col.ID), nil
				}
			}
		}
	}
	return "", nil
}

// linkProblem says why an `entry` field may not name target (house decision #76), or "" when it may: the target is an
// entry of this room, of the field's kind, and not the entry being saved. Who may read it is the Seat view's business.
func linkProblem(ctx context.Context, tx core.Conn, campaignID string, a cs.Action, kind, target string) (string, error) {
	if id, _ := a["id"].(string); id == target {
		return "an entry can't link to itself", nil
	}
	var got string
	err := tx.QueryRow(ctx, `SELECT kind FROM codex_entry WHERE id = $1 AND campaign_id = $2`, target, campaignID).Scan(&got)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "no such entry in this room", nil
	case err != nil:
		return "", err
	case got != kind:
		return "expected a " + kind + " entry", nil
	}
	return "", nil
}
