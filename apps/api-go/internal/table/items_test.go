package table

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Items a hero holds in play (house decision #95), on the ledger fixture's items: arms (one of each), fittings fitted to
// arms (two on one, one per slot, the Twin Mount by the GM only), stores the holder spends, and kit. The Brass Lens
// adds 1 to Guard while held; the Sight Lens 1 while fitted.

type itemRoom struct {
	*play
	gm, ana, bo cs.Ctx
	hero, other string
}

func newItemRoom(t *testing.T, tx pgx.Tx, lib ledgerLibrary) *itemRoom {
	p := ledgerPlay(t, tx, lib)
	hero := p.room.Actor(t, tx, "pc", "Wren", "")
	other := p.room.Actor(t, tx, "pc", "Ott", "")
	r := &itemRoom{play: p, gm: p.room.GM(), hero: hero, other: other}
	r.ana = p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
	r.bo = p.room.Seat(t, tx, dbtest.User(t, tx, "Bo"), other)
	p.send(r.ana, save(hero, dreamBuild))
	p.send(r.bo, save(other, dreamBuild))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, p.room.ID)
	return r
}

// items is the hero's items as a seat sees them, "name[xN][@host]" in order.
func (r *itemRoom) items(c cs.Ctx, actorID string) []cs.ActorItem {
	for _, a := range r.seatView(c).State.Actors {
		if a.ID == actorID {
			return a.Items
		}
	}
	r.t.Fatalf("no actor %s", actorID)
	return nil
}

func (r *itemRoom) line(actorID string) string {
	out := []string{}
	byID := map[string]string{}
	list := r.items(r.gm, actorID)
	for _, x := range list {
		byID[x.ID] = x.Name
	}
	for _, x := range list {
		s := x.Name
		if x.Quantity != nil {
			s += "x" + string(rune('0'+*x.Quantity))
		}
		if x.FittedTo != nil {
			s += "@" + byID[*x.FittedTo]
		}
		out = append(out, s)
	}
	return strings.Join(out, ",")
}

func (r *itemRoom) id(actorID, name string) string {
	for _, x := range r.items(r.gm, actorID) {
		if x.Name == name {
			return x.ID
		}
	}
	r.t.Fatalf("%s holds no %s", actorID, name)
	return ""
}

func (r *itemRoom) guard(actorID string) float64 {
	for _, a := range r.seatView(r.gm).State.Actors {
		if a.ID == actorID {
			return a.Derived["guard"]
		}
	}
	return -1
}

func (r *itemRoom) add(actorID, kind, entry string) {
	r.send(r.gm, map[string]any{"type": "item.add", "actorId": actorID, "kind": kind, "entry": entry})
}

func undoAs(p *play, c cs.Ctx) { p.send(c, undo) }

func TestAGiveHandsOverTheCodexItemAndTakeBackLoosensWhatWasFitted(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newItemRoom(t, tx, lib)
		staff := r.send(r.gm, map[string]any{"type": "codex.save", "kind": "item", "title": "The old staff",
			"fields": map[string]any{"of": "wargear.lantern-staff"}}).ID
		rope := r.send(r.gm, map[string]any{"type": "codex.save", "kind": "item", "title": "A coil of rope"}).ID
		give := func(entry, actorID string) map[string]any {
			return map[string]any{"type": "item.give", "entryId": entry, "actorId": actorID}
		}
		r.refusedWith(r.ana, give(staff, r.hero), "noPermission")
		r.send(r.gm, give(staff, r.hero))
		r.send(r.gm, give(rope, r.hero)) // no ref: a hand-written kit line by its title
		if got := r.line(r.hero); got != "Lantern Staff,A coil of rope" {
			t.Fatalf("given: %s", got)
		}
		if x := r.items(r.gm, r.hero)[0]; x.Source != "give" || x.EntryID == nil || *x.EntryID != staff || x.Kind != "arms" {
			t.Fatalf("the staff's row: %+v", x)
		}
		r.refusedWith(r.gm, give(staff, r.other), "itemGiven")
		// A second of a unique entry is refused, whoever gives it.
		again := r.send(r.gm, map[string]any{"type": "codex.save", "kind": "item", "title": "Another staff",
			"fields": map[string]any{"of": "wargear.lantern-staff"}}).ID
		r.refusedWith(r.gm, give(again, r.hero), "itemAlready")

		// A lens fitted to the staff comes loose when the staff is taken back; Undo puts both back as they were.
		r.add(r.hero, "fittings", "wargear.twin-mount")
		r.send(r.gm, map[string]any{"type": "item.fit", "itemId": r.id(r.hero, "Twin Mount"), "to": r.id(r.hero, "Lantern Staff")})
		r.send(r.gm, map[string]any{"type": "item.take", "entryId": staff})
		if got := r.line(r.hero); got != "A coil of rope,Twin Mount" {
			t.Fatalf("taken back: %s", got)
		}
		r.refusedWith(r.gm, map[string]any{"type": "item.take", "entryId": staff}, "itemNotGiven")
		undoAs(r.play, r.gm)
		if got := r.line(r.hero); got != "Lantern Staff,A coil of rope,Twin Mount@Lantern Staff" {
			t.Fatalf("after Undo: %s", got)
		}
		// Undo of the give takes the item away again, and the entry may be given anew.
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, r.room.ID)
		r.refusedWith(r.gm, give(again, r.other), "noSessionRunning")
	})
}

