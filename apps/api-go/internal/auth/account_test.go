package auth

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// apps/api/src/auth/account.service.test.ts: the SDK is stubbed at its boundary (Account, RenameAccount); the identity
// link and app_user are real rows, so these need TEST_DATABASE_URL.

const stubIssuer = "https://auth.example.test"

var stubCreated = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

// stubClient records the sub it was asked for; fail makes every call refuse with that code.
type stubClient struct {
	asked []string
	fail  inconsisid.ErrorCode
}

func (s *stubClient) answer(sub, name string) (inconsisid.Account, error) {
	s.asked = append(s.asked, sub)
	if s.fail != "" {
		// The SDK's errors are made inside it; errors.As still reads this one's code.
		return inconsisid.Account{}, &inconsisid.Error{Code: s.fail}
	}
	return inconsisid.Account{
		Sub: sub, DisplayName: name, Roles: []inconsisid.Role{inconsisid.RoleCreator}, CreatedAt: stubCreated,
		SignInMethods: inconsisid.SignInMethods{
			Passkeys:  []inconsisid.Passkey{{Name: "Phone", CreatedAt: stubCreated}},
			Password:  &inconsisid.PasswordMethod{Username: "mira"},
			Providers: []inconsisid.Provider{inconsisid.ProviderGitHub},
		},
		RecoveryCodesLeft: 7,
	}, nil
}

func (s *stubClient) Account(_ context.Context, sub string) (inconsisid.Account, error) {
	return s.answer(sub, "Mira of the Lantern")
}

func (s *stubClient) RenameAccount(_ context.Context, sub, name string) (inconsisid.Account, error) {
	return s.answer(sub, name)
}

func stubIDP(client *stubClient) AccountIDP {
	return AccountIDP{
		Issuer:    stubIssuer,
		ManageURL: stubIssuer + "/account?client=inconsistable",
		Client:    func(context.Context) (AccountClient, error) { return client, nil },
	}
}

// linkedUser is a user linked at stubIssuer, named the way a first sign-in names them.
func linkedUser(t *testing.T, db *pgxpool.Pool) (userID, sub string) {
	t.Helper()
	ctx := context.Background()
	sub = "sub-" + NewSecret()
	if err := db.QueryRow(ctx, `INSERT INTO app_user (id, name, role) VALUES (uuidv7()::text, 'Player', 'creator') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	dropUsers(t, db, userID)
	if _, err := db.Exec(ctx, `INSERT INTO identity_link (iss, sub, user_id) VALUES ($1, $2, $3)`, stubIssuer, sub, userID); err != nil {
		t.Fatal(err)
	}
	return userID, sub
}

func nameOf(t *testing.T, db *pgxpool.Pool, userID string) string {
	t.Helper()
	var name string
	if err := db.QueryRow(context.Background(), `SELECT name FROM app_user WHERE id = $1`, userID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestTheAccountIsReadForTheUsersOwnSubAsThePagesView(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	userID, sub := linkedUser(t, db)
	client := &stubClient{}
	idp := stubIDP(client)
	view, err := ReadAccount(ctx, db, idp, userID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(client.asked, []string{sub}) {
		t.Errorf("asked for %v", client.asked)
	}
	raw, _ := json.Marshal(view)
	var got, want any
	_ = json.Unmarshal(raw, &got)
	_ = json.Unmarshal([]byte(`{
		"displayName": "Mira of the Lantern", "roles": ["creator"], "createdAt": "2026-01-02T03:04:05.000Z",
		"signInMethods": {
			"passkeys": [{"name": "Phone", "createdAt": "2026-01-02T03:04:05.000Z", "lastUsedAt": null}],
			"password": {"username": "mira"}, "providers": ["github"]
		},
		"recoveryCodesLeft": 7, "manageUrl": "`+idp.ManageURL+`"
	}`), &want)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("want %v\ngot  %v", want, got)
	}
	idp.Issuer = "https://other.example.test"
	if view, err := ReadAccount(ctx, db, idp, userID); view != nil || err != nil {
		t.Errorf("no link there: got %v %v", view, err)
	}
}

func TestARenameTheProviderAcceptsBecomesTheNameTablesSee(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	userID, _ := linkedUser(t, db)
	renamed, err := RenameAccount(ctx, db, stubIDP(&stubClient{}), userID, "Mira")
	if err != nil || renamed.DisplayName != "Mira" || nameOf(t, db, userID) != "Mira" {
		t.Fatalf("got %v %v", renamed, err)
	}
	_, err = RenameAccount(ctx, db, stubIDP(&stubClient{fail: inconsisid.ErrAccountAPIFailed}), userID, "Nope")
	var idErr *inconsisid.Error
	if !errors.As(err, &idErr) || idErr.Code != inconsisid.ErrAccountAPIFailed {
		t.Errorf("want account_api_failed, got %v", err)
	}
	if nameOf(t, db, userID) != "Mira" {
		t.Error("the local name did not move")
	}
}
