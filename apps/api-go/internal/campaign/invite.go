package campaign

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Invite is GET /api/invites/{code}: what the invite offers the caller, before they accept it.
func (s *Service) Invite(_ http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.Visitor(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	code, err := core.Parse(coreschema.InviteCode, r.PathValue("code"))
	if err != nil {
		return nil, err
	}
	return auth.PreviewInvite(ctx, s.DB, code.(string), user)
}

// Accept is POST /api/invites/{code}/accept. Accepting changes who's at the table, so it runs in that table's action
// queue and rebroadcasts like an action.
func (s *Service) Accept(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.EnsureDeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	parsed, err := core.Parse(coreschema.InviteCode, r.PathValue("code"))
	if err != nil {
		return nil, err
	}
	code := parsed.(string)
	body, err := core.ReadBody(w, r, core.MaxBody)
	if err != nil {
		return nil, err
	}
	preview, err := auth.PreviewInvite(ctx, s.DB, code, user)
	if err != nil {
		return nil, err
	}
	var campaignID, guestToken string
	err = s.Mutate(preview.CampaignID, func() error {
		return core.InTx(ctx, s.DB, func(tx pgx.Tx) error {
			var err error
			campaignID, guestToken, err = auth.AcceptInvite(ctx, tx, code, user, body)
			return err
		})
	})
	if err != nil {
		return nil, err
	}
	if guestToken != "" {
		setGuestCookie(w, guestToken)
	}
	return map[string]string{"campaignId": campaignID}, nil
}
