package admin

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Table is the part of the table socket this service drives (the gateway has it), so the service imports no socket code.
type Table interface {
	Run(c cs.Ctx, a cs.Action) any
}

// Actions are the housekeeping an admin may run at a room (ADMIN_ACTIONS in packages/core-schema).
var Actions = []string{"member.seat", "member.remove", "campaign.archive", "campaign.unarchive", "campaign.delete", "campaign.transfer"}

// Service holds the admin console's reads and housekeeping, behind the shared `x-admin-key` header.
//
// ponytail: one shared key, move to an admin account once a provider exists.
type Service struct {
	DB    *pgxpool.Pool
	Table Table
}

var takedown = schema.Object(schema.Req("disabled", schema.Bool()))

func badRequest(message string) *core.HTTPError {
	return &core.HTTPError{Status: http.StatusBadRequest, Body: map[string]any{"message": message, "error": "Bad Request", "statusCode": 400}}
}

func notFound(message string) *core.HTTPError {
	return &core.HTTPError{Status: http.StatusNotFound, Body: map[string]any{"message": message, "error": "Not Found", "statusCode": 404}}
}

// guard: no key is 401, a wrong one 403.
func guard(r *http.Request) error {
	key := r.Header.Get("X-Admin-Key")
	if key == "" {
		return core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if !core.IsAdminKey(key) {
		return core.Refuse(http.StatusForbidden, "adminKeyWrong")
	}
	return nil
}

func uuid(value string) (string, bool) {
	id, issues := schema.Parse(schema.UUID(), value)
	if len(issues) > 0 {
		return "", false
	}
	return id.(string), true
}

type campaignRow struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	OwnerUserID    *string `json:"ownerUserId"`
	OwnerName      *string `json:"ownerName"`
	Ruleset        *string `json:"ruleset"`
	RulesetVersion *string `json:"rulesetVersion"`
	LastPlayedAt   *string `json:"lastPlayedAt"`
	Archived       bool    `json:"archived"`
}

// Campaigns is GET /api/admin/campaigns.
//
// ponytail: whole lists, fine for a private deployment; paginate once rooms or users pass a few hundred.
func (s *Service) Campaigns(_ http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT c.id::text, c.name, c.owner_user_id, u.name, ruleset.title, ruleset_version.version,
			(SELECT max(coalesce(s.ended_at, s.started_at)) FROM session s WHERE s.campaign_id = c.id), c.archived_at IS NOT NULL
		FROM campaign c LEFT JOIN app_user u ON u.id = c.owner_user_id
		LEFT JOIN ruleset_version ON ruleset_version.id = c.ruleset_version_id
		LEFT JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id
		ORDER BY c.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []campaignRow{}
	for rows.Next() {
		var c campaignRow
		var played *time.Time
		if err := rows.Scan(&c.ID, &c.Name, &c.OwnerUserID, &c.OwnerName, &c.Ruleset, &c.RulesetVersion, &played, &c.Archived); err != nil {
			return nil, err
		}
		if played != nil {
			iso := core.ISOTime(*played)
			c.LastPlayedAt = &iso
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Action is POST /api/admin/campaigns/{id}/action: one housekeeping action at one room, OPEN AS ADMIN. Refusals come
// back as the ActionResult, like a socket ack.
func (s *Service) Action(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	campaignID, ok := uuid(r.PathValue("id"))
	if !ok {
		return nil, badRequest("Not a campaign id")
	}
	body, err := core.ReadBody(w, r, core.MaxBody)
	if err != nil {
		return nil, err
	}
	action, issues := cs.ParseAction(body)
	if len(issues) > 0 {
		return nil, badRequest(schema.Prettify(issues))
	}
	if !slices.Contains(Actions, action.Type()) {
		return nil, badRequest("Not an admin action")
	}
	if err := LogAdminKey(r.Context(), s.DB, "key.action", campaignID, action.Type()); err != nil {
		return nil, err
	}
	var owner *string
	var mode string
	err = s.DB.QueryRow(r.Context(), `SELECT owner_user_id, table_mode FROM campaign WHERE id = $1`, campaignID).Scan(&owner, &mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("Game not found")
	}
	if err != nil {
		return nil, err
	}
	return s.Table.Run(cs.Ctx{CampaignID: campaignID, CampaignOwnerID: owner, TableMode: mode, Seat: cs.Seat{Kind: cs.SeatAdmin}}, action), nil
}

type packRow struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	OwnerUserID string `json:"ownerUserId"`
	License     string `json:"license"`
	Disabled    bool   `json:"disabled"`
}

// Packs is GET /api/admin/packs: every imported pack, for finding the one a takedown notice names. Metadata only: an
// admin does not read pack content.
func (s *Service) Packs(_ http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT id::text, slug, owner_user_id, license, disabled_at IS NOT NULL FROM pack ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []packRow{}
	for rows.Next() {
		var p packRow
		if err := rows.Scan(&p.ID, &p.Slug, &p.OwnerUserID, &p.License, &p.Disabled); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetPackDisabled is notice-and-takedown (docs/design.md §4.6): a disabled pack is served to nobody and can't be
// attached or re-imported, at once, in every room. Logged with the owner as target. False when there is no such pack.
func SetPackDisabled(ctx context.Context, db *pgxpool.Pool, packID string, disabled bool) (bool, error) {
	found := false
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var slug, owner string
		err := tx.QueryRow(ctx, `UPDATE pack SET disabled_at = CASE WHEN $2 THEN now() END WHERE id = $1
			RETURNING slug, owner_user_id`, packID, disabled).Scan(&slug, &owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		action := "pack.enable"
		if disabled {
			action = "pack.disable"
		}
		_, err = tx.Exec(ctx, `INSERT INTO admin_event (actor_user_id, action, target_user_id, detail) VALUES ($1, $2, $3, $4)`,
			KeyActor, action, owner, slug+" ("+packID+")")
		return err
	})
	return found, err
}

// DisablePack is POST /api/admin/packs/{id}/disable: takes a pack down at once, or puts it back.
func (s *Service) DisablePack(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	packID, idOK := uuid(r.PathValue("id"))
	body, err := core.ReadBody(w, r, core.MaxBody)
	if err != nil {
		return nil, err
	}
	parsed, issues := schema.Parse(takedown, body)
	if !idOK || len(issues) > 0 {
		return nil, badRequest("Not a takedown request")
	}
	found, err := SetPackDisabled(r.Context(), s.DB, packID, parsed.(map[string]any)["disabled"].(bool))
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, notFound("Pack not found")
	}
	return map[string]bool{"ok": true}, nil
}

type eventRow struct {
	ID           string  `json:"id"`
	ActorUserID  string  `json:"actorUserId"`
	Action       string  `json:"action"`
	CampaignID   *string `json:"campaignId"`
	CampaignName *string `json:"campaignName"`
	TargetUserID *string `json:"targetUserId"`
	Detail       string  `json:"detail"`
	CreatedAt    string  `json:"createdAt"`
}

// Events is GET /api/admin/events: the newest 200 rows of the admin log.
func (s *Service) Events(_ http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT id::text, actor_user_id, action, campaign_id::text, campaign_name, target_user_id, detail, created_at
		FROM admin_event ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []eventRow{}
	for rows.Next() {
		var e eventRow
		var at time.Time
		if err := rows.Scan(&e.ID, &e.ActorUserID, &e.Action, &e.CampaignID, &e.CampaignName, &e.TargetUserID, &e.Detail, &at); err != nil {
			return nil, err
		}
		e.CreatedAt = core.ISOTime(at)
		out = append(out, e)
	}
	return out, rows.Err()
}
