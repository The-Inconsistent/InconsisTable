package roomdoc

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Service is the import route.
type Service struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

// Export is GET /api/campaigns/:id/export (house decision #103): the room's document, for its owner while they run it
// (as a GM of it, or as its owner in a room without a GM: principle 4's words). No seat there, or no such room, is 404;
// a seat that is not the owner running it is 403. `?pictures=0` leaves the pictures out.
func (s *Service) Export(w http.ResponseWriter, r *http.Request) (any, error) {
	id := r.PathValue("id")
	if _, err := core.Parse(cs.CampaignID, id); err != nil {
		return nil, core.Refuse(http.StatusNotFound, "gameNotFound")
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), id, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusNotFound, "gameNotFound")
	}
	c := resolved.Ctx
	if !view.IsOwner(c) || !(view.RunsAsGm(c) || !c.HasGM()) {
		return nil, core.Refuse(http.StatusForbidden, "roomExportOwnerOnly")
	}
	return WriteFile(r.Context(), s.DB, w, id, r.URL.Query().Get("pictures") != "0")
}

// AdminExport is GET /api/admin/campaigns/:id/export: the same document for the admin key, which already reads a whole
// room (OPEN AS ADMIN) and holds no seat. No key is 401, a wrong one 403, as every admin route answers.
func (s *Service) AdminExport(w http.ResponseWriter, r *http.Request) (any, error) {
	key := r.Header.Get("X-Admin-Key")
	if key == "" {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if !core.IsAdminKey(key) {
		return nil, core.Refuse(http.StatusForbidden, "adminKeyWrong")
	}
	id := r.PathValue("id")
	if _, err := core.Parse(cs.CampaignID, id); err != nil {
		return nil, core.Refuse(http.StatusNotFound, "gameNotFound")
	}
	return WriteFile(r.Context(), s.DB, w, id, r.URL.Query().Get("pictures") != "0")
}

// WriteFile answers a room's document as a file named after the room (its name as a slug, then `.room.json`), with
// what it carries and leaves out in the `X-Room-Export` header (#232).
func WriteFile(ctx context.Context, db *pgxpool.Pool, w http.ResponseWriter, campaignID string, pictures bool) (any, error) {
	var name string
	if err := db.QueryRow(ctx, `SELECT name FROM campaign WHERE id = $1`, campaignID).Scan(&name); errors.Is(err, pgx.ErrNoRows) {
		return nil, core.Refuse(http.StatusNotFound, "gameNotFound")
	} else if err != nil {
		return nil, err
	}
	// Nothing is written until the document is known to fit, so a refusal before then is still an ordinary answer.
	doc, err := prepare(ctx, db, campaignID, pictures)
	switch {
	case errors.Is(err, ErrTooLarge):
		return nil, core.Refuse(http.StatusRequestEntityTooLarge, "roomExportTooLarge")
	case err != nil:
		return nil, err
	}
	report, _ := json.Marshal(doc.Report)
	out := &started{w: w, file: Slug(name) + ".room.json", report: string(report)}
	err = doc.write(ctx, db, out)
	switch {
	case err != nil && !out.began:
		return nil, err
	case err != nil:
		// Mid-stream the answer is already a file: the client gets one cut short, which no import reads.
		log.Printf("room export %s: %v", campaignID, err)
	}
	return core.Written{}, nil
}

// started sends the file's headers with its first bytes.
type started struct {
	w      http.ResponseWriter
	file   string
	report string
	began  bool
}

func (s *started) Write(p []byte) (int, error) {
	if !s.began {
		s.began = true
		s.w.Header().Set("Content-Type", "application/json; charset=utf-8")
		s.w.Header().Set("Content-Disposition", `attachment; filename="`+s.file+`"`)
		s.w.Header().Set("Cache-Control", "no-store")
		s.w.Header().Set("X-Room-Export", s.report)
		s.w.WriteHeader(http.StatusOK)
	}
	return s.w.Write(p)
}

// Slug is a room's name as a file name: lower case, every run of other characters a dash, "room" when nothing is left
// (the source app's export name).
func Slug(name string) string {
	slug := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		return "room"
	}
	return slug
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Import is POST /api/campaigns/import: a room document as the body, for a user who may create a room (the gate of POST
// /api/campaigns). `?dryRun=1` applies it and rolls it back; `?tableMode=` is how the new room sits. A refused document
// is 422 with the refusal, its path, and what was read of the document.
func (s *Service) Import(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	user, err := s.Auth.EnsureDeviceUser(ctx, core.CookieHeader(r))
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
	// `?module=`: the room is made from that version of the caller's own game module (house decision #143).
	module := query.Get("module")
	if _, issues := schema.Parse(schema.UUID(), module); module != "" && len(issues) > 0 {
		return nil, core.Refuse(http.StatusBadRequest, "badRequest", cs.Params{"detail": "module is a module version id"})
	}
	body, err := core.ReadBody(w, r, cs.RoomMaxBytes)
	if err != nil {
		return nil, err
	}
	dryRun := query.Get("dryRun") == "1"
	answer, err := Import(ctx, s.DB, campaign.Owner{UserID: user.UserID, Name: user.Name}, body,
		Options{DryRun: dryRun, TableMode: mode, Fresh: query.Get("fresh") == "1", Module: module})
	var p *Problem
	if errors.As(err, &p) {
		refusal := cs.RefusalBody(p.Code, p.Params)
		out := map[string]any{"code": refusal.Code, "message": refusal.Message, "path": p.Path}
		if refusal.Params != nil {
			out["params"] = refusal.Params
		}
		if answer.Name != "" {
			out["name"] = answer.Name
		}
		if answer.Expects != nil {
			out["expects"] = answer.Expects
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
