package auth

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// Signing in through InconsisID with its SDK (docs/research/auth-service-security.md §7; apps/api/src/auth/
// sign-in.service.ts). The SDK checks the protocol; this file keeps what the SDK leaves to its caller: the single-use
// transaction, the identity link, the api's own session, and the logout-token replay table. It returns the hashes of
// the sessions it ends, so the caller can disconnect their sockets.

const (
	// SessionMax is house decision #33's 90 days after sign-in, at the latest.
	SessionMax = 90 * 24 * time.Hour
	// The SDK accepts a logout token up to 30 s past its exp; a jti is kept a minute past it so a replay inside that
	// tolerance still finds its row.
	jtiKeep = time.Minute
)

// Refused is a sign-in or a logout token the api turned down. Reason is the SDK's code or the api's own; Cause is the
// SDK's detail, for the log only.
type Refused struct {
	Reason string
	Cause  error
}

func (r *Refused) Error() string { return "refused: " + r.Reason }

// refusal turns an SDK refusal into a Refused, and passes any other error through.
func refusal(err error) error {
	var idErr *inconsisid.Error
	if errors.As(err, &idErr) {
		return &Refused{string(idErr.Code), errors.Unwrap(idErr)}
	}
	return err
}

func roleStrings(roles []inconsisid.Role) []string {
	out := make([]string, len(roles))
	for i, r := range roles {
		out[i] = string(r)
	}
	return out
}

