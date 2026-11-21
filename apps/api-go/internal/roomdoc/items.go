package roomdoc

import (
	"errors"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// items writes the items each document actor holds (house decision #95), after the codex so a GIVE's entry has its new
// id: each of a kind the ruleset declares for the actor's type, a served pack entry of that kind or a hand-written
// name, no second of a unique entry, no more than the kind's max, a counted kind with its quantity, fitted to an item
// of a kind it fits, and a given codex entry an item entry held once. Every id is a new one. A refusal names the path.
func (im *importer) items() error {
	rules, err := compiled.Load(im.ctx, im.tx, im.gm.CampaignID)
	if err != nil {
		return err
	}
	given := map[string]bool{}
	for i, a := range im.d.list("actors") {
		list := doc(a).list("items")
		if len(list) == 0 {
			continue
		}
		at := func(j int, key string) []any { return []any{"actors", i, "items", j, key} }
		if rules == nil || rules.Ruleset.Items == nil {
			return problem("noItems", nil, "actors", i, "items")
		}
		actorID := im.actors[doc(a).str("id")]
		var entity string
		if err := im.tx.QueryRow(im.ctx, `SELECT entity_type FROM actor WHERE id = $1`, actorID).Scan(&entity); err != nil {
			return err
		}
		name, _ := a["name"].(string)
		ids, kinds, counts, held := map[string]string{}, map[string]string{}, map[string]int{}, map[string]bool{}
		for j, x := range list {
			kind := rules.Ruleset.Items.Kind(doc(x).str("kind"))
			if kind == nil {
				return problem("noItemKind", cs.Params{"kind": doc(x).str("kind")}, at(j, "kind")...)
			}
			if !slices.Contains(kind.Entities, entity) {
				return problem("itemNotFor", cs.Params{"name": name, "kind": kind.Label}, at(j, "kind")...)
			}
			key, hasEntry := x["entry"].(string)
			label, hasName := x["name"].(string)
			if hasEntry == hasName {
				return problem("itemEntryOrName", nil, at(j, "entry")...)
			}
			var entryType any
			if hasEntry {
				var tags []string
				err := im.tx.QueryRow(im.ctx, `SELECT e.name, e.tags FROM campaign_pack
					JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id
					JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
					WHERE e.type = $2 AND e.key = $3 AND `+actor.ServedPacks("$1")+` ORDER BY pack.slug LIMIT 1`,
					im.gm.CampaignID, kind.Entry, key).Scan(&label, &tags)
				if errors.Is(err, pgx.ErrNoRows) {
					return problem("itemNoEntry", cs.Params{"entry": key}, at(j, "entry")...)
				}
				if err != nil {
					return err
				}
				if k := rules.Ruleset.Items.KindOf(kind.Entry, tags); k == nil || k.ID != kind.ID {
					return problem("itemNotAnItem", cs.Params{"entry": label, "kind": kind.Label}, at(j, "entry")...)
				}
				if kind.Unique != nil && *kind.Unique && held[kind.ID+"/"+key] {
					return problem("itemAlready", cs.Params{"name": name, "item": label}, at(j, "entry")...)
				}
				held[kind.ID+"/"+key], entryType = true, kind.Entry
			}
			if counts[kind.ID]++; counts[kind.ID] > kind.MaxOrDefault() {
				return problem("itemsFull", cs.Params{"name": name, "kind": kind.Label, "max": kind.MaxOrDefault()}, at(j, "kind")...)
			}
			var quantity any
			if kind.Counted() {
				quantity = int64(1)
				if q, has := x["quantity"].(float64); has {
					quantity = int64(q)
				}
			}
			var entryID any
			if e, has := x["entryId"].(string); has {
				if given[e] {
					return problem("itemGiven", cs.Params{"item": label}, at(j, "entryId")...)
				}
				given[e], entryID = true, im.entries[e]
			}
			source := doc(x).str("source")
			if source == "" {
				source = "hand"
			}
			note, _ := x["note"].(string)
			var entryKey any
			if hasEntry {
				entryKey, label = key, ""
			}
			var id string
			if err := im.tx.QueryRow(im.ctx, `INSERT INTO actor_item (actor_id, kind, entry_type, entry_key, name, note, quantity,
					source, codex_entry_id, ordinal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10) RETURNING id::text`,
				actorID, kind.ID, entryType, entryKey, label, note, quantity, source, entryID, j).Scan(&id); err != nil {
				return err
			}
			ids[doc(x).str("id")], kinds[doc(x).str("id")] = id, kind.ID
		}
		lines, err := actor.SheetLines(im.ctx, im.tx, actorID)
		if err != nil {
			return err
		}
		for j, x := range list {
			kind := rules.Ruleset.Items.Kind(doc(x).str("kind"))
			// A fitting on a line of the character's saved build (house decision #102): the build came in first.
			if line, onLine := x["fittedLine"].(string); onLine {
				card, host, _ := strings.Cut(line, "/")
				lineKind := rules.Ruleset.Items.CardKind(card, entity)
				_, both := x["fittedTo"].(string)
				switch {
				case both || kind.Fits == nil || lineKind == nil || !slices.Contains(kind.Fits.To, lineKind.ID):
					return problem("itemFitsNot", cs.Params{"item": doc(x).str("kind"), "host": host}, at(j, "fittedLine")...)
				case !slices.Contains(lines, line):
					return problem("roomNoSuchItem", nil, at(j, "fittedLine")...)
				}
				if _, err := im.tx.Exec(im.ctx, `UPDATE actor_item SET fitted_line = $2 WHERE id = $1`, ids[doc(x).str("id")], line); err != nil {
					return err
				}
				continue
			}
			to, fitted := x["fittedTo"].(string)
			if !fitted {
				continue
			}
			if kind.Fits == nil || !slices.Contains(kind.Fits.To, kinds[to]) {
				return problem("itemFitsNot", cs.Params{"item": doc(x).str("kind"), "host": kinds[to]}, at(j, "fittedTo")...)
			}
			if _, err := im.tx.Exec(im.ctx, `UPDATE actor_item SET fitted_to = $2 WHERE id = $1`, ids[doc(x).str("id")], ids[to]); err != nil {
				return err
			}
		}
	}
	return nil
}
