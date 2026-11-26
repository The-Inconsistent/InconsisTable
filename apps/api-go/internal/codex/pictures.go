package codex

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// A picture on an entry (house decision #70) or an actor (#155). Uploading carries bytes, so it is REST; attaching
// (codex.save imageId, actor.picture) and showing it to the table (codex.reveal and actor.picture imageRevealed) stay
// actions. Auspex's routes are the model (wrath_glory apps/api/src/campaign/campaign.controller.ts, the images routes).

// setPicture points an entry at a picture, or at none. A new picture starts hidden from the table; without a GM nothing
// can be, so it is the party's at once, as a new entry is. The picture it no longer points at goes if nothing else does.
func setPicture(ctx context.Context, tx core.Conn, c cs.Ctx, entryID, picture string) error {
	var old *string
	if err := tx.QueryRow(ctx, `SELECT image_id::text FROM codex_entry WHERE id = $1`, entryID).Scan(&old); err != nil {
		return err
	}
	if old != nil && *old == picture {
		return nil
	}
	var next *string
	if picture != "" {
		next = &picture
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET image_id = $2, image_revealed = $3 WHERE id = $1`,
		entryID, next, next != nil && !c.HasGM()); err != nil {
		return err
	}
	return dropUnused(ctx, tx, c.CampaignID, old)
}

// dropUnused deletes a picture nothing points at any more.
func dropUnused(ctx context.Context, tx core.Conn, campaignID string, picture *string) error {
	return image.DropUnused(ctx, tx, campaignID, picture)
}

// sweep deletes the room's pictures that were uploaded over a day ago and never attached, as Auspex's sweepImages does
// on every codex save and delete (wrath_glory apps/api/src/codex/image.store.ts). An actor's picture is attached too.
func sweep(ctx context.Context, tx core.Conn, campaignID string) error {
	held, err := image.Pictures.Usage(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	stale := []string{}
	for _, p := range held {
		if time.Since(p.CreatedAt) > image.Grace {
			stale = append(stale, p.ID)
		}
	}
	if len(stale) == 0 {
		return nil
	}
	unused, err := image.Unused(ctx, tx, campaignID, stale)
	if err != nil || len(unused) == 0 {
		return err
	}
	return image.Pictures.Delete(ctx, tx, campaignID, unused)
}

// Pictures serves the picture routes.
type Pictures struct {
	DB   *pgxpool.Pool
	Auth *auth.Service
}

// Upload is POST /api/campaigns/:id/images: the picture is the raw body, its Content-Type image/webp or image/jpeg.
// A seat that may write the codex uploads; the answer is the new id, which codex.save then attaches.
func (s *Pictures) Upload(w http.ResponseWriter, r *http.Request) (any, error) {
	return s.upload(w, r, func(c cs.Ctx) error {
		if !cs.CanInCampaign(c, "codex:write", "") {
			return core.Refuse(http.StatusForbidden, "noPermission")
		}
		return nil
	})
}

// UploadForActor is POST /api/campaigns/:id/actors/:actorId/images (house decision #155): the seat holding the
// character, or the GM side of it, uploads its picture; actor.picture then attaches it. A pack's creature gets one only
// this way, from the GM side: a pack carries no picture.
func (s *Pictures) UploadForActor(w http.ResponseWriter, r *http.Request) (any, error) {
	actorID, err := core.Parse(cs.CampaignID, r.PathValue("actorId"))
	if err != nil {
		return nil, err
	}
	return s.upload(w, r, func(c cs.Ctx) error {
		return MayPictureActor(r.Context(), s.DB, c, actorID.(string))
	})
}

// MayPictureActor refuses a seat that may not give this actor of its room a picture: one neither holding it nor on the
// GM side of it.
func MayPictureActor(ctx context.Context, conn core.Conn, c cs.Ctx, actorID string) error {
	if refused := cs.RequirePerm(c, "character:edit:own", actorID); refused != nil {
		return core.Refuse(http.StatusForbidden, refused.Code)
	}
	var here bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM actor WHERE id = $1 AND campaign_id = $2)`,
		actorID, c.CampaignID).Scan(&here); err != nil || here {
		return err
	}
	return cs.Fail("characterNotFound")
}

