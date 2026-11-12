package auth

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Invites by their code (apps/api/src/auth/invite.service.ts and invite.limits.ts).

// A room invite's QR lets anyone make a new character on every accept, and each one grows the broadcast snapshot.
//
// ponytail: invite.uses counts every accept of the invite (picking an open character too), so the per-invite cap is
// slightly stricter than "characters it made"; a created-by-invite column if that ever bites. The per-campaign cap
// counts every pc, whoever made it. Flat numbers for a table of a handful; make them per-room settings if one outgrows them.
const (
	MaxNewCharactersPerInvite   = 50
	MaxNewCharactersPerCampaign = 50
)

type liveInvite struct {
	id, campaignID, mode, role string
	actorID                    *string
	allowGuests                bool
	uses                       int
}

// A live invite by its code: not revoked, not expired, uses left.
func live(ctx context.Context, conn core.Conn, code string) (liveInvite, error) {
	var inv liveInvite
	err := conn.QueryRow(ctx, `SELECT id::text, campaign_id::text, mode, role, actor_id::text, allow_guests, uses FROM invite
		WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)`,
		Hash(code)).Scan(&inv.id, &inv.campaignID, &inv.mode, &inv.role, &inv.actorID, &inv.allowGuests, &inv.uses)
	if errors.Is(err, pgx.ErrNoRows) {
		return inv, cs.Fail("inviteExpired")
	}
	return inv, err
}

// Characters someone plays: a seat holds them or a live guest token points at them.
func claimed(ctx context.Context, conn core.Conn, campaignID string) (map[string]bool, error) {
	rows, err := conn.Query(ctx, `SELECT mc.actor_id::text FROM membership_character mc
			JOIN membership m ON m.id = mc.membership_id WHERE m.campaign_id = $1
		UNION SELECT actor_id::text FROM access_token WHERE campaign_id = $1 AND revoked_at IS NULL AND actor_id IS NOT NULL`,
		campaignID)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out, err
}

// ActorBrief is a character as an invite shows it.
type ActorBrief struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"`
	Name        string  `json:"name"`
	Status      string  `json:"status"`
	OwnerUserID *string `json:"ownerUserId"`
}

