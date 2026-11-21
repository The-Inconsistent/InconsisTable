package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Items an actor holds in play (house decision #95): rows of actor_item, each naming a served pack entry by type and
// key or hand-written with a name. Their entries' effects reach the actor's numbers through the #61 path.

// ItemRow is one actor_item row, with the served entry it names (Served false when the room is served none: it keeps
// its key as its name and adds nothing).
type ItemRow struct {
	ID, Kind               string
	EntryType, EntryKey    *string
	Name, Note, Source     string
	Quantity               *int
	FittedTo, CodexEntryID *string
	// FittedLine is the saved build's line it is fitted to (house decision #102), nil when none.
	FittedLine *string
	// Profile is the entry record's weapon or armour, the numbers a card draws (house decision #102); nil without one.
	Profile   json.RawMessage
	Ordinal   int
	Rev       int64
	Served    bool
	EntryName string
	Cite      *string
	Tags      []string
	Effects   []engine.Effect
}

// Label is the item's name: the served entry's, else the hand-written one, else the entry's key.
func (r ItemRow) Label() string {
	switch {
	case r.Served:
		return r.EntryName
	case r.EntryKey == nil:
		return r.Name
	}
	return *r.EntryKey
}

// itemSelect reads every column of an item and its served entry (the first by pack slug, house decision #61's rule).
const itemSelect = `SELECT i.actor_id::text, i.id::text, i.kind, i.entry_type, i.entry_key, i.name, i.note, i.source, i.quantity,
		i.fitted_to::text, i.codex_entry_id::text, i.ordinal, i.rev, i.fitted_line, e.key IS NOT NULL, coalesce(e.name, ''), e.cite,
		coalesce(e.tags, '{}'), coalesce(e.effects, '[]'), coalesce(e.record->'weapon', e.record->'armour')::text
	FROM actor_item i JOIN actor ON actor.id = i.actor_id
	LEFT JOIN LATERAL (SELECT e.key, e.name, e.cite, e.tags, e.effects, e.record FROM campaign_pack
		JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id
		JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE e.type = i.entry_type AND e.key = i.entry_key AND ` + "%s" + ` ORDER BY pack.slug LIMIT 1) e ON true`

func scanItem(r pgx.Row) (string, ItemRow, error) {
	var actorID string
	var x ItemRow
	var effects []byte
	var profile *string
	err := r.Scan(&actorID, &x.ID, &x.Kind, &x.EntryType, &x.EntryKey, &x.Name, &x.Note, &x.Source, &x.Quantity,
		&x.FittedTo, &x.CodexEntryID, &x.Ordinal, &x.Rev, &x.FittedLine, &x.Served, &x.EntryName, &x.Cite, &x.Tags, &effects, &profile)
	if profile != nil {
		x.Profile = json.RawMessage(*profile)
	}
	if err != nil {
		return "", x, err
	}
	return actorID, x, json.Unmarshal(effects, &x.Effects)
}

// loadItems is the room's items by actor, in each actor's order.
func loadItems(ctx context.Context, conn core.Conn, campaignID string) (map[string][]ItemRow, error) {
	return byActor(ctx, conn, fmt.Sprintf(itemSelect, ServedPacks("$1"))+` WHERE actor.campaign_id = $1 ORDER BY i.actor_id, i.ordinal, i.id`,
		campaignID, func(r pgx.Rows) (string, ItemRow, error) { return scanItem(r) })
}

// LoadItem is one item of the room with its holder, or ok false when the room has no such item.
func LoadItem(ctx context.Context, conn core.Conn, campaignID, itemID string) (actorID string, item ItemRow, ok bool, err error) {
	actorID, item, err = scanItem(conn.QueryRow(ctx, fmt.Sprintf(itemSelect, ServedPacks("$1"))+` WHERE actor.campaign_id = $1 AND i.id = $2`,
		campaignID, itemID))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", item, false, nil
	}
	return actorID, item, err == nil, err
}

// ItemEntries are the effects of the items an actor holds (house decision #95): every served entry's, except a kind
// that is fitted, whose item counts only while it is fitted to an item the actor holds.
func ItemEntries(compiled *engine.CompiledRuleset, items []ItemRow) []engine.ActiveEntry {
	var out []engine.ActiveEntry
	for _, x := range items {
		kind := compiled.Ruleset.Items.Kind(x.Kind)
		if kind == nil || !x.Served || len(x.Effects) == 0 {
			continue
		}
		// Fitted to a line of the saved build counts too: a rebuild drops a fitting whose line it no longer gives (#102).
		if kind.Fits != nil && x.FittedLine == nil && (x.FittedTo == nil || !hasItem(items, *x.FittedTo)) {
			continue
		}
		out = append(out, engine.ActiveEntry{Type: *x.EntryType, Key: *x.EntryKey, Name: x.EntryName, Effects: x.Effects})
	}
	return out
}

