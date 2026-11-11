package codex

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The codex actions (apps/api/src/codex/codex.actions.ts).

func ownEntry(ctx context.Context, tx core.Conn, campaignID, id string) error {
	err := tx.QueryRow(ctx, `SELECT 1 FROM codex_entry WHERE id = $1 AND campaign_id = $2`, id, campaignID).Scan(new(int))
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Fail("entryNotFound")
	}
	return err
}

// Save is codex.save, a patch: only the fields sent are written. GM notes need the secrets scope too, so a co-GM who
// was never shown them can't blank or overwrite them (docs/design.md §3.6).
func Save(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	if _, sent := a["gmNotes"]; sent && !cs.CanInCampaign(c, "codex:read_secret", "") {
		return cs.Result{}, cs.Fail("needSecretsScope")
	}
	text := func(key string) *string {
		if s, sent := a[key].(string); sent {
			return &s
		}
		return nil
	}
	title, body, notes := text("title"), text("body"), text("gmNotes")
	id, existing := a["id"].(string)
	if !existing {
		if title == nil {
			return cs.Result{}, cs.Fail("giveTitle")
		}
		err := tx.QueryRow(ctx, `INSERT INTO codex_entry (campaign_id, kind, title, body, gm_notes)
			VALUES ($1, $2, $3, coalesce($4, ''), coalesce($5, '')) RETURNING id::text`,
			cid, a.Str("kind"), *title, body, notes).Scan(&id)
		return cs.Done(id), err
	}
	if err := ownEntry(ctx, tx, cid, id); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE codex_entry SET title = coalesce($2, title), body = coalesce($3, body),
		gm_notes = coalesce($4, gm_notes) WHERE id = $1`, id, title, body, notes)
	return cs.Done(id), err
}

// Reveal is codex.reveal: who reads an entry. Only this campaign's characters can be listed readers, and a reader
// listed twice is one row.
func Reveal(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	if err := ownEntry(ctx, tx, cid, id); err != nil {
		return cs.Result{}, err
	}
	listed := a.Str("audienceMode") == "listed"
	audience := []string{}
	given, _ := a["audience"].([]any)
	for _, v := range given {
		if s, ok := v.(string); ok && !slices.Contains(audience, s) {
			audience = append(audience, s)
		}
	}
	if listed && a.Str("visibility") != "gm" && len(audience) == 0 {
		return cs.Result{}, cs.Fail("pickAudience")
	}
	if listed {
		var known int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[])`, cid, audience).
			Scan(&known); err != nil {
			return cs.Result{}, err
		}
		if known != len(audience) {
			return cs.Result{}, cs.Fail("characterNotFound")
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET visibility = $2, audience_mode = $3 WHERE id = $1`,
		id, a.Str("visibility"), a.Str("audienceMode")); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM codex_reveal WHERE entry_id = $1`, id); err != nil {
		return cs.Result{}, err
	}
	if listed && len(audience) > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO codex_reveal (entry_id, actor_id) SELECT $1, unnest($2::uuid[])`, id, audience); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), nil
}

// Delete is codex.delete.
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("id")
	if err := ownEntry(ctx, tx, c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `DELETE FROM codex_entry WHERE id = $1`, id)
	return cs.Done(""), err
}
