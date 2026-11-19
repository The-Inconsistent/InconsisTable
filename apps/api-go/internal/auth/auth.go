// Package auth resolves who is calling: a signed-in session, a device's anonymous user, or a guest token, and the seat
// they hold at one table.
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

const (
	// GuestCookie is the guest login cookie (a player QR token). Every device also has DeviceCookie.
	GuestCookie = "it_token"
	// DeviceCookie names a device's anonymous user by a random secret.
	DeviceCookie = "it_device"
	// SessionCookie holds a signed-in session's token. The __Host- prefix keeps a sibling subdomain from setting it.
	SessionCookie = "__Host-it_session"
	defaultName   = "Player"
	// sessionIdle matches SESSION_IDLE_MS in apps/api/src/auth/session.schema.ts.
	sessionIdle = 30 * 24 * time.Hour
)

// Hash is what is stored for every secret: only its SHA-256.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

var secretPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,200}$`)

// IsDeviceSecret says what the api accepts as a device secret or a session token.
func IsDeviceSecret(s string) bool { return secretPattern.MatchString(s) }

// ReadCookie reads one cookie by the rules of the header it was given. The header is attacker-controlled: a malformed
// escape reads as no value.
func ReadCookie(header, name string) (string, bool) {
	for part := range strings.SplitSeq(header, ";") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		if key != name {
			continue
		}
		decoded, err := url.PathUnescape(value)
		if err != nil || !utf8.ValidString(decoded) {
			return "", false
		}
		return decoded, true
	}
	return "", false
}

// User is the caller. Roles are set when the caller came through a session (signed in).
type User struct {
	UserID  string
	Name    string
	Creator bool
	Roles   []string
	Account bool
}

// Session is a live session: its user, the hash that names its sockets' room, and when it ends unless used again.
type Session struct {
	TokenHash string
	User      User
	EndsAt    time.Time
}

// Service reads identities from the database. SignIn is on when the sign-in config loaded (IDP_SIGN_IN): an HTTPS
// deployment, whose socket refuses the adminKey handshake (auth-service-security.md §7.7).
type Service struct {
	DB     *pgxpool.Pool
	SignIn bool
}

// SessionOf reads the caller's session from its cookie. One statement checks both limits and touches last_seen_at, so
// an expired session never reads as live. It returns nil for no cookie or a dead session.
func (s *Service) SessionOf(ctx context.Context, cookieHeader string) (*Session, error) {
	token, _ := ReadCookie(cookieHeader, SessionCookie)
	if !IsDeviceSecret(token) {
		return nil, nil
	}
	tokenHash := Hash(token)
	now := time.Now()
	var userID string
	var roles []string
	var expiresAt time.Time
	err := s.DB.QueryRow(ctx, `UPDATE api_session SET last_seen_at = $1
		WHERE token_hash = $2 AND expires_at > $1 AND last_seen_at > $3
		RETURNING user_id, roles, expires_at`, now, tokenHash, now.Add(-sessionIdle)).Scan(&userID, &roles, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var name, role string
	err = s.DB.QueryRow(ctx, `SELECT name, role FROM app_user WHERE id = $1`, userID).Scan(&name, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ends := now.Add(sessionIdle)
	if expiresAt.Before(ends) {
		ends = expiresAt
	}
	return &Session{tokenHash, User{userID, name, role == "creator", roles, true}, ends}, nil
}

// SessionLive says whether the session of this hash is still there and within both limits. It touches nothing.
func (s *Service) SessionLive(ctx context.Context, tokenHash string) (bool, error) {
	var live bool
	now := time.Now()
	err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM api_session
		WHERE token_hash = $1 AND expires_at > $2 AND last_seen_at > $3)`, tokenHash, now, now.Add(-sessionIdle)).Scan(&live)
	return live, err
}

