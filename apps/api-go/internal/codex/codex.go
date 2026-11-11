// Package codex holds codex entries and their listed readers. This phase ports the read the table snapshot needs.
package codex

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Load is the campaign's codex, whole: every entry with its audience. The Seat view decides what each seat gets.
func Load(ctx context.Context, conn core.Conn, campaignID string) (cs.Codex, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, kind, title, body, gm_notes, visibility, audience_mode FROM codex_entry
		WHERE campaign_id = $1 ORDER BY created_at`, campaignID)
	if err != nil {
		return cs.Codex{}, err
	}
	entries, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.CodexEntry, error) {
		e := cs.CodexEntry{Audience: []string{}}
		err := r.Scan(&e.ID, &e.Kind, &e.Title, &e.Body, &e.GMNotes, &e.Visibility, &e.AudienceMode)
		return e, err
	})
	if err != nil {
		return cs.Codex{}, err
	}
	rows, err = conn.Query(ctx, `SELECT r.entry_id::text, r.actor_id::text FROM codex_reveal r
		JOIN codex_entry e ON e.id = r.entry_id WHERE e.campaign_id = $1`, campaignID)
	if err != nil {
		return cs.Codex{}, err
	}
	defer rows.Close()
	audience := map[string][]string{}
	for rows.Next() {
		var entryID, actorID string
		if err := rows.Scan(&entryID, &actorID); err != nil {
			return cs.Codex{}, err
		}
		audience[entryID] = append(audience[entryID], actorID)
	}
	if err := rows.Err(); err != nil {
		return cs.Codex{}, err
	}
	for i := range entries {
		entries[i].Audience = append(entries[i].Audience, audience[entries[i].ID]...)
	}
	if entries == nil {
		entries = []cs.CodexEntry{}
	}
	return cs.Codex{Entries: entries}, nil
}
