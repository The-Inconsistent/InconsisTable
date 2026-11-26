package codex

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// SHOW TO TABLE (#2, house decision #139): showing reveals for good and never narrows; clearing unreveals nothing.

func show(entry string, audience ...string) cs.Action {
	listed := []any{}
	for _, a := range audience {
		listed = append(listed, a)
	}
	return cs.Action{"type": "spotlight.show", "entryId": entry, "audience": listed}
}

func reach(t *testing.T, tx pgx.Tx, id string) (visibility, mode string, readers []string) {
	t.Helper()
	visibility, mode = dbtest.Scalar[string](t, tx, `SELECT visibility FROM codex_entry WHERE id = $1`, id),
		dbtest.Scalar[string](t, tx, `SELECT audience_mode FROM codex_entry WHERE id = $1`, id)
	readers = dbtest.Scalar[[]string](t, tx, `SELECT coalesce(array_agg(actor_id::text ORDER BY actor_id), '{}') FROM codex_reveal WHERE entry_id = $1`, id)
	return
}

func spotlightOf(t *testing.T, tx pgx.Tx, room dbtest.Room) *cs.Spotlight {
	t.Helper()
	s, err := LoadSpotlight(context.Background(), tx, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestShowRevealsForGoodAndNeverNarrows(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		a, b := room.Actor(t, tx, "pc", "A", ""), room.Actor(t, tx, "pc", "B", "")
		sorted := []string{a, b}
		slices.Sort(sorted)

		// For everyone: a sealed entry reaches the party, a public one stays public, its picture is held up too.
		sealed := run(t, tx, room, Save, save("npc", "Keeper", nil))
		dbtest.Exec(t, tx, `WITH i AS (INSERT INTO image (campaign_id, mime, bytes, size) VALUES ($1, 'image/jpeg', '\xffd8ff00'::bytea, 4)
			RETURNING id) UPDATE codex_entry SET image_id = (SELECT id FROM i) WHERE id = $2`, room.ID, sealed)
		run(t, tx, room, ShowSpotlight, show(sealed))
		if v, m, _ := reach(t, tx, sealed); v != "party" || m != "all" {
			t.Fatalf("shown to everyone: %s %s", v, m)
		}
		if !dbtest.Scalar[bool](t, tx, `SELECT image_revealed FROM codex_entry WHERE id = $1`, sealed) {
			t.Fatal("showing holds the picture up")
		}
		if s := spotlightOf(t, tx, room); s == nil || s.EntryID != sealed || len(s.Audience) != 0 || s.At == "" {
			t.Fatalf("spotlight %+v", s)
		}
		public := run(t, tx, room, Save, save("lore", "Sign", nil))
		run(t, tx, room, Reveal, cs.Action{"type": "codex.reveal", "id": public, "visibility": "public", "audienceMode": "listed", "audience": []any{a}})
		run(t, tx, room, ShowSpotlight, show(public))
		if v, m, _ := reach(t, tx, public); v != "public" || m != "all" {
			t.Fatalf("a public entry stays public: %s %s", v, m)
		}

		// Listed: a sealed entry reaches the named; a second SHOW adds to them; one shown to all stays so.
		letter := run(t, tx, room, Save, save("handout", "Letter", nil))
		run(t, tx, room, ShowSpotlight, show(letter, a, a))
		if v, m, r := reach(t, tx, letter); v != "party" || m != "listed" || !reflect.DeepEqual(r, []string{a}) {
			t.Fatalf("listed: %s %s %v", v, m, r)
		}
		run(t, tx, room, ShowSpotlight, show(letter, b))
		if _, _, r := reach(t, tx, letter); !reflect.DeepEqual(r, sorted) {
			t.Fatalf("a listed reveal gains readers, never loses them: %v", r)
		}
		if s := spotlightOf(t, tx, room); s == nil || !reflect.DeepEqual(s.Audience, []string{b}) {
			t.Fatalf("a new SHOW replaces the last: %+v", s)
		}
		run(t, tx, room, ShowSpotlight, show(sealed, a))
		if v, m, _ := reach(t, tx, sealed); v != "party" || m != "all" {
			t.Fatalf("an entry shown to all is never narrowed: %s %s", v, m)
		}

		// Clearing takes the card down and unreveals nothing; clearing again is fine.
		run(t, tx, room, ClearSpotlight, cs.Action{"type": "spotlight.clear"})
		run(t, tx, room, ClearSpotlight, cs.Action{"type": "spotlight.clear"})
		if s := spotlightOf(t, tx, room); s != nil {
			t.Fatalf("cleared: %+v", s)
		}
		if v, _, _ := reach(t, tx, sealed); v != "party" {
			t.Fatal("clearing unreveals nothing")
		}

		// A listed spotlight whose readers are all gone shows to no one, never to everyone.
		run(t, tx, room, ShowSpotlight, show(letter, a))
		dbtest.Exec(t, tx, `DELETE FROM actor WHERE id = $1`, a)
		if s := spotlightOf(t, tx, room); s != nil {
			t.Fatalf("readers gone: %+v", s)
		}
	})
}

func TestShowRefusesWhatIsNotThisRooms(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room, other := dbtest.NewRoom(t, tx), dbtest.NewRoom(t, tx)
		entry := run(t, tx, room, Save, save("npc", "Keeper", nil))
		foreign := run(t, tx, other, Save, save("npc", "Elsewhere", nil))
		npc := room.Actor(t, tx, "npc", "Guard", "")
		stranger := other.Actor(t, tx, "pc", "Stranger", "")
		refuses(t, tx, room, ShowSpotlight, show(foreign), "entryNotFound")
		refuses(t, tx, room, ShowSpotlight, show(entry, npc), "characterNotFound")
		refuses(t, tx, room, ShowSpotlight, show(entry, stranger), "characterNotFound")
		if v, _, _ := reach(t, tx, entry); v != "gm" {
			t.Fatal("a refused SHOW reveals nothing")
		}
	})
}
