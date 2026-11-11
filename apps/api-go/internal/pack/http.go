package pack

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Service holds the owner's library routes, outside any table (docs/design.md §5.3): what they import is theirs alone
// until sharing exists. Every route is for a device user and touches only that user's rows. The body limit is the
// pack cap (5 MB), as express's was for these routes.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

func (s *Service) caller(r *http.Request) (*auth.User, error) {
	user, err := s.Auth.DeviceUser(r.Context(), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	return user, nil
}

// A refused import answers 422 with its problems by path, so the importer can show them next to the field.
func refusing(err error) error {
	var refused *ruleset.Refused
	if !errors.As(err, &refused) {
		return err
	}
	body := coreschema.RefusalBody("importRefused", nil)
	return &core.HTTPError{Status: http.StatusUnprocessableEntity, Body: map[string]any{
		"ok": false, "code": body.Code, "message": body.Message,
		"problems": problemsOrEmpty(refused.Problems), "warnings": problemsOrEmpty(refused.Warnings),
	}}
}

func packID(r *http.Request) (string, error) {
	id, issues := schema.Parse(schema.UUID(), r.PathValue("id"))
	if len(issues) > 0 {
		return "", core.Refuse(http.StatusBadRequest, "notAPackId")
	}
	return id.(string), nil
}

// ImportRuleset is POST /api/rulesets.
func (s *Service) ImportRuleset(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r)
	if err != nil {
		return nil, refusing(err)
	}
	out, err := ruleset.Import(r.Context(), s.DB, user.UserID, body)
	if err != nil {
		return nil, refusing(err)
	}
	return core.Created{Body: out}, nil
}

// Rulesets is GET /api/rulesets.
func (s *Service) Rulesets(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	return ruleset.List(r.Context(), s.DB, user.UserID)
}

// ImportPack is POST /api/packs.
func (s *Service) ImportPack(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r)
	if err != nil {
		return nil, refusing(err)
	}
	out, err := Import(r.Context(), s.DB, user.UserID, body)
	if err != nil {
		return nil, refusing(err)
	}
	return core.Created{Body: out}, nil
}

// Packs is GET /api/packs.
func (s *Service) Packs(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	return ListMine(r.Context(), s.DB, user.UserID)
}

// Export is GET /api/packs/{id}/export: the owner's own JSON back, as ImportPack takes it. Anyone else's pack answers
// like a missing one.
func (s *Service) Export(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := packID(r)
	if err != nil {
		return nil, err
	}
	out, err := Export(r.Context(), s.DB, user.UserID, id)
	if errors.Is(err, ErrTakenDown) {
		return nil, core.Refuse(http.StatusForbidden, "packTakenDown")
	}
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "packNotFound")
	}
	return out, nil
}

// Hide is POST /api/packs/{id}/hide.
func (s *Service) Hide(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := packID(r)
	if err != nil {
		return nil, err
	}
	out, err := Hide(r.Context(), s.DB, user.UserID, id)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "packNotFound")
	}
	return out, nil
}
