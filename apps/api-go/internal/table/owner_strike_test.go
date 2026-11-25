package table

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// A strike its owner sends (house decision #112), on the strike fixture's sweep: a hero's might, one more put in hard,
// against the target's guard; a total over it thins a swarm by 1, 2 put in hard. Its owner's seat sends it once a
// round, on the hero's own turn, while a session runs, at a target shown to it in full.

func sweepOf(attacker, target string, total int, force float64) map[string]any {
	return map[string]any{"type": "strike.apply", "strikeId": "sweep", "attackerId": attacker, "targetId": target,
		"inputs": map[string]any{"force": force}, "total": float64(total)}
}

// ownerFight is a fight with Hal on the party's side, the rats shown in full and the ogre as a bar, on Hal's turn.
func (p *play) ownerFight(hal, rats, ogre string) {
	gm := p.room.GM()
	p.send(gm, map[string]any{"type": "encounter.start"})
	p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{hal}, "side": "party", "visibility": "full"})
	p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{rats}, "side": "foe", "visibility": "full"})
	p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{ogre}, "side": "foe"})
	p.send(gm, map[string]any{"type": "rule.op", "primitive": "initiative.seated", "op": "next", "input": map[string]any{}})
}

// The owner's seat sends it on its turn as one logged action, under its own name; the GM's Undo takes it back, and its
// use this round with it; a second in the round is refused.
func TestAnOwnerSendsItsStrikeOnItsTurn(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		rats := p.swarm("Rats", 6)
		ogre := p.brute("Ogre", 5)
		p.ownerFight(hal, rats, ogre)
		user := dbtest.User(t, tx, "Player")
		player := p.room.Seat(t, tx, user, hal)
		p.send(player, sweepOf(hal, rats, 9, 1))
		if m := p.res(rats, "members"); m != 4 {
			t.Fatalf("Rats' members: want 4, got %d", m)
		}
		by := dbtest.Scalar[string](t, tx, `SELECT seat_user_id FROM session_event WHERE campaign_id = $1 AND type = 'strike'`, p.room.ID)
		if by != user {
			t.Fatalf("the strike is logged under %q, want the player's %q", by, user)
		}
		p.refused(player, sweepOf(hal, rats, 9, 0), "usedThisRound")
		p.send(gm, undo)
		if m := p.res(rats, "members"); m != 6 {
			t.Fatalf("after Undo: want 6, got %d", m)
		}
		// Undo gave the round's use back: the sweep may be sent again, once.
		p.send(player, sweepOf(hal, rats, 9, 0))
		if m := p.res(rats, "members"); m != 5 {
			t.Fatalf("Rats' members after the second sweep: want 5, got %d", m)
		}
		p.refused(player, sweepOf(hal, rats, 9, 1), "usedThisRound")
		// A choice the strike does not offer is refused as an input.
		p.send(gm, undo)
		p.refused(player, sweepOf(hal, rats, 9, 2), "badInput")
	})
}

// Each case the owner's path refuses, in its own words, and nothing is written: another's character, a strike only the
// GM applies, a target shown as a bar, another's turn, no session running.
func TestAnOwnersStrikeIsRefusedOutsideItsTurnAndSight(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		rats := p.swarm("Rats", 6)
		ogre := p.brute("Ogre", 5)
		p.arm(hal, "maul")
		p.ownerFight(hal, rats, ogre)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"), hal)
		other := p.room.Seat(t, tx, dbtest.User(t, tx, "Other"))
		p.refused(other, sweepOf(hal, rats, 9, 0), "notYourCharacter")
		p.refused(player, strikeOf(hal, rats, "maul", 9, map[string]any{}), "strikeNotByOwner")
		p.refused(player, sweepOf(hal, ogre, 9, 0), "strikeTargetHidden")
		p.refused(player, sweepOf(hal, p.swarm("Stray", 3), 9, 0), "strikeNotInFight")
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, p.room.ID)
		p.refused(player, sweepOf(hal, rats, 9, 0), "sessionPaused")
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 2)`, p.room.ID)
		p.send(gm, map[string]any{"type": "rule.op", "primitive": "initiative.seated", "op": "next", "input": map[string]any{}})
		p.refused(player, sweepOf(hal, rats, 9, 0), "strikeNotYourTurn")
		if m := p.res(rats, "members"); m != 6 {
			t.Fatalf("Rats' members after refusals: want 6, got %d", m)
		}
		// The GM side applies the same strike off Hal's turn, at the ogre shown as a bar.
		p.send(gm, sweepOf(hal, ogre, 9, 0))
		if w := p.res(ogre, "wounds"); w != 1 {
			t.Fatalf("Ogre's wounds: want 1, got %d", w)
		}
	})
}

// TURN BACK takes the owner's strike back with the turn step.
func TestTurnBackTakesAnOwnersStrikeBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newStrikePlay(t, tx)
		hal := p.hero("Hal", 0, 0)
		rats := p.swarm("Rats", 6)
		ogre := p.brute("Ogre", 5)
		p.ownerFight(hal, rats, ogre)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"), hal)
		p.send(player, sweepOf(hal, rats, 9, 0))
		p.send(p.room.GM(), turnBack)
		if m := p.res(rats, "members"); m != 6 {
			t.Fatalf("after TURN BACK: want 6, got %d", m)
		}
	})
}
