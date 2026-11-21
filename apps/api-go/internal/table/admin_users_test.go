package table

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/admin"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The admin console's users and per-room controls (house decision #94).

// runIn applies an action in the test's transaction and answers as the gateway does: the result, or the refused ack.
func runIn(t *testing.T, tx pgx.Tx) func(cs.Ctx, cs.Action) any {
	return func(c cs.Ctx, a cs.Action) any {
		r, err := ApplyAction(context.Background(), tx, c, a)
		var refusal *cs.Error
		if errors.As(err, &refusal) {
			return Refused(refusal.Code, refusal.Params)
		}
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
}

func adminAt(room dbtest.Room) cs.Ctx {
	owner := room.Owner
	return cs.Ctx{CampaignID: room.ID, CampaignOwnerID: &owner, TableMode: "gm", Seat: cs.Seat{Kind: cs.SeatAdmin}}
}

func TestTheUsersListShowsRolesAccountsAndSeatsWithTheirCharacters(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		mara := room.Actor(t, tx, "pc", "Mara", "")
		user := dbtest.User(t, tx, "Ana")
		room.Seat(t, tx, user, mara)
		dbtest.Exec(t, tx, `UPDATE app_user SET last_seen_at = now() + interval '1 hour' WHERE id IN ($1, $2)`, user, room.Owner)
		dbtest.Exec(t, tx, `INSERT INTO identity_link (iss, sub, user_id) VALUES ('https://id.test', 'sub-1', $1)`, room.Owner)

		users, err := admin.ListUsers(context.Background(), tx)
		if err != nil {
			t.Fatal(err)
		}
		byID := map[string]admin.UserRow{}
		for _, u := range users {
			byID[u.ID] = u
		}
		ana, owner := byID[user], byID[room.Owner]
		if ana.Name != "Ana" || ana.Role != "creator" || ana.Account || len(ana.Seats) != 1 {
			t.Fatalf("a device user with one seat: %+v", ana)
		}
		if s := ana.Seats[0]; s.CampaignID != room.ID || s.CampaignName != "Room" || s.Role != "player" || s.Owner ||
			len(s.Characters) != 1 || s.Characters[0] != "Mara" {
			t.Fatalf("the seat names its room, role and character: %+v", s)
		}
		if !owner.Account || len(owner.Seats) != 1 || !owner.Seats[0].Owner || owner.Seats[0].Role != "gm" {
			t.Fatalf("the owner is an account, a GM who owns the room: %+v", owner)
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM admin_event WHERE action = 'user.list' AND actor_user_id = 'admin-key'`); n == 0 {
			t.Fatal("reading the list is logged")
		}
	})
}

func TestRemovingAUserFromEveryRoomKeepsTheRoomsTheyOwn(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		one, two := dbtest.NewRoom(t, tx), dbtest.NewRoom(t, tx)
		user := dbtest.User(t, tx, "Ana")
		mara := one.Actor(t, tx, "pc", "Mara", "")
		one.Seat(t, tx, user, mara)
		dbtest.Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, two.ID, user)
		// A room Ana owns.
		owned := dbtest.NewRoom(t, tx)
		dbtest.Exec(t, tx, `UPDATE campaign SET owner_user_id = $2 WHERE id = $1`, owned.ID, user)
		dbtest.Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, owned.ID, user)

		if _, err := admin.Unseat(ctx, tx, runIn(t, tx), "nobody-here"); err == nil {
			t.Fatal("an unknown user is not found")
		}
		out, err := admin.Unseat(ctx, tx, runIn(t, tx), user)
		if err != nil {
			t.Fatal(err)
		}
		if len(out.Removed) != 2 || len(out.Kept) != 1 || out.Kept[0].CampaignID != owned.ID || out.Kept[0].Code != "ownerNotRemovable" {
			t.Fatalf("removed from both rooms, kept in the one they own: %+v", out)
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM membership WHERE user_id = $1`, user); n != 1 {
			t.Fatalf("%d seats left", n)
		}
		if dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM actor WHERE id = $1`, mara) != 1 {
			t.Fatal("their character stays in the room")
		}
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM admin_event WHERE action = 'user.unseat' AND target_user_id = $1`, user); n != 3 {
			t.Fatalf("%d user.unseat rows, want one per room", n)
		}
	})
}

func TestTheAdminEndsASessionWithoutAnAwardAndDeletesTheLast(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		run := runIn(t, tx)
		a := adminAt(p.room)
		if code := refusalCode(run(a, cs.Action{"type": "session.abandon", "recap": ""})); code != "noSessionRunning" {
			t.Fatalf("with no session: %s", code)
		}
		id := p.startTitled("Left open")
		if code := refusalCode(run(a, cs.Action{"type": "session.delete", "sessionId": id})); code != "endSessionFirst" {
			t.Fatalf("a running session: %s", code)
		}
		if code := refusalCode(run(a, cs.Action{"type": "session.abandon", "recap": ""})); code != "" {
			t.Fatalf("abandon refused: %s", code)
		}
		if !dbtest.Scalar[bool](t, tx, `SELECT abandoned FROM session WHERE id = $1`, id) {
			t.Fatal("the session ends without an award")
		}
		if code := refusalCode(run(a, cs.Action{"type": "session.delete", "sessionId": id})); code != "" {
			t.Fatalf("delete refused: %s", code)
		}
		if dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM session WHERE campaign_id = $1`, p.room.ID) != 0 {
			t.Fatal("the last session is gone")
		}
	})
}

func refusalCode(answer any) string {
	if m, ok := answer.(map[string]any); ok {
		code, _ := m["code"].(string)
		return code
	}
	return ""
}