// upload reads the body and stores it for a seat the check lets through.
func (s *Pictures) upload(w http.ResponseWriter, r *http.Request, may func(cs.Ctx) error) (any, error) {
	id, err := core.Parse(cs.CampaignID, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), id.(string), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	if err := may(resolved.Ctx); err != nil {
		return nil, err
	}
	declared, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if !slices.Contains(image.Mimes, declared) {
		return nil, cs.Fail("pictureType")
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, image.MaxBytes))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return nil, core.Refuse(http.StatusRequestEntityTooLarge, "pictureTooLarge")
	}
	if err != nil {
		return nil, err
	}
	picture, err := store(r.Context(), s.DB, resolved.Ctx, declared, data)
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": picture}, nil
}

// StorePicture stores a picture that fits the room, for a seat that may write the codex. The upload route and the room
// import (internal/roomdoc) call it.
func StorePicture(ctx context.Context, conn core.Conn, c cs.Ctx, declared string, data []byte) (string, error) {
	if !cs.CanInCampaign(c, "codex:write", "") {
		return "", core.Refuse(http.StatusForbidden, "noPermission")
	}
	return store(ctx, conn, c, declared, data)
}

// store stores a picture that fits the room, for a seat already let through.
func store(ctx context.Context, conn core.Conn, c cs.Ctx, declared string, data []byte) (string, error) {
	// ponytail: the room's quota is read outside the table's queue, so uploads racing each other can pass it by the few
	// the upload limit lets through at once (as Auspex's can); a per-room lock in Put if that ever matters.
	held, err := image.Pictures.Usage(ctx, conn, c.CampaignID)
	if err != nil {
		return "", err
	}
	if err := image.Check(declared, data, held); err != nil {
		return "", err
	}
	return image.Pictures.Put(ctx, conn, c.CampaignID, c.UserID, declared, data)
}

// Serve is GET /api/campaigns/:id/images/:imageId. The codex side reads any picture of the room; another seat only one
// an entry it reads carries and has shown to the table; the table screen none, as in Auspex. Anyone else, and a picture
// that isn't there, is the same 404, so an id can't be probed.
func (s *Pictures) Serve(w http.ResponseWriter, r *http.Request) (any, error) {
	notFound := core.Refuse(http.StatusNotFound, "pictureNotFound")
	campaignID, picture := r.PathValue("id"), r.PathValue("imageId")
	if _, err := core.Parse(cs.CampaignID, campaignID); err != nil {
		return nil, notFound
	}
	if _, err := core.Parse(cs.CampaignID, picture); err != nil {
		return nil, notFound
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), campaignID, core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, notFound
	}
	p, err := servable(r.Context(), s.DB, resolved.Ctx, picture)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, notFound
	}
	w.Header().Set("Content-Type", p.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// A picture's bytes never change: a new picture is a new id.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if _, err := w.Write(p.Bytes); err != nil {
		return nil, err
	}
	return core.Written{}, nil
}

// servable is the picture when the seat may see it, else nil. An actor's picture goes where the seat view sends its id
// (house decision #155), the table screen included once it is shown.
func servable(ctx context.Context, conn core.Conn, c cs.Ctx, picture string) (*image.Picture, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, kind, image_revealed FROM actor WHERE campaign_id = $1 AND image_id = $2`,
		c.CampaignID, picture)
	if err != nil {
		return nil, err
	}
	onActor, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (bool, error) {
		var id, kind string
		var shown bool
		err := r.Scan(&id, &kind, &shown)
		return view.ShowsActorPicture(c, id, kind, shown), err
	})
	if err != nil {
		return nil, err
	}
	if slices.Contains(onActor, true) {
		return image.Pictures.Get(ctx, conn, c.CampaignID, picture)
	}
	if c.Role() == "screen" {
		return nil, nil
	}
	if sight := view.SightOf(c); !sight.All && !sight.Codex && !sight.Secrets {
		codex, err := Load(ctx, conn, c.CampaignID)
		if err != nil || !view.ShowsPicture(codex, c, picture) {
			return nil, err
		}
	}
	return image.Pictures.Get(ctx, conn, c.CampaignID, picture)
}
