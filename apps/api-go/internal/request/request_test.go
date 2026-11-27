package request_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/request"
)

// The fixture plus a resource hidden from players and a party pool.
var manifest = strings.Replace(dbtest.Fixture, `"editableBy": "ownerSpendOnly"}`, `"editableBy": "ownerSpendOnly"},
		{"id": "secret", "label": "Secret", "cite": "Fixture p.5", "scope": "entity", "max": "3", "visibility": "gm"},
		{"id": "pool", "label": "Pool", "cite": "Fixture p.6", "scope": "party", "max": "5", "visibility": "party"}`, 1)

// A room with a running session, a character with 5 Vigour, and a player holding it.
func table(t *testing.T, tx pgx.Tx) (dbtest.Room, string, cs.Ctx) {
	t.Helper()
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, manifest)
	id := room.Actor(t, tx, "pc", "Lyra", "character")
	dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 3)`, id)
	dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'hp', 5), ($1, 'focus', 2), ($1, 'secret', 1)`, id)
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return room, id, room.Seat(t, tx, dbtest.User(t, tx, "Player"), id)
}

func send(tx pgx.Tx, c cs.Ctx, actor, resource string, amount float64) (string, error) {
	a := cs.Action{"type": "request.send", "resourceId": resource, "amount": amount}
	if actor != "" {
		a["actorId"] = actor
	}
	res, err := request.Send(context.Background(), tx, c, a)
	return res.ID, err
}

func code(err error) string {
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		return refusal.Code
	}
	return ""
}

func hp(t *testing.T, tx pgx.Tx, actor string) int32 {
	t.Helper()
	return dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, actor)
}

func status(t *testing.T, tx pgx.Tx, id string) string {
	t.Helper()
	return dbtest.Scalar[string](t, tx, `SELECT status FROM spend_request WHERE id = $1`, id)
}

func act(typ string, id string) cs.Action { return cs.Action{"type": typ, "id": id} }

func TestSendIsRefusedWhereAPlayerMayNotAsk(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room, hero, player := table(t, tx)
		other := room.Actor(t, tx, "pc", "Kael", "character")
		for _, c := range []struct{ name, actor, resource, want string }{
			{"a hidden resource", hero, "secret", "requestNotAllowed"},
			{"a party pool", hero, "pool", "requestNotAllowed"},
			{"one the player spends themselves", hero, "focus", "requestSpendYourself"},
			{"another player's character", other, "hp", "notYourCharacter"},
			{"a shared pool with no character", "", "pool", "requestNoPool"},
			{"a resource that does not exist", hero, "mana", "noResourceHere"},
		} {
			if _, err := send(tx, player, c.actor, c.resource, 1); code(err) != c.want {
				t.Errorf("%s: want %s, got %v", c.name, c.want, err)
			}
		}
		if cs.RequirePerm(room.GM(), cs.ActionPerms["request.send"], "") == nil {
			t.Error("the GM side asks for nothing: it answers")
		}
		if cs.RequirePerm(player, cs.ActionPerms["request.approve"], "") == nil {
			t.Error("a player answered a request")
		}
	})
}

func TestSendNeedsASessionAndStopsAtFivePending(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		_, hero, player := table(t, tx)
		for range request.MaxPending {
			if _, err := send(tx, player, hero, "hp", 1); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := send(tx, player, hero, "hp", 1); code(err) != "requestLimit" {
			t.Fatalf("the sixth: want requestLimit, got %v", err)
		}
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now()`)
		if _, err := send(tx, player, hero, "hp", 1); code(err) != "noSessionRunning" {
			t.Fatalf("no session: got %v", err)
		}
	})
}

func TestApproveSpendsClampedAndUndoRevertsIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room, hero, player := table(t, tx)
		id, err := send(tx, player, hero, "hp", 99)
		if err != nil {
			t.Fatal(err)
		}
		dbtest.Must[cs.Result](t)(request.Approve(ctx, tx, room.GM(), act("request.approve", id)))
		if got := hp(t, tx, hero); got != 0 {
			t.Fatalf("hp %d, want it clamped at 0", got)
		}
		if got := status(t, tx, id); got != "approved" {
			t.Fatalf("status %s", got)
		}
		if _, err := request.Approve(ctx, tx, room.GM(), act("request.approve", id)); code(err) != "requestAnswered" {
			t.Fatalf("approving twice: got %v", err)
		}
		dbtest.Must[cs.Result](t)(campaign.Undo(ctx, tx, room.GM(), cs.Action{"type": "event.undo"}))
		if got := hp(t, tx, hero); got != 5 {
			t.Fatalf("hp %d after undo, want 5", got)
		}
		// The undone approval leaves the ask waiting again, to be answered anew (house decision #119).
		if got := status(t, tx, id); got != "pending" {
			t.Fatalf("status %s after undo, want pending", got)
		}
		dbtest.Must[cs.Result](t)(request.Deny(ctx, tx, room.GM(), act("request.deny", id)))
	})
}

// A spend at the floor changes nothing and logs no action: it is approved all the same, with nothing to reopen.
func TestApprovingASpendThatChangesNothing(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room, hero, player := table(t, tx)
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 0 WHERE actor_id = $1 AND resource_id = 'hp'`, hero)
		id, err := send(tx, player, hero, "hp", 1)
		if err != nil {
			t.Fatal(err)
		}
		dbtest.Must[cs.Result](t)(request.Approve(ctx, tx, room.GM(), act("request.approve", id)))
		if got := status(t, tx, id); got != "approved" {
			t.Fatalf("status %s", got)
		}
		if dbtest.Scalar[bool](t, tx, `SELECT action_id IS NOT NULL FROM spend_request WHERE id = $1`, id) {
			t.Fatal("an action id for a spend that logged nothing")
		}
	})
}

