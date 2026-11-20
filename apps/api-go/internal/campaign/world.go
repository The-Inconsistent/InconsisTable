package campaign

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// SetWorld is campaign.setWorld (house decision #65): one of the caller's own World versions, neither hidden nor taken
// down, in a room the caller runs, the rule a private pack follows (principle 4). A World is independent of the ruleset
// (design D4), so nothing is checked against the ruleset, the characters or the packs, and it may change mid-session.
// Someone else's World reads as missing.
func SetWorld(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	owner, versionID := "", a.Str("worldVersionId")
	if c.UserID != nil {
		owner = *c.UserID
	}
	var disabled, hidden bool
	err := tx.QueryRow(ctx, `SELECT w.disabled_at IS NOT NULL, w.hidden_at IS NOT NULL FROM world_version v
		JOIN world w ON w.id = v.world_id WHERE v.id = $1 AND w.owner_user_id = $2`, versionID, owner).Scan(&disabled, &hidden)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return cs.Result{}, cs.Fail("worldNotFound")
	case err != nil:
		return cs.Result{}, err
	case disabled:
		return cs.Result{}, cs.Fail("worldTakenDown")
	case hidden:
		return cs.Result{}, cs.Fail("worldDeleted")
	case !view.RunsAsGm(c) && !(!c.HasGM() && view.IsOwner(c)):
		return cs.Result{}, cs.Fail("worldRunnersOnly")
	}
	_, err = tx.Exec(ctx, `UPDATE campaign SET world_version_id = $1 WHERE id = $2`, versionID, c.CampaignID)
	return cs.Done(""), err
}

// UnsetWorld is campaign.unsetWorld: the room goes back to each device's base Theme. A room without a World is left as
// it is.
func UnsetWorld(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	_, err := tx.Exec(ctx, `UPDATE campaign SET world_version_id = NULL WHERE id = $1`, c.CampaignID)
	return cs.Done(""), err
}
