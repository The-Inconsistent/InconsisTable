package auth

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// apps/api/src/auth/sign-in.service.test.ts. Against Postgres (TEST_DATABASE_URL) and, for the protocol cases, a running
// InconsisID dev server: INCONSISID_DIR is its checkout (after bun run keys:dev), IDP_TEST_ISSUER its issuer (default
// http://localhost:4100). The logout tokens come from that checkout's `node scripts/logout-token.ts`, signed by the
// provider's own delivery code. These tests commit, since concurrent sign-ins need separate transactions; each drops
// the users it made, and the links and sessions cascade.

const devClientID = "inconsistable-dev"

func testIssuer() string {
	if issuer := os.Getenv("IDP_TEST_ISSUER"); issuer != "" {
		return issuer
	}
	return "http://localhost:4100"
}

func dropUsers(t *testing.T, db *pgxpool.Pool, ids ...string) {
	t.Cleanup(func() {
		if _, err := db.Exec(context.Background(), `DELETE FROM app_user WHERE id = ANY($1)`, ids); err != nil {
			t.Error(err)
		}
	})
}

func link(t *testing.T, db *pgxpool.Pool, iss, sub string, roles ...inconsisid.Role) string {
	t.Helper()
	var id string
	err := core.InTx(context.Background(), db, func(tx pgx.Tx) (err error) {
		id, err = LinkIdentity(context.Background(), tx, iss, sub, roles)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func issue(t *testing.T, db *pgxpool.Pool, userID, opSid string, roles ...inconsisid.Role) string {
	t.Helper()
	var token string
	err := core.InTx(context.Background(), db, func(tx pgx.Tx) (err error) {
		token, err = IssueSession(context.Background(), tx, userID, opSid, roles)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func count(t *testing.T, db *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestTheSameAccountSigningInTwiceIsOneUserAndItsRoleFollowsTheToken(t *testing.T) {
	db := dbtest.Open(t)
	sub := "sub-" + NewSecret()
	first := link(t, db, testIssuer(), sub, inconsisid.RoleCreator)
	dropUsers(t, db, first)
	if again := link(t, db, testIssuer(), sub); again != first {
		t.Errorf("want %s again, got %s", first, again)
	}
	if n := count(t, db, `SELECT count(*) FROM identity_link WHERE sub = $1`, sub); n != 1 {
		t.Errorf("want one link, got %d", n)
	}
	var role string
	if err := db.QueryRow(context.Background(), `SELECT role FROM app_user WHERE id = $1`, first).Scan(&role); err != nil || role != "user" {
		t.Errorf("the creator role was revoked at the provider: got %q %v", role, err)
	}
}

func TestFiveFirstCallbacksForOneAccountAtOnceMakeOneUserAndOneLink(t *testing.T) {
	db := dbtest.Open(t)
	sub := "sub-" + NewSecret()
	ids, errs := make([]string, 5), make([]error, 5)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Go(func() {
			errs[i] = core.InTx(context.Background(), db, func(tx pgx.Tx) (err error) {
				ids[i], err = LinkIdentity(context.Background(), tx, testIssuer(), sub, []inconsisid.Role{inconsisid.RoleCreator})
				return err
			})
		})
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		t.Fatal(err)
	}
	dropUsers(t, db, ids[0])
	if len(slices.Compact(slices.Sorted(slices.Values(ids)))) != 1 {
		t.Errorf("want one user, got %v", ids)
	}
	if n := count(t, db, `SELECT count(*) FROM identity_link WHERE sub = $1`, sub); n != 1 {
		t.Errorf("want one link, got %d", n)
	}
	if n := count(t, db, `SELECT count(*) FROM app_user WHERE id = $1`, ids[0]); n != 1 {
		t.Errorf("want the user, got %d", n)
	}
}

func TestASessionLivesUntilIdleOrOldAndADeadOneFallsBackToTheDevice(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	s := &Service{DB: db}
	userID := link(t, db, testIssuer(), "sub-"+NewSecret(), inconsisid.RoleCreator, inconsisid.RoleAdmin)
	dropUsers(t, db, userID)
	token := issue(t, db, userID, "sid-a", inconsisid.RoleCreator, inconsisid.RoleAdmin)
	device := NewSecret()
	cookie := DeviceCookie + "=" + device + "; " + SessionCookie + "=" + token
	tokenHash := Hash(token)

	live, err := s.SessionOf(ctx, cookie)
	if err != nil || live == nil {
		t.Fatalf("want a live session, got %v", err)
	}
	if live.User.UserID != userID || !live.User.Account || !live.User.Creator || !slices.Equal(live.User.Roles, []string{"creator", "admin"}) {
		t.Errorf("got %+v", live.User)
	}
	if user, err := s.DeviceUser(ctx, cookie); err != nil || user.UserID != userID {
		t.Errorf("the session wins over the device cookie: %v %v", user, err)
	}

	set := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, append(args, tokenHash)...); err != nil {
			t.Fatal(err)
		}
	}
	almostIdle := time.Now().Add(-sessionIdle + time.Minute)
	set(`UPDATE api_session SET last_seen_at = $1 WHERE token_hash = $2`, almostIdle)
	if live, err := s.SessionOf(ctx, cookie); live == nil || err != nil {
		t.Errorf("29 days 23 hours idle is still live: %v", err)
	}
	if live, err := s.SessionLive(ctx, tokenHash); !live || err != nil {
		t.Errorf("SessionLive agrees it is live: %v", err)
	}
	var touched time.Time
	if err := db.QueryRow(ctx, `SELECT last_seen_at FROM api_session WHERE token_hash = $1`, tokenHash).Scan(&touched); err != nil || !touched.After(almostIdle) {
		t.Errorf("the read touched last_seen_at: %v %v", touched, err)
	}

	set(`UPDATE api_session SET last_seen_at = $1 WHERE token_hash = $2`, time.Now().Add(-sessionIdle-time.Second))
	if live, _ := s.SessionOf(ctx, cookie); live != nil {
		t.Error("30 days idle")
	}
	if live, err := s.SessionLive(ctx, tokenHash); live || err != nil {
		t.Errorf("SessionLive agrees on 30 days idle: %v", err)
	}
	set(`UPDATE api_session SET last_seen_at = now(), expires_at = $1 WHERE token_hash = $2`, time.Now().Add(-time.Second))
	if live, _ := s.SessionOf(ctx, cookie); live != nil {
		t.Error("past 90 days")
	}
	fallback, err := s.EnsureDeviceUser(ctx, cookie)
	if err != nil || fallback == nil || fallback.UserID == userID || fallback.Account {
		t.Fatalf("back to the anonymous device user: %+v %v", fallback, err)
	}
	dropUsers(t, db, fallback.UserID)

	for _, other := range []string{SessionCookie + "=" + NewSecret(), SessionCookie + "=short"} {
		if live, err := s.SessionOf(ctx, other); live != nil || err != nil {
			t.Errorf("%s: want no session, got %v %v", other, live, err)
		}
	}
}

func TestIssuingASessionPrunesDeadOnes(t *testing.T) {
	db := dbtest.Open(t)
	userID := link(t, db, testIssuer(), "sub-"+NewSecret())
	dropUsers(t, db, userID)
	dead := issue(t, db, userID, "sid-dead")
	if _, err := db.Exec(context.Background(), `UPDATE api_session SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, Hash(dead)); err != nil {
		t.Fatal(err)
	}
	issue(t, db, userID, "sid-fresh")
	if n := count(t, db, `SELECT count(*) FROM api_session WHERE user_id = $1`, userID); n != 1 {
		t.Errorf("want only the fresh session, got %d", n)
	}
}

// The protocol cases need the provider: discovery, the authorization URL's state, and its signing keys.
func idpFlows(t *testing.T) *Flows {
	t.Helper()
	db := dbtest.Open(t)
	dir := os.Getenv("INCONSISID_DIR")
	if dir == "" {
		t.Skip("INCONSISID_DIR is not set")
	}
	config, err := LoadSignInConfig(envOf(map[string]string{
		"IDP_SIGN_IN": "1", "IDP_DEV_HTTP": "1", "IDP_ISSUER": testIssuer(), "IDP_CLIENT_ID": devClientID,
		"IDP_REDIRECT_URI":    "http://localhost:3000/api/auth/callback",
		"IDP_CLIENT_JWK_FILE": filepath.Join(dir, ".secrets", "inconsistable_dev_client_jwk.json"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	return &Flows{Config: *config, DB: db}
}

func wantRefused(t *testing.T, err error, reason, why string) {
	t.Helper()
	var refused *Refused
	if !errors.As(err, &refused) || refused.Reason != reason {
		t.Errorf("%s: want %s, got %v", why, reason, err)
	}
}

func TestTheCallbackRefusesTamperedStateForeignIssAndASpentOrStaleTransaction(t *testing.T) {
	f := idpFlows(t)
	ctx := context.Background()
	start := func() (handle, state string) {
		t.Helper()
		handle, authURL, err := f.Start(ctx, nil, "/")
		if err != nil {
			t.Fatal(err)
		}
		u, _ := url.Parse(authURL)
		if u.Scheme+"://"+u.Host != testIssuer() {
			t.Errorf("the authorization URL is at %s", authURL)
		}
		return handle, u.Query().Get("state")
	}
	finish := func(handle string, query map[string]string) error {
		q := url.Values{}
		for k, v := range query {
			q.Set(k, v)
		}
		_, err := f.Finish(ctx, handle, CallbackPath+"?"+q.Encode(), "")
		return err
	}
	issuer := testIssuer()

	a, stateA := start()
	wantRefused(t, finish(a, map[string]string{"code": "c", "state": "tampered", "iss": issuer}), "state_mismatch", "a tampered state")
	wantRefused(t, finish(a, map[string]string{"code": "c", "state": stateA, "iss": issuer}), "no_transaction",
		"the first callback spent the transaction, right or wrong")

	b, stateB := start()
	wantRefused(t, finish(b, map[string]string{"code": "c", "state": stateB, "iss": "https://evil.example"}), "issuer_mismatch", "a foreign iss")
	c, stateC := start()
	wantRefused(t, finish(c, map[string]string{"code": "c", "state": stateC}), "issuer_mismatch", "no iss")

	d, stateD := start()
	if _, err := f.DB.Exec(ctx, `UPDATE oidc_tx SET created_at = now() - interval '11 minutes' WHERE handle_hash = $1`, Hash(d)); err != nil {
		t.Fatal(err)
	}
	wantRefused(t, finish(d, map[string]string{"code": "c", "state": stateD, "iss": issuer}), "no_transaction", "a stale transaction")
	wantRefused(t, finish("", map[string]string{"code": "c", "state": stateA, "iss": issuer}), "no_transaction", "no handle")

	e, stateE := start()
	wantRefused(t, finish(e, map[string]string{"code": "never-issued", "state": stateE, "iss": issuer}), "code_exchange_failed",
		"state and iss right: the provider refuses a code it never issued")
}

func logoutToken(t *testing.T, clientID, sub, sid string) string {
	t.Helper()
	cmd := exec.Command("node", "scripts/logout-token.ts", clientID, sub, sid)
	cmd.Dir = os.Getenv("INCONSISID_DIR")
	// Without ISSUER the provider derives it from PORT, which it could inherit from the api's environment.
	cmd.Env = append(os.Environ(), "ISSUER="+testIssuer())
	out, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			t.Fatalf("logout-token: %v\n%s", err, exit.Stderr)
		}
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

func TestARealLogoutTokenEndsItsSidOnlyAndAReplayOrAnotherClientsTokenIsRefused(t *testing.T) {
	f := idpFlows(t)
	ctx := context.Background()
	sub, sid := "sub-"+NewSecret(), "sid-"+NewSecret()
	userID := link(t, f.DB, f.Config.Issuer, sub, inconsisid.RoleCreator)
	dropUsers(t, f.DB, userID)
	s1, s2, other := issue(t, f.DB, userID, sid), issue(t, f.DB, userID, sid), issue(t, f.DB, userID, "other-"+sid)

	token := logoutToken(t, devClientID, sub, sid)
	ended, err := f.ReceiveLogout(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{Hash(s1), Hash(s2)}; !slices.Equal(slices.Sorted(slices.Values(ended)), slices.Sorted(slices.Values(want))) {
		t.Errorf("want %v ended, got %v", want, ended)
	}
	var left string
	if err := f.DB.QueryRow(ctx, `SELECT string_agg(token_hash, ',') FROM api_session WHERE user_id = $1`, userID).Scan(&left); err != nil || left != Hash(other) {
		t.Errorf("want only the other sid's session left, got %q %v", left, err)
	}

	_, err = f.ReceiveLogout(ctx, token)
	wantRefused(t, err, "replayed", "the same token again")
	_, err = f.ReceiveLogout(ctx, logoutToken(t, "dev-test", sub, "other-"+sid))
	wantRefused(t, err, "logout_token_invalid", "a token for another client")
	_, err = f.ReceiveLogout(ctx, "not.a.jwt")
	wantRefused(t, err, "logout_token_invalid", "not a JWT")
	if n := count(t, f.DB, `SELECT count(*) FROM api_session WHERE user_id = $1`, userID); n != 1 {
		t.Errorf("the refused tokens ended nothing: %d left", n)
	}
}
