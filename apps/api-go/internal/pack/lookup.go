// Package pack holds imported content packs: the lookups the room uses, and the owner's import, library and export.
package pack

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// ServedPacks is the SQL condition for the pack versions of a room that may be served to anyone: attached, not taken
// down by an admin, and a `private` pack only while its owner is a GM of the room (CLAUDE.md, principle 4). The one
// place this is decided. It reads campaign_pack and pack, so the query must join both. campaignParam is the
// placeholder holding the campaign id, such as "$1".
func ServedPacks(campaignParam string) string {
	return fmt.Sprintf(`campaign_pack.campaign_id = %[1]s AND pack.disabled_at IS NULL AND (pack.license <> 'private' OR EXISTS (
		SELECT 1 FROM membership WHERE membership.campaign_id = %[1]s AND membership.user_id = pack.owner_user_id AND membership.role = 'gm'))`,
		campaignParam)
}

// SeesEntry says what a seat may read of an entry: a `gm` entry is for GM-side seats only.
func SeesEntry(visibility string, gm bool) bool {
	return gm || visibility == "public" || visibility == "party"
}

// StoredEntry is a pack entry as stored.
type StoredEntry struct {
	PackVersionID string
	Key           string
	Type          string
	Name          string
	Level         *int
	Tags          []string
	Cite          *string
	Visibility    string
	Body          map[string]any
}

// EntryLookup is the lookup RunCreation picks from, over entries already loaded: only what this seat may see (a player
// must never pick a `gm` entry). The first entry per (type, key) wins, in load order.
//
// ponytail: a stored entry is not re-validated here (TypeScript parses it again); the importer validated it, and a
// stored row is ours. Parse it again if a manifest change can outdate stored entries.
func EntryLookup(entries []StoredEntry, gm bool) engine.EntryLookup {
	return func(entityType, key string) *engine.PackEntry {
		for _, e := range entries {
			if e.Type != entityType || e.Key != key || !SeesEntry(e.Visibility, gm) {
				continue
			}
			out := &engine.PackEntry{
				Key: e.Key, Type: e.Type, Name: e.Name, Tags: e.Tags, Cite: e.Cite, Visibility: e.Visibility, Body: e.Body,
			}
			if e.Level != nil {
				level := float64(*e.Level)
				out.Level = &level
			}
			return out
		}
		return nil
	}
}

// ServedOptions narrows LoadServedEntries.
type ServedOptions struct {
	// Types limits the entries to these types. Nil means any type; an empty, non-nil list means none.
	Types []string
	// PackVersionID limits the entries to one pack version when set.
	PackVersionID string
}

// LoadServedEntries is the entries of the room's served packs, in a stable order (pack slug, then key).
func LoadServedEntries(ctx context.Context, conn core.Conn, campaignID string, opts ServedOptions) ([]StoredEntry, error) {
	if opts.Types != nil && len(opts.Types) == 0 {
		return []StoredEntry{}, nil
	}
	var where strings.Builder
	args := []any{campaignID}
	where.WriteString(ServedPacks("$1"))
	if opts.Types != nil {
		args = append(args, opts.Types)
		fmt.Fprintf(&where, " AND pack_entry.type = ANY($%d)", len(args))
	}
	if opts.PackVersionID != "" {
		args = append(args, opts.PackVersionID)
		fmt.Fprintf(&where, " AND pack_entry.pack_version_id = $%d", len(args))
	}
	rows, err := conn.Query(ctx, `SELECT pack_entry.pack_version_id::text, pack_entry.key, pack_entry.type, pack_entry.name,
			pack_entry.level, pack_entry.tags, pack_entry.cite, pack_entry.visibility, pack_entry.body
		FROM pack_entry
		JOIN campaign_pack ON campaign_pack.pack_version_id = pack_entry.pack_version_id
		JOIN pack_version ON pack_version.id = pack_entry.pack_version_id
		JOIN pack ON pack.id = pack_version.pack_id
		WHERE `+where.String()+` ORDER BY pack.slug ASC, pack_entry.key ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StoredEntry{}
	for rows.Next() {
		var e StoredEntry
		var level *int32
		var body []byte
		if err := rows.Scan(&e.PackVersionID, &e.Key, &e.Type, &e.Name, &level, &e.Tags, &e.Cite, &e.Visibility, &body); err != nil {
			return nil, err
		}
		if level != nil {
			l := int(*level)
			e.Level = &l
		}
		if err := json.Unmarshal(body, &e.Body); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