// LinkIdentity is the (iss, sub) account's user, made on its first sign-in, with app_user.role set from the token each
// time (§8). Two first callbacks at once make one user: the link's primary key picks a winner; the loser drops the user
// it just made and reads the winner's. The device user of the browser is left untouched (ADR 0005).
func LinkIdentity(ctx context.Context, tx pgx.Tx, iss, sub string, roles []inconsisid.Role) (string, error) {
	role := UserRoleOf(roles)
	linked := func() (string, error) {
		var id string
		err := tx.QueryRow(ctx, `SELECT user_id FROM identity_link WHERE iss = $1 AND sub = $2`, iss, sub).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return id, err
	}
	known, err := linked()
	if err != nil {
		return "", err
	}
	if known != "" {
		_, err := tx.Exec(ctx, `UPDATE app_user SET role = $1, updated_at = now() WHERE id = $2`, role, known)
		return known, err
	}
	var userID string
	if err := tx.QueryRow(ctx, `INSERT INTO app_user (id, name, role) VALUES (uuidv7()::text, $1, $2) RETURNING id`,
		defaultName, role).Scan(&userID); err != nil {
		return "", err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO identity_link (iss, sub, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		iss, sub, userID)
	if err != nil || tag.RowsAffected() == 1 {
		return userID, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM app_user WHERE id = $1`, userID); err != nil {
		return "", err
	}
	winner, err := linked()
	if err == nil && winner == "" {
		err = errors.New("identity link lost its race and found no winner")
	}
	return winner, err
}

// IssueSession is a fresh session for a user who just signed in; the token goes in the cookie, only its hash in the
// row. Dead sessions are pruned here, the one place sessions are made.
func IssueSession(ctx context.Context, tx pgx.Tx, userID, opSid string, roles []inconsisid.Role) (string, error) {
	now := time.Now()
	if _, err := tx.Exec(ctx, `DELETE FROM api_session WHERE expires_at < $1 OR last_seen_at < $2`,
		now, now.Add(-sessionIdle)); err != nil {
		return "", err
	}
	token := NewSecret()
	_, err := tx.Exec(ctx, `INSERT INTO api_session (token_hash, user_id, op_sid, roles, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		Hash(token), userID, opSid, roleStrings(roles), now.Add(SessionMax))
	return token, err
}

// endedHashes collects the token_hash column a DELETE ... RETURNING gives back.
func endedHashes(rows pgx.Rows, err error) ([]string, error) {
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if out == nil {
		out = []string{}
	}
	return out, err
}

// EndSessionByToken ends the session a cookie names, if any, and returns its hash.
func EndSessionByToken(ctx context.Context, db core.Conn, token string) ([]string, error) {
	if !IsDeviceSecret(token) {
		return []string{}, nil
	}
	return endedHashes(db.Query(ctx, `DELETE FROM api_session WHERE token_hash = $1 RETURNING token_hash`, Hash(token)))
}

// Flows are the sign-in flows for one configured identity provider.
type Flows struct {
	Config SignInConfig
	DB     *pgxpool.Pool

	mu     sync.Mutex
	client *inconsisid.Client
}

// IDP is the SDK client, made on first use and remade after a failure, so an api that boots while the provider is
// down still serves anonymous tables and signs in once it is back.
func (f *Flows) IDP(ctx context.Context) (*inconsisid.Client, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.client == nil {
		client, err := inconsisid.New(ctx, f.Config.Options())
		if err != nil {
			return nil, err
		}
		f.client = client
	}
	return f.client, nil
}

// Start is POST /api/auth/login: a transaction row keyed by the hash of a handle the caller puts in its cookie.
func (f *Flows) Start(ctx context.Context, deviceUserID *string, returnTo string) (handle, authURL string, err error) {
	idp, err := f.IDP(ctx)
	if err != nil {
		return "", "", err
	}
	authURL, transaction, err := idp.StartSignIn(inconsisid.PurposeSignIn)
	if err != nil {
		return "", "", err
	}
	handle = NewSecret()
	if _, err := f.DB.Exec(ctx, `DELETE FROM oidc_tx WHERE created_at < now() - interval '10 minutes'`); err != nil {
		return "", "", err
	}
	// The SDK's transaction is JSON; pgx sends a string to jsonb as is.
	_, err = f.DB.Exec(ctx, `INSERT INTO oidc_tx (handle_hash, transaction, device_user_id, return_to) VALUES ($1, $2, $3, $4)`,
		Hash(handle), string(transaction), deviceUserID, returnTo)
	return handle, authURL, err
}

// Finished is a sign-in that went through.
type Finished struct {
	Token, ReturnTo, UserID string
	Ended                   []string
}

// Finish is GET /api/auth/callback, in the order of §7.2: the transaction is deleted on first read (one use, this
// browser only), then the SDK's checks, then the link and a fresh session. The browser's previous session, if any,
// ends. A refusal is a *Refused.
func (f *Flows) Finish(ctx context.Context, handle, callbackURL, previousSession string) (*Finished, error) {
	if !IsDeviceSecret(handle) {
		return nil, &Refused{Reason: refusedNoTransaction}
	}
	var transaction []byte
	var returnTo string
	err := f.DB.QueryRow(ctx, `DELETE FROM oidc_tx WHERE handle_hash = $1 AND created_at > now() - interval '10 minutes'
		RETURNING transaction, return_to`, Hash(handle)).Scan(&transaction, &returnTo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &Refused{Reason: refusedNoTransaction}
	}
	if err != nil {
		return nil, err
	}
	idp, err := f.IDP(ctx)
	if err != nil {
		return nil, refusal(err)
	}
	signIn, err := idp.FinishSignIn(ctx, callbackURL, transaction)
	if err != nil {
		return nil, refusal(err)
	}
	ended, err := EndSessionByToken(ctx, f.DB, previousSession)
	if err != nil {
		return nil, err
	}
	done := &Finished{ReturnTo: returnTo, Ended: ended}
	err = core.InTx(ctx, f.DB, func(tx pgx.Tx) error {
		userID, err := LinkIdentity(ctx, tx, signIn.Iss, signIn.Sub, signIn.Roles)
		if err != nil {
			return err
		}
		done.UserID = userID
		done.Token, err = IssueSession(ctx, tx, userID, signIn.Sid, signIn.Roles)
		return err
	})
	if err != nil {
		return nil, err
	}
	return done, nil
}

// LogoutRedirect is where POST /api/auth/logout sends the browser once the api session ended: the provider, which asks
// the user to confirm its own logout. Without a reachable provider the user still ends up signed out here, on the lobby.
func (f *Flows) LogoutRedirect(ctx context.Context) (string, error) {
	idp, err := f.IDP(ctx)
	var idErr *inconsisid.Error
	if errors.As(err, &idErr) {
		return "/", nil
	}
	if err != nil {
		return "", err
	}
	return idp.LogoutURL(""), nil
}

// ReceiveLogout is POST /api/auth/backchannel-logout (§7.6): the SDK verifies the token; a jti seen before is a replay.
// A sid ends that provider session; a token with only sub ends every session of the linked user. A refusal is a
// *Refused.
func (f *Flows) ReceiveLogout(ctx context.Context, logoutToken string) ([]string, error) {
	idp, err := f.IDP(ctx)
	if err != nil {
		return nil, refusal(err)
	}
	claims, err := idp.VerifyLogoutToken(ctx, logoutToken)
	if err != nil {
		return nil, refusal(err)
	}
	if _, err := f.DB.Exec(ctx, `DELETE FROM logout_jti WHERE exp < $1`, time.Now().Add(-jtiKeep)); err != nil {
		return nil, err
	}
	tag, err := f.DB.Exec(ctx, `INSERT INTO logout_jti (jti, exp) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		claims.Jti, time.Unix(claims.Exp, 0))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, &Refused{Reason: refusedReplayed}
	}
	if claims.Sid != "" {
		return endedHashes(f.DB.Query(ctx, `DELETE FROM api_session WHERE op_sid = $1 RETURNING token_hash`, claims.Sid))
	}
	return endedHashes(f.DB.Query(ctx, `DELETE FROM api_session WHERE user_id IN
		(SELECT user_id FROM identity_link WHERE iss = $1 AND sub = $2) RETURNING token_hash`, f.Config.Issuer, claims.Sub))
}
