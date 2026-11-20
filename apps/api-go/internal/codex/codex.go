// Package codex holds codex entries and their listed readers. This phase ports the read the table snapshot needs.
package codex

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Load is the campaign's codex, whole: every entry with its audience. The Seat view decides what each seat gets.
func Load(ctx context.Context, conn core.Conn, campaignID string) (cs.Codex, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, kind, title, body, gm_notes, visibility, audience_mode, status,
		parent_id::text, position, planned_tests, image_id::text, image_revealed, fields, layout, header FROM codex_entry
		WHERE campaign_id = $1 ORDER BY created_at`, campaignID)
	if err != nil {
		return cs.Codex{}, err
	}
	entries, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.CodexEntry, error) {
		e := cs.CodexEntry{Audience: []string{}, Links: []string{}}
		err := r.Scan(&e.ID, &e.Kind, &e.Title, &e.Body, &e.GMNotes, &e.Visibility, &e.AudienceMode, &e.Status,
			&e.ParentID, &e.Position, &e.PlannedTests, &e.ImageID, &e.ImageRevealed, &e.Fields, &e.Layout, &e.Header)
		if e.PlannedTests == nil {
			e.PlannedTests = []string{}
		}
		return e, err
	})
	if err != nil {
		return cs.Codex{}, err
	}
	links, err := loadLinks(ctx, conn, campaignID)
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
		entries[i].Links = append(entries[i].Links, links[entries[i].ID]...)
	}
	if entries == nil {
		entries = []cs.CodexEntry{}
	}
	recaps, err := loadRecaps(ctx, conn, campaignID)
	if err != nil {
		return cs.Codex{}, err
	}
	return cs.Codex{Entries: entries, Recaps: recaps}, nil
}

// loadLinks is each scene's linked entry ids, in the order they were made.
func loadLinks(ctx context.Context, conn core.Conn, campaignID string) (map[string][]string, error) {
	rows, err := conn.Query(ctx, `SELECT l.entry_id::text, l.target_id::text FROM codex_link l
		JOIN codex_entry e ON e.id = l.entry_id WHERE e.campaign_id = $1 ORDER BY l.target_id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := map[string][]string{}
	for rows.Next() {
		var entryID, targetID string
		if err := rows.Scan(&entryID, &targetID); err != nil {
			return nil, err
		}
		links[entryID] = append(links[entryID], targetID)
	}
	return links, rows.Err()
}

// maxRecaps is core-schema's MAX_RECAPS.
const maxRecaps = 50

// loadRecaps is the ended sessions that have a recap, newest first. The session's notes are never read.
func loadRecaps(ctx context.Context, conn core.Conn, campaignID string) ([]cs.SessionRecap, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, number, title, ended_at, recap FROM session
		WHERE campaign_id = $1 AND ended_at IS NOT NULL AND btrim(recap) <> '' ORDER BY number DESC LIMIT $2`, campaignID, maxRecaps)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.SessionRecap, error) {
		var s cs.SessionRecap
		var endedAt time.Time
		err := r.Scan(&s.SessionID, &s.Number, &s.Title, &endedAt, &s.Recap)
		s.EndedAt = core.ISOTime(endedAt)
		return s, err
	})
	if out == nil {
		out = []cs.SessionRecap{}
	}
	return out, err
}
