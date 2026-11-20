package codex

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// A handout's layout and header (house decision #72): a handout always has both, every other kind neither.
func TestHandoutLayoutAndHeader(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		read := func(id string) [2]any {
			var layout, header *string
			if err := tx.QueryRow(t.Context(), `SELECT layout, header FROM codex_entry WHERE id = $1`, id).
				Scan(&layout, &header); err != nil {
				t.Fatal(err)
			}
			if layout == nil || header == nil {
				return [2]any{layout, header}
			}
			return [2]any{*layout, *header}
		}
		plain := run(t, tx, room, Save, save("handout", "H", nil))
		if got := read(plain); got != [2]any{"plain", ""} {
			t.Fatalf("a new handout is plain with no header, got %v", got)
		}
		notice := run(t, tx, room, Save, save("handout", "N", cs.Action{"layout": "proclamation", "header": "Hear ye"}))
		if got := read(notice); got != [2]any{"proclamation", "Hear ye"} {
			t.Fatalf("want the layout and header sent, got %v", got)
		}
		// A patch writes only what it carries.
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "handout", "id": notice, "header": ""})
		if got := read(notice); got != [2]any{"proclamation", ""} {
			t.Fatalf("a header patch keeps the layout, got %v", got)
		}
		run(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "handout", "id": notice, "layout": "transcript"})
		if got := read(notice); got != [2]any{"transcript", ""} {
			t.Fatalf("want transcript, got %v", got)
		}
		codex := dbtest.Must[cs.Codex](t)(Load(t.Context(), tx, room.ID))
		for _, e := range codex.Entries {
			if e.ID == notice && (e.Layout == nil || *e.Layout != "transcript" || e.Header == nil || *e.Header != "") {
				t.Fatalf("the load carries both, got %v %v", e.Layout, e.Header)
			}
		}

		npc := run(t, tx, room, Save, save("npc", "P", nil))
		if got := read(npc); got[0] != (*string)(nil) || got[1] != (*string)(nil) {
			t.Fatalf("an NPC has neither, got %v", got)
		}
		refuses(t, tx, room, Save, save("npc", "P2", cs.Action{"layout": "form"}), "handoutOnly")
		refuses(t, tx, room, Save, save("lore", "L", cs.Action{"header": "x"}), "handoutOnly")
		// The kind is the stored one, never the client's.
		refuses(t, tx, room, Save, cs.Action{"type": "codex.save", "kind": "handout", "id": npc, "layout": "form"}, "handoutOnly")
	})
}

// A layout the platform does not draw never reaches the handler: the action's schema refuses it (badRequest).
func TestUnknownHandoutLayoutIsRefusedBySchema(t *testing.T) {
	for _, layout := range []any{"scroll", "PLAIN", "", 1} {
		if _, issues := cs.ParseAction(map[string]any{"type": "codex.save", "kind": "handout", "title": "H", "layout": layout}); len(issues) == 0 {
			t.Errorf("layout %v: want refused", layout)
		}
	}
	for _, header := range []string{"", string(make([]byte, 120))} {
		if _, issues := cs.ParseAction(map[string]any{"type": "codex.save", "kind": "handout", "title": "H", "header": header}); len(issues) != 0 {
			t.Errorf("header of %d: want accepted, got %v", len(header), issues)
		}
	}
	if _, issues := cs.ParseAction(map[string]any{"type": "codex.save", "kind": "handout", "title": "H", "header": string(make([]byte, 121))}); len(issues) == 0 {
		t.Error("a header of 121 characters: want refused")
	}
}
