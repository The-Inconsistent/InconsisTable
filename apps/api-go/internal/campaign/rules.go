package campaign

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// The room's ruleset and packs (apps/api/src/campaign/rules.actions.ts).
//
// ponytail: only a version every stored value still fits; a version that renames or removes something in play needs the declared migrations of design §4.5.

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
	// The room keeps how it sits, so the new game has to be played that way.
	modes, err := RulesetModes(ctx, tx, versionID)
	if err != nil {
		return cs.Result{}, err
	}
	if !slices.Contains(modes, c.Mode()) {
		return cs.Result{}, cs.Fail("modeNotPlayed")
	}
	// Characters carry the version their values were built under; a different one would orphan them.
	used, err := exists(ctx, tx, `SELECT 1 FROM actor WHERE `+builtActor+` AND ruleset_version_id IS DISTINCT FROM $2`, cid, versionID)
	if err != nil {
		return cs.Result{}, err
	}
	if used {
		if err := checkUpgrade(ctx, tx, cid, rulesetID, versionID); err != nil {
			return cs.Result{}, err
		}
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
	if _, err = tx.Exec(ctx, `UPDATE campaign SET ruleset_version_id = $1 WHERE id = $2`, versionID, cid); err != nil {
		return cs.Result{}, err
	}
	if used {
		// Every stored value fits (checkUpgrade), so the characters just follow the room.
		if _, err := tx.Exec(ctx, `UPDATE actor SET ruleset_version_id = $1 WHERE campaign_id = $2 AND ruleset_version_id IS NOT NULL`,
			versionID, cid); err != nil {
			return cs.Result{}, err
		}
		// A draft written under another version is never read again (actor.LoadDrafts filters by the pinned version).
		if _, err := tx.Exec(ctx, `DELETE FROM builder_draft WHERE campaign_id = $1`, cid); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), nil
}

// checkUpgrade is the compatible upgrade (house decision #51): characters already built under the room's version move
// to another version of the same ruleset when nothing stored would have to change.
func checkUpgrade(ctx context.Context, tx core.Conn, cid, rulesetID, versionID string) error {
	var pinned *string
	if err := tx.QueryRow(ctx, `SELECT v.ruleset_id::text FROM campaign c LEFT JOIN ruleset_version v ON v.id = c.ruleset_version_id
		WHERE c.id = $1`, cid).Scan(&pinned); err != nil {
		return err
	}
	if pinned == nil || *pinned != rulesetID {
		return cs.Fail("charactersUseOtherVersion")
	}
	running, err := exists(ctx, tx, `SELECT 1 FROM session WHERE campaign_id = $1 AND ended_at IS NULL`, cid)
	if err != nil {
		return err
	}
	if running {
		return cs.Fail("changeBetweenSessions")
	}
	open, err := exists(ctx, tx, `SELECT 1 FROM encounter WHERE campaign_id = $1 AND active`, cid)
	if err != nil {
		return err
	}
	if open {
		return cs.Fail("endEncounterFirst")
	}
	old, err := compiled.Load(ctx, tx, cid)
	if err != nil || old == nil {
		return err
	}
	next, err := compiled.LoadVersion(ctx, tx, versionID)
	if err != nil || next == nil {
		return err
	}
	rows, err := actor.LoadRows(ctx, tx, cid)
	if err != nil {
		return err
	}
	problems := actor.Incompatible(old, next, rows)
	more, err := tableProblems(ctx, tx, cid, old, next)
	if err != nil {
		return err
	}
	problems = append(problems, more...)
	if len(problems) == 0 {
		return nil
	}
	slices.Sort(problems)
	detail := strings.Join(problems[:min(5, len(problems))], "; ")
	if len(problems) > 5 {
		detail += fmt.Sprintf("; and %d more", len(problems)-5)
	}
	return cs.Fail("versionNotCompatible", cs.Params{"detail": detail})
}

