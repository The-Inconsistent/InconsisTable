package library

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Service is the library's routes, beside the rulesets' and packs'.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

// caller is the library's user: anyone with an account, or, on a deployment without sign-in, any device (each one is a
// user and a creator there). With sign-in on, an anonymous device keeps no library (libraryNeedsAccount): its players
// are guests of the rooms they join, as the source app's QR guests are, and its storage would be anyone's.
func (s *Service) caller(r *http.Request) (*auth.User, error) {
	user, err := s.Auth.DeviceUser(r.Context(), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if s.Auth.SignIn && !user.Account {
		return nil, core.Refuse(http.StatusForbidden, "libraryNeedsAccount")
	}
	return user, nil
}

func characterID(r *http.Request) (string, error) {
	id, issues := schema.Parse(schema.UUID(), r.PathValue("id"))
	if len(issues) > 0 {
		return "", core.Refuse(http.StatusNotFound, "libraryNotFound")
	}
	return id.(string), nil
}

// notFound answers a character that is not the caller's as a missing one.
func notFound(err error) error {
	if err == errNotFound {
		return core.Refuse(http.StatusNotFound, "libraryNotFound")
	}
	return err
}

var (
	newBody = schema.Object(
		schema.Req("rulesetVersionId", schema.UUID()),
		schema.Def("name", schema.String().Trim().Max(80), ""),
	).Strict()
	patchBody = schema.Object(
		schema.Req("rev", schema.Int().Min(1)),
		schema.Opt("name", schema.String().Trim().Max(80)),
		schema.Opt("build", cs.LedgerBuildText),
		schema.Def("done", schema.Bool(), false),
	).Strict()
	fromRoomBody = schema.Object(schema.Req("campaignId", schema.UUID()), schema.Req("actorId", schema.UUID())).Strict()
)

// body reads a JSON body against its schema; a problem is 400 badRequest.
func body(w http.ResponseWriter, r *http.Request, s schema.Schema) (map[string]any, error) {
	raw, err := core.ReadBody(w, r, 2*cs.MaxBuildBytes)
	if err != nil {
		return nil, err
	}
	out, err := core.Parse(s, raw)
	if err != nil {
		return nil, err
	}
	m, _ := out.(map[string]any)
	return m, nil
}

// List is GET /api/library: the caller's characters, the last edited first.
func (s *Service) List(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	return List(r.Context(), s.DB, user.UserID)
}

// Create is POST /api/library `{ rulesetVersionId, name? }`: a new character with one of the caller's own rulesets.
func (s *Service) Create(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	b, err := body(w, r, newBody)
	if err != nil {
		return nil, err
	}
	var card Card
	err = core.InTx(r.Context(), s.DB, func(tx pgx.Tx) error {
		var err error
		card, err = New(r.Context(), tx, user.UserID, b["name"].(string), b["rulesetVersionId"].(string))
		return err
	})
	if err != nil {
		return nil, err
	}
	return core.Created{Body: card}, nil
}

// Get is GET /api/library/:id: one of the caller's characters whole.
func (s *Service) Get(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := characterID(r)
	if err != nil {
		return nil, err
	}
	e, err := Get(r.Context(), s.DB, user.UserID, id)
	return e, notFound(err)
}

// Rules is GET /api/library/:id/rules: the manifest and catalogue the builder outside a room reads, for a character
// whose ruleset and packs are all the caller's own (libraryNotEditable otherwise: it is edited in a room).
func (s *Service) Rules(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := characterID(r)
	if err != nil {
		return nil, err
	}
	out, err := Rules(r.Context(), s.DB, user.UserID, id)
	return out, notFound(err)
}

// Patch is PATCH /api/library/:id `{ rev, name?, build?, done? }`: an autosave (a draft) or a save (done, resolved
// ready), at the revision the caller read; another one is 409 libraryChanged.
func (s *Service) Patch(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := characterID(r)
	if err != nil {
		return nil, err
	}
	b, err := body(w, r, patchBody)
	if err != nil {
		return nil, err
	}
	p := Patch{Rev: int64(b["rev"].(float64)), Done: b["done"].(bool)}
	if name, has := b["name"].(string); has {
		p.Name = &name
	}
	if build, has := b["build"].(string); has {
		p.Build = &build
	}
	card, err := Save(r.Context(), s.DB, user.UserID, id, p)
	if refusal := (*cs.Error)(nil); errors.As(err, &refusal) && refusal.Code == "libraryChanged" {
		return nil, core.Refuse(http.StatusConflict, "libraryChanged")
	}
	if err != nil {
		return nil, notFound(err)
	}
	return card, nil
}

// Delete is DELETE /api/library/:id.
func (s *Service) Delete(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	id, err := characterID(r)
	if err != nil {
		return nil, err
	}
	if err := Delete(r.Context(), s.DB, user.UserID, id); err != nil {
		return nil, notFound(err)
	}
	return map[string]bool{"ok": true}, nil
}

// FromRoom is POST /api/library/from-room `{ campaignId, actorId }`: SAVE TO MY LIBRARY, a copy of a built character
// the caller's seat holds in that room. No seat there is 404.
func (s *Service) FromRoom(w http.ResponseWriter, r *http.Request) (any, error) {
	user, err := s.caller(r)
	if err != nil {
		return nil, err
	}
	b, err := body(w, r, fromRoomBody)
	if err != nil {
		return nil, err
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), b["campaignId"].(string), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusNotFound, "gameNotFound")
	}
	var card Card
	err = core.InTx(r.Context(), s.DB, func(tx pgx.Tx) error {
		var err error
		card, err = FromRoom(r.Context(), tx, user.UserID, resolved.Ctx, b["actorId"].(string))
		return err
	})
	if err != nil {
		return nil, err
	}
	return core.Created{Body: card}, nil
}
