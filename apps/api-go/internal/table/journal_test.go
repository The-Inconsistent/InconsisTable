package table

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The action journal (#237, house decisions #131 to #133): undo by line, redo, and the session's history, on the sides
// play fixture. Our own invention.

func undoLine(id string) map[string]any { return map[string]any{"type": "event.undo", "actionId": id} }
func redoLine(id string) map[string]any { return map[string]any{"type": "event.redo", "actionId": id} }

// newest is the newest logged action of the session, standing or not.
func (p *play) newest() string {
	p.t.Helper()
	return dbtest.Scalar[string](p.t, p.tx, `SELECT action_id::text FROM session_event WHERE campaign_id = $1
		AND type = 'delta' ORDER BY created_at DESC, id DESC LIMIT 1`, p.room.ID)
}

// refusedNaming wants the refusal code, naming that later action.
func (p *play) refusedNaming(c cs.Ctx, action map[string]any, code, blocker string) {
	p.t.Helper()
	_, err := p.try(c, action)
	var refusal *cs.Error
	// The value is named by the condition it holds, not by its row's id.
	if !errors.As(err, &refusal) || refusal.Code != code || refusal.Params["actionId"] != blocker ||
		refusal.Params["target"] != `condition "dazed"` {
		p.t.Fatalf("%v: want %s naming %s, got %v", action["type"], code, blocker, err)
	}
}

func TestUndoByLineTakesBackAnEarlierActionUnderLaterOnes(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		_, _, r1 := p.sidesFight()
		p.hit(r1, -1)
		first := p.newest()
		p.hit(r1, -2)
		p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})

		// A count is a change: the first hit goes back under the later one and the condition.
		p.send(gm, undoLine(first))
		if hp := p.hp(r1); hp != 3 {
			t.Fatalf("Rook after undoing the first hit: %d Vigour", hp)
		}
		p.refused(gm, undoLine(first), "alreadyUndone")
		p.refused(gm, undoLine("0190a000-0000-7000-8000-000000000999"), "nothingToUndo")
		// Plain Undo still takes the newest standing action: the condition.
		p.send(gm, undo)
		if n := p.conditions(r1); n != 0 {
			t.Fatalf("plain Undo after a line: %d conditions", n)
		}
	})
}

func TestUndoByLineIsRefusedWhenALaterActionSetTheSameValue(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		_, _, r1 := p.sidesFight()
		p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})
		added := p.newest()
		p.send(gm, map[string]any{"type": "condition.remove", "actorId": r1, "condition": "dazed"})
		removed := p.newest()
		p.refusedNaming(gm, undoLine(added), "undoLaterFirst", removed)
		// Once the later one is undone, the earlier goes back.
		p.send(gm, undoLine(removed))
		p.send(gm, undoLine(added))
		if n := p.conditions(r1); n != 0 {
			t.Fatalf("both undone: %d conditions", n)
		}
	})
}

func TestRedoPutsAnUndoneActionBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		_, _, r1 := p.sidesFight()
		p.hit(r1, -2)
		hit := p.newest()
		p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})
		dazed := p.newest()
		p.refused(gm, redoLine(hit), "nothingToRedo")
		p.send(gm, undoLine(hit))
		p.send(gm, undoLine(dazed))
		p.send(gm, redoLine(hit))
		p.send(gm, redoLine(dazed))
		if hp, n := p.hp(r1), p.conditions(r1); hp != 3 || n != 1 {
			t.Fatalf("after both redos: %d Vigour, %d conditions", hp, n)
		}
		p.refused(gm, redoLine(hit), "nothingToRedo")
		// HISTORY: the session's actions newest first, for the side that may undo them; a player is sent none.
		history := p.seatView(gm).State.History
		if len(history) != 2 || history[0].ID != dazed || history[1].ID != hit || history[0].Undone || history[1].Undone {
			t.Fatalf("the GM's history: %+v", history)
		}
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pia"), p.room.Actor(t, tx, "pc", "Pia's", "character"))
		if got := p.seatView(player).State.History; got != nil {
			t.Fatalf("a player's history: %+v", got)
		}
		// The redone action stands again: Undo reaches it as before, and it can be redone once more.
		p.send(gm, undoLine(hit))
		if hp := p.hp(r1); hp != 5 {
			t.Fatalf("undone again: %d Vigour", hp)
		}
		p.send(gm, redoLine(hit))
		if hp := p.hp(r1); hp != 3 {
			t.Fatalf("redone again: %d Vigour", hp)
		}
	})
}

func TestRedoIsRefusedAfterANewActionSetTheSameValue(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSidesPlay(t, tx, nil)
		gm := p.room.GM()
		_, _, r1 := p.sidesFight()
		p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})
		added := p.newest()
		p.send(gm, undoLine(added))
		p.send(gm, map[string]any{"type": "condition.add", "actorId": r1, "condition": "dazed"})
		again := p.newest()
		p.refusedNaming(gm, redoLine(added), "redoLaterFirst", again)
		if n := p.conditions(r1); n != 1 {
			t.Fatalf("a refused redo changes nothing: %d conditions", n)
		}
	})
}

// An undone approval reopens its ask (house decision #119); its redo approves it again while it waits, and is refused
// once the ask was answered since (house decision #132).
func TestRedoOfAnUndoneApprovalApprovesItsAskAgain(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newSpendsPlay(t, tx, 0)
		gm := p.room.GM()
		wren := p.character("Wren", 3)
		asker := p.room.Seat(t, tx, dbtest.User(t, tx, "P"), wren)
		p.fill("momentum", 3)
		id := p.send(asker, ask(wren, "rally", map[string]any{"dice": 2.0})).ID
		p.send(gm, map[string]any{"type": "request.approve", "id": id})
		approval := p.newest()
		p.send(gm, undoLine(approval))
		wantPool(t, p, "momentum", 3)
		if got := p.requestStatus(id); got != "pending" {
			t.Fatalf("after undo: got %s", got)
		}
		p.send(gm, redoLine(approval))
		wantPool(t, p, "momentum", 1)
		if got := p.requestStatus(id); got != "approved" {
			t.Fatalf("after redo: got %s", got)
		}

		// Undone again, then denied: a redo would spend a cost nobody approved.
		p.send(gm, undoLine(approval))
		p.send(gm, map[string]any{"type": "request.deny", "id": id})
		p.refused(gm, redoLine(approval), "requestAnsweredSince")
		wantPool(t, p, "momentum", 3)
	})
}
