// Package campaign holds rooms: creating them, the lobby, and the REST routes outside a table.
package campaign

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// adminKeyActor names the admin key in admin_event, which has no user for it.
const adminKeyActor = "admin-key"

// Service holds a room's REST routes.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
	// Mutate runs a REST change to a table in that table's action queue and rebroadcasts it (Gateway.Mutate).
	Mutate func(campaignID string, fn func() error) error
}

type owner struct{ userID, name string }

// Create makes a new room with its creator as owner and GM. A ruleset version can be picked at creation, if the owner
// imported it. owner.name is a placeholder until they next sign in.
func (s *Service) create(ctx context.Context, name string, by *owner, rulesetVersionID *string) (string, error) {
	var campaignID string
	err := core.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		ownerID := ""
		var ownerParam *string
		if by != nil {
			ownerID = by.userID
			ownerParam = &ownerID
			if _, err := tx.Exec(ctx, `INSERT INTO app_user (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, by.userID, by.name); err != nil {
				return err
			}
		}
		if rulesetVersionID != nil {
			var mine string
			err := tx.QueryRow(ctx, `SELECT ruleset_version.id::text FROM ruleset_version
				JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id
				WHERE ruleset_version.id = $1 AND ruleset.owner_user_id = $2`, *rulesetVersionID, ownerID).Scan(&mine)
			if errors.Is(err, pgx.ErrNoRows) {
				return coreschema.Fail("rulesetNotFound")
			}
			if err != nil {
				return err
			}
		}
		err := tx.QueryRow(ctx, `INSERT INTO campaign (name, owner_user_id, ruleset_version_id) VALUES ($1, $2, $3) RETURNING id::text`,
			name, ownerParam, rulesetVersionID).Scan(&campaignID)
		if err != nil {
			return err
		}
		if by != nil {
			_, err = tx.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, campaignID, by.userID)
		}
		return err
	})
	return campaignID, err
}

func optionalString(body map[string]any, key string) *string {
	if s, ok := body[key].(string); ok {
		return &s
	}
	return nil
}

// Create is POST /api/campaigns. Creators start rooms in the lobby, and own them; scripts use the admin key.
func (s *Service) Create(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	if core.IsAdminKey(r.Header.Get("X-Admin-Key")) {
		body, err := core.ParseBody(w, r, coreschema.AdminCreate)
		if err != nil {
			return nil, err
		}
		name := body["name"].(string)
		var by *owner
		if id := optionalString(body, "ownerUserId"); id != nil {
			by = &owner{*id, "GM"}
		}
		id, err := s.create(ctx, name, by, optionalString(body, "rulesetVersionId"))
		if err != nil {
			return nil, err
		}
		_, err = s.DB.Exec(ctx, `INSERT INTO admin_event (actor_user_id, action, campaign_id, detail) VALUES ($1, 'campaign.create', $2, $3)`,
			adminKeyActor, id, name)
		if err != nil {
			return nil, err
		}
		return core.Created{Body: map[string]string{"campaignId": id}}, nil
	}
	user, err := s.Auth.DeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if !user.Creator {
		return nil, core.Refuse(http.StatusForbidden, "creatorsOnly")
	}
	body, err := core.ParseBody(w, r, coreschema.CreateGame)
	if err != nil {
		return nil, err
	}
	id, err := s.create(ctx, body["name"].(string), &owner{user.UserID, user.Name}, optionalString(body, "rulesetVersionId"))
	if err != nil {
		return nil, err
	}
	return core.Created{Body: map[string]string{"campaignId": id}}, nil
}

// LobbyGame is one room in the lobby.
type LobbyGame struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Owner         string  `json:"owner"`
	Players       int     `json:"players"`
	Session       *int    `json:"session"`
	Role          *string `json:"role"`
	IsOwner       bool    `json:"isOwner"`
	NextSessionAt *string `json:"nextSessionAt"`
}

// LobbyCharacter is a character a seat of the caller holds, in any of their rooms.
type LobbyCharacter struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	CampaignID   string `json:"campaignId"`
	CampaignName string `json:"campaignName"`
}

// Lobby is what GET /api/lobby answers.
type Lobby struct {
	CanCreate  bool             `json:"canCreate"`
	Name       string           `json:"name"`
	Mine       []LobbyGame      `json:"mine"`
	Seated     []LobbyGame      `json:"seated"`
	Archived   []LobbyGame      `json:"archived"`
	Characters []LobbyCharacter `json:"characters"`
}

// One query, since the TypeScript's five only ever joined the same rows in memory.
const lobbyGames = `
SELECT c.id::text, c.name, coalesce(o.name, '—'),
	(SELECT count(*) FROM actor a WHERE a.campaign_id = c.id AND a.kind = 'pc')::int,
	(SELECT s.number FROM session s WHERE s.campaign_id = c.id AND s.ended_at IS NULL LIMIT 1),
	m.role, c.owner_user_id IS NOT DISTINCT FROM m.user_id, c.next_session_at, c.archived_at IS NOT NULL
FROM membership m
JOIN campaign c ON c.id = m.campaign_id
LEFT JOIN app_user o ON o.id = c.owner_user_id
WHERE m.user_id = $1`

const lobbyCharacters = `
SELECT a.id::text, a.kind, a.name, a.status, a.campaign_id::text, c.name
FROM membership_character mc
JOIN membership m ON m.id = mc.membership_id
JOIN actor a ON a.id = mc.actor_id
JOIN campaign c ON c.id = a.campaign_id
WHERE m.user_id = $1
ORDER BY a.name ASC`

// Lobby is GET /api/lobby: the rooms the caller owns, the ones where they hold another seat, the archived ones, and the
// characters their seats hold.
func (s *Service) Lobby(_ http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.DeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	out := Lobby{user.Creator, user.Name, []LobbyGame{}, []LobbyGame{}, []LobbyGame{}, []LobbyCharacter{}}
	rows, err := s.DB.Query(ctx, lobbyGames, user.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var g LobbyGame
		var next *time.Time
		var archived bool
		if err := rows.Scan(&g.ID, &g.Name, &g.Owner, &g.Players, &g.Session, &g.Role, &g.IsOwner, &next, &archived); err != nil {
			return nil, err
		}
		if next != nil {
			iso := core.ISOTime(*next)
			g.NextSessionAt = &iso
		}
		switch {
		case archived:
			out.Archived = append(out.Archived, g)
		case g.IsOwner:
			out.Mine = append(out.Mine, g)
		default:
			out.Seated = append(out.Seated, g)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	characters, err := s.DB.Query(ctx, lobbyCharacters, user.UserID)
	if err != nil {
		return nil, err
	}
	collected, err := pgx.CollectRows(characters, func(row pgx.CollectableRow) (LobbyCharacter, error) {
		var c LobbyCharacter
		return c, row.Scan(&c.ID, &c.Kind, &c.Name, &c.Status, &c.CampaignID, &c.CampaignName)
	})
	if err != nil {
		return nil, err
	}
	if collected != nil {
		out.Characters = collected
	}
	return out, nil
}

// Rename is PATCH /api/me: the name this device's user goes by at every table.
func (s *Service) Rename(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.DeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	body, err := core.ParseBody(w, r, coreschema.Rename)
	if err != nil {
		return nil, err
	}
	name := body["name"].(string)
	if err := s.Auth.RenameUser(ctx, user.UserID, name); err != nil {
		return nil, err
	}
	return map[string]string{"name": name}, nil
}

// Me is GET /api/campaigns/{id}/me: who the caller is at this table.
func (s *Service) Me(_ http.ResponseWriter, r *http.Request) (any, error) {
	id, err := core.Parse(coreschema.CampaignID, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), id.(string), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	return resolved.Ctx, nil
}

// A year-long httpOnly cookie holding a guest's player token.
func setGuestCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.GuestCookie,
		Value:    token,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   core.CookieSecure(),
		MaxAge:   365 * 24 * 3600,
		Path:     "/",
	})
}

// Join is POST /api/join: a guest's QR, whose token becomes the guest cookie.
func (s *Service) Join(w http.ResponseWriter, r *http.Request) (any, error) {
	body, err := core.ParseBody(w, r, coreschema.Join)
	if err != nil {
		return nil, err
	}
	token := body["token"].(string)
	c, err := s.Auth.ResolveGuest(r.Context(), token)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "linkInvalid")
	}
	setGuestCookie(w, token)
	return c, nil
}

// Guest is GET /api/guest: the guest cookie's table, so a returning guest lands back at it.
func (s *Service) Guest(_ http.ResponseWriter, r *http.Request) (any, error) {
	token, _ := auth.ReadCookie(core.CookieHeader(r), auth.GuestCookie)
	c, err := s.Auth.ResolveGuest(r.Context(), token)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	return c, nil
}
