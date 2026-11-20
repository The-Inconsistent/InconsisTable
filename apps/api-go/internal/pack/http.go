package pack

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/world"
)

// Service holds the owner's library routes, outside any table (docs/design.md §5.3): what they import is theirs alone
// until sharing exists. Every route is for a device user and touches only that user's rows. The body limit is the
// pack cap (5 MB), as express's was for these routes.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

// caller reads as the Visitor, so a new device's library is empty and its own export or hide finds nothing.
func (s *Service) caller(r *http.Request) (*auth.User, error) {
	return s.who(r, s.Auth.Visitor)
}

func (s *Service) who(r *http.Request, find func(context.Context, string) (*auth.User, error)) (*auth.User, error) {
	user, err := find(r.Context(), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	return user, nil
}

// importer is the caller of an import. Importing stores content on the server, so it takes a creator, as starting a
// room does: with sign-in on, an anonymous device never is one (auth.DeviceCreates). Reading, exporting and hiding
// one's own stay open to every caller.
func (s *Service) importer(r *http.Request) (*auth.User, error) {
	user, err := s.who(r, s.Auth.EnsureDeviceUser)
	if err != nil {
		return nil, err
	}
	if !user.Creator {
		return nil, core.Refuse(http.StatusForbidden, "importCreatorsOnly")
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
	user, err := s.importer(r)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r, false)
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

// ExportRuleset is GET /api/rulesets/{id}/export: the owner's newest manifest, as ImportRuleset takes it. Anyone
// else's ruleset answers like a missing one.
func (s *Service) ExportRuleset(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, issues := schema.Parse(schema.UUID(), r.PathValue("id"))
	if len(issues) > 0 {
		return nil, core.Refuse(http.StatusBadRequest, "notARulesetId")
	}
	out, err := ruleset.Export(r.Context(), s.DB, user.UserID, id.(string))
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "rulesetNotFound")
	}
	return out, nil
}

// ImportPack is POST /api/packs.
func (s *Service) ImportPack(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.importer(r)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r, true)
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

func worldID(r *http.Request) (string, error) {
	id, issues := schema.Parse(schema.UUID(), r.PathValue("id"))
	if len(issues) > 0 {
		return "", core.Refuse(http.StatusBadRequest, "notAWorldId")
	}
	return id.(string), nil
}

// ImportWorld is POST /api/worlds (house decision #65).
func (s *Service) ImportWorld(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.importer(r)
	if err != nil {
		return nil, err
	}
	body, err := readBody(w, r, false)
	if err != nil {
		return nil, refusing(err)
	}
	out, err := world.Import(r.Context(), s.DB, user.UserID, body)
	if err != nil {
		return nil, refusing(err)
	}
	return core.Created{Body: out}, nil
}

// Worlds is GET /api/worlds: the caller's own.
func (s *Service) Worlds(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	return world.List(r.Context(), s.DB, user.UserID)
}

// ExportWorld is GET /api/worlds/{id}/export: the owner's newest version, as ImportWorld takes it. Anyone else's World
// answers like a missing one.
func (s *Service) ExportWorld(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := worldID(r)
	if err != nil {
		return nil, err
	}
	out, err := world.Export(r.Context(), s.DB, user.UserID, id)
	if errors.Is(err, world.ErrTakenDown) {
		return nil, core.Refuse(http.StatusForbidden, "worldTakenDown")
	}
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "worldNotFound")
	}
	return out, nil
}

// HideWorld is POST /api/worlds/{id}/hide.
func (s *Service) HideWorld(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := worldID(r)
	if err != nil {
		return nil, err
	}
	out, err := world.Hide(r.Context(), s.DB, user.UserID, id)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "worldNotFound")
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
