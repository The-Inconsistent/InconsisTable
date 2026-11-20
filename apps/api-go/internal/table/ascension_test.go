package table

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// XP at a session's end, the group's Ascension and the Tier raised by hand (house decision #64), against the invented
// ledger ruleset: ascension.xp 20, award.max 50, gone ["lost"] (Corruption 10 or more), Tiers 1 to 4.

func ascend(kind string, waive bool) map[string]any {
	return map[string]any{"type": "build.ascend", "kind": kind, "waivePackage": waive}
}

func endSession(award int) map[string]any {
	return map[string]any{"type": "session.end", "award": float64(award)}
}

// made is a hero of the room built with dreamBuild by the GM, with the XP given.
func (p *play) made(name string, xp int) string {
	p.t.Helper()
	hero := p.room.Actor(p.t, p.tx, "pc", name, "")
	p.send(p.room.GM(), save(hero, dreamBuild))
	p.setXP(hero, xp)
	return hero
}

func (p *play) xp(actorID string) int {
	p.t.Helper()
	n, _ := p.fields(actorID)["xp"].(int)
	return n
}

// ascension is the actor's stored count start and waive.
func (p *play) ascension(actorID string) (xpAt int, waived bool) {
	p.t.Helper()
	if err := p.tx.QueryRow(context.Background(), `SELECT xp_at_ascension, package_waived FROM actor_build WHERE actor_id = $1`,
		actorID).Scan(&xpAt, &waived); err != nil {
		p.t.Fatal(err)
	}
	return xpAt, waived
}

func (p *play) tier() int {
	p.t.Helper()
	return dbtest.Scalar[int](p.t, p.tx, `SELECT coalesce((SELECT int_value FROM campaign_field WHERE campaign_id = $1 AND field_id = 'tier'), 1)`,
		p.room.ID)
}

func TestASessionsEndAwardsXPToEveryLedgerCharacter(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		wren, ash := p.made("Wren", 3), p.made("Ash", 0)
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 12 WHERE actor_id = $1 AND resource_id = 'corruption'`, ash) // lost
		keeper := p.room.Actor(t, tx, "npc", "Keeper", "hero")
		unbuilt := p.room.Actor(t, tx, "pc", "Unbuilt", "")

		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, p.room.ID)
		p.refused(gm, endSession(51), "awardTooHigh")
		p.send(gm, endSession(5))
		if p.xp(wren) != 8 || p.xp(ash) != 5 || p.xp(keeper) != 0 || p.xp(unbuilt) != 0 {
			t.Fatalf("xp %d %d %d %d", p.xp(wren), p.xp(ash), p.xp(keeper), p.xp(unbuilt))
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM session WHERE campaign_id = $1 AND ended_at IS NULL`, p.room.ID); n != 0 {
			t.Fatal("the session is still running")
		}
		// No session running: refused, and the transaction (not this test's) rolls the award back.
		p.refused(gm, endSession(5), "noSessionRunning")

		// A ruleset without an award gives none, though a session still ends.
		plain := newPlay(t, tx)
		plain.refused(plain.room.GM(), endSession(1), "noAward")
		plain.send(plain.room.GM(), endSession(0))
	})
}