func hasItem(items []ItemRow, id string) bool {
	for _, x := range items {
		if x.ID == id {
			return true
		}
	}
	return false
}

// Live is the item as the snapshot carries it, before any seat's filter.
func (r ItemRow) Live() cs.ActorItem {
	effects := []cs.HeldEffect{}
	if r.Served {
		for _, e := range r.Effects {
			effects = append(effects, cs.HeldEffect{Path: e.Path, Mode: e.Mode, Value: e.Value, Phase: e.Phase})
		}
	}
	tags := []string{}
	var cite *string
	if r.Served {
		cite = r.Cite
	}
	if r.Served && r.Tags != nil {
		tags = r.Tags
	}
	return cs.ActorItem{ID: r.ID, Kind: r.Kind, Entry: r.EntryKey, Name: r.Label(), Cite: cite, Note: r.Note,
		Quantity: r.Quantity, FittedTo: r.FittedTo, FittedLine: r.FittedLine, Profile: profileOf(r), Source: r.Source, EntryID: r.CodexEntryID, Rev: r.Rev, Tags: tags, Effects: effects}
}

// profileOf is what a seat reads of the entry's profile: a served entry's only.
func profileOf(r ItemRow) json.RawMessage {
	if !r.Served {
		return nil
	}
	return r.Profile
}

// The logged value of an item row: what Undo compares and puts back (nil for no row).
func itemValue(actorID string, r ItemRow) map[string]any {
	return map[string]any{"actorId": actorID, "kind": r.Kind, "entryType": nullable(r.EntryType), "entryKey": nullable(r.EntryKey),
		"name": r.Name, "note": r.Note, "quantity": nullableInt(r.Quantity), "fittedTo": nullable(r.FittedTo), "fittedLine": nullable(r.FittedLine),
		"source": r.Source, "codexEntryId": nullable(r.CodexEntryID), "ordinal": float64(r.Ordinal)}
}

func nullable(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func nullableInt(n *int) any {
	if n == nil {
		return nil
	}
	return float64(*n)
}

// ItemValue is an item's logged value now, nil when the room has no such row.
func ItemValue(ctx context.Context, conn core.Conn, campaignID, itemID string) (any, error) {
	actorID, row, ok, err := LoadItem(ctx, conn, campaignID, itemID)
	if err != nil || !ok {
		return nil, err
	}
	return itemValue(actorID, row), nil
}

// writeItem sets an item row to the value a delta carries (nil deletes it), and says what it changed. The holder the
// value names must be an actor of this room; every write takes a new revision.
func writeItem(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	id := w.Delta.Target.Item
	before, err := ItemValue(ctx, tx, w.CampaignID, id)
	if err != nil {
		return eventlog.Written{}, err
	}
	after, _ := w.Delta.Value.(map[string]any)
	if w.Delta.Value == nil {
		if _, err := tx.Exec(ctx, `DELETE FROM actor_item i USING actor WHERE actor.id = i.actor_id AND actor.campaign_id = $1
			AND i.id = $2`, w.CampaignID, id); err != nil {
			return eventlog.Written{}, err
		}
		return eventlog.Written{Target: w.Delta.Target, Kind: "set", Before: before, After: nil}, nil
	}
	if after == nil {
		return eventlog.Written{}, cs.Fail("cannotWrite")
	}
	tag, err := tx.Exec(ctx, `INSERT INTO actor_item (id, actor_id, kind, entry_type, entry_key, name, note, quantity, fitted_to,
			source, codex_entry_id, ordinal, fitted_line)
		SELECT $2, actor.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14 FROM actor WHERE actor.id = $3 AND actor.campaign_id = $1
		ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, entry_type = EXCLUDED.entry_type, entry_key = EXCLUDED.entry_key,
			name = EXCLUDED.name, note = EXCLUDED.note, quantity = EXCLUDED.quantity, fitted_to = EXCLUDED.fitted_to,
			fitted_line = EXCLUDED.fitted_line,
			source = EXCLUDED.source, codex_entry_id = EXCLUDED.codex_entry_id, ordinal = EXCLUDED.ordinal,
			rev = nextval('actor_item_rev')`,
		w.CampaignID, id, after["actorId"], after["kind"], after["entryType"], after["entryKey"], after["name"], after["note"],
		intArg(after["quantity"]), after["fittedTo"], after["source"], after["codexEntryId"], intArg(after["ordinal"]),
		after["fittedLine"])
	if err != nil {
		return eventlog.Written{}, err
	}
	if tag.RowsAffected() == 0 {
		return eventlog.Written{}, cs.Fail("characterNotFound")
	}
	return eventlog.Written{Target: w.Delta.Target, Kind: "set", Before: before, After: after}, nil
}

// intArg is a logged whole number as SQL takes it (decoded JSON holds a float64), nil kept nil.
func intArg(v any) any {
	if n, isNumber := v.(float64); isNumber {
		return int64(n)
	}
	return nil
}
