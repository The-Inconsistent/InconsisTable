package campaign

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The room's ruleset (apps/api/src/campaign/rules.actions.ts). attachPack and detachPack wait for internal/pack.
//
// ponytail: a room pins its ruleset version once. Moving a room that already has characters to another version needs
// the migration with a dry-run diff (docs/p1-plan.md "Không làm ở P1"); until then it is refused.

// A built character's values belong to the version they were built under.
const builtActor = `campaign_id = $1 AND (ruleset_version_id IS NOT NULL OR entity_type <> '')`

func exists(ctx context.Context, tx core.Conn, sql string, args ...any) (bool, error) {
	var found bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (`+sql+`)`, args...).Scan(&found)
	return found, err
}

// SetRuleset is campaign.setRuleset: only a version the caller imported, since a ruleset is its owner's until sharing
// exists.
func SetRuleset(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, owner := c.CampaignID, ""
	if c.UserID != nil {
		owner = *c.UserID
	}
	var versionID, rulesetID string
	err := tx.QueryRow(ctx, `SELECT v.id::text, v.ruleset_id::text FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
		WHERE v.id = $1 AND r.owner_user_id = $2`, a.Str("rulesetVersionId"), owner).Scan(&versionID, &rulesetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("rulesetNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	same, err := exists(ctx, tx, `SELECT 1 FROM campaign WHERE id = $1 AND ruleset_version_id = $2`, cid, versionID)
	if err != nil || same {
		return cs.Done(""), err
	}
	// Characters carry the version their values were built under; a different one would orphan them.
	used, err := exists(ctx, tx, `SELECT 1 FROM actor WHERE `+builtActor+` AND ruleset_version_id IS DISTINCT FROM $2`, cid, versionID)
	if err != nil {
		return cs.Result{}, err
	}
	if used {
		return cs.Result{}, cs.Fail("charactersUseOtherVersion")
	}
	// Packs are written for one ruleset; keep only ones that fit the new version's.
	other, err := exists(ctx, tx, `SELECT 1 FROM campaign_pack cp JOIN pack_version pv ON pv.id = cp.pack_version_id
		JOIN pack p ON p.id = pv.pack_id WHERE cp.campaign_id = $1 AND p.ruleset_id <> $2`, cid, rulesetID)
	if err != nil {
		return cs.Result{}, err
	}
	if other {
		return cs.Result{}, cs.Fail("detachPacksFirst")
	}
	_, err = tx.Exec(ctx, `UPDATE campaign SET ruleset_version_id = $1 WHERE id = $2`, versionID, cid)
	return cs.Done(""), err
}

// UnpinRuleset is campaign.unpinRuleset. A built character's values belong to the pinned version, so unpinning would
// orphan them; packs are written for the ruleset that is leaving, so they leave with it.
func UnpinRuleset(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	built, err := exists(ctx, tx, `SELECT 1 FROM actor WHERE `+builtActor, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	if built {
		return cs.Result{}, cs.Fail("charactersBuilt")
	}
	for _, statement := range []string{
		`DELETE FROM campaign_pack WHERE campaign_id = $1`,
		`UPDATE campaign SET ruleset_version_id = NULL WHERE id = $1`,
	} {
		if _, err := tx.Exec(ctx, statement, c.CampaignID); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), nil
}
