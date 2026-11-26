package codex

import (
	"bytes"
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
)

// A character's picture (house decision #155): the seat holding it and the GM side upload it, nobody else.
func TestAnActorsPictureIsUploadedByItsHolderOrTheGM(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		wren, bram := room.Actor(t, tx, "pc", "Wren", ""), room.Actor(t, tx, "pc", "Bram", "")
		creature := room.Actor(t, tx, "creature", "Gull", "")
		holder := room.Seat(t, tx, dbtest.User(t, tx, "Holder"), wren)
		other := room.Seat(t, tx, dbtest.User(t, tx, "Other"), bram)
		screen := cs.Ctx{CampaignID: room.ID, CampaignOwnerID: &room.Owner, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
		for _, ok := range []struct {
			c     cs.Ctx
			actor string
		}{{holder, wren}, {room.GM(), wren}, {room.GM(), creature}} {
			if err := MayPictureActor(ctx, tx, ok.c, ok.actor); err != nil {
				t.Errorf("refused %v for %s: %v", ok.c.Seat.Role, ok.actor, err)
			}
		}
		for _, no := range []struct {
			c           cs.Ctx
			actor, code string
		}{
			{other, wren, "notYourCharacter"},
			{holder, creature, "notYourCharacter"},
			{screen, wren, "screenReadOnly"},
			{dbtest.NewRoom(t, tx).GM(), wren, "characterNotFound"},
		} {
			if err := MayPictureActor(ctx, tx, no.c, no.actor); code(err) != no.code {
				t.Errorf("%s for %s: want %s, got %v", no.c.Seat.Role, no.actor, no.code, err)
			}
		}
		if _, err := store(ctx, tx, holder, "image/gif", jpeg); code(err) != "pictureType" {
			t.Errorf("a gif: %v", err)
		}
		if _, err := store(ctx, tx, holder, "image/webp", jpeg); code(err) != "pictureNotPicture" {
			t.Errorf("jpeg bytes sent as webp: %v", err)
		}
		large := append(bytes.Clone(jpeg), make([]byte, image.MaxBytes)...)
		if _, err := store(ctx, tx, holder, "image/jpeg", large); code(err) != "pictureTooLarge" {
			t.Errorf("over 1 MB: %v", err)
		}
	})
}

// Attaching, showing, replacing and removing: the holder sees a held-back picture, the rest of the table only once it
// is shown, and every step is logged in the running session.
func TestAnActorsPictureIsShownWhenItsHolderSaysSo(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
		wren, bram := room.Actor(t, tx, "pc", "Wren", ""), room.Actor(t, tx, "pc", "Bram", "")
		holder := room.Seat(t, tx, dbtest.User(t, tx, "Holder"), wren)
		other := room.Seat(t, tx, dbtest.User(t, tx, "Other"), bram)
		screen := cs.Ctx{CampaignID: room.ID, CampaignOwnerID: &room.Owner, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
		picture := func(c cs.Ctx, a cs.Action) error {
			a["type"], a["actorId"] = "actor.picture", wren
			_, err := actor.Picture(ctx, tx, c, a)
			return err
		}
		sees := func(c cs.Ctx, id string) bool {
			t.Helper()
			p, err := servable(ctx, tx, c, id)
			if err != nil {
				t.Fatal(err)
			}
			return p != nil
		}
		first := dbtest.Must[string](t)(store(ctx, tx, holder, "image/jpeg", jpeg))
		if err := picture(holder, cs.Action{"imageId": first}); err != nil {
			t.Fatal(err)
		}
		if !sees(holder, first) || !sees(room.GM(), first) || sees(other, first) || sees(screen, first) {
			t.Fatal("held back: the holder and the GM see it, another player and the screen do not")
		}
		if err := picture(holder, cs.Action{"imageRevealed": true}); err != nil {
			t.Fatal(err)
		}
		if !sees(other, first) || !sees(screen, first) {
			t.Fatal("shown: the whole table sees it")
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type = 'actor.picture'
			AND payload->>'actorId' = $2`, room.ID, wren); n != 2 {
			t.Fatalf("logged %d steps", n)
		}

		// Only a picture nothing points at yet can be attached: one shown on an entry, or another room's, cannot.
		entryPicture := put(t, tx, room)
		run(t, tx, room, Save, save("npc", "Watcher", cs.Action{"imageId": entryPicture}))
		foreign := put(t, tx, dbtest.NewRoom(t, tx))
		for _, id := range []string{entryPicture, foreign} {
			if err := picture(holder, cs.Action{"imageId": id}); code(err) != "pictureNotFound" {
				t.Fatalf("attached %s: %v", id, err)
			}
		}

		// A new picture starts held back and the old one goes.
		second := dbtest.Must[string](t)(store(ctx, tx, room.GM(), "image/jpeg", jpeg))
		if err := picture(room.GM(), cs.Action{"imageId": second}); err != nil {
			t.Fatal(err)
		}
		if sees(other, second) || dbtest.Scalar[bool](t, tx, `SELECT EXISTS (SELECT 1 FROM image WHERE id = $1)`, first) {
			t.Fatal("a replaced picture stayed shown, or the old one stayed")
		}
		// An attached picture outlives the sweep a codex write runs.
		dbtest.Exec(t, tx, `UPDATE image SET created_at = now() - interval '25 hours' WHERE id = $1`, second)
		run(t, tx, room, Save, save("lore", "Note", nil))
		if !dbtest.Scalar[bool](t, tx, `SELECT EXISTS (SELECT 1 FROM image WHERE id = $1)`, second) {
			t.Fatal("the sweep took an actor's picture")
		}
		if err := picture(holder, cs.Action{"imageId": nil}); err != nil {
			t.Fatal(err)
		}
		if dbtest.Scalar[bool](t, tx, `SELECT EXISTS (SELECT 1 FROM image WHERE id = $1)`, second) {
			t.Fatal("a removed picture stayed")
		}

		// Deleting the character takes its picture.
		third := dbtest.Must[string](t)(store(ctx, tx, holder, "image/jpeg", jpeg))
		if err := picture(holder, cs.Action{"imageId": third}); err != nil {
			t.Fatal(err)
		}
		if _, err := actor.Delete(ctx, tx, room.GM(), cs.Action{"type": "actor.delete", "id": wren}); err != nil {
			t.Fatal(err)
		}
		if dbtest.Scalar[bool](t, tx, `SELECT EXISTS (SELECT 1 FROM image WHERE id = $1)`, third) {
			t.Fatal("a deleted character's picture stayed")
		}
	})
}

// Without a GM nothing can be held back: a character's new picture is the table's at once, as an entry's is.
func TestAnActorsPictureWithoutAGMIsShownAtOnce(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		dbtest.Exec(t, tx, `UPDATE campaign SET table_mode = 'gmless' WHERE id = $1`, room.ID)
		wren := room.Actor(t, tx, "pc", "Wren", "")
		c := room.Seat(t, tx, dbtest.User(t, tx, "Player"), wren)
		c.TableMode = cs.TableModeGMLess
		p := dbtest.Must[string](t)(store(ctx, tx, c, "image/jpeg", jpeg))
		if _, err := actor.Picture(ctx, tx, c, cs.Action{"type": "actor.picture", "actorId": wren, "imageId": p}); err != nil {
			t.Fatal(err)
		}
		if !dbtest.Scalar[bool](t, tx, `SELECT image_revealed FROM actor WHERE id = $1`, wren) {
			t.Fatal("without a GM a picture is the table's")
		}
	})
}
