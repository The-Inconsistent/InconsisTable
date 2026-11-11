package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func refused(t *testing.T, err error, code string) *cs.Error {
	t.Helper()
	var refusal *cs.Error
	if !errors.As(err, &refusal) || refusal.Code != code {
		t.Fatalf("want refusal %s, got %v", code, err)
	}
	return refusal
}

// A member of the room with this role, and their seat.
func seated(t *testing.T, tx pgx.Tx, room dbtest.Room, name, role string) cs.Ctx {
	user := dbtest.User(t, tx, name)
	dbtest.Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, $3)`, room.ID, user, role)
	owner := room.Owner
	return cs.Ctx{CampaignID: room.ID, UserID: &user, CampaignOwnerID: &owner, Seat: cs.Seat{Kind: cs.SeatMember, Role: role}}
}

func TestNoGmRemovesTheOwnerAndOnlyTheOwnerRemovesAGm(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		gm := seated(t, tx, room, "Second GM", "gm")
		cogm := seated(t, tx, room, "Co-GM", "cogm")
		_, err := MemberRemove(ctx, tx, gm, cs.Action{"type": "member.remove", "userId": room.Owner})
		refused(t, err, "ownerNotRemovable")
		_, err = MemberRemove(ctx, tx, cogm, cs.Action{"type": "member.remove", "userId": *gm.UserID})
		refused(t, err, "onlyOwnerRemovesGm")
		if _, err := MemberRemove(ctx, tx, room.GM(), cs.Action{"type": "member.remove", "userId": *gm.UserID}); err != nil {
			t.Fatalf("the owner removes a GM: %v", err)
		}
	})
}

func TestOnlyTheRecipientAcceptsARoomOffer(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		ben := seated(t, tx, room, "Ben", "player")
		cara := seated(t, tx, room, "Cara", "player")
		if _, err := Transfer(ctx, tx, room.GM(), cs.Action{"type": "campaign.transfer", "toUserId": *ben.UserID}); err != nil {
			t.Fatal(err)
		}
		_, err := TransferAccept(ctx, tx, cara, cs.Action{"type": "campaign.transferAccept"})
		refused(t, err, "noOffer")
		if _, err := TransferAccept(ctx, tx, ben, cs.Action{"type": "campaign.transferAccept"}); err != nil {
			t.Fatalf("the recipient accepts: %v", err)
		}
		if owner := dbtest.Scalar[string](t, tx, `SELECT owner_user_id FROM campaign WHERE id = $1`, room.ID); owner != *ben.UserID {
			t.Fatalf("the room's owner is now %s", owner)
		}
		if role := dbtest.Scalar[string](t, tx, `SELECT role FROM membership WHERE campaign_id = $1 AND user_id = $2`, room.ID, *ben.UserID); role != "gm" {
			t.Fatalf("the new owner sits as a GM, not %s", role)
		}
	})
}

func TestARoomInviteMakesOnlySoManyCharacters(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		invite := dbtest.Must[cs.Result](t)(InviteCreate(ctx, tx, room.GM(), cs.Action{
			"type": "invite.create", "mode": "room", "role": "player", "allowGuests": true, "hours": 12.0,
		}))
		join := map[string]any{"newCharacterName": "Ana", "asGuest": true}
		dbtest.Exec(t, tx, `UPDATE invite SET uses = $2 WHERE id = $1`, invite.ID, MaxNewCharactersPerInvite)
		_, _, err := AcceptInvite(ctx, tx, invite.Token, nil, join)
		if r := refused(t, err, "inviteCharacterLimit"); r.Params["limit"] != MaxNewCharactersPerInvite {
			t.Fatalf("the refusal names the limit: %v", r.Params)
		}
		dbtest.Exec(t, tx, `UPDATE invite SET uses = 0 WHERE id = $1`, invite.ID)
		dbtest.Exec(t, tx, `INSERT INTO actor (campaign_id, kind, name) SELECT $1, 'pc', 'Extra ' || n FROM generate_series(1, $2) n`,
			room.ID, MaxNewCharactersPerCampaign)
		_, _, err = AcceptInvite(ctx, tx, invite.Token, nil, join)
		refused(t, err, "gameCharacterLimit")
	})
}
