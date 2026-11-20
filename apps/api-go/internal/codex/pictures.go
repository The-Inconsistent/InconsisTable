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

// A picture on an entry (house decision #70). Uploading carries bytes, so it is REST; attaching (codex.save imageId)
// and showing it to the table (codex.reveal imageRevealed) stay actions. Auspex's routes are the model
// (wrath_glory apps/api/src/campaign/campaign.controller.ts, the images routes).

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

// dropUnused deletes a picture no entry points at any more.
func dropUnused(ctx context.Context, tx core.Conn, campaignID string, picture *string) error {
	if picture == nil {
		return nil
	}
	var used bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM codex_entry WHERE image_id = $1)`, *picture).Scan(&used); err != nil || used {
		return err
	}
	return image.Pictures.Delete(ctx, tx, campaignID, []string{*picture})
}

// sweep deletes the room's pictures that were uploaded over a day ago and never attached, as Auspex's sweepImages does
// on every codex save and delete (wrath_glory apps/api/src/codex/image.store.ts).
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
	rows, err := tx.Query(ctx, `SELECT unnest($1::uuid[])::text EXCEPT
		SELECT image_id::text FROM codex_entry WHERE campaign_id = $2 AND image_id IS NOT NULL`, stale, campaignID)
	if err != nil {
		return err
	}
	unused, err := pgx.CollectRows(rows, pgx.RowTo[string])
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
	picture, err := upload(r.Context(), s.DB, resolved.Ctx, declared, data)
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": picture}, nil
}

// upload stores a picture that fits the room, for a seat that may write the codex.
func upload(ctx context.Context, conn core.Conn, c cs.Ctx, declared string, data []byte) (string, error) {
	if !cs.CanInCampaign(c, "codex:write", "") {
		return "", core.Refuse(http.StatusForbidden, "noPermission")
	}
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

// servable is the picture when the seat may see it, else nil.
func servable(ctx context.Context, conn core.Conn, c cs.Ctx, picture string) (*image.Picture, error) {
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