// Player characters of a campaign: what an invite can offer.
func playerCharacters(ctx context.Context, conn core.Conn, campaignID string) ([]ActorBrief, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, kind, name, status, owner_user_id FROM actor
		WHERE campaign_id = $1 AND kind = 'pc' AND status = 'active' ORDER BY created_at`, campaignID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ActorBrief, error) {
		var a ActorBrief
		return a, r.Scan(&a.ID, &a.Kind, &a.Name, &a.Status, &a.OwnerUserID)
	})
}

func unclaimed(ctx context.Context, conn core.Conn, campaignID string) ([]ActorBrief, error) {
	pcs, err := playerCharacters(ctx, conn, campaignID)
	if err != nil {
		return nil, err
	}
	taken, err := claimed(ctx, conn, campaignID)
	return slices.DeleteFunc(pcs, func(a ActorBrief) bool { return taken[a.ID] }), err
}

// PlayerSeats counts the seats a room without a GM seats: every member (each is a player there) and every guest's player
// token. The table's TV is not a seat.
func PlayerSeats(ctx context.Context, conn core.Conn, campaignID string) (int, error) {
	var n int
	err := conn.QueryRow(ctx, `SELECT (SELECT count(*) FROM membership WHERE campaign_id = $1)
		+ (SELECT count(*) FROM access_token WHERE campaign_id = $1 AND role = 'player' AND revoked_at IS NULL)`, campaignID).Scan(&n)
	return n, err
}

// InvitePreview is what an invite's page shows before it is accepted.
type InvitePreview struct {
	CampaignID   string       `json:"campaignId"`
	CampaignName string       `json:"campaignName"`
	Mode         string       `json:"mode"`
	Role         string       `json:"role"`
	Actor        *ActorBrief  `json:"actor"`
	OpenActors   []ActorBrief `json:"openActors"`
	AllowGuests  bool         `json:"allowGuests"`
	SignedIn     bool         `json:"signedIn"`
	Member       bool         `json:"member"`
}

// PreviewInvite is the invite behind a code, as the caller (nil: no user) would accept it.
func PreviewInvite(ctx context.Context, conn core.Conn, code string, user *User) (InvitePreview, error) {
	inv, err := live(ctx, conn, code)
	if err != nil {
		return InvitePreview{}, err
	}
	out := InvitePreview{CampaignID: inv.campaignID, CampaignName: "?", Mode: inv.mode, Role: inv.role, OpenActors: []ActorBrief{},
		AllowGuests: inv.allowGuests, SignedIn: user != nil}
	if err := conn.QueryRow(ctx, `SELECT name FROM campaign WHERE id = $1`, inv.campaignID).Scan(&out.CampaignName); err != nil &&
		!errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	pcs, err := playerCharacters(ctx, conn, inv.campaignID)
	if err != nil {
		return out, err
	}
	for i := range pcs {
		if inv.actorID != nil && pcs[i].ID == *inv.actorID {
			out.Actor = &pcs[i]
		}
	}
	if inv.mode == "room" && inv.role == "player" {
		if out.OpenActors, err = unclaimed(ctx, conn, inv.campaignID); err != nil {
			return out, err
		}
	}
	if user != nil {
		m, err := memberOf(ctx, conn, inv.campaignID, user.UserID)
		if err != nil {
			return out, err
		}
		out.Member = m != nil
	}
	return out, nil
}

// AcceptInvite takes the invite: a signed-in user takes a seat; a guest gets a player token (guestToken, which the
// caller sets as the guest cookie). It runs in the campaign's action queue (Gateway.Mutate), so the claim checks can't
// race, and like any action it bumps the state version (docs/design.md §5.6); a refusal rolls it back.
func AcceptInvite(ctx context.Context, tx core.Conn, code string, user *User, body any) (campaignID, guestToken string, err error) {
	parsed, issues := schema.Parse(cs.AcceptInvite, body)
	if len(issues) > 0 {
		return "", "", cs.Fail("pickOrNameCharacter")
	}
	b := parsed.(map[string]any)
	asGuest, _ := b["asGuest"].(bool)
	inv, err := live(ctx, tx, code)
	if err != nil {
		return "", "", err
	}
	campaignID = inv.campaignID
	var archived bool
	var tableMode string
	err = tx.QueryRow(ctx, `UPDATE campaign SET state_version = state_version + 1 WHERE id = $1
		RETURNING archived_at IS NOT NULL, table_mode`, campaignID).Scan(&archived, &tableMode)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", "", err
	}
	switch {
	case !archived && tableMode != cs.TableModeGM && inv.role != "player":
		return "", "", cs.Fail("noGmSeats") // an invite made before the table changed mode
	case archived:
		return "", "", cs.Fail("gameArchived")
	case asGuest && !inv.allowGuests:
		return "", "", cs.Fail("inviteNeedsAccount")
	case !asGuest && user == nil:
		return "", "", cs.Fail("signInFirstOrGuest")
	}
	if !asGuest {
		m, err := memberOf(ctx, tx, campaignID, user.UserID)
		if err != nil || m != nil {
			return campaignID, "", err // already seated: nothing to use up
		}
	}
	if tableMode == cs.TableModeSolo {
		seats, err := PlayerSeats(ctx, tx, campaignID)
		if err != nil {
			return "", "", err
		}
		if seats >= 1 {
			return "", "", cs.Fail("soloOneSeat")
		}
	}
	useUp := func() error {
		_, err := tx.Exec(ctx, `UPDATE invite SET uses = uses + 1 WHERE id = $1`, inv.id)
		return err
	}

	// A GM or co-GM invite seats them without a character (guests were refused above: gmSeatNeedsAccount).
	if inv.role != "player" {
		if err := useUp(); err != nil {
			return "", "", err
		}
		_, err := tx.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, $3)`, campaignID, user.UserID, inv.role)
		return campaignID, "", err
	}

	// Which character: the invited one, an open one the player picked, or a new one by name (room invites).
	open, err := unclaimed(ctx, tx, campaignID)
	if err != nil {
		return "", "", err
	}
	isOpen := func(id string) bool { return slices.ContainsFunc(open, func(a ActorBrief) bool { return a.ID == id }) }
	picked, hasPick := b["actorId"].(string)
	name, hasName := b["newCharacterName"].(string)
	var actorID string
	switch {
	case inv.mode == "character":
		if inv.actorID == nil {
			return "", "", cs.Fail("inviteNoCharacter")
		}
		if actorID = *inv.actorID; !isOpen(actorID) {
			return "", "", cs.Fail("characterTaken")
		}
	case hasPick:
		if !isOpen(picked) {
			return "", "", cs.Fail("characterTaken")
		}
		actorID = picked
	case hasName:
		if inv.uses >= MaxNewCharactersPerInvite {
			return "", "", cs.Fail("inviteCharacterLimit", cs.Params{"limit": MaxNewCharactersPerInvite})
		}
		var pcs int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND kind = 'pc'`, campaignID).Scan(&pcs); err != nil {
			return "", "", err
		}
		if pcs >= MaxNewCharactersPerCampaign {
			return "", "", cs.Fail("gameCharacterLimit", cs.Params{"limit": MaxNewCharactersPerCampaign})
		}
		var ownerID *string
		if !asGuest {
			ownerID = &user.UserID
		}
		if actorID, err = actor.CreateActor(ctx, tx, campaignID, "pc", name, ownerID); err != nil {
			return "", "", err
		}
	default:
		return "", "", cs.Fail("pickOrNameCharacter")
	}

	if err := useUp(); err != nil {
		return "", "", err
	}
	if asGuest {
		token, err := IssueToken(ctx, tx, campaignID, actorID)
		return campaignID, token, err
	}
	var membershipID string
	if err := tx.QueryRow(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'player') RETURNING id::text`,
		campaignID, user.UserID).Scan(&membershipID); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO membership_character (membership_id, actor_id) VALUES ($1, $2)`, membershipID, actorID); err != nil {
		return "", "", err
	}
	// The player owns what they play from now on (export to their library).
	_, err = tx.Exec(ctx, `UPDATE actor SET owner_user_id = $1 WHERE id = $2 AND owner_user_id IS NULL`, user.UserID, actorID)
	return campaignID, "", err
}
