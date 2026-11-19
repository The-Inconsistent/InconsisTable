package table

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// codeOf is the refusal code an action draws as c, "" when it is accepted.
func codeOf(p *play, c cs.Ctx, action map[string]any) string {
	p.t.Helper()
	_, err := p.try(c, action)
	if err == nil {
		return ""
	}
	var refusal *cs.Error
	if !errors.As(err, &refusal) {
		p.t.Fatalf("%v: %v", action, err)
	}
	return refusal.Code
}

// Every cell of house decision #56's table, in a room with a GM and in one without. "gm" is the owner's seat, a holder
// holds a character, a bystander holds none. A refusal never tells a seat a pool it may not see is there.
func TestWhoMayChangeAPoolByHand(t *testing.T) {
	for _, withGM := range []bool{true, false} {
		dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
			room := dbtest.NewRoom(t, tx)
			room.Pin(t, tx, poolFixture(t))
			p := &play{t, tx, room}
			ash := p.character("Ash", 3)
			seats := map[string]cs.Ctx{
				"gm":        room.GM(),
				"holder":    room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash),
				"bystander": room.Seat(t, tx, dbtest.User(t, tx, "Ben")),
			}
			if !withGM {
				p.setMode(room.GM(), "gmless")
			}
			scopes := map[string]string{"gmOwn": "gm", "campOwn": "campaign"}
			for _, id := range []string{"partyGm", "partyOwner", "partySpend", "gmOwn", "campOwn", "hidden"} {
				scope := scopes[id]
				if scope == "" {
					scope = "party"
				}
				dbtest.Exec(t, tx, `INSERT INTO resource_pool (campaign_id, scope, resource_id, value) VALUES ($1, $2, $3, 5)`,
					room.ID, scope, id)
			}
			try := func(who, pool string, delta float64, want string) {
				t.Helper()
				if got := codeOf(p, seats[who], adjustPool(pool, delta)); got != want {
					t.Fatalf("GM in the room %v: %s adjusting %s by %v: want %q, got %q", withGM, who, pool, delta, want, got)
				}
			}

			all := []string{"partyGm", "partyOwner", "partySpend", "gmOwn", "campOwn"}
			for _, pool := range all {
				if withGM {
					try("gm", pool, 1, "")
					try("gm", pool, -1, "")
				} else { // nobody is on the GM side: the owner's seat is a player who holds nothing
					try("gm", pool, 1, "gmOnly")
				}
			}
			if withGM {
				try("gm", "hidden", 1, "")
			} else {
				try("gm", "hidden", 1, "unknownPool")
			}
			for _, who := range []string{"holder", "bystander"} {
				holds := who == "holder"
				try(who, "partyGm", 1, "gmOnly")
				try(who, "partyGm", -1, "gmOnly")
				for _, pool := range []string{"gmOwn", "campOwn"} {
					try(who, pool, 1, "gmOnly")
					try(who, pool, -1, "gmOnly")
				}
				if holds {
					try(who, "partyOwner", 1, "")
					try(who, "partyOwner", -1, "")
					try(who, "partySpend", 1, "onlySpend")
					try(who, "partySpend", -1, "")
				} else {
					try(who, "partyOwner", 1, "gmOnly")
					try(who, "partySpend", -1, "gmOnly")
				}
				try(who, "hidden", 1, "unknownPool")
				try(who, "hidden", -1, "unknownPool")
			}
			// A pool the manifest does not declare, for anyone.
			try("holder", "nowhere", 1, "unknownPool")
			try("gm", "nowhere", 1, "unknownPool")
		})
	}
}

// Other ops are charged by their own permission, but adjustPool is not one of them: a seat the pool refuses stays
// refused, and its value does not move.
func TestAdjustPoolIsNeverChargedLikeOtherOps(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		ash := p.character("Ash", 3)
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		p.startSession()
		p.refused(alice, adjustPool("partyGm", 1), "gmOnly")
		if _, has := poolValue(p, "partyGm"); has {
			t.Fatal("a refused adjust wrote a row")
		}
	})
}
