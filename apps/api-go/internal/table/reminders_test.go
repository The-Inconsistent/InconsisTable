package table

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// House decision #81 through the api on the sides play fixture: reminder lines, a whole side barred, immunity, a
// condition armed from its holder's next turn, stacks on the chip and a rest refused while downed. Our own invention.

func reminderFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(sidesFixture(t, map[string]any{
		"setup": map[string]any{"cite": "Fixture p.4", "note": "Mark who is caught off guard"},
	})), &m); err != nil {
		t.Fatal(err)
	}
	cite := "Fixture p.10"
	m["conditions"] = append(m["conditions"].([]any),
		map[string]any{"id": "burning", "label": "Burning", "cite": cite, "duration": "manual", "at": "turnStart",
			"text": "Burning: lose 1 Vigour"},
		map[string]any{"id": "reeling", "label": "Reeling", "cite": cite, "duration": "ownTurnEnd", "from": "nextOwnTurn",
			"stacking": "stack", "maxStacks": 3, "immune": "level >= 5"},
	)
	m["reminders"] = []any{
		map[string]any{"id": "rally", "at": "turnStart", "text": "Rally below half", "if": "res.hp * 2 <= derived.maxHp", "cite": cite},
		map[string]any{"id": "footing", "at": "turnEnd", "text": "Check footing", "cite": cite},
		map[string]any{"id": "heldLost", "at": "roundEnd", "text": "A held action is lost", "if": "held", "cite": cite},
		map[string]any{"id": "offGuard", "at": "roundEnd", "text": "No longer off guard", "if": "barred && round == 1", "cite": cite},
	}
	m["rests"] = []any{map[string]any{"event": "longRest", "refusedIn": []any{"downed"}, "cite": cite}}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func newReminderPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, reminderFixture(t))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// lines is the reminder lines the GM side is sent now, as "<at>:<id>:<actor ids>".
func (p *play) lines() []string {
	out := []string{}
	for _, r := range p.enc().Reminders {
		ids := ""
		for _, id := range r.ActorIDs {
			ids += tail(id)
		}
		out = append(out, r.At+":"+r.ID+":"+ids)
	}
	return out
}

func tail(id string) string { return id[len(id)-4:] }

func TestRemindersShowToTheCombatSideAtTheirMoment(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newReminderPlay(t, tx)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()
		// Setup: a whole side barred in one action, then freed and one barred alone.
		p.send(gm, sidesOp("bar", map[string]any{"side": "wardens", "barred": true}))
		if got := p.turn().Barred; !slices.Equal(got, []string{w1, w2}) {
			t.Fatalf("a side barred: got %v", got)
		}
		p.refused(gm, sidesOp("bar", map[string]any{"side": "nobody", "barred": true}), "badInput")
		p.send(gm, sidesOp("bar", map[string]any{"side": "wardens", "barred": false}))
		p.send(gm, sidesOp("bar", map[string]any{"id": w2, "barred": true}))
		if got := p.lines(); len(got) != 0 {
			t.Fatalf("nothing before the fight begins: %v", got)
		}
		p.send(gm, sidesOp("begin", map[string]any{}))
		// Wren is below half and burning: both lines at its turn's start, footing at its end.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 2 WHERE actor_id = $1 AND resource_id = 'hp'`, w1)
		p.send(gm, map[string]any{"type": "condition.add", "actorId": w1, "condition": "burning"})
		p.send(gm, pick(w1))
		want := []string{"turnStart:rally:" + tail(w1), "turnStart:burning:" + tail(w1), "turnEnd:footing:"}
		if got := p.lines(); !slices.Equal(got, want) {
			t.Fatalf("Wren's turn: want %v, got %v", want, got)
		}
		// Nobody else reads them: a player and the table screen.
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pia"), w1)
		screen := gm
		screen.UserID, screen.Seat = nil, cs.Seat{Kind: cs.SeatToken, Role: "screen", CharacterIDs: []string{}}
		for _, seat := range []cs.Ctx{player, screen} {
			if e := p.seatView(seat).State.Encounter; e == nil || e.Reminders != nil {
				t.Fatalf("a seat off the combat side: %+v", e)
			}
		}
		// The raider holds; Wick stays barred: at the round's end both are named, each by its line.
		p.send(gm, pick(r1))
		p.send(gm, sidesOp("hold", map[string]any{}))
		want = []string{"roundEnd:heldLost:" + tail(r1), "roundEnd:offGuard:" + tail(w2)}
		if got := p.lines(); !slices.Equal(got, want) {
			t.Fatalf("round complete: want %v, got %v", want, got)
		}
	})
}

