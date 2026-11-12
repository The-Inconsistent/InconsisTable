package campaign

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/request"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The room's actions (apps/api/src/campaign/campaign.actions.ts). Starting and ending a session apply the ruleset's
// resetOn: sessionStart / sessionEnd to every actor.

// A partial UPDATE of only the columns sent: (column, key) pairs read from the action, in this order.
func patch(ctx context.Context, tx core.Conn, table, where string, whereArgs []any, a cs.Action, columns [][2]string,
	value func(key string, v any) any) (int64, bool, error) {
	sets, args := []string{}, append([]any{}, whereArgs...)
	for _, col := range columns {
		v, sent := a[col[1]]
		if !sent {
			continue
		}
		if value != nil {
			v = value(col[1], v)
		}
		args = append(args, v)
		sets = append(sets, col[0]+" = $"+strconv.Itoa(len(args)))
	}
	if len(sets) == 0 {
		return 0, false, nil
	}
	tag, err := tx.Exec(ctx, `UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE `+where, args...)
	return tag.RowsAffected(), true, err
}

// Update is campaign.update: only the fields sent are written.
func Update(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	_, _, err := patch(ctx, tx, "campaign", "id = $1", []any{c.CampaignID}, a,
		[][2]string{{"name", "name"}, {"next_session_at", "nextSessionAt"}, {"next_session_place", "nextSessionPlace"}},
		func(key string, v any) any {
			if text, isText := v.(string); key == "nextSessionAt" && isText {
				at, err := time.Parse(time.RFC3339Nano, text)
				if err != nil {
					return text // the schema checked it; Postgres reads every ISO datetime it lets through
				}
				return at
			}
			return v
		})
	return cs.Done(""), err
}

// Archive is campaign.archive: read-only until unarchived. The running session ends, open invites and a pending
// transfer stop working.
func Archive(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	for _, statement := range []string{
		`UPDATE session SET ended_at = now() WHERE campaign_id = $1 AND ended_at IS NULL`,
		`UPDATE invite SET revoked_at = now() WHERE campaign_id = $1 AND revoked_at IS NULL`,
		`DELETE FROM ownership_transfer WHERE campaign_id = $1`,
		`UPDATE campaign SET archived_at = now() WHERE id = $1`,
	} {
		if _, err := tx.Exec(ctx, statement, c.CampaignID); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), request.CancelPending(ctx, tx, c.CampaignID)
}

// Unarchive is campaign.unarchive.
func Unarchive(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	_, err := tx.Exec(ctx, `UPDATE campaign SET archived_at = NULL WHERE id = $1`, c.CampaignID)
	return cs.Done(""), err
}

// Delete is campaign.delete, kept from Auspex (#178): only an archived game, and only after typing its name.
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	var name string
	var archived bool
	err := tx.QueryRow(ctx, `SELECT name, archived_at IS NOT NULL FROM campaign WHERE id = $1`, c.CampaignID).Scan(&name, &archived)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, err
	}
	if !archived {
		return cs.Result{}, cs.Fail("archiveFirst")
	}
	if schema.TrimJS(a.Str("name")) != name {
		return cs.Result{}, cs.Fail("typeNameToDelete")
	}
	_, err = tx.Exec(ctx, `DELETE FROM campaign WHERE id = $1`, c.CampaignID) // everything it owns cascades
	return cs.Done(""), err
}

// SessionStart is session.start. The ruleset's sessionStart resets are logged in the session just opened.
func SessionStart(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	var running bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM session WHERE campaign_id = $1 AND ended_at IS NULL)`, cid).
		Scan(&running); err != nil {
		return cs.Result{}, err
	}
	if running {
		return cs.Result{}, cs.Fail("sessionRunning")
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO session (campaign_id, number, title)
		VALUES ($1, coalesce((SELECT max(number) FROM session WHERE campaign_id = $1), 0) + 1, $2) RETURNING id::text`,
		cid, a.Str("title")).Scan(&id); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE campaign SET next_session_at = NULL WHERE id = $1`, cid); err != nil {
		return cs.Result{}, err
	}
	if _, _, err := ruleset.RestActors(ctx, tx, c, "sessionStart", ""); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(id), nil
}

// SessionEnd is session.end. The sessionEnd resets run before the session ends, so they are logged in it; with no
// session running the refusal rolls them back.
func SessionEnd(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if _, _, err := ruleset.RestActors(ctx, tx, c, "sessionEnd", ""); err != nil {
		return cs.Result{}, err
	}
	tag, err := tx.Exec(ctx, `UPDATE session SET ended_at = now(), recap = $2 WHERE campaign_id = $1 AND ended_at IS NULL`,
		c.CampaignID, a.Str("recap"))
	if err != nil {
		return cs.Result{}, err
	}
	if tag.RowsAffected() == 0 {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	return cs.Done(""), request.CancelPending(ctx, tx, c.CampaignID)
}

// SessionEdit is session.edit: a session's title, recap or notes, only those sent.
func SessionEdit(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	found, wrote, err := patch(ctx, tx, "session", "id = $1 AND campaign_id = $2", []any{a.Str("sessionId"), c.CampaignID}, a,
		[][2]string{{"title", "title"}, {"recap", "recap"}, {"notes", "notes"}}, nil)
	if err != nil {
		return cs.Result{}, err
	}
	if !wrote {
		// Nothing to write: the session must still be this room's.
		err := tx.QueryRow(ctx, `SELECT 1 FROM session WHERE id = $1 AND campaign_id = $2`, a.Str("sessionId"), c.CampaignID).Scan(new(int))
		if errors.Is(err, pgx.ErrNoRows) {
			return cs.Result{}, cs.Fail("sessionNotFound")
		}
		return cs.Done(""), err
	}
	if found == 0 {
		return cs.Result{}, cs.Fail("sessionNotFound")
	}
	return cs.Done(""), nil
}
