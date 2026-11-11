package auth

import (
	"context"
	"errors"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// The account page: a signed-in user's account at the identity provider, read and renamed through the SDK (contract
// C16; apps/api/src/auth/account.service.ts). Passkeys, password, recovery codes, linked providers and deletion stay on
// the provider's own pages, which ManageURL opens.

// AccountClient is what the account page needs of the SDK client.
type AccountClient interface {
	Account(ctx context.Context, sub string) (inconsisid.Account, error)
	RenameAccount(ctx context.Context, sub, name string) (inconsisid.Account, error)
}

// AccountIDP is the provider the account lives at. Client is called only once a link is found.
type AccountIDP struct {
	Issuer, ManageURL string
	Client            func(ctx context.Context) (AccountClient, error)
}

type passkeyView struct {
	Name       string  `json:"name"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt"`
}

type signInMethodsView struct {
	Passkeys  []passkeyView              `json:"passkeys"`
	Password  *inconsisid.PasswordMethod `json:"password"`
	Providers []inconsisid.Provider      `json:"providers"`
}

// AccountView is what the web's account page reads: times as ISO strings, and no sub, which the page has no use for.
type AccountView struct {
	DisplayName       string            `json:"displayName"`
	Roles             []inconsisid.Role `json:"roles"`
	CreatedAt         string            `json:"createdAt"`
	SignInMethods     signInMethodsView `json:"signInMethods"`
	RecoveryCodesLeft int               `json:"recoveryCodesLeft"`
	ManageURL         string            `json:"manageUrl"`
}

func accountView(a inconsisid.Account, manageURL string) *AccountView {
	passkeys := make([]passkeyView, len(a.SignInMethods.Passkeys))
	for i, p := range a.SignInMethods.Passkeys {
		passkeys[i] = passkeyView{Name: p.Name, CreatedAt: core.ISOTime(p.CreatedAt)}
		if p.LastUsedAt != nil {
			used := core.ISOTime(*p.LastUsedAt)
			passkeys[i].LastUsedAt = &used
		}
	}
	roles, providers := a.Roles, a.SignInMethods.Providers
	if roles == nil {
		roles = []inconsisid.Role{}
	}
	if providers == nil {
		providers = []inconsisid.Provider{}
	}
	return &AccountView{
		DisplayName:       a.DisplayName,
		Roles:             roles,
		CreatedAt:         core.ISOTime(a.CreatedAt),
		SignInMethods:     signInMethodsView{passkeys, a.SignInMethods.Password, providers},
		RecoveryCodesLeft: a.RecoveryCodesLeft,
		ManageURL:         manageURL,
	}
}

func subOf(ctx context.Context, db core.Conn, issuer, userID string) (string, error) {
	var sub string
	err := db.QueryRow(ctx, `SELECT sub FROM identity_link WHERE iss = $1 AND user_id = $2`, issuer, userID).Scan(&sub)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return sub, err
}

// ReadAccount is nil when the user has no account at this issuer. An *inconsisid.Error passes through for the caller
// to map.
func ReadAccount(ctx context.Context, db core.Conn, idp AccountIDP, userID string) (*AccountView, error) {
	sub, err := subOf(ctx, db, idp.Issuer, userID)
	if err != nil || sub == "" {
		return nil, err
	}
	client, err := idp.Client(ctx)
	if err != nil {
		return nil, err
	}
	account, err := client.Account(ctx, sub)
	if err != nil {
		return nil, err
	}
	return accountView(account, idp.ManageURL), nil
}

// RenameAccount: the provider renames first; the name tables see follows only a rename it accepted, as it stored it.
func RenameAccount(ctx context.Context, db core.Conn, idp AccountIDP, userID, displayName string) (*AccountView, error) {
	sub, err := subOf(ctx, db, idp.Issuer, userID)
	if err != nil || sub == "" {
		return nil, err
	}
	client, err := idp.Client(ctx)
	if err != nil {
		return nil, err
	}
	account, err := client.RenameAccount(ctx, sub, displayName)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(ctx, `UPDATE app_user SET name = $1, updated_at = now() WHERE id = $2`, account.DisplayName, userID); err != nil {
		return nil, err
	}
	return accountView(account, idp.ManageURL), nil
}
