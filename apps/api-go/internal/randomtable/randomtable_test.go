package randomtable

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The fixture plus tables of our own invention: a d6 table the party sees, a weighted table for the GM, and a deck of
// five cards (two copies of Mole, one each of Host, Guard and Spy) dealt to the holder alone.
var manifest = strings.Replace(dbtest.Fixture, `"conditions": [],`, `"conditions": [],
	"tables": {
		"season": {"title": "Season", "die": "d6", "visibility": "party", "cite": "Fixture p.7", "entries": [
			{"id": "thaw", "label": "Thaw", "range": [1, 2]}, {"id": "bloom", "label": "Bloom", "range": [3, 4]},
			{"id": "frost", "label": "Frost", "range": [5, 6]}]},
		"omen": {"title": "Omen", "visibility": "gm", "cite": "Fixture p.8", "entries": [
			{"id": "calm", "label": "Calm", "weight": 3}, {"id": "storm", "label": "Storm", "weight": 1}]},
		"role": {"title": "Role", "visibility": "owner", "cite": "Fixture p.9", "entries": [
			{"id": "mole", "label": "Mole", "count": 2}, {"id": "host", "label": "Host"}, {"id": "guard", "label": "Guard"},
			{"id": "spy", "label": "Spy"}]}
	},`, 1)

// script makes the randomness the numbers in order, then fails the test if it runs out.
func script(t *testing.T, faces ...int) {
	t.Helper()
	was := draw
	t.Cleanup(func() { draw = was })
	next := 0
	draw = func(sides int) int {
		if next >= len(faces) {
			t.Fatalf("the script ran out: asked for a d%d after %d draws", sides, next)
		}
		v := faces[next]
		next++
		if v > sides {
			t.Fatalf("the script asked draw %d for face %d on a d%d", next, v, sides)
		}
		return v
	}
}

func code(err error) string {
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		return refusal.Code
	}
	return ""
}

type room struct {
	dbtest.Room
	gm     cs.Ctx
	actors []string
}

func newRoom(t *testing.T, tx pgx.Tx, characters int) room {
	t.Helper()
	r := dbtest.NewRoom(t, tx)
	r.Pin(t, tx, manifest)
	out := room{Room: r, gm: r.GM()}
	for range characters {
		out.actors = append(out.actors, r.Actor(t, tx, "pc", "Hero", "character"))
	}
	return out
}

func roll(tx pgx.Tx, c cs.Ctx, table string) (string, error) {
	res, err := Roll(context.Background(), tx, c, cs.Action{"type": "table.roll", "tableId": table})
	return res.ID, err
}

func deal(tx pgx.Tx, c cs.Ctx, table string, actors ...string) error {
	ids := make([]any, len(actors))
	for i, a := range actors {
		ids[i] = a
	}
	_, err := Deal(context.Background(), tx, c, cs.Action{"type": "table.deal", "tableId": table, "actorIds": ids})
	return err
}

func held(t *testing.T, tx pgx.Tx, r room, table string) map[string]string {
	t.Helper()
	dealt, err := LoadDealt(context.Background(), tx, r.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, d := range dealt {
		if d.TableID == table {
			out[d.ActorID] = d.EntryID
		}
	}
	return out
}

func compiled(t *testing.T) *engine.CompiledRuleset {
	t.Helper()
	var input any
	if err := json.Unmarshal([]byte(manifest), &input); err != nil {
		t.Fatal(err)
	}
	c, problems := engine.CompileRuleset(input)
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	return c
}

func TestRollRecordsTheEntryAndShowsAsARow(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 0)
		for face, want := range map[int]string{1: "thaw", 2: "thaw", 3: "bloom", 4: "bloom", 5: "frost", 6: "frost"} {
			script(t, face)
			if _, err := roll(tx, r.gm, "season"); err != nil {
				t.Fatal(err)
			}
			rolls, err := LoadRolls(context.Background(), tx, r.ID, compiled(t))
			if err != nil {
				t.Fatal(err)
			}
			if got := rolls[0]; got.EntryID != want || got.Value != face || got.Visibility != "party" || got.Label == "" {
				t.Fatalf("face %d: got %+v, want entry %s", face, got, want)
			}
		}
		rolls, _ := LoadRolls(context.Background(), tx, r.ID, compiled(t))
		if len(rolls) != 6 {
			t.Fatalf("%d rolls kept", len(rolls))
		}
	})
}

