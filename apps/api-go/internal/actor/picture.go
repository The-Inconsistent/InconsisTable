package actor

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
)

// Picture is actor.picture (house decision #155): it attaches a picture uploaded for the actor, or none, and shows it to
// the table or holds it back; either may be sent alone, and both are logged. The seat holding the character and the GM
// side may (character:edit:own); the bytes went up first through POST /api/campaigns/:id/actors/:actorId/images.
func Picture(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("actorId")
	if _, err := OwnActor(ctx, tx, c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	logged := map[string]any{"actorId": id}
	if next, sent := a["imageId"]; sent {
		picture, _ := next.(string)
		if err := setPicture(ctx, tx, c, id, picture); err != nil {
			return cs.Result{}, err
		}
		logged["imageId"] = next
	}
	if shown, sent := a["imageRevealed"].(bool); sent {
		if _, err := tx.Exec(ctx, `UPDATE actor SET image_revealed = $2 AND image_id IS NOT NULL WHERE id = $1`, id, shown); err != nil {
			return cs.Result{}, err
		}
		logged["imageRevealed"] = shown
	}
	return cs.Done(""), eventlog.LogEvent(ctx, tx, c, "actor.picture", logged)
}

// setPicture points the actor at a picture, or at none. Only a picture nothing points at yet may be attached: its id is
// known only to whoever uploaded it, so a seat can never carry a picture the table was not meant to see onto a character
// and show it. A new picture starts held back; without a GM nothing can be, so it is the table's at once, as an entry's
// is (house decision #70). The picture it no longer points at goes if nothing else does.
func setPicture(ctx context.Context, tx core.Conn, c cs.Ctx, actorID, picture string) error {
	var old *string
	if err := tx.QueryRow(ctx, `SELECT image_id::text FROM actor WHERE id = $1`, actorID).Scan(&old); err != nil {
		return err
	}
	if old != nil && *old == picture {
		return nil
	}
	var next *string
	if picture != "" {
		free, err := image.Free(ctx, tx, c.CampaignID, picture)
		if err != nil {
			return err
		}
		if !free {
			return cs.Fail("pictureNotFound")
		}
		next = &picture
	}
	if _, err := tx.Exec(ctx, `UPDATE actor SET image_id = $2, image_revealed = $3 WHERE id = $1`,
		actorID, next, next != nil && !c.HasGM()); err != nil {
		return err
	}
	return image.DropUnused(ctx, tx, c.CampaignID, old)
}
