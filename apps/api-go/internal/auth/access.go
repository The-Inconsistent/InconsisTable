package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The access actions (apps/api/src/auth/access.actions.ts). The permission each action needs was checked before these
// run (authorize); what's here are the rules about the seat being acted on (docs/design.md §3.6).

// An offer to take over a room lasts a week.
const transferHours = 168

// NewSecret is a random secret: an invite code or a token, only ever shown once and stored hashed.
func NewSecret() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b) // never fails (crypto/rand)
	return base64.RawURLEncoding.EncodeToString(b)
}

// IssueToken is a guest's player token for one character (the per-character QR).
func IssueToken(ctx context.Context, tx core.Conn, campaignID, actorID string) (string, error) {
	token := NewSecret()
	_, err := tx.Exec(ctx, `INSERT INTO access_token (token_hash, campaign_id, role, actor_id) VALUES ($1, $2, 'player', $3)`,
		Hash(token), campaignID, actorID)
	return token, err
}

// issueScreenToken is a screen token for the table's TV: no character, and the seat only reads (CanInCampaign).
//
// ponytail: every SCREEN QR tap mints a token that lives until REVOKE SCREENS; reuse or expire them if TVs multiply.
func issueScreenToken(ctx context.Context, tx core.Conn, campaignID string) (string, error) {
	token := NewSecret()
	_, err := tx.Exec(ctx, `INSERT INTO access_token (token_hash, campaign_id, role) VALUES ($1, $2, 'screen')`, Hash(token), campaignID)
	return token, err
}

func held(ctx context.Context, tx core.Conn, membershipID string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT actor_id::text FROM membership_character WHERE membership_id = $1`, membershipID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type member struct{ id, role string }

// The member of the room this user is, or nil.
func memberOf(ctx context.Context, tx core.Conn, campaignID, userID string) (*member, error) {
	var m member
	err := tx.QueryRow(ctx, `SELECT id::text, role FROM membership WHERE campaign_id = $1 AND user_id = $2`, campaignID, userID).
		Scan(&m.id, &m.role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// The characters of a seat that goes stay at the table, retired: the GM still needs them (docs/design.md §3.6). A dead
// one stays dead.
func retire(ctx context.Context, tx core.Conn, campaignID string, actorIDs []string) error {
	if len(actorIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE actor SET status = 'retired' WHERE campaign_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
		campaignID, actorIDs)
	return err
}

// A member leaves or is removed: their characters retire, their seat and any room offer to them go.
func unseat(ctx context.Context, tx core.Conn, campaignID, userID, membershipID string) error {
	actorIDs, err := held(ctx, tx, membershipID)
	if err != nil {
		return err
	}
	if err := retire(ctx, tx, campaignID, actorIDs); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM membership WHERE id = $1`, membershipID); err != nil {
		return err
	}
	// An offer to someone who no longer sits here goes with their seat.
	_, err = tx.Exec(ctx, `DELETE FROM ownership_transfer WHERE campaign_id = $1 AND to_user_id = $2`, campaignID, userID)
	return err
}

func owner(c cs.Ctx) string {
	if c.CampaignOwnerID == nil {
		return ""
	}
	return *c.CampaignOwnerID
}

func caller(c cs.Ctx) string {
	if c.UserID == nil {
		return ""
	}
	return *c.UserID
}

// InviteCreate is invite.create. A character invite is one seat, used once. A room invite is the table QR: anyone with
// it claims or starts a character until it expires.
func InviteCreate(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	role, mode := a.Str("role"), a.Str("mode")
	actorID, named := a["actorId"].(string)
	if !c.HasGM() && role != "player" {
		return cs.Result{}, cs.Fail("noGmSeats")
	}
	if !cs.CanGrantRole(c, role) {
		return cs.Result{}, cs.Fail("onlyInvitePlayers")
	}
	switch {
	case mode == "character" && !named:
		return cs.Result{}, cs.Fail("pickCharacterToInvite")
	case mode == "character":
		if _, err := actor.OwnActor(ctx, tx, c.CampaignID, actorID); err != nil {
			return cs.Result{}, err
		}
	case named:
		return cs.Result{}, cs.Fail("roomInviteNoCharacter")
	}
	allowGuests, _ := a["allowGuests"].(bool)
	if role != "player" && allowGuests {
		return cs.Result{}, cs.Fail("gmSeatNeedsAccount")
	}
	hours, _ := a["hours"].(float64)
	var target, maxUses any
	if named {
		target = actorID
	}
	if mode == "character" {
		maxUses = 1
	}
	code := NewSecret()
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO invite (code_hash, campaign_id, mode, role, actor_id, allow_guests, expires_at, max_uses)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
		Hash(code), c.CampaignID, mode, role, target, allowGuests, time.Now().Add(time.Duration(hours*float64(time.Hour))), maxUses).Scan(&id)
	if err != nil {
		return cs.Result{}, err
	}
	return cs.Result{OK: true, ID: id, Token: code}, nil // the code is only ever shown now
}