func TestRollKeepsOnlyTheLastTen(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 0)
		for range 12 {
			script(t, 1)
			if _, err := roll(tx, r.gm, "season"); err != nil {
				t.Fatal(err)
			}
		}
		rolls, _ := LoadRolls(context.Background(), tx, r.ID, compiled(t))
		if len(rolls) != MaxRolls {
			t.Fatalf("%d rolls shown", len(rolls))
		}
	})
}

// A weighted table is a draw over the total weight: 3 of 4 faces are Calm, one is Storm.
func TestWeightedRollFollowsTheWeights(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 0)
		for face, want := range map[int]string{1: "calm", 2: "calm", 3: "calm", 4: "storm"} {
			script(t, face)
			if _, err := roll(tx, r.gm, "omen"); err != nil {
				t.Fatal(err)
			}
			rolls, _ := LoadRolls(context.Background(), tx, r.ID, compiled(t))
			if rolls[0].EntryID != want || rolls[0].Visibility != "gm" {
				t.Fatalf("face %d: %+v, want %s", face, rolls[0], want)
			}
		}
	})
}

// The real source is uniform: over many rolls every entry of a d6 table comes up about as often as its range says.
func TestRollDistributionWithTheRealSource(t *testing.T) {
	table := &engine.RandomTable{Die: ptr("d6"), Entries: []engine.TableEntry{
		{ID: "a", Range: []int{1, 2}}, {ID: "b", Range: []int{3, 6}},
	}}
	counts := map[int]int{}
	const rolls = 6000
	for range rolls {
		index, _, err := table.Roll(nil)
		if err != nil {
			t.Fatal(err)
		}
		counts[index]++
	}
	// a is 1/3 of the die: 2000 of 6000, with a margin far outside chance (5 sigma is about 190).
	if counts[0] < 1700 || counts[0] > 2300 {
		t.Fatalf("a came up %d of %d, want about 2000", counts[0], rolls)
	}
}

func ptr[T any](v T) *T { return &v }

func TestRollRefusals(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 0)
		if _, err := roll(tx, r.gm, "nope"); code(err) != "tableNotFound" {
			t.Fatalf("unknown table: %v", err)
		}
		if _, err := roll(tx, r.gm, "role"); code(err) != "tableDealOnly" {
			t.Fatalf("an owner table is dealt, not rolled: %v", err)
		}
		gmless := r.gm
		gmless.TableMode = cs.TableModeGMLess
		if _, err := roll(tx, gmless, "omen"); code(err) != "tableNoGm" {
			t.Fatalf("a gm table without a GM: %v", err)
		}
		script(t, 3)
		if _, err := roll(tx, gmless, "season"); err != nil {
			t.Fatalf("a party table without a GM: %v", err)
		}
	})
}

func TestDealNeverRepeatsBeyondCountAndRefusesWhenShort(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 6)
		// The deck is [mole mole host guard spy]. Draw index 1 each time: mole, then host, guard, spy remain.
		script(t, 1, 1, 1)
		if err := deal(tx, r.gm, "role", r.actors[0], r.actors[1], r.actors[2]); err != nil {
			t.Fatal(err)
		}
		got := held(t, tx, r, "role")
		if got[r.actors[0]] != "mole" || got[r.actors[1]] != "mole" || got[r.actors[2]] != "host" {
			t.Fatalf("dealt %v", got)
		}
		// Two cards are left (guard, spy): three characters are one too many, and nothing is dealt.
		if err := deal(tx, r.gm, "role", r.actors[3], r.actors[4], r.actors[5]); code(err) != "tableShort" {
			t.Fatalf("short deck: %v", err)
		}
		if len(held(t, tx, r, "role")) != 3 {
			t.Fatal("a refused deal left cards behind")
		}
		script(t, 2, 1)
		if err := deal(tx, r.gm, "role", r.actors[3], r.actors[4]); err != nil {
			t.Fatal(err)
		}
		got = held(t, tx, r, "role")
		if got[r.actors[3]] != "spy" || got[r.actors[4]] != "guard" {
			t.Fatalf("dealt %v", got)
		}
		if err := deal(tx, r.gm, "role", r.actors[5]); code(err) != "tableShort" {
			t.Fatalf("an empty deck: %v", err)
		}
	})
}

func TestDealWithTheRealSourceIsAPermutation(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 5)
		if err := deal(tx, r.gm, "role", r.actors...); err != nil {
			t.Fatal(err)
		}
		counts := map[string]int{}
		for _, entry := range held(t, tx, r, "role") {
			counts[entry]++
		}
		if counts["mole"] != 2 || counts["host"] != 1 || counts["guard"] != 1 || counts["spy"] != 1 {
			t.Fatalf("five cards from a five-card deck: %v", counts)
		}
	})
}

