package roomdoc

import (
	"errors"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Service is the import route.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

// Import is POST /api/campaigns/import: a room document as the body, for a user who may create a room (the gate of POST
// /api/campaigns). `?dryRun=1` applies it and rolls it back; `?tableMode=` is how the new room sits. A refused document
// is 422 with the refusal, its path, and what was read of the document.
func (s *Service) Import(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.DeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if !user.Creator {
		return nil, core.Refuse(http.StatusForbidden, "creatorsOnly")
	}
	query := r.URL.Query()
	mode := query.Get("tableMode")
	if mode != "" && !slices.Contains([]string{cs.TableModeGM, cs.TableModeGMLess, cs.TableModeSolo}, mode) {
		return nil, core.Refuse(http.StatusBadRequest, "badRequest", cs.Params{"detail": "tableMode is gm, gmless or solo"})
	}
	body, err := core.ReadBody(w, r, cs.RoomMaxBytes)
	if err != nil {
		return nil, err
	}
	dryRun := query.Get("dryRun") == "1"
	answer, err := Import(ctx, s.DB, campaign.Owner{UserID: user.UserID, Name: user.Name}, body, Options{dryRun, mode})
	var p *Problem
	if errors.As(err, &p) {
		refusal := cs.RefusalBody(p.Code, p.Params)
		out := map[string]any{"code": refusal.Code, "message": refusal.Message, "path": p.Path}
		if refusal.Params != nil {
			out["params"] = refusal.Params
		}
		if answer.Name != "" {
			out["name"], out["expects"] = answer.Name, answer.Expects
		}
		return nil, &core.HTTPError{Status: http.StatusUnprocessableEntity, Body: out}
	}
	if err != nil {
		return nil, err
	}
	if dryRun {
		return answer, nil
	}
	return core.Created{Body: answer}, nil
}