// InviteRevoke is invite.revoke.
func InviteRevoke(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tag, err := tx.Exec(ctx, `UPDATE invite SET revoked_at = now() WHERE id = $1 AND campaign_id = $2 AND revoked_at IS NULL`,
		a.Str("id"), c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	if tag.RowsAffected() == 0 {
		return cs.Result{}, cs.Fail("inviteNotFound")
	}
	return cs.Done(""), nil
}

// MemberRemove is member.remove. A GM or co-GM removes players only; only the owner removes a GM, and nobody the
// owner.
func MemberRemove(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	userID := a.Str("userId")
	if userID == caller(c) {
		return cs.Result{}, cs.Fail("leaveInstead")
	}
	m, err := memberOf(ctx, tx, c.CampaignID, userID)
	if err != nil {
		return cs.Result{}, err
	}
	if m == nil {
		return cs.Result{}, cs.Fail("memberNotFound")
	}
	if !cs.CanActOnMember(c, userID, m.role) {
		if userID == owner(c) {
			return cs.Result{}, cs.Fail("ownerNotRemovable")
		}
		return cs.Result{}, cs.Fail("onlyOwnerRemovesGm")
	}
	return cs.Done(""), unseat(ctx, tx, c.CampaignID, userID, m.id)
}

// MemberAppoint is member.appoint, owner only: appoint a GM or co-GM, demote one, or set a co-GM's scopes.
func MemberAppoint(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	userID, role := a.Str("userId"), a.Str("role")
	if !c.HasGM() && role != "player" {
		return cs.Result{}, cs.Fail("noGmSeats")
	}
	if userID == owner(c) {
		return cs.Result{}, cs.Fail("ownerIsGm")
	}
	m, err := memberOf(ctx, tx, c.CampaignID, userID)
	if err != nil {
		return cs.Result{}, err
	}
	if m == nil {
		return cs.Result{}, cs.Fail("memberNotFound")
	}
	scopes := []string{}
	if list, _ := a["scopes"].([]any); role == "cogm" {
		for _, s := range list {
			scopes = append(scopes, s.(string)) // the schema let only scope names through
		}
	}
	_, err = tx.Exec(ctx, `UPDATE membership SET role = $1, scopes = $2 WHERE id = $3`, role, scopes, m.id)
	return cs.Done(""), err
}

// MemberSeat is member.seat, admin only. Only a user the app has seen: the id is a user id, and a typo mustn't seat
// nobody.
func MemberSeat(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	userID := a.Str("userId")
	err := tx.QueryRow(ctx, `SELECT 1 FROM app_user WHERE id = $1`, userID).Scan(new(int))
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("userNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	role := "gm"
	if !c.HasGM() {
		role = "player" // an admin's seat in a room without a GM
	}
	_, err = tx.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (campaign_id, user_id) DO UPDATE SET role = $3, scopes = '{}'`, c.CampaignID, userID, role)
	return cs.Done(""), err
}

// SeatLeave is seat.leave. The leaver's sockets are kicked a moment after the ack (KicksOf), so this phone gets its
// answer first.
func SeatLeave(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	if c.Seat.Kind == cs.SeatAdmin {
		return cs.Result{}, cs.Fail("noSeatHere")
	}
	if c.UserID != nil && *c.UserID == owner(c) {
		return cs.Result{}, cs.Fail("handOnFirst")
	}
	if c.Seat.Kind == cs.SeatMember && c.UserID != nil {
		m, err := memberOf(ctx, tx, c.CampaignID, *c.UserID)
		if err != nil || m == nil {
			return cs.Done(""), err
		}
		return cs.Done(""), unseat(ctx, tx, c.CampaignID, *c.UserID, m.id)
	}
	// A guest is a player too: their character stays, retired.
	if err := retire(ctx, tx, c.CampaignID, c.Seat.CharacterIDs); err != nil {
		return cs.Result{}, err
	}
	// ponytail: a guest can't be told apart from another phone on the same character's QR, so all its tokens go.
	if len(c.Seat.CharacterIDs) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE access_token SET revoked_at = now()
			WHERE campaign_id = $1 AND actor_id = ANY($2::uuid[]) AND revoked_at IS NULL`, c.CampaignID, c.Seat.CharacterIDs); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), nil
}