func TestDenyKeepsTheReasonAndAnswersOnce(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room, hero, player := table(t, tx)
		id, _ := send(tx, player, hero, "hp", 2)
		dbtest.Must[cs.Result](t)(request.Deny(ctx, tx, room.GM(), cs.Action{"id": id, "reason": "not yet"}))
		if got := hp(t, tx, hero); got != 5 {
			t.Fatalf("a denial spent: hp %d", got)
		}
		answers := dbtest.Must[[]cs.RequestAnswer](t)(request.LoadAnswers(ctx, tx, room.ID))
		if len(answers) != 1 || answers[0].Status != "denied" || answers[0].Reason != "not yet" {
			t.Fatalf("answers: %+v", answers)
		}
		if _, err := request.Deny(ctx, tx, room.GM(), act("request.deny", id)); code(err) != "requestAnswered" {
			t.Fatalf("denying twice: got %v", err)
		}
		if pending := dbtest.Must[[]cs.SpendRequest](t)(request.Load(ctx, tx, room.ID)); len(pending) != 0 {
			t.Fatalf("still pending: %+v", pending)
		}
	})
}

func TestOnlyTheAskerCancelsAndOnlyWhilePending(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room, hero, player := table(t, tx)
		rival := room.Seat(t, tx, dbtest.User(t, tx, "Rival"))
		id, _ := send(tx, player, hero, "hp", 1)
		if _, err := request.Cancel(ctx, tx, rival, act("request.cancel", id)); code(err) != "requestNotFound" {
			t.Fatalf("another player's cancel: got %v", err)
		}
		dbtest.Must[cs.Result](t)(request.Cancel(ctx, tx, player, act("request.cancel", id)))
		if got := status(t, tx, id); got != "cancelled" {
			t.Fatalf("status %s", got)
		}
		if _, err := request.Cancel(ctx, tx, player, act("request.cancel", id)); code(err) != "requestAnswered" {
			t.Fatalf("cancelling twice: got %v", err)
		}
		if _, err := request.Approve(ctx, tx, room.GM(), act("request.approve", id)); code(err) != "requestAnswered" {
			t.Fatalf("approving a cancelled one: got %v", err)
		}
	})
}

func TestEndingTheSessionCancelsPending(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room, hero, player := table(t, tx)
		id, _ := send(tx, player, hero, "hp", 1)
		dbtest.Must[cs.Result](t)(campaign.SessionEnd(context.Background(), tx, room.GM(), cs.Action{"type": "session.end"}))
		if got := status(t, tx, id); got != "cancelled" {
			t.Fatalf("status %s", got)
		}
	})
}

func TestARequestOfAnotherRoomIsNotFound(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		_, hero, player := table(t, tx)
		id, _ := send(tx, player, hero, "hp", 1)
		elsewhere := dbtest.NewRoom(t, tx)
		for _, run := range []func() error{
			func() error {
				_, err := request.Approve(ctx, tx, elsewhere.GM(), act("request.approve", id))
				return err
			},
			func() error { _, err := request.Deny(ctx, tx, elsewhere.GM(), act("request.deny", id)); return err },
			func() error {
				c := elsewhere.Seat(t, tx, *player.UserID)
				_, err := request.Cancel(ctx, tx, c, act("request.cancel", id))
				return err
			},
		} {
			if err := run(); code(err) != "requestNotFound" {
				t.Fatalf("got %v", err)
			}
		}
		if got := status(t, tx, id); got != "pending" {
			t.Fatalf("status %s", got)
		}
	})
}