func TestDealRefusals(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 2)
		other := newRoom(t, tx, 1)
		if err := deal(tx, r.gm, "role", other.actors[0]); code(err) != "characterNotFound" {
			t.Fatalf("an actor of another room: %v", err)
		}
		if err := deal(tx, r.gm, "role", r.actors[0], other.actors[0]); code(err) != "characterNotFound" {
			t.Fatalf("one stranger spoils the deal: %v", err)
		}
		creature := r.Actor(t, tx, "creature", "Ogre", "character")
		if err := deal(tx, r.gm, "role", creature); code(err) != "characterNotFound" {
			t.Fatalf("a creature is not a character: %v", err)
		}
		if err := deal(tx, r.gm, "nope", r.actors[0]); code(err) != "tableNotFound" {
			t.Fatalf("unknown table: %v", err)
		}
		if err := deal(tx, r.gm, "role", r.actors[0]); err != nil {
			t.Fatal(err)
		}
		if err := deal(tx, r.gm, "role", r.actors[0]); code(err) != "tableHeld" {
			t.Fatalf("a second card for the same character: %v", err)
		}
		if len(held(t, tx, r, "role")) != 1 {
			t.Fatal("a refused deal left cards behind")
		}
		gmless := r.gm
		gmless.TableMode = cs.TableModeGMLess
		if err := deal(tx, gmless, "omen", r.actors[1]); code(err) != "tableNoGm" {
			t.Fatalf("a gm table without a GM: %v", err)
		}
		if err := deal(tx, gmless, "role", r.actors[1]); err != nil {
			t.Fatalf("an owner table without a GM: %v", err)
		}
	})
}

func TestReshuffleReturnsTheTablesCardsOnly(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 3)
		if err := deal(tx, r.gm, "role", r.actors...); err != nil {
			t.Fatal(err)
		}
		if err := deal(tx, r.gm, "omen", r.actors[0]); err != nil {
			t.Fatal(err)
		}
		if _, err := Reshuffle(context.Background(), tx, r.gm, cs.Action{"type": "table.reshuffle", "tableId": "role"}); err != nil {
			t.Fatal(err)
		}
		if len(held(t, tx, r, "role")) != 0 || len(held(t, tx, r, "omen")) != 1 {
			t.Fatal("a reshuffle returns the cards of its own table, and only those")
		}
		if err := deal(tx, r.gm, "role", r.actors...); err != nil {
			t.Fatalf("dealing again after a reshuffle: %v", err)
		}
		if _, err := Reshuffle(context.Background(), tx, r.gm, cs.Action{"type": "table.reshuffle", "tableId": "nope"}); code(err) != "tableNotFound" {
			t.Fatalf("unknown table: %v", err)
		}
	})
}

// Deleting a character takes its cards with it.
func TestACardGoesWithItsCharacter(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 2)
		if err := deal(tx, r.gm, "role", r.actors...); err != nil {
			t.Fatal(err)
		}
		dbtest.Exec(t, tx, `DELETE FROM actor WHERE id = $1`, r.actors[0])
		if len(held(t, tx, r, "role")) != 1 {
			t.Fatal("the card stayed")
		}
	})
}

// Rolling and dealing write events of their own type, so Undo, which reads only deltas, never touches them.
func TestEventsAreNotDeltas(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		r := newRoom(t, tx, 1)
		script(t, 1, 1)
		if _, err := roll(tx, r.gm, "season"); err != nil {
			t.Fatal(err)
		}
		if err := deal(tx, r.gm, "role", r.actors[0]); err != nil {
			t.Fatal(err)
		}
		if _, err := Reshuffle(context.Background(), tx, r.gm, cs.Action{"type": "table.reshuffle", "tableId": "role"}); err != nil {
			t.Fatal(err)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type = 'delta'`, r.ID); n != 0 {
			t.Fatalf("%d deltas", n)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type IN ('table.roll', 'table.deal', 'table.reshuffle')`, r.ID); n != 3 {
			t.Fatalf("%d table events, want 3", n)
		}
		// The deal's log names who was dealt, never which card.
		payload := dbtest.Scalar[string](t, tx, `SELECT payload::text FROM session_event WHERE campaign_id = $1 AND type = 'table.deal'`, r.ID)
		if strings.Contains(payload, "mole") || strings.Contains(payload, "host") {
			t.Fatalf("the deal's log holds a card: %s", payload)
		}
	})
}
