package module

import (
	"net/http"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Service holds the module routes: owner-scoped like the rest of the library (the callers are the library's), and the
// room made from one.
type Service struct {
	Library *pack.Service
}

// createRoom is the body of POST /api/campaigns/from-module: POST /api/campaigns' name and table mode, and the module
// version in place of a ruleset version.
var createRoom = schema.Object(
	schema.Req("name", schema.String().Trim().Min(1).Max(100)),
	schema.Req("moduleVersionId", schema.UUID()),
	schema.Opt("tableMode", schema.Enum("gm", "gmless", "solo")),
)

func moduleID(r *http.Request) (string, error) {
	id, issues := schema.Parse(schema.UUID(), r.PathValue("id"))
	if len(issues) > 0 {
		return "", core.Refuse(http.StatusBadRequest, "notAModuleId")
	}
	return id.(string), nil
}

// Import is POST /api/modules: a module file, with or without the documents it names, for a creator.
func (s *Service) Import(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.Library.Importer(r)
	if err != nil {
		return nil, err
	}
	body, err := pack.ReadBody(w, r, true)
	if err != nil {
		return nil, pack.Refusing(err)
	}
	out, err := Import(r.Context(), s.Library.DB, user.UserID, body)
	if err != nil {
		return nil, pack.Refusing(err)
	}
	return core.Created{Body: out}, nil
}

// List is GET /api/modules: the caller's own.
func (s *Service) List(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.Library.Caller(r)
	if err != nil {
		return nil, err
	}
	return List(r.Context(), s.Library.DB, user.UserID)
}

// Export is GET /api/modules/{id}/export: the owner's newest version as a list. Anyone else's answers like a missing one.
func (s *Service) Export(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.Library.Caller(r)
	if err != nil {
		return nil, err
	}
	id, err := moduleID(r)
	if err != nil {
		return nil, err
	}
	out, err := Export(r.Context(), s.Library.DB, user.UserID, id)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, core.Refuse(http.StatusNotFound, "moduleNotFound")
	}
	return out, nil
}

// Hide is POST /api/modules/{id}/hide, the library's delete: a module holds no room, so it is always really removed.
func (s *Service) Hide(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.Library.Caller(r)
	if err != nil {
		return nil, err
	}
	id, err := moduleID(r)
	if err != nil {
		return nil, err
	}
	deleted, err := Delete(r.Context(), s.Library.DB, user.UserID, id)
	if err != nil {
		return nil, err
	}
	if !deleted {
		return nil, core.Refuse(http.StatusNotFound, "moduleNotFound")
	}
	return map[string]bool{"deleted": true}, nil
}

// Room is POST /api/campaigns/from-module: a new room of the caller's from one of their own modules, for a user who may
// create a room (the gate of POST /api/campaigns).
func (s *Service) Room(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Library.Auth.EnsureDeviceUser(ctx, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if !user.Creator {
		return nil, core.Refuse(http.StatusForbidden, "creatorsOnly")
	}
	body, err := core.ParseBody(w, r, createRoom)
	if err != nil {
		return nil, err
	}
	mode, _ := body["tableMode"].(string)
	id, err := CreateRoom(ctx, s.Library.DB, campaign.Owner{UserID: user.UserID, Name: user.Name}, body["name"].(string),
		body["moduleVersionId"].(string), mode)
	if err != nil {
		return nil, err
	}
	return core.Created{Body: map[string]string{"campaignId": id}}, nil
}