func TestFittingHoldsToTheKindsLimitsAndItsEffectCountsOnlyWhileFitted(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newItemRoom(t, tx, lib)
		base := r.guard(r.hero)
		r.add(r.hero, "arms", "wargear.hunting-bow")
		r.add(r.hero, "fittings", "wargear.sight-lens")
		r.add(r.hero, "fittings", "wargear.long-sight")
		r.add(r.hero, "fittings", "wargear.twin-mount")
		r.add(r.hero, "kit", "wargear.lens")
		if got := r.guard(r.hero); got != base+1 {
			t.Fatalf("a held Brass Lens adds 1, a loose Sight Lens nothing: %v from %v", got, base)
		}
		bow, sight, long, twin := r.id(r.hero, "Hunting Bow"), r.id(r.hero, "Sight Lens"), r.id(r.hero, "Long Sight"), r.id(r.hero, "Twin Mount")
		fit := func(item, to string) map[string]any {
			return map[string]any{"type": "item.fit", "itemId": item, "to": to}
		}
		r.refusedWith(r.bo, fit(sight, bow), "notYourCharacter") // not Bo's character
		r.refusedWith(r.ana, fit(bow, sight), "itemNoFit")       // arms are not fitted
		r.refusedWith(r.ana, fit(sight, sight), "itemFitsNot")   // not to itself
		r.send(r.ana, fit(sight, bow))
		if got := r.guard(r.hero); got != base+2 {
			t.Fatalf("a fitted Sight Lens adds 1: %v", got)
		}
		r.refusedWith(r.ana, fit(sight, bow), "itemFitted")
		r.refusedWith(r.ana, fit(long, bow), "itemSlotTaken")
		r.refusedWith(r.ana, fit(twin, bow), "itemFitGm")
		r.send(r.gm, fit(twin, bow))
		r.send(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "fittings", "name": "Bone Charm"})
		r.refusedWith(r.ana, fit(r.id(r.hero, "Bone Charm"), bow), "itemFitFull")
		// Taken off by its holder, the lens adds nothing again; Undo fits it back.
		r.send(r.ana, map[string]any{"type": "item.fit", "itemId": sight, "to": nil})
		r.refusedWith(r.ana, map[string]any{"type": "item.fit", "itemId": sight, "to": nil}, "itemNotFitted")
		if got := r.guard(r.hero); got != base+1 {
			t.Fatalf("taken off: %v", got)
		}
		undoAs(r.play, r.gm)
		if got := r.line(r.hero); !strings.Contains(got, "Sight Lens@Hunting Bow") {
			t.Fatalf("after Undo: %s", got)
		}
	})
}

