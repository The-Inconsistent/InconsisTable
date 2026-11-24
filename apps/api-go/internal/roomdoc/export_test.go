package roomdoc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/table"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/world"
)

var uuidRE = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

// names is every row id of a room by a name that stays the same from one room to its copy: actors by name, entries by
// title, a picture by its entry's title, sessions by number, clocks by name, items by holder and place.
func names(t *testing.T, db *pgxpool.Pool, id string) map[string]string {
	t.Helper()
	out := map[string]string{id: "room"}
	for _, sql := range []string{
		`SELECT id::text, 'actor:' || name FROM actor WHERE campaign_id = $1`,
		`SELECT id::text, 'entry:' || title FROM codex_entry WHERE campaign_id = $1`,
		`SELECT image_id::text, 'picture:' || title FROM codex_entry WHERE campaign_id = $1 AND image_id IS NOT NULL`,
		`SELECT id::text, 'session:' || number FROM session WHERE campaign_id = $1`,
		`SELECT id::text, 'clock:' || name FROM clock WHERE campaign_id = $1`,
		`SELECT i.id::text, 'item:' || a.name || ':' || i.ordinal FROM actor_item i JOIN actor a ON a.id = i.actor_id WHERE a.campaign_id = $1`,
	} {
		rows, err := db.Query(context.Background(), sql, id)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var row, name string
			if err := rows.Scan(&row, &name); err != nil {
				t.Fatal(err)
			}
			out[row] = name
		}
		rows.Close()
	}
	return out
}

// renamed is v with every id in it named, and an id the room does not hold marked.
func renamed(t *testing.T, v any, names map[string]string) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	text := uuidRE.ReplaceAllStringFunc(string(raw), func(id string) string {
		if name, has := names[id]; has {
			return name
		}
		return "unknown"
	})
	var out any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func sameJSON(t *testing.T, what string, want, got any) {
	t.Helper()
	var diffs []string
	var walk func(path string, w, g any)
	walk = func(path string, w, g any) {
		wm, wIsMap := w.(map[string]any)
		gm, gIsMap := g.(map[string]any)
		wl, wIsList := w.([]any)
		gl, gIsList := g.([]any)
		switch {
		case wIsMap && gIsMap:
			for key := range wm {
				walk(path+"."+key, wm[key], gm[key])
			}
			for key := range gm {
				if _, has := wm[key]; !has {
					walk(path+"."+key, nil, gm[key])
				}
			}
		case wIsList && gIsList && len(wl) == len(gl):
			for i := range wl {
				walk(fmt.Sprintf("%s[%d]", path, i), wl[i], gl[i])
			}
		case !reflect.DeepEqual(w, g):
			wj, _ := json.Marshal(w)
			gj, _ := json.Marshal(g)
			diffs = append(diffs, fmt.Sprintf("%s: want %.300s, got %.300s", path, wj, gj))
		}
	}
	walk("", want, got)
	slices.Sort(diffs)
	if len(diffs) > 0 {
		t.Errorf("%s differs:\n%s", what, strings.Join(diffs[:min(len(diffs), 30)], "\n"))
	}
}

func exported(t *testing.T, db *pgxpool.Pool, id string, pictures bool) map[string]any {
	t.Helper()
	d, err := Export(context.Background(), db, id, pictures)
	if err != nil {
		t.Fatal(err)
	}
	if _, issues := schema.Parse(cs.RoomDocument, d); len(issues) > 0 {
		t.Fatalf("the export is no document: %s", schema.Prettify(issues))
	}
	return d
}

func imported(t *testing.T, db *pgxpool.Pool, owner campaign.Owner, d map[string]any, opts Options) string {
	t.Helper()
	answer, err := Import(context.Background(), db, owner, d, opts)
	if err != nil {
		t.Fatal(err)
	}
	return *answer.CampaignID
}

// Each document imported, exported and imported again is the document: the second room reads back as the first did,
// and its export is the first export, id for id by name, but for when it was made.
func TestAnExportImportsAsItsRoom(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	for _, name := range []string{"d20", "bare", "ledger"} {
		t.Run(name, func(t *testing.T) {
			d := v.document(t, name)
			first := imported(t, db, owner, d, Options{})
			e := exported(t, db, first, true)
			second := imported(t, db, owner, e, Options{})
			r := readRoom(t, db, second, d)
			r.entries()
			r.actors()
			r.rest()
			again := exported(t, db, second, true)
			delete(e, "exportedAt")
			delete(again, "exportedAt")
			sameJSON(t, "the second export", renamed(t, e, names(t, db, first)), renamed(t, again, names(t, db, second)))
		})
	}
}

