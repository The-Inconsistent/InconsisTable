package table

import (
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// A spend limited per round (house decision #91) on the invented sides fixture: counted per actor and round, refused a
// second time, free again next round, and given back by Undo and TURN BACK with its cost.

var channelSpend = spend("channel", []any{poolCost("momentum", "1 + ctx.push", false)}, map[string]any{
	"inputs": map[string]any{"push": map[string]any{"label": "Push", "min": 0, "max": "2"}},
	"limit":  map[string]any{"per": "round", "max": 1},
})

func newChannelPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, withSpends(t, sidesFixture(t, nil), append(slices.Clone(sidesSpends), channelSpend), 0))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// usedOf is the spends a combatant used this round, as the GM's tracker is sent them.
func (p *play) usedOf(actorID string) []string {
	p.t.Helper()
	for _, c := range p.enc().Combatants {
		if c.ActorID == actorID {
			return c.Used
		}
	}
	p.t.Fatalf("%s is not in the fight", actorID)
	return nil
}

func TestASpendLimitedPerRoundIsRefusedTwiceAndFreeNextRound(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newChannelPlay(t, tx)
		gm := p.room.GM()
		w1, w2, _ := p.sidesFight()
		p.fill("momentum", 5)
		push := func(n float64) map[string]any { return map[string]any{"push": n} }

		p.send(gm, doSpend(w1, "channel", push(1)))
		wantPool(t, p, "momentum", 3) // the cost, once
		if got := p.usedOf(w1); !slices.Equal(got, []string{"channel"}) {
			t.Fatalf("Wren's use is on the tracker: %v", got)
		}
		refusal := p.refusedAny(gm, doSpend(w1, "channel", push(0)))
		if refusal.Code != "usedThisRound" || refusal.Params["detail"] != `"channel", round 1` {
			t.Fatalf("a second use names the use and the round: %+v", refusal)
		}
		wantPool(t, p, "momentum", 3)
		p.send(gm, doSpend(w2, "channel", push(0))) // another actor's own count
		wantPool(t, p, "momentum", 2)

		// Undo gives Wick's use back with its cost; Wren's stays.
		p.send(gm, map[string]any{"type": "event.undo"})
		wantPool(t, p, "momentum", 3)
		if got := p.usedOf(w2); len(got) != 0 {
			t.Fatalf("undone: Wick used %v", got)
		}
		p.refused(gm, doSpend(w1, "channel", push(0)), "usedThisRound")

		// A new round clears it; TURN BACK over the round brings the old round's use back.
		p.send(gm, sidesOp("newRound", map[string]any{}))
		if got := p.usedOf(w1); len(got) != 0 {
			t.Fatalf("a new round: Wren used %v", got)
		}
		p.send(gm, doSpend(w1, "channel", push(0)))
		wantPool(t, p, "momentum", 2)
		p.send(gm, turnBack)
		wantPool(t, p, "momentum", 3)
		if got := p.usedOf(w1); !slices.Equal(got, []string{"channel"}) {
			t.Fatalf("TURN BACK to round 1: Wren used %v", got)
		}
		p.refused(gm, doSpend(w1, "channel", push(0)), "usedThisRound")
	})
}

func TestAnAskedSpendLimitedPerRoundCountsWhenApproved(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newChannelPlay(t, tx)
		gm := p.room.GM()
		w1, _, _ := p.sidesFight()
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), w1)
		p.fill("momentum", 5)
		id := p.send(asker, ask(w1, "channel", map[string]any{"push": 0.0})).ID
		p.send(gm, doSpend(w1, "channel", map[string]any{"push": 0.0}))
		p.refused(gm, map[string]any{"type": "request.approve", "id": id}, "usedThisRound")
		p.send(gm, map[string]any{"type": "request.deny", "id": id})
		p.refused(asker, ask(w1, "channel", map[string]any{"push": 1.0}), "usedThisRound")
		wantPool(t, p, "momentum", 4)
	})
}