// tableProblems are the lines for what the room holds apart from its actors' values: creation choices, pools and open
// Test calls.
func tableProblems(ctx context.Context, tx core.Conn, cid string, old, next *engine.CompiledRuleset) ([]string, error) {
	var out []string
	hasStep := func(c *engine.CompiledRuleset, id string) bool {
		return slices.ContainsFunc(c.Ruleset.Creation, func(s engine.CreationStep) bool { return s.ID == id })
	}
	each := func(sql string, fn func(a, b string)) error {
		rows, err := tx.Query(ctx, sql, cid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a, b string
			if err := rows.Scan(&a, &b); err != nil {
				return err
			}
			fn(a, b)
		}
		return rows.Err()
	}
	if err := each(`SELECT DISTINCT a.name, c.step_id FROM actor_choice c JOIN actor a ON a.id = c.actor_id
		WHERE a.campaign_id = $1`, func(name, step string) {
		if hasStep(old, step) && !hasStep(next, step) {
			out = append(out, fmt.Sprintf(`%s: creation step "%s" is gone`, name, step))
		}
	}); err != nil {
		return nil, err
	}
	if err := each(`SELECT scope, resource_id FROM resource_pool WHERE campaign_id = $1`, func(scope, id string) {
		if o, n := old.Resources[id], next.Resources[id]; o != nil && (n == nil || n.Def.Scope != scope) {
			out = append(out, fmt.Sprintf(`table: pool "%s" is gone`, id))
		}
	}); err != nil {
		return nil, err
	}
	err := each(`SELECT DISTINCT test_id, '' FROM test_call WHERE campaign_id = $1 AND status = 'open'`, func(id, _ string) {
		if next.Tests[id] == nil {
			out = append(out, fmt.Sprintf(`table: an open Test call uses "%s"`, id))
		}
	})
	return out, err
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

// AttachPack is campaign.attachPack: one of the caller's own pack versions, for this room's ruleset. A pack that is
// someone else's reads as missing.
func AttachPack(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, owner, versionID := c.CampaignID, "", a.Str("packVersionId")
	if c.UserID != nil {
		owner = *c.UserID
	}
	var packID, rulesetID, license string
	var disabled, hidden bool
	err := tx.QueryRow(ctx, `SELECT p.id::text, p.ruleset_id::text, p.license, p.disabled_at IS NOT NULL, p.hidden_at IS NOT NULL
		FROM pack_version v JOIN pack p ON p.id = v.pack_id WHERE v.id = $1 AND p.owner_user_id = $2`, versionID, owner).
		Scan(&packID, &rulesetID, &license, &disabled, &hidden)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return cs.Result{}, cs.Fail("packNotFound")
	case err != nil:
		return cs.Result{}, err
	case disabled:
		return cs.Result{}, cs.Fail("packTakenDown")
	case hidden:
		return cs.Result{}, cs.Fail("packDeleted")
	case license == "private" && !view.RunsAsGm(c) && !(!c.HasGM() && view.IsOwner(c)):
		// A `private` pack (copied from a book) never leaves the rooms its owner runs: as GM, or, in a room without a GM,
		// as the owner, who counts as the one running it (CLAUDE.md, principle 4; docs/adr/0009-table-modes.md).
		return cs.Result{}, cs.Fail("privatePackGmOnly")
	}
	var roomRuleset string
	err = tx.QueryRow(ctx, `SELECT v.ruleset_id::text FROM campaign JOIN ruleset_version v ON v.id = campaign.ruleset_version_id
		WHERE campaign.id = $1`, cid).Scan(&roomRuleset)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("pickRulesetFirst")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if roomRuleset != rulesetID {
		return cs.Result{}, cs.Fail("packWrongRuleset")
	}
	// One version of a pack at a time: attaching a newer one replaces the older.
	if _, err := tx.Exec(ctx, `DELETE FROM campaign_pack WHERE campaign_id = $1 AND pack_version_id IN (
		SELECT id FROM pack_version WHERE pack_id = $2 AND id <> $3)`, cid, packID, versionID); err != nil {
		return cs.Result{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		cid, versionID)
	return cs.Done(""), err
}

// DetachPack is campaign.detachPack, scoped to this room's own rows, so another room's pin is never touched by an id
// from the client.
func DetachPack(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	gone, err := tx.Exec(ctx, `DELETE FROM campaign_pack WHERE campaign_id = $1 AND pack_version_id = $2`,
		c.CampaignID, a.Str("packVersionId"))
	if err != nil {
		return cs.Result{}, err
	}
	if gone.RowsAffected() == 0 {
		return cs.Result{}, cs.Fail("packNotAttached")
	}
	return cs.Done(""), nil
}
