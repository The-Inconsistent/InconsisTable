package codex

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
)

var jpeg = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'p', 'i', 'c'}

func put(t *testing.T, tx pgx.Tx, room dbtest.Room) string {
	t.Helper()
	id, err := StorePicture(context.Background(), tx, room.GM(), "image/jpeg", jpeg)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func held(t *testing.T, tx pgx.Tx, room dbtest.Room) []string {
	t.Helper()
	infos := dbtest.Must[[]image.Info](t)(image.Pictures.Usage(context.Background(), tx, room.ID))
	ids := []string{}
	for _, p := range infos {
		ids = append(ids, p.ID)
	}
	return ids
}

func code(err error) string {
	var e *cs.Error
	var h *core.HTTPError
	switch {
	case errors.As(err, &e):
		return e.Code
	case errors.As(err, &h):
		body, _ := h.Body.(cs.Body)
		return body.Code
	}
	return ""
}

func TestUploadKeepsToTheRoomsLimits(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		player := room.Seat(t, tx, dbtest.User(t, tx, "Player"))
		if _, err := StorePicture(ctx, tx, player, "image/jpeg", jpeg); code(err) != "noPermission" {
			t.Fatalf("a player uploaded a picture into a room with a GM: %v", err)
		}
		if _, err := StorePicture(ctx, tx, room.GM(), "image/webp", jpeg); code(err) != "pictureNotPicture" {
			t.Fatalf("jpeg bytes sent as webp: %v", err)
		}
		if _, err := StorePicture(ctx, tx, room.GM(), "image/gif", jpeg); code(err) != "pictureType" {
			t.Fatalf("a gif: %v", err)
		}
		dbtest.Exec(t, tx, `INSERT INTO image (campaign_id, mime, bytes, size)
			SELECT $1, 'image/jpeg', '\xffd8ff00'::bytea, 4 FROM generate_series(1, $2)`, room.ID, image.MaxCount-1)
		put(t, tx, room)
		if _, err := StorePicture(ctx, tx, room.GM(), "image/jpeg", jpeg); code(err) != "picturesFull" {
			t.Fatalf("the 201st picture: %v", err)
		}
		other := dbtest.NewRoom(t, tx)
		dbtest.Exec(t, tx, `INSERT INTO image (campaign_id, mime, bytes, size) VALUES ($1, 'image/jpeg', '\xffd8ff00'::bytea, $2)`,
			other.ID, image.MaxRoomBytes-len(jpeg)+1)
		if _, err := StorePicture(ctx, tx, other.GM(), "image/jpeg", jpeg); code(err) != "picturesTooHeavy" {
			t.Fatalf("past 100 MB: %v", err)
		}
	})
}

func TestAttachReplaceAndDeleteCleanUp(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room, other := dbtest.NewRoom(t, tx), dbtest.NewRoom(t, tx)
		foreign := put(t, tx, other)
		npc := run(t, tx, room, Save, save("npc", "Watcher", nil))
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "id": npc, "kind": "npc", "imageId": foreign}, "pictureNotFound")

		first := put(t, tx, room)
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "id": npc, "kind": "npc", "imageId": first})
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": npc, "imageRevealed": true})
		if !dbtest.Scalar[bool](t, tx, `SELECT image_revealed FROM codex_entry WHERE id = $1`, npc) {
			t.Fatal("the picture was not shown")
		}
		// Revealing the picture alone leaves who reads the entry as it was.
		if v := dbtest.Scalar[string](t, tx, `SELECT visibility FROM codex_entry WHERE id = $1`, npc); v != "gm" {
			t.Fatalf("visibility became %q", v)
		}

		second := put(t, tx, room)
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "id": npc, "kind": "npc", "imageId": second})
		if dbtest.Scalar[bool](t, tx, `SELECT image_revealed FROM codex_entry WHERE id = $1`, npc) {
			t.Fatal("a replaced picture stayed shown")
		}
		if got := held(t, tx, room); len(got) != 1 || got[0] != second {
			t.Fatalf("after replacing: %v", got)
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "id": npc, "kind": "npc", "imageId": nil})
		if got := held(t, tx, room); len(got) != 0 {
			t.Fatalf("after removing: %v", got)
		}

		// Two entries sharing a picture: deleting one keeps it for the other.
		shared := put(t, tx, room)
		place := run(t, tx, room, Save, save("location", "Mill", cs.Action{"imageId": shared}))
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "id": npc, "kind": "npc", "imageId": shared})
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": place})
		if got := held(t, tx, room); len(got) != 1 {
			t.Fatalf("a picture still used went: %v", got)
		}
		run(t, tx, room, Delete, cs.Action{"type": "codex.delete", "id": npc})
		if got := held(t, tx, room); len(got) != 0 {
			t.Fatalf("after deleting: %v", got)
		}

		// Never attached: kept for a day, then swept by the next codex write.
		fresh, stale := put(t, tx, room), put(t, tx, room)
		dbtest.Exec(t, tx, `UPDATE image SET created_at = now() - interval '25 hours' WHERE id = $1`, stale)
		run(t, tx, room, Save, save("lore", "Note", nil))
		if got := held(t, tx, room); len(got) != 1 || got[0] != fresh {
			t.Fatalf("after the sweep: %v", got)
		}
	})
}

func TestPictureWithoutAGMIsShownAtOnce(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		dbtest.Exec(t, tx, `UPDATE campaign SET table_mode = 'gmless' WHERE id = $1`, room.ID)
		c := room.Seat(t, tx, dbtest.User(t, tx, "Player"))
		c.TableMode = cs.TableModeGMLess
		picture, err := StorePicture(context.Background(), tx, c, "image/jpeg", jpeg)
		if err != nil {
			t.Fatal(err)
		}
		r, err := Save(context.Background(), tx, c, save("npc", "Watcher", cs.Action{"imageId": picture}))
		if err != nil {
			t.Fatal(err)
		}
		if !dbtest.Scalar[bool](t, tx, `SELECT image_revealed FROM codex_entry WHERE id = $1`, r.ID) {
			t.Fatal("without a GM a picture is the party's")
		}
	})
}

func TestServeAnswersOnlyWhoMaySeeThePicture(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		pc := room.Actor(t, tx, "pc", "Wren", "")
		player := room.Seat(t, tx, dbtest.User(t, tx, "Player"), pc)
		screen := cs.Ctx{CampaignID: room.ID, CampaignOwnerID: &room.Owner, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
		picture := put(t, tx, room)
		npc := run(t, tx, room, Save, save("npc", "Watcher", cs.Action{"imageId": picture}))
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": npc, "visibility": "party", "audienceMode": "all"})
		sees := func(c cs.Ctx, id string) bool {
			t.Helper()
			p, err := servable(ctx, tx, c, id)
			if err != nil {
				t.Fatal(err)
			}
			return p != nil
		}
		if !sees(room.GM(), picture) || sees(player, picture) {
			t.Fatal("before it is shown: the GM sees it, the player does not")
		}
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": npc, "imageRevealed": true})
		if !sees(player, picture) {
			t.Fatal("a shown picture on an entry the player reads")
		}
		if sees(screen, picture) {
			t.Fatal("the table screen is never served a picture")
		}
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": npc, "visibility": "gm", "audienceMode": "all"})
		if sees(player, picture) {
			t.Fatal("a shown picture on an entry the player can't read")
		}
		other := dbtest.NewRoom(t, tx)
		if sees(other.GM(), picture) {
			t.Fatal("another room's GM")
		}
	})
}