// DeviceUser is the caller: a signed-in session first, else the device's user. The device user is made on first sight
// of a well-formed secret; it is nil for a missing or malformed secret. Two first requests at once make one user: the
// loser of the device insert undoes the user it just made and reads the winner's.
func (s *Service) DeviceUser(ctx context.Context, cookieHeader string) (*User, error) {
	session, err := s.SessionOf(ctx, cookieHeader)
	if err != nil {
		return nil, err
	}
	if session != nil {
		return &session.User, nil
	}
	secret, _ := ReadCookie(cookieHeader, DeviceCookie)
	if !IsDeviceSecret(secret) {
		return nil, nil
	}
	tokenHash := Hash(secret)
	find := func() (*User, error) {
		var u User
		var role string
		err := s.DB.QueryRow(ctx, `SELECT app_user.id, app_user.name, app_user.role FROM device
			JOIN app_user ON app_user.id = device.user_id WHERE device.token_hash = $1`, tokenHash).Scan(&u.UserID, &u.Name, &role)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		u.Creator = DeviceCreates(role, s.SignIn)
		return &u, nil
	}
	known, err := find()
	if known != nil || err != nil {
		return known, err
	}
	err = core.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO app_user (id, name) VALUES (uuidv7()::text, $1) RETURNING id`, defaultName).Scan(&id); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO device (token_hash, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, tokenHash, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			_, err = tx.Exec(ctx, `DELETE FROM app_user WHERE id = $1`, id)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return find()
}

// RenameUser sets the name other seats see.
func (s *Service) RenameUser(ctx context.Context, userID, name string) error {
	_, err := s.DB.Exec(ctx, `UPDATE app_user SET name = $1, updated_at = now() WHERE id = $2`, name, userID)
	return err
}

// roomRow is what a Ctx takes from the campaign row: the owner and how the table sits.
type roomRow struct {
	owner *string
	mode  string
}

// room reads a campaign's owner and table mode. exists is false when there is no such campaign.
func (s *Service) room(ctx context.Context, campaignID string) (row roomRow, exists bool, err error) {
	err = s.DB.QueryRow(ctx, `SELECT owner_user_id, table_mode FROM campaign WHERE id = $1`, campaignID).Scan(&row.owner, &row.mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return roomRow{}, false, nil
	}
	return row, err == nil, err
}

// guestSeat is a guest token's seat and its token's hash (what the rate limits key a token seat by).
func (s *Service) guestSeat(ctx context.Context, token string) (*coreschema.Ctx, string, error) {
	if token == "" {
		return nil, "", nil
	}
	var tokenHash, campaignID, role string
	var actorID *string
	err := s.DB.QueryRow(ctx, `SELECT token_hash, campaign_id::text, role, actor_id::text FROM access_token
		WHERE token_hash = $1 AND revoked_at IS NULL`, Hash(token)).Scan(&tokenHash, &campaignID, &role, &actorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	row, exists, err := s.room(ctx, campaignID)
	if err != nil || !exists {
		return nil, "", err
	}
	characters := []string{}
	if actorID != nil {
		characters = append(characters, *actorID)
	}
	return &coreschema.Ctx{
		CampaignID:      campaignID,
		CampaignOwnerID: row.owner,
		TableMode:       row.mode,
		Seat:            coreschema.Seat{Kind: coreschema.SeatToken, Role: role, CharacterIDs: characters},
	}, tokenHash, nil
}

// ResolveGuest is a guest token's seat, or nil.
func (s *Service) ResolveGuest(ctx context.Context, token string) (*coreschema.Ctx, error) {
	c, _, err := s.guestSeat(ctx, token)
	return c, err
}

// Resolved is a caller's seat at one table, and the key their rate limits share across sockets.
type Resolved struct {
	Ctx     coreschema.Ctx
	SeatKey string
}

// ResolveCtx is the caller at campaignID: a member (by device) first, else a token for that same campaign. OPEN AS ADMIN
// is not here: it is the socket's adminKey handshake.
func (s *Service) ResolveCtx(ctx context.Context, campaignID, cookieHeader string) (*Resolved, error) {
	user, err := s.DeviceUser(ctx, cookieHeader)
	if err != nil {
		return nil, err
	}
	if user != nil {
		row, exists, err := s.room(ctx, campaignID)
		if err != nil || !exists {
			return nil, err
		}
		var membershipID, role string
		var scopes []string
		err = s.DB.QueryRow(ctx, `SELECT id::text, role, scopes FROM membership WHERE campaign_id = $1 AND user_id = $2`,
			campaignID, user.UserID).Scan(&membershipID, &role, &scopes)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			characters, err := s.heldCharacters(ctx, membershipID)
			if err != nil {
				return nil, err
			}
			userID := user.UserID
			return &Resolved{coreschema.Ctx{
				CampaignID:      campaignID,
				UserID:          &userID,
				CampaignOwnerID: row.owner,
				TableMode:       row.mode,
				Seat:            coreschema.Seat{Kind: coreschema.SeatMember, Role: role, Scopes: scopes, CharacterIDs: characters},
			}, campaignID + ":" + userID}, nil
		}
	}
	token, _ := ReadCookie(cookieHeader, GuestCookie)
	guest, tokenID, err := s.guestSeat(ctx, token)
	if err != nil || guest == nil || guest.CampaignID != campaignID {
		return nil, err
	}
	return &Resolved{*guest, campaignID + ":" + tokenID}, nil
}

func (s *Service) heldCharacters(ctx context.Context, membershipID string) ([]string, error) {
	rows, err := s.DB.Query(ctx, `SELECT actor_id::text FROM membership_character WHERE membership_id = $1`, membershipID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if out == nil {
		out = []string{}
	}
	return out, err
}
