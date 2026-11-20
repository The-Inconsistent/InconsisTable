package table

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// A ledger character in play (house decision #64): its Tier and creation are locked, it buys with the XP it earned, and
// the server keeps its purchase history.

// withAdvancement is dreamBuild with an advancement document.
func withAdvancement(advancement string) string {
	return strings.TrimSuffix(dreamBuild, "}") + `,"advancement":` + advancement + "}"
}

// The stored build's purchase history, as text.
func (p *play) history(actorID string) string {
	p.t.Helper()
	build, _ := p.stored(actorID)
	at := strings.Index(build, `"boughtIn":`)
	if at < 0 {
		return ""
	}
	rest := build[at+len(`"boughtIn":`):]
	return rest[:strings.Index(rest, "}")+1]
}

func (p *play) xpSpent(actorID string) int {
	p.t.Helper()
	return dbtest.Scalar[int](p.t, p.tx, `SELECT xp_spent FROM actor_build WHERE actor_id = $1`, actorID)
}

// setXP writes the actor's XP field row as play would have.
func (p *play) setXP(actorID string, xp int) {
	p.t.Helper()
	dbtest.Exec(p.t, p.tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'xp', 0, $2)
		ON CONFLICT (actor_id, field_id, ordinal) DO UPDATE SET int_value = EXCLUDED.int_value`, actorID, xp)
}

func TestAMadeLedgerCharacterKeepsItsTierAndOnlyTheGMChangesItsCreation(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		p.send(ana, save(hero, dreamBuild))

		// The room's Tier rises; the character stays at the Tier it was made at, for every seat, and a draft too.
		dbtest.Exec(t, tx, `INSERT INTO campaign_field (campaign_id, field_id, int_value) VALUES ($1, 'tier', 2)`, p.room.ID)
		atTwo := strings.Replace(dreamBuild, `"tier":1`, `"tier":2`, 1)
		for _, seat := range []map[string]any{save(hero, atTwo), draftSave(hero, atTwo)} {
			if refusal := p.refusedWith(ana, seat, "buildMadeAtTier"); refusal.Params["tier"] != 1.0 {
				t.Fatalf("params %v", refusal.Params)
			}
			p.refused(gm, seat, "buildMadeAtTier")
		}
		// (At Tier 2 the build owes an Ascension Package; back to 1 for the rest.)
		dbtest.Exec(t, tx, `UPDATE campaign_field SET int_value = 1 WHERE campaign_id = $1`, p.room.ID)

		// A player may not change a creation choice, in a save or a draft; key order and the GM's part are no change.
		poorer := strings.Replace(dreamBuild, `"wealth":1`, `"wealth":0`, 1)
		p.refused(ana, save(hero, poorer), "creationLocked")
		p.refused(ana, draftSave(hero, poorer), "creationLocked")
		reordered := `{"tier":1,"wealth":1,"archetypeId":"lamplighter","skills":{"Brawl":1,"Lore":3},` +
			`"languages":{"picks":["trade-tongue"]},"fills":{"[GUILD]":{"id":"ironhand"}},` +
			`"background":{"bonus":"dream","dream":"A Quiet Hearth","deed":"Held the Gate","roots":"Lowland","tableId":"warden-roots"},` +
			`"gm":{"approved":["x"]}}`
		p.send(ana, save(hero, reordered))
		// The GM does.
		p.send(gm, save(hero, poorer))
		if got := p.resources(hero)["wealth"]; got != 3 {
			t.Fatalf("a save in play changed Wealth: %d", got)
		}
	})
}

func TestBuyingInPlayStampsThePurchaseHistoryAndStoresTheXPSpent(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		p.send(ana, save(hero, dreamBuild))
		p.setXP(hero, 10)
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 7 WHERE actor_id = $1 AND resource_id = 'wealth'`, hero)

		// Bought before any session: unstamped, and the client's history is discarded.
		p.send(ana, save(hero, withAdvancement(`{"skills":{"Brawl":2},"boughtIn":{"advance/skill/Brawl/2":99,"made/up":3}}`)))
		if h := p.history(hero); h != `{}` {
			t.Fatalf("history with no session %s", h)
		}
		if got := p.fields(hero)["skill.brawl"]; got != 2 {
			t.Fatalf("Brawl %v", got)
		}
		if spent := p.xpSpent(hero); spent != 3 {
			t.Fatalf("xp spent %d", spent)
		}

		// The open session stamps it on the next save.
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, p.room.ID)
		p.send(ana, save(hero, withAdvancement(`{"skills":{"Brawl":2}}`)))
		if h := p.history(hero); h != `{"advance/skill/Brawl/2":1}` {
			t.Fatalf("history in session 1 %s", h)
		}
		// A purchase after that session ended belongs to the last one; one in the next keeps the first its own stamp.
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, p.room.ID)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 2)`, p.room.ID)
		p.send(ana, save(hero, withAdvancement(`{"skills":{"Brawl":3},"boughtIn":{"advance/skill/Brawl/2":2}}`)))
		if h := p.history(hero); h != `{"advance/skill/Brawl/2":1,"advance/skill/Brawl/3":2}` {
			t.Fatalf("history in session 2 %s", h)
		}
		if spent := p.xpSpent(hero); spent != 8 {
			t.Fatalf("xp spent %d", spent)
		}
		// The GM's save keeps the stored history too.
		p.send(gm, save(hero, withAdvancement(`{"skills":{"Brawl":3},"boughtIn":{}}`)))
		if h := p.history(hero); h != `{"advance/skill/Brawl/2":1,"advance/skill/Brawl/3":2}` {
			t.Fatalf("history after the GM's save %s", h)
		}

		// Taken back, a purchase loses its stamp.
		p.send(ana, save(hero, withAdvancement(`{"skills":{"Brawl":2}}`)))
		if h := p.history(hero); h != `{"advance/skill/Brawl/2":1}` {
			t.Fatalf("history after taking one back %s", h)
		}
		if spent := p.xpSpent(hero); spent != 3 {
			t.Fatalf("xp spent %d", spent)
		}

		// More than was earned is refused.
		refusal := p.refusedWith(ana, save(hero, withAdvancement(`{"skills":{"Brawl":4}}`)), "buildNotReady")
		if detail, _ := refusal.Params["detail"].(string); !strings.Contains(detail, "earned in play") {
			t.Fatalf("detail %q", detail)
		}
		// Play's resources were never touched.
		if got := p.resources(hero); got["wealth"] != 7 || got["corruption"] != 1 {
			t.Fatalf("resources %v", got)
		}
	})
}
