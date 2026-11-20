package codex

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Beginning a scene (house decision #86; Auspex codex.actions.ts beat.begin, apps/web/lib/scene-reveal/scene-reveal.ts):
// the one tap the GM's prepared reveals ride on, recorded in scene_begin so it can be taken back.

// Begin is scene.begin: the scene being played goes to done, this one becomes active, then each of its prepared reveal
// lines is sent as the codex.reveal a tap on it sends. A line that is refused (its entry gone, no codex:reveal) is
// skipped and named in the answer; it does not fail the begin. The answer's id is the begin's.
func Begin(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, sceneID := c.CampaignID, a.Str("sceneId")
	var kind, title, status string
	var prep []byte
	err := tx.QueryRow(ctx, `SELECT kind, title, coalesce(status, ''), prep FROM codex_entry WHERE id = $1 AND campaign_id = $2`,
		sceneID, cid).Scan(&kind, &title, &status, &prep)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("entryNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if kind != "scene" {
		return cs.Result{}, cs.Fail("notAScene")
	}
	var before *string
	err = tx.QueryRow(ctx, `UPDATE codex_entry SET status = 'done'
		WHERE campaign_id = $1 AND kind = 'scene' AND status = 'active' AND id <> $2 RETURNING id::text`, cid, sceneID).Scan(&before)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET status = 'active' WHERE id = $1`, sceneID); err != nil {
		return cs.Result{}, err
	}

	var lines struct {
		Reveals []struct {
			ID      string `json:"id"`
			Label   string `json:"label"`
			EntryID string `json:"entryId"`
		} `json:"reveals"`
	}
	if prep != nil {
		if err := json.Unmarshal(prep, &lines); err != nil {
			return cs.Result{}, err
		}
	}
	sent, revealed := 0, []string{}
	for _, line := range lines.Reveals {
		var sealed bool
		err := tx.QueryRow(ctx, `SELECT visibility = 'gm' FROM codex_entry WHERE id = $1 AND campaign_id = $2`, line.EntryID, cid).
			Scan(&sealed)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return cs.Result{}, err
		}
		reveal := cs.Action{"type": "codex.reveal", "id": line.EntryID, "visibility": "party", "audienceMode": "all",
			"audience": []any{}}
		refusal := cs.RequirePerm(c, cs.ActionPerms["codex.reveal"], "")
		if refusal == nil {
			_, err = Reveal(ctx, tx, c, reveal)
			if !errors.As(err, &refusal) && err != nil {
				return cs.Result{}, err
			}
		}
		if refusal != nil {
			name := line.Label
			if name == "" {
				name = line.ID
			}
			cs.Notify(ctx, cs.RevealSkipped(name, refusal.Code))
			continue
		}
		sent++
		if sealed {
			revealed = append(revealed, line.EntryID)
		}
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO scene_begin (campaign_id, scene_id, before_id, scene_status, revealed)
		VALUES ($1, $2, $3, $4, $5::uuid[]) RETURNING id::text`, cid, sceneID, before, status, revealed).Scan(&id); err != nil {
		return cs.Result{}, err
	}
	cs.Notify(ctx, cs.SceneBegun(title, sent))
	return cs.Done(id), nil
}

// UndoBegin is scene.undoBegin: only the room's latest begin, and only while its scene is still the one being played.
// The begun scene goes back to the status it had, the scene it replaced is active again (none, if there was none or it
// is gone), and the entries the begin itself revealed are sealed again; one revealed before it stays revealed.
func UndoBegin(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	var id, sceneID, status, sceneNow string
	var before *string
	var revealed []string
	err := tx.QueryRow(ctx, `SELECT b.id::text, b.scene_id::text, b.before_id::text, b.scene_status, b.revealed::text[],
			coalesce(e.status, '')
		FROM scene_begin b JOIN codex_entry e ON e.id = b.scene_id
		WHERE b.campaign_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1`, cid).
		Scan(&id, &sceneID, &before, &status, &revealed, &sceneNow)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, err
	}
	if id == "" || id != a.Str("beginId") {
		return cs.Result{}, cs.Fail("notLatestBegin")
	}
	if sceneNow != "active" {
		return cs.Result{}, cs.Fail("sceneNotActive")
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET status = $2 WHERE id = $1`, sceneID, status); err != nil {
		return cs.Result{}, err
	}
	if before != nil {
		if _, err := tx.Exec(ctx, `UPDATE codex_entry SET status = 'active' WHERE id = $1`, *before); err != nil {
			return cs.Result{}, err
		}
	}
	// Sealed again as a codex.reveal to the GM leaves an entry: no readers, no time. An entry deleted since is not there.
	rows, err := tx.Query(ctx, `UPDATE codex_entry SET visibility = 'gm', audience_mode = 'all', revealed_at = NULL
		WHERE campaign_id = $1 AND id = ANY($2::uuid[]) RETURNING id::text`, cid, revealed)
	if err != nil {
		return cs.Result{}, err
	}
	sealed, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM codex_reveal WHERE entry_id = ANY($1::uuid[])`, sealed); err != nil {
		return cs.Result{}, err
	}
	for _, entry := range sealed {
		if err := eventlog.LogEvent(ctx, tx, c, "codex.reveal",
			map[string]any{"entryId": entry, "visibility": "gm", "audienceMode": "all"}); err != nil {
			return cs.Result{}, err
		}
	}
	_, err = tx.Exec(ctx, `DELETE FROM scene_begin WHERE id = $1`, id)
	return cs.Done(""), err
}
