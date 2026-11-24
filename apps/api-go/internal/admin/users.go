package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The users of the console (house decision #94, kept from Auspex admin.controller.ts): who they are, the platform role,
// an account or an anonymous device, and every seat. Nothing personal beyond the display name: no email, no device secret.

// UsersCap is how many users the list carries, the most recently seen first, as the admin log carries its newest 200.
//
// ponytail: a capped list, fine for a private deployment; page it once a deployment's devices pass a few thousand.
const UsersCap = 200

// UserSeat is one seat of a user: the room, the seat's role, whether they own the room, the characters it holds.
type UserSeat struct {
	CampaignID   string   `json:"campaignId"`
	CampaignName string   `json:"campaignName"`
	Role         string   `json:"role"`
	Owner        bool     `json:"owner"`
	Characters   []string `json:"characters"`
}

// UserRow is one user of the console's list.
type UserRow struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Role       string     `json:"role"`
	Account    bool       `json:"account"`
	LastSeenAt string     `json:"lastSeenAt"`
	Seats      []UserSeat `json:"seats"`
}

// Users is GET /api/admin/users: the most recently seen users, each with their seats (room by name, the seat's role,
// whether they own the room, the characters the seat holds by name).
func (s *Service) Users(_ http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	return ListUsers(r.Context(), s.DB)
}

// ListUsers is the users list, logged as user.list.
func ListUsers(ctx context.Context, conn core.Conn) ([]UserRow, error) {
	if err := LogAdminKey(ctx, conn, "user.list", "", ""); err != nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, `SELECT u.id, u.name, u.role, EXISTS (SELECT 1 FROM identity_link l WHERE l.user_id = u.id), u.last_seen_at,
			coalesce((SELECT json_agg(json_build_object(
					'campaignId', c.id, 'campaignName', c.name, 'role', m.role, 'owner', c.owner_user_id = u.id,
					'characters', coalesce((SELECT json_agg(a.name ORDER BY a.name) FROM membership_character mc
						JOIN actor a ON a.id = mc.actor_id WHERE mc.membership_id = m.id), '[]'::json))
				ORDER BY c.name, c.id)
				FROM membership m JOIN campaign c ON c.id = m.campaign_id WHERE m.user_id = u.id), '[]'::json)
		FROM app_user u ORDER BY u.last_seen_at DESC, u.id LIMIT $1`, UsersCap)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserRow{}
	for rows.Next() {
		var u UserRow
		var seen time.Time
		var seats []byte
		if err := rows.Scan(&u.ID, &u.Name, &u.Role, &u.Account, &seen, &seats); err != nil {
			return nil, err
		}
		u.LastSeenAt = core.ISOTime(seen)
		if err := json.Unmarshal(seats, &u.Seats); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SeatRef names a room a user sat in.
type SeatRef struct {
	CampaignID   string `json:"campaignId"`
	CampaignName string `json:"campaignName"`
}

// KeptSeat is a room the user still sits in, with the refusal that kept them.
type KeptSeat struct {
	SeatRef
	Code string `json:"code"`
}

// Unseated is what DELETE /api/admin/users/:id/seats answers: the rooms the user left, and the rooms they stay in with
// the refusal that kept them there.
type Unseated struct {
	Removed []SeatRef  `json:"removed"`
	Kept    []KeptSeat `json:"kept"`
}

var userID = schema.String().Min(1).Max(100)

// RemoveSeats is DELETE /api/admin/users/:id/seats, Auspex's REMOVE FROM ALL GAMES.
func (s *Service) RemoveSeats(_ http.ResponseWriter, r *http.Request) (any, error) {
	if err := guard(r); err != nil {
		return nil, err
	}
	parsed, issues := schema.Parse(userID, r.PathValue("id"))
	if len(issues) > 0 {
		return nil, badRequest("Not a user id")
	}
	return Unseat(r.Context(), s.DB, s.Table.Run, parsed.(string))
}

// Unseat is member.remove at every room the user sits in, each its own action through run (the table's, so the user's
// sockets there are kicked and the room rebroadcast). A room the user owns keeps them, refused ownerNotRemovable
// without being tried, as the platform's kick rules have it: the owner hands the room on instead. Their characters stay
// in each room. Each room is logged as user.unseat, with "removed" or the refusal that kept them.
func Unseat(ctx context.Context, conn core.Conn, run func(cs.Ctx, cs.Action) any, id string) (Unseated, error) {
	out := Unseated{Removed: []SeatRef{}, Kept: []KeptSeat{}}
	if err := conn.QueryRow(ctx, `SELECT 1 FROM app_user WHERE id = $1`, id).Scan(new(int)); errors.Is(err, pgx.ErrNoRows) {
		return out, notFound("User not found")
	} else if err != nil {
		return out, err
	}
	type seat struct {
		SeatRef
		owner *string
		mode  string
	}
	rows, err := conn.Query(ctx, `SELECT c.id::text, c.name, c.owner_user_id, c.table_mode FROM membership m
		JOIN campaign c ON c.id = m.campaign_id WHERE m.user_id = $1 ORDER BY c.name, c.id`, id)
	if err != nil {
		return out, err
	}
	seats, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (seat, error) {
		var x seat
		return x, row.Scan(&x.CampaignID, &x.CampaignName, &x.owner, &x.mode)
	})
	if err != nil {
		return out, err
	}
	for _, x := range seats {
		code := "ownerNotRemovable"
		if x.owner == nil || *x.owner != id {
			c := cs.Ctx{CampaignID: x.CampaignID, CampaignOwnerID: x.owner, TableMode: x.mode, Seat: cs.Seat{Kind: cs.SeatAdmin}}
			code = refusalOf(run(c, cs.Action{"type": "member.remove", "userId": id}))
		}
		detail := "removed"
		if code != "" {
			detail = "kept: " + code
			out.Kept = append(out.Kept, KeptSeat{x.SeatRef, code})
		} else {
			out.Removed = append(out.Removed, x.SeatRef)
		}
		if err := logUnseat(ctx, conn, x.CampaignID, id, detail); err != nil {
			return out, err
		}
	}
	return out, nil
}

// refusalOf is the refusal code of a table answer, or "" when it was accepted.
func refusalOf(answer any) string {
	if refused, ok := answer.(map[string]any); ok && refused["ok"] == false {
		code, _ := refused["code"].(string)
		return code
	}
	return ""
}

func logUnseat(ctx context.Context, conn core.Conn, campaignID, userID, detail string) error {
	_, err := conn.Exec(ctx, `INSERT INTO admin_event (actor_user_id, action, campaign_id, campaign_name, target_user_id, detail)
		VALUES ($1, 'user.unseat', $2, (SELECT name FROM campaign WHERE id = $2), $3, $4)`, KeyActor, campaignID, userID, detail)
	return err
}