func TestImmunityArmingStacksAndARefusedRest(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newReminderPlay(t, tx)
		gm := p.room.GM()
		w1, w2, r1 := p.sidesFight()
		reeling := func(id string) map[string]any {
			return map[string]any{"type": "condition.add", "actorId": id, "condition": "reeling"}
		}
		// Immune at level 5 or more, by name.
		big := p.character("Giant", 5)
		refusal := p.refusedAny(gm, reeling(big))
		if refusal.Code != "conditionImmune" || refusal.Params["name"] != "Giant" || refusal.Params["condition"] != "Reeling" {
			t.Fatalf("immune: got %+v", refusal)
		}
		p.send(gm, sidesOp("begin", map[string]any{}))
		// Added during Wren's own turn: it survives that turn's end and goes at the end of the next one.
		p.send(gm, pick(w1))
		p.send(gm, reeling(w1))
		p.send(gm, reeling(w1))
		chip := func(id string) *cs.CombatantCondition {
			for _, c := range p.enc().Combatants {
				for _, k := range c.Conditions {
					if c.ActorID == id && k.ID == "reeling" {
						return &k
					}
				}
			}
			return nil
		}
		if k := chip(w1); k == nil || k.Stacks != 2 || k.Left == nil || *k.Left != 2 {
			t.Fatalf("two stacks, two ticks: %+v", k)
		}
		// Added outside Wick's turn: it ends at the end of Wick's next turn.
		p.send(gm, reeling(w2))
		p.send(gm, sidesOp("next", map[string]any{}))
		if p.conditions(w1) != 1 {
			t.Fatal("Wren keeps it past its own turn")
		}
		// Undo takes the turn's end back with its tick, and the turn's end runs again.
		p.send(gm, map[string]any{"type": "event.undo"})
		if k := chip(w1); k == nil || *k.Left != 2 {
			t.Fatalf("undo gives the tick back: %+v", k)
		}
		p.send(gm, sidesOp("next", map[string]any{}))
		p.send(gm, pick(r1))
		p.send(gm, pick(w2))
		p.send(gm, sidesOp("next", map[string]any{}))
		if p.conditions(w2) != 0 {
			t.Fatal("Wick's goes at its next turn's end")
		}
		p.send(gm, sidesOp("newRound", map[string]any{}))
		p.send(gm, pick(w1))
		p.send(gm, sidesOp("next", map[string]any{}))
		if p.conditions(w1) != 0 {
			t.Fatal("Wren's goes at its next turn's end")
		}

		// A long rest is refused for one who is downed, and the party's skips it by name.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 0 WHERE actor_id = $1 AND resource_id = 'hp'`, w2)
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 1 WHERE actor_id = $1 AND resource_id = 'hp'`, w1)
		refusal = p.refusedAny(gm, map[string]any{"type": "actor.rest", "event": "longRest", "actorId": w2})
		if refusal.Code != "restRefused" || refusal.Params["name"] != "Wick" || refusal.Params["state"] != "downed" {
			t.Fatalf("one downed: got %+v", refusal)
		}
		r := p.send(gm, map[string]any{"type": "actor.rest", "event": "longRest"})
		if !slices.Equal(r.Skipped, []string{"Wick"}) {
			t.Fatalf("skipped: got %v", r.Skipped)
		}
		if p.res(w1, "hp") != 10 || p.res(w2, "hp") != 0 {
			t.Fatalf("Wren rested, Wick did not: %d, %d", p.res(w1, "hp"), p.res(w2, "hp"))
		}
	})
}