// Without its pictures a document names none, and imports.
func TestAnExportWithoutPictures(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	room := imported(t, db, owner, v.document(t, "d20"), Options{})
	e := exported(t, db, room, false)
	if _, has := e["images"]; has {
		t.Error("pictures in a document without them")
	}
	for _, x := range doc(e).list("codex") {
		if _, has := x["imageId"]; has {
			t.Errorf("%v names a picture", x["title"])
		}
	}
	copied := imported(t, db, owner, e, Options{})
	var pictures int
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM image WHERE campaign_id = $1`, copied).Scan(&pictures)
	if pictures != 0 {
		t.Errorf("pictures: %d", pictures)
	}
}

func gmOf(owner campaign.Owner, id string) cs.Ctx {
	return cs.Ctx{CampaignID: id, UserID: &owner.UserID, CampaignOwnerID: &owner.UserID, TableMode: cs.TableModeGM,
		Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
}

// act runs actions in the room as its GM, through the table's own path.
func act(t *testing.T, db *pgxpool.Pool, owner campaign.Owner, id string, actions ...map[string]any) []string {
	t.Helper()
	ids := []string{}
	for _, raw := range actions {
		a, issues := cs.ParseAction(viaJSON(t, raw))
		if len(issues) > 0 {
			t.Fatalf("%v: %s", raw["type"], schema.Prettify(issues))
		}
		err := core.InTx(context.Background(), db, func(tx pgx.Tx) error {
			result, err := table.ApplyAction(context.Background(), tx, gmOf(owner, id), a)
			ids = append(ids, result.ID)
			return err
		})
		if err != nil {
			t.Fatalf("%v: %v", raw["type"], err)
		}
	}
	return ids
}

// gmView is what the room's GM is sent, every id named.
func gmView(t *testing.T, db *pgxpool.Pool, owner campaign.Owner, id string) any {
	t.Helper()
	loaded, err := table.LoadSnapshot(context.Background(), db, id)
	if err != nil {
		t.Fatal(err)
	}
	v := view.Of(loaded.Snapshot, loaded.Compiled, gmOf(owner, id))
	out := renamed(t, map[string]any{"state": v.State, "codex": v.Codex}, names(t, db, id))
	// When a session started and ended is the import's time, never the document's (house decision #103).
	var strip func(any)
	strip = func(x any) {
		switch x := x.(type) {
		case map[string]any:
			for _, key := range []string{"startedAt", "endedAt", "stateVersion", "rev"} {
				delete(x, key)
			}
			for _, child := range x {
				strip(child)
			}
		case []any:
			for _, child := range x {
				strip(child)
			}
			// Rows made in one transaction share their time, so the order they load in is the ids': compare by name.
			slices.SortStableFunc(x, func(a, b any) int {
				am, _ := a.(map[string]any)
				bm, _ := b.(map[string]any)
				an, _ := am["id"].(string)
				bn, _ := bm["id"].(string)
				return strings.Compare(an, bn)
			})
		}
	}
	strip(out)
	return out
}

// A room built through the table's actions, exported and imported, is the same room to its GM: three rooms, between
// them every part a document carries (a spawned foe's options, an abandoned session, an entry made from a pack entry, a
// build with items, a picture).
func TestTheGMSeesTheSameRoom(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	version := func(table, slug string) string {
		var id string
		if err := db.QueryRow(context.Background(), `SELECT v.id::text FROM `+table+`_version v JOIN `+table+` x ON x.id = v.`+table+`_id
			WHERE x.owner_user_id = $1 AND x.slug = $2`, owner.UserID, slug).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	d20 := imported(t, db, owner, v.document(t, "d20"), Options{})
	act(t, db, owner, d20,
		map[string]any{"type": "session.start", "title": "Cut short"},
		map[string]any{"type": "session.abandon", "recap": "The storm came in."},
		// An entry made from a pack entry keeps where it came from (house decision #97).
		map[string]any{"type": "codex.fromPack", "kind": "npc", "entity": "creature", "key": "ember-wisp"})
	ledger := imported(t, db, owner, v.document(t, "ledger"), Options{})

	var skirmish string
	if err := core.InTx(context.Background(), db, func(tx pgx.Tx) error {
		var err error
		skirmish, err = campaign.NewRoom(context.Background(), tx, "Raid", &owner, nil, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	ids := act(t, db, owner, skirmish,
		map[string]any{"type": "campaign.setRuleset", "rulesetVersionId": version("ruleset", "sample-skirmish")},
		map[string]any{"type": "campaign.attachPack", "packVersionId": version("pack", "sample-raiders")},
		map[string]any{"type": "actor.create", "kind": "pc", "name": "Tamsin", "entityType": "character"},
		map[string]any{"type": "actor.spawn", "packVersionId": version("pack", "sample-raiders"), "key": "iron-warden", "count": 1,
			"options": []any{"quick", "scaled"}},
		map[string]any{"type": "codex.save", "kind": "location", "title": "The ford"},
		map[string]any{"type": "clock.create", "name": "Reinforcements", "segments": 6},
	)
	act(t, db, owner, skirmish,
		map[string]any{"type": "codex.reveal", "id": ids[4], "visibility": "party", "audienceMode": "all", "audience": []any{}},
		map[string]any{"type": "clock.tick", "id": ids[5], "delta": 2},
		map[string]any{"type": "session.start", "title": "The ford"},
		map[string]any{"type": "session.end", "recap": "We held @[The ford](" + ids[4] + ")."},
	)

	for name, room := range map[string]string{"d20": d20, "ledger": ledger, "skirmish": skirmish} {
		t.Run(name, func(t *testing.T) {
			copied := imported(t, db, owner, exported(t, db, room, true), Options{})
			sameJSON(t, "the GM's view", gmView(t, db, owner, room), gmView(t, db, owner, copied))
		})
	}
}

// A reference to something the room no longer holds is left out, and the document still imports: a mention keeps its
// words, a prepared line naming a deleted entry goes, a deleted character leaves a Test line's takers.
func TestAnExportLeavesNothingDangling(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	room := imported(t, db, owner, v.document(t, "d20"), Options{})
	byTitle := func(title string) string {
		var id string
		if err := db.QueryRow(context.Background(), `SELECT id::text FROM codex_entry WHERE campaign_id = $1 AND title = $2`, room, title).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	var mara string
	_ = db.QueryRow(context.Background(), `SELECT id::text FROM actor WHERE campaign_id = $1 AND name = 'Mara'`, room).Scan(&mara)
	act(t, db, owner, room,
		map[string]any{"type": "codex.delete", "id": byTitle("Notice")},
		map[string]any{"type": "codex.delete", "id": byTitle("The hill road")},
		map[string]any{"type": "codex.delete", "id": byTitle("Harbour town")},
		map[string]any{"type": "actor.delete", "id": mara})
	e := exported(t, db, room, true)
	copied := imported(t, db, owner, e, Options{})
	var quay, gmNotes, recap string
	_ = db.QueryRow(context.Background(), `SELECT body FROM codex_entry WHERE campaign_id = $1 AND title = 'Quay'`, copied).Scan(&quay)
	_ = db.QueryRow(context.Background(), `SELECT gm_notes FROM codex_entry WHERE campaign_id = $1 AND title = 'Harbourmaster Oyle'`, copied).Scan(&gmNotes)
	_ = db.QueryRow(context.Background(), `SELECT recap FROM session WHERE campaign_id = $1 AND number = 1`, copied).Scan(&recap)
	if quay != "Wet stones below Harbour town." || recap != "The crew came ashore at Harbour town." || !strings.Contains(gmNotes, "@[The Salt Guild](") {
		t.Errorf("mentions: %q %q %q", quay, recap, gmNotes)
	}
	var prep map[string]any
	_ = db.QueryRow(context.Background(), `SELECT prep FROM codex_entry WHERE campaign_id = $1 AND title = 'Trouble on the quay'`, copied).Scan(&prep)
	if len(doc(prep).list("exits")) != 0 || len(doc(prep).list("reveals")) != 0 || len(doc(prep).list("picks")) != 1 {
		t.Errorf("prep: %v", prep)
	}
	if takers := strs(doc(prep).list("tests")[0]["actorIds"]); len(takers) != 0 {
		t.Errorf("takers: %v", takers)
	}
}

// A fresh start (house decision #103): no sessions, nothing revealed, scenes planned and picks off, every resource and
// pool at its start, no conditions, no next session or safety lines; builds, fields, held records, items and where an
// entry came from stay.
func TestAFreshStart(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	room := imported(t, db, owner, v.document(t, "d20"), Options{Fresh: true})
	count := func(sql string) int {
		var n int
		if err := db.QueryRow(context.Background(), sql, room).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for what, sql := range map[string]string{
		"sessions":    `SELECT count(*) FROM session WHERE campaign_id = $1`,
		"revealed":    `SELECT count(*) FROM codex_entry WHERE campaign_id = $1 AND (visibility <> 'gm' OR revealed_at IS NOT NULL OR image_revealed)`,
		"readers":     `SELECT count(*) FROM codex_reveal r JOIN codex_entry e ON e.id = r.entry_id WHERE e.campaign_id = $1`,
		"not planned": `SELECT count(*) FROM codex_entry WHERE campaign_id = $1 AND kind = 'scene' AND status <> 'planned'`,
		"conditions":  `SELECT count(*) FROM actor_condition c JOIN actor a ON a.id = c.actor_id WHERE a.campaign_id = $1`,
		"pools":       `SELECT count(*) FROM resource_pool WHERE campaign_id = $1 AND value <> 0`,
		"next or safety": `SELECT count(*) FROM campaign WHERE id = $1 AND (next_session_at IS NOT NULL OR next_session_place IS NOT NULL
			AND next_session_place <> '' OR safety <> '{"lines":[],"veils":[],"xCard":true}'::jsonb)`,
		"picks on": `SELECT count(*) FROM codex_entry, jsonb_array_elements(prep->'picks') p, jsonb_array_elements(p->'rows') r
			WHERE campaign_id = $1 AND (r->>'on')::boolean`,
	} {
		if n := count(sql); n != 0 {
			t.Errorf("%s: %d", what, n)
		}
	}
	plain := imported(t, db, owner, v.document(t, "d20"), Options{})
	hp := func(id string) (hp int) {
		_ = db.QueryRow(context.Background(), `SELECT r.value FROM actor_resource r JOIN actor a ON a.id = r.actor_id
			WHERE a.campaign_id = $1 AND a.name = 'Mara' AND r.resource_id = 'hp'`, id).Scan(&hp)
		return hp
	}
	if hp(room) == 8 || hp(plain) != 8 {
		t.Errorf("hp: fresh %d, as it was %d", hp(room), hp(plain))
	}
	if n := count(`SELECT count(*) FROM actor_field f JOIN actor a ON a.id = f.actor_id WHERE a.campaign_id = $1 AND f.field_id = 'charms'`); n != 1 {
		t.Errorf("held charms: %d", n)
	}
	// Where an entry came from is prep, not play (house decision #97).
	if n := count(`SELECT count(*) FROM codex_entry WHERE campaign_id = $1 AND source->>'key' = 'ember-wisp'`); n != 1 {
		t.Errorf("an entry's source: %d", n)
	}
	ledger := imported(t, db, owner, v.document(t, "ledger"), Options{Fresh: true})
	var items, builds int
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM actor_item i JOIN actor a ON a.id = i.actor_id WHERE a.campaign_id = $1`, ledger).Scan(&items)
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM actor_build b JOIN actor a ON a.id = b.actor_id WHERE a.campaign_id = $1`, ledger).Scan(&builds)
	if items != 5 || builds != 1 {
		t.Errorf("a fresh start keeps builds and items: %d %d", builds, items)
	}
	// A fitting on a line of the build stays on it (house decision #102).
	var onLine int
	_ = db.QueryRow(context.Background(), `SELECT count(*) FROM actor_item i JOIN actor a ON a.id = i.actor_id
		WHERE a.campaign_id = $1 AND i.fitted_line = 'weapons/Lantern Staff'`, ledger).Scan(&onLine)
	if onLine != 1 {
		t.Errorf("a fitting on the build's line: %d", onLine)
	}
	// The dry run honours it.
	answer, err := Import(context.Background(), db, owner, v.document(t, "d20"), Options{DryRun: true, Fresh: true})
	if err != nil || answer.Counts.Sessions != 0 {
		t.Errorf("dry run: %+v %v", answer.Counts, err)
	}
}

// The route: its owner running the room gets the file, named after the room; no seat or no room is 404, a seat that is
// not the owner's 403, no user 404; `?pictures=0` leaves the pictures out; the admin key reads any room.
func TestTheExportRoute(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	s := &Service{DB: db, Auth: &auth.Service{DB: db}}
	ctx := context.Background()
	device := func() (string, string) {
		cookie := auth.DeviceCookie + "=" + auth.NewSecret()
		user, err := s.Auth.EnsureDeviceUser(ctx, cookie)
		if err != nil || user == nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = db.Exec(ctx, `DELETE FROM campaign WHERE owner_user_id = $1`, user.UserID)
			_, _ = db.Exec(ctx, `DELETE FROM app_user WHERE id = $1`, user.UserID)
		})
		return cookie, user.UserID
	}
	ownerCookie, ownerID := device()
	for _, f := range []string{"d20Ruleset", "d20Pack", "world"} {
		var err error
		switch f {
		case "d20Ruleset":
			_, err = ruleset.Import(ctx, db, ownerID, v.fixture(t, f))
		case "d20Pack":
			_, err = pack.Import(ctx, db, ownerID, v.fixture(t, f))
		default:
			_, err = world.Import(ctx, db, ownerID, v.fixture(t, f))
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	room := imported(t, db, campaign.Owner{UserID: ownerID, Name: "Owner"}, v.document(t, "d20"), Options{})
	get := func(path, cookie, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		if key != "" {
			r.Header.Set("X-Admin-Key", key)
		}
		r.SetPathValue("id", uuidRE.FindString(path))
		w := httptest.NewRecorder()
		if key != "" || strings.HasPrefix(path, "/api/admin") {
			core.Serve(s.AdminExport)(w, r)
		} else {
			core.Serve(s.Export)(w, r)
		}
		return w
	}
	w := get("/api/campaigns/"+room+"/export", ownerCookie, "")
	if w.Code != http.StatusOK || w.Header().Get("Content-Disposition") != `attachment; filename="harbour-watch.room.json"` ||
		!strings.Contains(w.Body.String(), `"base64":"`) {
		t.Errorf("owner: %d %v", w.Code, w.Header())
	}
	var d map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if _, issues := schema.Parse(cs.RoomDocument, d); len(issues) > 0 {
		t.Errorf("not a document: %s", schema.Prettify(issues))
	}
	if w := get("/api/campaigns/"+room+"/export?pictures=0", ownerCookie, ""); w.Code != http.StatusOK || strings.Contains(w.Body.String(), "base64") {
		t.Errorf("without pictures: %d", w.Code)
	}
	if w := get("/api/campaigns/"+room+"/export", "", ""); w.Code != http.StatusNotFound {
		t.Errorf("no user: %d", w.Code)
	}
	playerCookie, playerID := device()
	if w := get("/api/campaigns/"+room+"/export", playerCookie, ""); w.Code != http.StatusNotFound {
		t.Errorf("no seat: %d", w.Code)
	}
	if _, err := db.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, room, playerID); err != nil {
		t.Fatal(err)
	}
	if w := get("/api/campaigns/"+room+"/export", playerCookie, ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "roomExportOwnerOnly") {
		t.Errorf("a player: %d %s", w.Code, w.Body)
	}
	if w := get("/api/campaigns/00000000-0000-4000-8000-000000000999/export", ownerCookie, ""); w.Code != http.StatusNotFound {
		t.Errorf("no room: %d", w.Code)
	}
	t.Setenv("ADMIN_KEY", "an-admin-key-for-the-test")
	if w := get("/api/admin/campaigns/"+room+"/export", "", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("admin without key: %d", w.Code)
	}
	if w := get("/api/admin/campaigns/"+room+"/export", "", "wrong"); w.Code != http.StatusForbidden {
		t.Errorf("admin wrong key: %d", w.Code)
	}
	if w := get("/api/admin/campaigns/"+room+"/export?pictures=0", "", "an-admin-key-for-the-test"); w.Code != http.StatusOK {
		t.Errorf("admin: %d %s", w.Code, w.Body)
	}
}
