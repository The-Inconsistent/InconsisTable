package table

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// House decision #82 on the sides play fixture: TURN BACK takes back the fight's last turn step with every action since,
// tells the combat side what it would take, and refuses as a whole. Our own invention.

var turnBack = map[string]any{"type": "event.turnBack"}

func (p *play) hit(actorID string, by float64) {
	p.send(p.room.GM(), map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
		"input": map[string]any{"actorId": actorID, "resource": "hp", "delta": by}})
}

func (p *play) hp(actorID string) int {
	return dbtest.Scalar[int](p.t, p.tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, actorID)
}

func (p *play) wantTurnBack(want *cs.EncounterTurnBack) {
	p.t.Helper()
	got := p.enc().TurnBack
	if (got == nil) != (want == nil) || (got != nil && *got != *want) {
		p.t.Fatalf("turnBack: want %+v, got %+v", want, got)
	}
}

// A Raider's turn ended, then Wick started out of turn for a point of momentum, Rook took two hits and a condition.
func (p *play) stepWithHits() (w1, w2, r1 string) {
	gm := p.room.GM()
	w1, w2, r1 = p.sidesFight()
	p.refused(gm, turnBack, "nothingToTurnBack")
	p.fill("momentum", 2)
	p.send(gm, pick(w1))
	p.send(gm, sidesOp("next", map[string]any{}))
	p.send(gm, sidesOp("seize", map[string]any{"id": w2}))
	p.hit(r1, -1)
	p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})
	p.hit(r1, -2)
	return w1, w2, r1
}

func TestTurnBackTakesTheLastTurnStepWithEverythingSince(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		w1, w2, r1 := p.stepWithHits()
		p.wantCurrent(&w2)
		wantPool(t, p, "momentum", 1)
		p.wantTurnBack(&cs.EncounterTurnBack{Kind: "turnStart", Name: "Wick", Round: 1, Later: 3})

		// Nobody else is told: a player and the table screen.
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pia"), w1)
		screen := gm
		screen.UserID, screen.Seat = nil, cs.Seat{Kind: cs.SeatToken, Role: "screen", CharacterIDs: []string{}}
		for _, seat := range []cs.Ctx{player, screen} {
			if e := p.seatView(seat).State.Encounter; e == nil || e.TurnBack != nil {
				t.Fatalf("a seat off the combat side: %+v", e)
			}
		}

		// One press: the hits, the condition and the paid start go back, and the momentum it cost.
		p.send(gm, turnBack)
		p.wantCurrent(nil)
		wantPool(t, p, "momentum", 2)
		if hp, n := p.hp(r1), p.conditions(r1); hp != 5 || n != 0 {
			t.Fatalf("Rook after TURN BACK: %d Vigour, %d conditions", hp, n)
		}
		p.wantTurnBack(&cs.EncounterTurnBack{Kind: "turnEnd", Name: "Wren", Round: 1, Later: 0})

		// The next press takes the step before: Wren acts again. Undo does not bring a step back.
		p.send(gm, turnBack)
		p.wantCurrent(&w1)
		p.wantTurnBack(&cs.EncounterTurnBack{Kind: "turnStart", Name: "Wren", Round: 1, Later: 0})
		p.send(gm, map[string]any{"type": "event.undo"}) // the pick, since the presses left it
		p.wantCurrent(nil)
		p.wantTurnBack(nil)
		p.refused(gm, turnBack, "nothingToTurnBack")
	})
}

func TestTurnBackThatCannotTakeBackOneActionChangesNothing(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		_, w2, r1 := p.stepWithHits()
		// The condition went another way than through the log: its add can't be taken back.
		dbtest.Exec(t, tx, `DELETE FROM actor_condition WHERE actor_id = $1`, r1)
		ctx := context.Background()
		// The gateway runs each action in a transaction of its own and rolls a refusal back.
		sp := dbtest.Must[pgx.Tx](t)(tx.Begin(ctx))
		a, _ := cs.ParseAction(turnBack)
		_, err := ApplyAction(ctx, sp, p.room.GM(), a)
		var refusal *cs.Error
		if !errors.As(err, &refusal) || refusal.Code != "turnBackRefused" || refusal.Params["n"] != 2 || refusal.Params["count"] != 4 {
			t.Fatalf("want turnBackRefused naming action 2 of 4, got %v", err)
		}
		if err := sp.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		p.wantCurrent(&w2)
		wantPool(t, p, "momentum", 1)
		if hp := p.hp(r1); hp != 2 {
			t.Fatalf("Rook keeps both hits: %d Vigour", hp)
		}
		p.wantTurnBack(&cs.EncounterTurnBack{Kind: "turnStart", Name: "Wick", Round: 1, Later: 3})
	})
}
