package campaign

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// How a room sits (docs/adr/0009-table-modes.md): with a GM, without one, or one player alone. The ruleset says which
// the game is played; the owner picks one at creation and changes it between sessions.

// RulesetModes are the table modes a ruleset version allows: its `game` block's, or only gm when it has none.
func RulesetModes(ctx context.Context, conn core.Conn, rulesetVersionID string) ([]string, error) {
	var raw []byte
	err := conn.QueryRow(ctx, `SELECT coalesce(manifest->'game'->'modes', '["gm"]'::jsonb) FROM ruleset_version WHERE id = $1`,
		rulesetVersionID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return []string{"gm"}, nil
	}
	if err != nil {
		return nil, err
	}
	var modes []string
	return modes, json.Unmarshal(raw, &modes)
}

// roomModes are the modes the room's pinned ruleset allows; a room with none yet is played with a GM.
func roomModes(ctx context.Context, conn core.Conn, campaignID string) ([]string, error) {
	var versionID *string
	if err := conn.QueryRow(ctx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, campaignID).Scan(&versionID); err != nil {
		return nil, err
	}
	if versionID == nil {
		return []string{"gm"}, nil
	}
	return RulesetModes(ctx, conn, *versionID)
}

// SetTableMode is campaign.setTableMode: owner only, between sessions, to a mode the ruleset allows. Without a GM there
// are only player seats, so every GM and co-GM becomes a player (the owner stays the owner); back with a GM, the owner
// takes the GM seat again. The sockets are kicked after the commit (KicksOf), so every seat resolves again.
func SetTableMode(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, mode := c.CampaignID, a.Str("mode")
	if mode == c.Mode() {
		return cs.Done(""), nil
	}
	running, err := exists(ctx, tx, `SELECT 1 FROM session WHERE campaign_id = $1 AND ended_at IS NULL`, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if running {
		return cs.Result{}, cs.Fail("changeBetweenSessions")
	}
	allowed, err := roomModes(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if !slices.Contains(allowed, mode) {
		return cs.Result{}, cs.Fail("modeNotPlayed")
	}
	if mode == cs.TableModeSolo {
		seats, err := auth.PlayerSeats(ctx, tx, cid)
		if err != nil {
			return cs.Result{}, err
		}
		if seats > 1 {
			return cs.Result{}, cs.Fail("soloOneSeat")
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE campaign SET table_mode = $2 WHERE id = $1`, cid, mode); err != nil {
		return cs.Result{}, err
	}
	if mode == cs.TableModeGM {
		_, err = tx.Exec(ctx, `UPDATE membership SET role = 'gm', scopes = '{}'
			WHERE campaign_id = $1 AND user_id = (SELECT owner_user_id FROM campaign WHERE id = $1)`, cid)
		return cs.Done(""), err
	}
	for _, statement := range []string{
		`UPDATE membership SET role = 'player', scopes = '{}' WHERE campaign_id = $1 AND role <> 'player'`,
		// An invite to a GM seat no longer has a seat to give.
		`UPDATE invite SET revoked_at = now() WHERE campaign_id = $1 AND revoked_at IS NULL AND role <> 'player'`,
	} {
		if _, err := tx.Exec(ctx, statement, cid); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), nil
}
