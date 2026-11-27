package codex

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// SHOW TO TABLE (#2, house decision #139): the GM holds one codex entry up to the table, for everyone or for listed
// characters. Each seat draws the card from its own codex, so the spotlight is only a reference.

// ShowSpotlight is spotlight.show: the entry is revealed for good as codex.reveal reveals it (never narrowed: one shown
// to all stays so, a listed one gains the new readers), its picture too, then it replaces the room's spotlight.
func ShowSpotlight(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("entryId")
	var visibility, mode string
	var picture, pictureShown bool
	err := tx.QueryRow(ctx, `SELECT visibility, audience_mode, image_id IS NOT NULL, image_revealed FROM codex_entry
		WHERE id = $1 AND campaign_id = $2`, id, cid).Scan(&visibility, &mode, &picture, &pictureShown)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("entryNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	audience := []string{}
	given, _ := a["audience"].([]any)
	for _, v := range given {
		if s, ok := v.(string); ok && !slices.Contains(audience, s) {
			audience = append(audience, s)
		}
	}
	var known int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[]) AND kind = 'pc'`,
		cid, audience).Scan(&known); err != nil {
		return cs.Result{}, err
	}
	if known != len(audience) {
		return cs.Result{}, cs.Fail("characterNotFound")
	}

	reveal := cs.Action{"type": "codex.reveal", "id": id}
	switch {
	case visibility != "gm" && mode == "all": // shown to all already, and never narrowed
	case len(audience) == 0:
		reveal["visibility"], reveal["audienceMode"], reveal["audience"] = "party", "all", []any{}
		if visibility == "public" {
			reveal["visibility"] = "public"
		}
	default:
		readers := slices.Clone(audience)
		if visibility != "gm" {
			rows, err := tx.Query(ctx, `SELECT actor_id::text FROM codex_reveal WHERE entry_id = $1`, id)
			if err != nil {
				return cs.Result{}, err
			}
			current, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return cs.Result{}, err
			}
			for _, r := range current {
				if !slices.Contains(readers, r) {
					readers = append(readers, r)
				}
			}
		} else {
			visibility = "party"
		}
		listed := make([]any, len(readers))
		for i, r := range readers {
			listed[i] = r
		}
		reveal["visibility"], reveal["audienceMode"], reveal["audience"] = visibility, "listed", listed
	}
	if picture && !pictureShown {
		reveal["imageRevealed"] = true // showing holds the picture up too
	}
	if len(reveal) > 2 { // anything to reveal beyond the type and the id
		if refusal := cs.RequirePerm(c, cs.ActionPerms["codex.reveal"], ""); refusal != nil {
			return cs.Result{}, refusal
		}
		if _, err := Reveal(ctx, tx, c, reveal); err != nil {
			return cs.Result{}, err
		}
	}

	if _, err := tx.Exec(ctx, `INSERT INTO spotlight (campaign_id, entry_id, listed, at) VALUES ($1, $2, $3, now())
		ON CONFLICT (campaign_id) DO UPDATE SET entry_id = excluded.entry_id, listed = excluded.listed, at = excluded.at`,
		cid, id, len(audience) > 0); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM spotlight_reader WHERE campaign_id = $1`, cid); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO spotlight_reader (campaign_id, actor_id) SELECT $1, unnest($2::uuid[])`,
		cid, audience); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), nil
}

// ClearSpotlight is spotlight.clear: the card comes down, and what showing revealed stays revealed. None up is no refusal.
func ClearSpotlight(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	_, err := tx.Exec(ctx, `DELETE FROM spotlight WHERE campaign_id = $1`, c.CampaignID)
	return cs.Done(""), err
}

// LoadSpotlight is the room's spotlight with its readers, sorted; nil when none, and nil for a listed one whose readers
// are all gone (their characters deleted), which must never read as one shown to everyone.
func LoadSpotlight(ctx context.Context, conn core.Conn, campaignID string) (*cs.Spotlight, error) {
	var s cs.Spotlight
	var listed bool
	var at time.Time
	err := conn.QueryRow(ctx, `SELECT s.entry_id::text, s.listed, s.at,
			coalesce((SELECT array_agg(r.actor_id::text ORDER BY r.actor_id) FROM spotlight_reader r WHERE r.campaign_id = s.campaign_id), '{}')
		FROM spotlight s WHERE s.campaign_id = $1`, campaignID).Scan(&s.EntryID, &listed, &at, &s.Audience)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && listed && len(s.Audience) == 0) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.At = core.ISOTime(at)
	return &s, nil
}