func TestTheGroupAscends(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		p.refused(gm, ascend("experience", false), "nobodyToAscend")
		wren, bo := p.made("Wren", 20), p.made("Bo", 15)
		ash := p.made("Ash", 0)
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 10 WHERE actor_id = $1 AND resource_id = 'corruption'`, ash) // lost

		// A player may not; one member short of the XP refuses, naming them; the lost one neither counts nor blocks.
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), wren)
		p.refused(ana, ascend("experience", false), "noPermission")
		refusal := p.refusedWith(gm, ascend("experience", false), "ascensionShort")
		if refusal.Params["names"] != "Bo" || refusal.Params["xp"] != 20.0 || refusal.Params["tier"] != 1.0 {
			t.Fatalf("params %v", refusal.Params)
		}
		p.setXP(bo, 20)
		p.send(gm, ascend("experience", false))
		if p.tier() != 2 {
			t.Fatalf("tier %d", p.tier())
		}
		for _, hero := range []string{wren, bo, ash} {
			if at, waived := p.ascension(hero); at != p.xp(hero) || waived {
				t.Fatalf("after the experience Ascension: %d at %d, waived %v", p.xp(hero), at, waived)
			}
		}
		// At Tier 2 the build owes an Ascension Package.
		p.refused(gm, save(wren, dreamBuild), "buildNotReady")

		// A milestone gives every character the XP, the lost one too, and waives this Ascension's package: the save
		// goes through.
		p.send(gm, ascend("milestone", true))
		if p.tier() != 3 || p.xp(wren) != 40 || p.xp(bo) != 40 || p.xp(ash) != 20 {
			t.Fatalf("tier %d, xp %d %d %d", p.tier(), p.xp(wren), p.xp(bo), p.xp(ash))
		}
		if at, waived := p.ascension(wren); at != 40 || !waived {
			t.Fatalf("after the milestone: at %d, waived %v", at, waived)
		}
		owesOne := withAdvancement(`{"packages":["rising-banner"]}`)
		p.send(gm, save(wren, owesOne))
		// The next Ascension clears the waive, and the slot it opens refuses the save until it is settled.
		p.send(gm, ascend("milestone", false))
		if at, waived := p.ascension(wren); at != 60 || waived {
			t.Fatalf("after the next milestone: at %d, waived %v", at, waived)
		}
		p.refused(gm, save(wren, owesOne), "buildNotReady")
		p.refusedWith(gm, ascend("milestone", false), "topTier")

		// Lowering the Tier by hand touches no count; raising it restarts every count, with no XP and no waive.
		p.setXP(wren, 75)
		p.send(gm, map[string]any{"type": "campaign.setField", "fieldId": "tier", "value": 2.0})
		if at, _ := p.ascension(wren); at != 60 {
			t.Fatalf("lowering moved the count to %d", at)
		}
		dbtest.Exec(t, tx, `UPDATE actor_build SET package_waived = true WHERE actor_id = $1`, wren)
		p.send(gm, map[string]any{"type": "campaign.setField", "fieldId": "tier", "value": 3.0})
		if at, waived := p.ascension(wren); at != 75 || waived || p.xp(wren) != 75 {
			t.Fatalf("raising: at %d, waived %v, xp %d", at, waived, p.xp(wren))
		}
	})
}

func TestAscensionRefusals(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		plain := newPlay(t, tx)
		plain.refused(plain.room.GM(), ascend("milestone", false), "noAscension")

		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.made("Wren", 0)
		// Everyone gone is nobody to Ascend.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 10 WHERE actor_id = $1 AND resource_id = 'corruption'`, hero)
		p.refused(gm, ascend("milestone", false), "nobodyToAscend")
		dbtest.Exec(t, tx, `INSERT INTO campaign_field (campaign_id, field_id, int_value) VALUES ($1, 'tier', 4)`, p.room.ID)
		if r := p.refusedWith(gm, ascend("milestone", false), "topTier"); r.Params["tier"] != 4.0 {
			t.Fatalf("params %v", r.Params)
		}
		// More than five short are named five and "N more".
		dbtest.Exec(t, tx, `UPDATE campaign_field SET int_value = 1 WHERE campaign_id = $1`, p.room.ID)
		for _, name := range []string{"A", "B", "C", "D", "E", "F", "G"} {
			p.room.Actor(t, tx, "pc", name, "hero")
		}
		if r := p.refusedWith(gm, ascend("experience", false), "ascensionShort"); r.Params["names"] != "A, B, C, D, E and 2 more" {
			t.Fatalf("names %v", r.Params["names"])
		}
	})
}