// House decision #176: the Bow String goes only on a host tagged BOW; the Ribbon goes on twice, past the two and into a
// slot taken, being free; on kit the Long Sight takes a slot of its own, so it sits beside a Sight Lens there.
func TestAFittingReadsItsHostsCopiesExemptionsAndSlotPerHostKind(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newItemRoom(t, tx, lib)
		r.add(r.hero, "arms", "wargear.hunting-bow")
		r.add(r.hero, "arms", "wargear.lantern-staff")
		r.add(r.hero, "kit", "wargear.rope")
		for _, entry := range []string{"wargear.bow-string", "wargear.sight-lens", "wargear.long-sight", "wargear.sight-lens",
			"wargear.ribbon", "wargear.ribbon", "wargear.ribbon"} {
			r.add(r.hero, "fittings", entry)
		}
		bow, staff, rope := r.id(r.hero, "Hunting Bow"), r.id(r.hero, "Lantern Staff"), r.id(r.hero, "Rope")
		loose := func(name string) string {
			for _, x := range r.items(r.gm, r.hero) {
				if x.Name == name && x.FittedTo == nil {
					return x.ID
				}
			}
			t.Fatalf("no loose %s", name)
			return ""
		}
		fit := func(name, to string) map[string]any {
			return map[string]any{"type": "item.fit", "itemId": loose(name), "to": to}
		}
		r.refusedWith(r.ana, fit("Bow String", staff), "itemFitsNot") // the staff is no BOW
		r.send(r.ana, fit("Bow String", bow))
		r.send(r.ana, fit("Sight Lens", bow)) // two on the bow: its max
		r.send(r.ana, fit("Ribbon", bow))     // free: past the max, and into the sight slot the lens holds
		r.send(r.ana, fit("Ribbon", bow))     // its second copy
		r.refusedWith(r.ana, fit("Ribbon", bow), "itemFitCopies")
		// On kit the Long Sight's slot is its own field's, so it goes beside a Sight Lens; on the bow it would clash.
		r.send(r.ana, fit("Sight Lens", rope))
		r.send(r.ana, fit("Long Sight", rope))
		if got := r.line(r.hero); !strings.Contains(got, "Long Sight@Rope") || strings.Count(got, "Ribbon@Hunting Bow") != 2 {
			t.Fatalf("fitted: %s", got)
		}
	})
}

func TestStoresAreSpentByTheHolderToNothingAndTheGMTopsThemUp(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newItemRoom(t, tx, lib)
		r.send(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "stores", "entry": "supply.pellets", "quantity": 1.0})
		r.send(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "stores", "entry": "supply.pellets", "quantity": 1.0})
		r.send(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "stores", "name": "Odd Shot", "quantity": 3.0})
		if got := r.line(r.hero); got != "Pelletsx2,Odd Shotx3" {
			t.Fatalf("added: %s", got)
		}
		pellets := r.id(r.hero, "Pellets")
		adjust := func(by float64) map[string]any {
			return map[string]any{"type": "item.adjust", "itemId": pellets, "by": by}
		}
		r.refusedWith(r.ana, adjust(1), "itemOnlySpend")
		r.refusedWith(r.bo, adjust(-1), "notYourCharacter")
		r.send(r.ana, adjust(-1))
		r.send(r.ana, adjust(-1))
		if got := r.line(r.hero); got != "Odd Shotx3" {
			t.Fatalf("spent to nothing: %s", got)
		}
		undoAs(r.play, r.gm)
		if got := r.line(r.hero); got != "Pelletsx1,Odd Shotx3" {
			t.Fatalf("after Undo: %s", got)
		}
		r.add(r.hero, "kit", "wargear.rope")
		r.refusedWith(r.gm, map[string]any{"type": "item.adjust", "itemId": r.id(r.hero, "Rope"), "by": -1.0}, "itemNotCounted")
	})
}

func TestEditCarriedRefusesAStaleLineAndARebuildKeepsWhatPlayGave(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newItemRoom(t, tx, lib)
		r.send(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "kit", "name": "Torn map", "note": "the GM knows"})
		x := r.items(r.gm, r.hero)[0]
		edit := map[string]any{"type": "item.edit", "itemId": x.ID, "rev": float64(x.Rev), "name": "Old map", "note": "marked"}
		r.send(r.gm, edit)
		r.refusedWith(r.gm, edit, "itemChanged") // the screen read the line before the edit
		y := r.items(r.gm, r.hero)[0]
		if y.Name != "Old map" || y.Note != "marked" || y.Rev == x.Rev {
			t.Fatalf("edited: %+v", y)
		}
		// Another player sees none of it; the holder sees the note.
		if got := r.items(r.bo, r.hero); len(got) != 0 {
			t.Fatalf("another seat reads the hero's items: %+v", got)
		}
		if got := r.items(r.ana, r.hero); len(got) != 1 || got[0].Note != "marked" {
			t.Fatalf("the holder reads: %+v", got)
		}
		// The GM saves the build again: the line stays.
		r.send(r.gm, save(r.hero, dreamBuild))
		if got := r.line(r.hero); got != "Old map" {
			t.Fatalf("after a rebuild: %s", got)
		}
		r.send(r.gm, map[string]any{"type": "item.edit", "itemId": y.ID, "rev": float64(y.Rev), "remove": true})
		if got := r.line(r.hero); got != "" {
			t.Fatalf("removed: %s", got)
		}
		r.refusedWith(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "arms", "entry": "wargear.rope"}, "itemNotAnItem")
		r.refusedWith(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "kit"}, "itemEntryOrName")
		r.refusedWith(r.gm, map[string]any{"type": "item.add", "actorId": r.hero, "kind": "trinkets", "name": "X"}, "noItemKind")
	})
}
