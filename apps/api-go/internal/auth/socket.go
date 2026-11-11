package auth

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// What a client puts in io({ auth }). Browsers send only campaignId; the it_device or guest cookie proves who they are.
// Scripts, tests and the admin page pass a token instead: a guest token, or the server's adminKey.
var handshake = schema.Object(
	schema.Opt("campaignId", schema.UUID()),
	schema.Opt("token", schema.String().Max(200)),
	schema.Opt("adminKey", schema.String().Max(500)),
)

// SocketSeat is the caller of a socket handshake. Script marks the admin key (exempt from the action limit, logged as
// key.action); SeatKey names the seat for the rate limits, so a second socket of the same seat shares them.
type SocketSeat struct {
	Ctx     cs.Ctx
	Script  bool
	SeatKey string
}

// ResolveSocketCtx is the caller of a socket handshake, or nil to refuse it.
func (s *Service) ResolveSocketCtx(ctx context.Context, auth map[string]any, cookieHeader string) (*SocketSeat, error) {
	var given any = map[string]any{}
	if auth != nil {
		given = auth
	}
	parsed, issues := schema.Parse(handshake, given)
	if len(issues) > 0 {
		return nil, nil
	}
	h := parsed.(map[string]any)
	campaignID, _ := h["campaignId"].(string)
	token, _ := h["token"].(string)
	adminKey, _ := h["adminKey"].(string)
	if adminKey != "" && s.SignIn {
		return nil, nil
	}
	if adminKey != "" && campaignID != "" {
		if !core.IsAdminKey(adminKey) {
			return nil, nil
		}
		owner, exists, err := s.owner(ctx, campaignID)
		if err != nil || !exists {
			return nil, err
		}
		return &SocketSeat{
			Ctx:     cs.Ctx{CampaignID: campaignID, CampaignOwnerID: owner, Seat: cs.Seat{Kind: cs.SeatAdmin}},
			Script:  true,
			SeatKey: campaignID + ":admin-key",
		}, nil
	}
	if token != "" {
		guest, tokenHash, err := s.guestSeat(ctx, token)
		if err != nil || guest == nil || (campaignID != "" && guest.CampaignID != campaignID) {
			return nil, err
		}
		return &SocketSeat{Ctx: *guest, SeatKey: guest.CampaignID + ":" + tokenHash}, nil
	}
	if campaignID == "" {
		return nil, nil
	}
	r, err := s.ResolveCtx(ctx, campaignID, cookieHeader)
	if err != nil || r == nil {
		return nil, err
	}
	return &SocketSeat{Ctx: r.Ctx, SeatKey: r.SeatKey}, nil
}
