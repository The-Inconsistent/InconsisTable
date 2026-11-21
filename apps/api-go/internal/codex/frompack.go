package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Entries made from pack entries (house decision #97; Auspex codex.actions.ts addPlaces and the preset pickers). The
// server reads the served entry itself: a client names only the type and the key.

// maxFromPack is how many entries one codex.fromPack makes at most, the root included (Auspex MAX_PLACES_PER_ADD).
const maxFromPack = 60

// prefill is the way the room's ruleset makes an entry of kind from a pack entry of entity, or nil when it has none.
func prefill(rules *engine.CompiledRuleset, kind, entity string) *engine.EntryPrefill {
	if rules == nil || rules.Ruleset.Codex == nil {
		return nil
	}
	from := rules.Ruleset.Codex.Kinds[kind].From
	for i := range from {
		if from[i].Entity == entity {
			return &from[i]
		}
	}
	return nil
}

// servedEntries is the served entries of one type that this seat reads, the first per key (pack slug order).
func servedEntries(ctx context.Context, tx core.Conn, c cs.Ctx, entity string) ([]pack.StoredEntry, error) {
	all, err := pack.LoadServedEntries(ctx, tx, c.CampaignID, pack.ServedOptions{Types: []string{entity}})
	if err != nil {
		return nil, err
	}
	gm, seen, out := view.ReadsGM(c), map[string]bool{}, []pack.StoredEntry{}
	for _, e := range all {
		if !seen[e.Key] && pack.SeesEntry(e.Visibility, gm) {
			seen[e.Key] = true
			out = append(out, e)
		}
	}
	return out, nil
}

// checkSource reads codex.save's `source` (house decision #97): a type the kind is made from and a key the room serves
// to this seat, stored with the served entry's own cite. Sent reports whether it was sent; nil text clears it.
func checkSource(ctx context.Context, tx core.Conn, c cs.Ctx, kind string, a cs.Action) (*string, bool, error) {
	given, sent := a["source"]
	if !sent || given == nil {
		return nil, sent, nil
	}
	source, _ := given.(map[string]any)
	entity, _ := source["entity"].(string)
	key, _ := source["key"].(string)
	rules, err := compiled.Load(ctx, tx, c.CampaignID)
	if err != nil {
		return nil, true, err
	}
	if prefill(rules, kind, entity) == nil {
		return nil, true, cs.Fail("fromPackNotFor")
	}
	entries, err := servedEntries(ctx, tx, c, entity)
	if err != nil {
		return nil, true, err
	}
	i := slices.IndexFunc(entries, func(e pack.StoredEntry) bool { return e.Key == key })
	if i < 0 {
		return nil, true, cs.Fail("fromPackNoEntry")
	}
	stored := map[string]any{"entity": entity, "key": key}
	if cite := entries[i].Cite; cite != nil {
		stored["cite"] = *cite
	}
	b, err := json.Marshal(stored)
	text := string(b)
	return &text, true, err
}

// FromPack is codex.fromPack (house decision #97): an entry of `kind` made from a served pack entry as the ruleset's
// `from` declares, with the served entries that name it through `children` nested under it (breadth first, in the
// packs' order, each once), and a scene's prepared Test and roster lines. Each entry is made by codex.save and nested by
// codex.move, so their checks and limits hold; the whole is one logged action that Undo takes back. Answers the new ids,
// root first.
func FromPack(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, kind, entity, key := c.CampaignID, a.Str("kind"), a.Str("entity"), a.Str("key")
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	how := prefill(rules, kind, entity)
	if how == nil {
		return cs.Result{}, cs.Fail("fromPackNotFor")
	}
	served, err := servedEntries(ctx, tx, c, entity)
	if err != nil {
		return cs.Result{}, err
	}
	root := slices.IndexFunc(served, func(e pack.StoredEntry) bool { return e.Key == key })
	if root < 0 {
		return cs.Result{}, cs.Fail("fromPackNoEntry")
	}
	type node struct {
		entry  pack.StoredEntry
		parent int
	}
	tree := []node{{served[root], -1}}
	taken := map[string]bool{key: true}
	for i := 0; how.Children != nil && i < len(tree); i++ {
		for _, e := range served {
			if parent, _ := e.Body[*how.Children].(string); parent == tree[i].entry.Key && !taken[e.Key] {
				taken[e.Key] = true
				tree = append(tree, node{e, i})
			}
		}
		if len(tree) > maxFromPack {
			return cs.Result{}, cs.Fail("fromPackTooMany", cs.Params{"limit": maxFromPack})
		}
	}
	ids := make([]string, 0, len(tree))
	for _, n := range tree {
		save, err := saveFrom(ctx, tx, c, rules, kind, how, n.entry)
		if err != nil {
			return cs.Result{}, err
		}
		parent := ""
		if n.parent >= 0 {
			parent = ids[n.parent]
		}
		id, err := makeUnder(ctx, tx, c, save, parent)
		if err != nil {
			return cs.Result{}, err
		}
		ids = append(ids, id)
	}
	// Each child's move checked the depth it reached; under a parent the whole branch is checked again there.
	return logMade(ctx, tx, c, a, ids)
}

// saveFrom is the codex.save that makes an entry of kind from a served pack entry (house decision #97): its name, its
// key and page, the fields its kind maps, and a scene's prepared lines.
func saveFrom(ctx context.Context, tx core.Conn, c cs.Ctx, rules *engine.CompiledRuleset, kind string, how *engine.EntryPrefill, e pack.StoredEntry) (cs.Action, error) {
	save := cs.Action{"type": "codex.save", "kind": kind, "title": e.Name,
		"source": map[string]any{"entity": how.Entity, "key": e.Key}}
	if fields := mapped(rules, kind, how, e, cs.CanInCampaign(c, "codex:read_secret", "")); len(fields) > 0 {
		save["fields"] = fields
	}
	if kind == "scene" {
		prep, err := scenePrep(ctx, tx, c, rules, how, e)
		if err != nil {
			return nil, err
		}
		save["prep"] = prep
	}
	return save, nil
}

// makeUnder makes an entry by codex.save and, under parent when there is one, moves it last there by codex.move.
func makeUnder(ctx context.Context, tx core.Conn, c cs.Ctx, save cs.Action, parent string) (string, error) {
	made, err := Save(ctx, tx, c, save)
	if err != nil || parent == "" {
		return made.ID, err
	}
	_, err = Move(ctx, tx, c, cs.Action{"id": made.ID, "parentId": parent, "position": float64(10_000)})
	return made.ID, err
}

// logMade puts the root of what an action made under its `parentId` when it names one, and logs every entry made as one
// action Undo takes back (house decision #97). Answers the ids, root first.
func logMade(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action, ids []string) (cs.Result, error) {
	if parent, has := a["parentId"].(string); has {
		if _, err := Move(ctx, tx, c, cs.Action{"id": ids[0], "parentId": parent, "position": float64(10_000)}); err != nil {
			return cs.Result{}, err
		}
	}
	written := make([]eventlog.Written, len(ids))
	for i, id := range ids {
		written[i] = eventlog.Written{Target: engine.DeltaTarget{Entry: id}, Kind: "create", Before: nil, After: true}
	}
	if _, err := eventlog.Record(ctx, tx, c, core.NewUUID(), written); err != nil {
		return cs.Result{}, err
	}
	return cs.Result{OK: true, ID: ids[0], IDs: ids}, nil
}

// mapped is the kind's fields a pack entry fills (`name` and `values`): a value that does not fit its field is left
// for the GM, and a `gm` field is left out for a seat that does not write GM notes.
func mapped(rules *engine.CompiledRuleset, kind string, how *engine.EntryPrefill, e pack.StoredEntry, secrets bool) map[string]any {
	defs := rules.Ruleset.Codex.Kinds[kind].Fields
	out := map[string]any{}
	put := func(id string, value any) {
		def := defs[id]
		if value != nil && (secrets || def.Visibility == "party") && engine.CheckFieldValue(&def, value) == "" {
			out[id] = value
		}
	}
	if how.Name != nil {
		put(*how.Name, e.Name)
	}
	for to, from := range how.Values {
		put(to, e.Body[from])
	}
	return out
}

// scenePrep is the prepared lines a scene brings (house decision #97): a Test line per Test id its `tests` list names
// (party takers, its inputs from the entry's fields where the Test declares them), and a roster line per pack key its
// `roster` list names, counted when it repeats, found among the served creatures this seat reads. A key nobody serves
// brings no line; a Test the ruleset lacks is kept, shown broken as every line naming what is gone (house decision #73).
func scenePrep(ctx context.Context, tx core.Conn, c cs.Ctx, rules *engine.CompiledRuleset, how *engine.EntryPrefill, e pack.StoredEntry) (map[string]any, error) {
	prep := map[string]any{"roster": []any{}, "tests": []any{}, "pools": []any{}, "exits": []any{}, "reveals": []any{}, "picks": []any{}}
	if how.Tests != nil {
		tests := []any{}
		for i, id := range listOf(e.Body[how.Tests.Field]) {
			inputs := map[string]any{}
			for input, field := range how.Tests.Inputs {
				if _, declared := rules.Ruleset.Tests[id].Inputs[input]; declared && e.Body[field] != nil {
					inputs[input] = e.Body[field]
				}
			}
			tests = append(tests, map[string]any{"id": fmt.Sprintf("t%d", i+1), "testId": id, "inputs": inputs,
				"takers": "party", "actorIds": []any{}, "hideTarget": false, "outcomes": []any{}})
		}
		prep["tests"] = capLines(tests)
	}
	if how.Roster != nil {
		keys := listOf(e.Body[*how.Roster])
		if len(keys) > 0 {
			slugs, err := creatureSlugs(ctx, tx, c, rules, keys)
			if err != nil {
				return nil, err
			}
			roster, at := []any{}, map[string]map[string]any{}
			for _, k := range keys {
				switch line, counted := at[k]; {
				case counted:
					line["count"] = min(line["count"].(int)+1, 50)
				case slugs[k] != "":
					at[k] = map[string]any{"id": fmt.Sprintf("r%d", len(roster)+1), "pack": slugs[k], "key": k, "count": 1,
						"visibility": "hidden", "temporary": true}
					roster = append(roster, at[k])
				}
			}
			prep["roster"] = capLines(roster)
		}
	}
	return prep, nil
}

// creatureSlugs is the pack slug serving each key as an actor entry this seat reads, the first by pack slug.
func creatureSlugs(ctx context.Context, tx core.Conn, c cs.Ctx, rules *engine.CompiledRuleset, keys []string) (map[string]string, error) {
	actors := []string{}
	for _, t := range rules.Ruleset.Entities {
		if t.Base == "actor" {
			actors = append(actors, t.ID)
		}
	}
	entries, err := pack.LoadServedEntries(ctx, tx, c.CampaignID, pack.ServedOptions{Types: actors})
	if err != nil {
		return nil, err
	}
	gm, out := view.ReadsGM(c), map[string]string{}
	for _, e := range entries {
		if out[e.Key] != "" || !slices.Contains(keys, e.Key) || !pack.SeesEntry(e.Visibility, gm) {
			continue
		}
		var slug string
		if err := tx.QueryRow(ctx, `SELECT pack.slug FROM pack_version JOIN pack ON pack.id = pack_version.pack_id
			WHERE pack_version.id = $1`, e.PackVersionID).Scan(&slug); err != nil {
			return nil, err
		}
		out[e.Key] = slug
	}
	return out, nil
}

func listOf(v any) []string {
	items, _ := v.([]any)
	out := []string{}
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// capLines keeps the first lines a scene holds of one kind (core-schema MAX_PREP_LINES).
func capLines(lines []any) []any { return lines[:min(len(lines), 40)] }
