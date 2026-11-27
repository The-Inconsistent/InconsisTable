package table

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// House decision #96 on the ledger fixture: the GM's override of the hero's Guard (the guardSet field), a Tier raised by
// hand read as that many advances, and a build saved over a sheet made by hand that keeps its armour and its Wealth.

func (p *play) derived(c cs.Ctx, actorID, id string) float64 {
	p.t.Helper()
	for _, a := range p.seatView(c).State.Actors {
		if a.ID == actorID {
			return a.Derived[id]
		}
	}
	p.t.Fatalf("no actor %s", actorID)
	return 0
}

func TestAnOverrideReplacesTheWorkedOutValueAndClearingBringsItBack(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		p.send(ana, save(hero, dreamBuild))
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, p.room.ID)
		worked := p.derived(gm, hero, "guard")
		set := func(v any) map[string]any {
			return map[string]any{"type": "field.set", "actorId": hero, "field": "guardSet", "value": v}
		}
		p.refusedWith(ana, set(9.0), "gmOnly")
		p.send(gm, set(9.0))
		if got := p.derived(ana, hero, "guard"); got != 9 {
			t.Fatalf("the override reaches the holder: %v", got)
		}
		p.send(gm, set(nil))
		if got := p.derived(gm, hero, "guard"); got != worked {
			t.Fatalf("cleared: %v, worked out %v", got, worked)
		}
		p.send(gm, undo)
		if got := p.derived(gm, hero, "guard"); got != 9 {
			t.Fatalf("Undo of the clear puts the override back: %v", got)
		}
	})
}

func TestATierRaisedByHandIsReadAsThatManyAdvancesAndLoweringItAsNone(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		wren := p.made("Wren", 10)
		tier := func(v float64) Result {
			return p.send(gm, map[string]any{"type": "campaign.setField", "fieldId": "tier", "value": v})
		}
		wantNotices(t, tier(2), cs.Advanced("Tier", 1, 2))
		if at, _ := p.ascension(wren); at != 10 {
			t.Fatalf("a rise of one starts the count at the XP: %d", at)
		}
		p.setXP(wren, 30)
		wantNotices(t, tier(4), cs.Advanced("Tier", 2, 4))
		if at, _ := p.ascension(wren); at != 30 {
			t.Fatalf("a rise of two starts it once, at the XP: %d", at)
		}
		p.setXP(wren, 40)
		wantNotices(t, tier(3))
		if at, _ := p.ascension(wren); at != 30 {
			t.Fatalf("lowering touches no count: %d", at)
		}
	})
}

func TestABuildOverASheetMadeByHandKeepsWhatTheRulesetMarks(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "hero")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		for field, v := range map[string]any{"armourRating": 4.0, "attr.mgt": 5.0} {
			p.send(gm, map[string]any{"type": "field.set", "actorId": hero, "field": field, "value": v})
		}
		dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'wealth', 7)`, hero)
		p.send(gm, map[string]any{"type": "item.add", "actorId": hero, "kind": "kit", "name": "Old map"})
		keep := save(hero, dreamBuild)
		keep["keepSheet"] = true
		p.refusedWith(gm, save(hero, dreamBuild), "alreadyBuilt")
		p.refusedWith(ana, keep, "keepSheetGm")
		draft := save(hero, dreamBuild)
		draft["keepSheet"], draft["draft"] = true, true
		p.refusedWith(gm, draft, "alreadyBuilt")
		p.send(gm, keep)
		fields := p.fields(hero)
		if fields["armourRating"] != 4 || fields["attr.mgt"] != 2 {
			t.Fatalf("the armour kept, the rest the build's: %v", fields)
		}
		if w := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'wealth'`, hero); w != 7 {
			t.Fatalf("the Wealth kept: %d", w)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM actor_item WHERE actor_id = $1`, hero); n != 1 {
			t.Fatalf("the items kept: %d", n)
		}
		// Built now: a later save is an ordinary one.
		p.send(gm, save(hero, dreamBuild))
	})
}

// A hero made by hand on a type the ledger also builds (house decision #199): only the GM side, only once, and a
// draft claims the hero for the ledger. A build over the sheet keeps the better armour and merges the keywords.
func TestAHeroMadeByHandBesideTheLedgerAndBuiltOverMergesAsDeclared(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		byHand := func(id string, armour float64) map[string]any {
			return map[string]any{"type": "actor.build", "actorId": id, "answers": map[string]any{
				"byHand": map[string]any{"species": "Moth", "armourRating": armour, "mod.guard": 1.0}}}
		}
		// The build's own numbers, on a hero built plainly.
		plain := p.room.Actor(t, tx, "pc", "Plain", "")
		p.send(gm, save(plain, dreamBuild))
		built := p.fields(plain)

		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		p.refusedWith(ana, byHand(hero, 1), "byHandGm")
		p.send(gm, byHand(hero, 99))
		p.refusedWith(gm, byHand(hero, 99), "alreadyBuilt")
		p.send(gm, map[string]any{"type": "field.set", "actorId": hero, "field": "keywords", "value": []any{"MOTH", "MOTH"}})
		keep := save(hero, dreamBuild)
		keep["keepSheet"] = true
		p.send(gm, keep)
		fields := p.fields(hero)
		if fields["armourRating"] != 99 || fields["species"] != built["species"] {
			t.Fatalf("the better armour kept, the rest the build's: %v (built %v)", fields, built)
		}
		want := "MOTH,MOTH"
		if k, _ := built["keywords"].(string); k != "" {
			want = k + "," + want
		}
		if fields["keywords"] != want {
			t.Fatalf("the build's keywords, then the hand's past the copies it has: want %q, got %v", want, fields["keywords"])
		}

		// A draft claims a hero for the ledger: not made by hand after.
		drafted := p.room.Actor(t, tx, "pc", "Drafted", "")
		draft := save(drafted, dreamBuild)
		draft["draft"] = true
		p.send(gm, draft)
		p.refusedWith(gm, byHand(drafted, 2), "alreadyBuilt")
	})
}