// TokenIssue is token.issue: a guest QR for one character of this room.
func TokenIssue(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	actorID := a.Str("actorId")
	if _, err := actor.OwnActor(ctx, tx, c.CampaignID, actorID); err != nil {
		return cs.Result{}, err
	}
	// Alone, the owner's seat is the one: a guest QR would seat a second player (docs/adr/0009-table-modes.md).
	if c.Mode() == cs.TableModeSolo {
		seats, err := PlayerSeats(ctx, tx, c.CampaignID)
		if err != nil {
			return cs.Result{}, err
		}
		if seats >= 1 {
			return cs.Result{}, cs.Fail("soloOneSeat")
		}
	}
	token, err := IssueToken(ctx, tx, c.CampaignID, actorID)
	return cs.Result{OK: true, Token: token}, err
}

// TokenRevoke is token.revoke: every guest token of one character. Members holding it keep their seat.
func TokenRevoke(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	actorID := a.Str("actorId")
	if _, err := actor.OwnActor(ctx, tx, c.CampaignID, actorID); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE access_token SET revoked_at = now() WHERE actor_id = $1 AND revoked_at IS NULL`, actorID)
	return cs.Done(""), err
}

// ScreenIssue is screen.issue.
func ScreenIssue(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	token, err := issueScreenToken(ctx, tx, c.CampaignID)
	return cs.Result{OK: true, Token: token}, err
}

// ScreenRevoke is screen.revoke: every screen of this room.
func ScreenRevoke(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	_, err := tx.Exec(ctx, `UPDATE access_token SET revoked_at = now() WHERE campaign_id = $1 AND role = 'screen' AND revoked_at IS NULL`,
		c.CampaignID)
	return cs.Done(""), err
}

// Transfer is campaign.transfer: an offer to a signed-in member of this room only, since they must already know the
// table.
func Transfer(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	to := a.Str("toUserId")
	if to == owner(c) {
		return cs.Result{}, cs.Fail("alreadyOwner")
	}
	m, err := memberOf(ctx, tx, c.CampaignID, to)
	if err != nil {
		return cs.Result{}, err
	}
	if m == nil {
		return cs.Result{}, cs.Fail("onlyMemberTakesOver")
	}
	_, err = tx.Exec(ctx, `INSERT INTO ownership_transfer (campaign_id, to_user_id, expires_at) VALUES ($1, $2, $3)
		ON CONFLICT (campaign_id) DO UPDATE SET to_user_id = EXCLUDED.to_user_id, expires_at = EXCLUDED.expires_at`,
		c.CampaignID, to, time.Now().Add(transferHours*time.Hour))
	return cs.Done(""), err
}

// TransferCancel is campaign.transferCancel.
func TransferCancel(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	_, err := tx.Exec(ctx, `DELETE FROM ownership_transfer WHERE campaign_id = $1`, c.CampaignID)
	return cs.Done(""), err
}

// TransferAccept is campaign.transferAccept. No permission gates it (ActionPerms ""): the offer itself names who may
// accept. The new owner always sits as a GM; the old owner keeps their GM seat until the new owner decides.
func TransferAccept(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	if c.UserID == nil {
		return cs.Result{}, cs.Fail("signInToTakeOver")
	}
	userID := *c.UserID
	tag, err := tx.Exec(ctx, `DELETE FROM ownership_transfer WHERE campaign_id = $1 AND to_user_id = $2 AND expires_at > now()`,
		c.CampaignID, userID)
	if err != nil {
		return cs.Result{}, err
	}
	if tag.RowsAffected() == 0 {
		return cs.Result{}, cs.Fail("noOffer")
	}
	// Only a member takes over (campaign.transfer): one who has left since can't come back through the offer.
	m, err := memberOf(ctx, tx, c.CampaignID, userID)
	if err != nil {
		return cs.Result{}, err
	}
	if m == nil {
		return cs.Result{}, cs.Fail("onlyMemberTakesOver")
	}
	// The new owner sits as the GM, unless the room has none.
	seat := "gm"
	if !c.HasGM() {
		seat = "player"
	}
	if _, err := tx.Exec(ctx, `UPDATE membership SET role = $2, scopes = '{}' WHERE id = $1`, m.id, seat); err != nil {
		return cs.Result{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE campaign SET owner_user_id = $1 WHERE id = $2`, userID, c.CampaignID)
	return cs.Done(""), err
}
