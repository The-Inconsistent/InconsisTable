package library

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/roomdoc"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/table"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// The ledger fixtures and the room document of a ledger-built character, as vectors/roomdoc.ts writes them.
type vectors struct {
	Documents map[string]json.RawMessage `json:"documents"`
	Fixtures  map[string]json.RawMessage `json:"fixtures"`
}

func vectorsOf(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile("../coreschema/testdata/roomdoc.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (v vectors) fixture(t *testing.T, name string) any {
	t.Helper()
	d, err := schema.DecodeJSON(v.Fixtures[name])
	if err != nil {
		t.Fatal(err)
	}
	return schema.Plain(d)
}

func (v vectors) ledgerDoc(t *testing.T) map[string]any {
	t.Helper()
	var d map[string]any
	if err := json.Unmarshal(v.Documents["ledger"], &d); err != nil {
		t.Fatal(err)
	}
	return d
}

// A ready build of the ledger fixture.
func (v vectors) build(t *testing.T) string {
	return v.ledgerDoc(t)["actors"].([]any)[0].(map[string]any)["build"].(string)
}

type user struct {
	cookie, id string
}

// person is a device of the test's own, its user deleted with everything it owns after the test.
func person(t *testing.T, db *pgxpool.Pool) user {
	t.Helper()
	ctx := context.Background()
	cookie := auth.DeviceCookie + "=" + auth.NewSecret()
	u, err := (&auth.Service{DB: db}).EnsureDeviceUser(ctx, cookie)
	if err != nil || u == nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, sql := range []string{`DELETE FROM library_character WHERE owner_user_id = $1`, `DELETE FROM campaign WHERE owner_user_id = $1`,
			`DELETE FROM pack WHERE owner_user_id = $1`, `DELETE FROM ruleset WHERE owner_user_id = $1`, `DELETE FROM app_user WHERE id = $1`} {
			_, _ = db.Exec(ctx, sql, u.UserID)
		}
	})
	return user{cookie, u.UserID}
}

// owning gives a user the ledger ruleset and its pack, and answers the ruleset's version id.
func owning(t *testing.T, db *pgxpool.Pool, v vectors, u user) string {
	t.Helper()
	ctx := context.Background()
	if _, err := ruleset.Import(ctx, db, u.id, v.fixture(t, "ledgerRuleset")); err != nil {
		t.Fatal(err)
	}
	if _, err := pack.Import(ctx, db, u.id, v.fixture(t, "ledgerPack")); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := db.QueryRow(ctx, `SELECT v.id::text FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
		WHERE r.owner_user_id = $1`, u.id).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type caller struct {
	t *testing.T
	s *Service
	u user
}

func (c caller) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var raw string
	if body != nil {
		b, _ := json.Marshal(body)
		raw = string(b)
	}
	r := httptest.NewRequest(method, path, strings.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if c.u.cookie != "" {
		r.Header.Set("Cookie", c.u.cookie)
	}
	parts := strings.Split(strings.TrimPrefix(path, "/api/library"), "/")
	if len(parts) > 1 && parts[1] != "from-room" {
		r.SetPathValue("id", parts[1])
	}
	route := map[string]core.Handler{"GET": c.s.Get, "PATCH": c.s.Patch, "DELETE": c.s.Delete, "POST": c.s.Create}[method]
	switch {
	case path == "/api/library" && method == "GET":
		route = c.s.List
	case strings.HasSuffix(path, "/rules"):
		route = c.s.Rules
	case strings.HasSuffix(path, "/from-room"):
		route = c.s.FromRoom
	}
	w := httptest.NewRecorder()
	core.Serve(route)(w, r)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out == nil {
		var list []any
		_ = json.Unmarshal(w.Body.Bytes(), &list)
		out = map[string]any{"list": list}
	}
	return w.Code, out
}

// Every route is its owner's: create, read, autosave a draft, save it ready, list, delete; anyone else finds nothing.
func TestTheLibraryIsItsOwners(t *testing.T) {
	db := dbtest.Open(t)
	v := vectorsOf(t)
	s := &Service{DB: db, Auth: &auth.Service{DB: db}}
	me, other := person(t, db), person(t, db)
	version := owning(t, db, v, me)
	c, o := caller{t, s, me}, caller{t, s, other}

	code, card := c.do("POST", "/api/library", map[string]any{"rulesetVersionId": version, "name": " Wren "})
	if code != http.StatusCreated || card["name"] != "Wren" || card["done"] != false || card["rev"] != 1.0 {
		t.Fatalf("create: %d %v", code, card)
	}
	id := card["id"].(string)
	if code, _ := o.do("POST", "/api/library", map[string]any{"rulesetVersionId": version}); code != http.StatusBadRequest {
		t.Errorf("another's ruleset: %d", code)
	}
	code, entry := c.do("GET", "/api/library/"+id, nil)
	if code != http.StatusOK || entry["editable"] != true || entry["build"] != nil || len(entry["packs"].([]any)) != 1 {
		t.Errorf("read: %d %v", code, entry)
	}
	if code, rules := c.do("GET", "/api/library/"+id+"/rules", nil); code != http.StatusOK || rules["manifest"] == nil || rules["kinds"] == nil {
		t.Errorf("rules: %d", code)
	}
	for _, path := range []string{"/api/library/" + id, "/api/library/" + id + "/rules"} {
		if code, _ := o.do("GET", path, nil); code != http.StatusNotFound {
			t.Errorf("another reads %s: %d", path, code)
		}
	}
	if code, _ := o.do("PATCH", "/api/library/"+id, map[string]any{"rev": 1, "name": "Mine"}); code != http.StatusNotFound {
		t.Errorf("another saves: %d", code)
	}
	if code, _ := o.do("DELETE", "/api/library/"+id, nil); code != http.StatusNotFound {
		t.Errorf("another deletes: %d", code)
	}

	// An autosave is a draft, kept unresolved, keys in their order; a stale revision is refused.
	draft := `{"tier":1,"archetypeId":"lamplighter"}`
	code, saved := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 1, "build": draft})
	if code != http.StatusOK || saved["rev"] != 2.0 || saved["done"] != false {
		t.Fatalf("autosave: %d %v", code, saved)
	}
	if code, body := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 1, "name": "Two tabs"}); code != http.StatusConflict || body["code"] != "libraryChanged" {
		t.Errorf("stale: %d %v", code, body)
	}
	if _, e := c.do("GET", "/api/library/"+id, nil); e["build"] != draft {
		t.Errorf("draft as written: %v", e["build"])
	}
	// SAVE: resolved as a first build.save is; one with choices left is refused, a ready one is done.
	if code, body := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 2, "build": draft, "done": true}); code != http.StatusBadRequest || body["code"] != "buildNotReady" {
		t.Errorf("not ready: %d %v", code, body)
	}
	if code, body := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 2, "build": "[1]"}); code != http.StatusBadRequest || body["code"] != "buildInvalid" {
		t.Errorf("not an object: %d %v", code, body)
	}
	code, saved = c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 2, "build": v.build(t), "done": true})
	if code != http.StatusOK || saved["done"] != true || saved["rev"] != 3.0 {
		t.Fatalf("save: %d %v", code, saved)
	}
	// The card's line: the archetype the ruleset names, off the resolved sheet (house decision #187); a draft has none.
	if line, _ := saved["line"].(string); line == "" {
		t.Errorf("a done character's line: %v", saved["line"])
	}
	if _, again := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 3, "name": "Wren"}); again["line"] != saved["line"] {
		t.Errorf("a rename keeps the line: %v", again["line"])
	}
	if _, drafted := c.do("PATCH", "/api/library/"+id, map[string]any{"rev": 4, "build": draft}); drafted["line"] != nil {
		t.Errorf("a draft's line: %v", drafted["line"])
	}
	if code, list := c.do("GET", "/api/library", nil); code != http.StatusOK || len(list["list"].([]any)) != 1 {
		t.Errorf("list: %d %v", code, list)
	}
	if code, list := o.do("GET", "/api/library", nil); code != http.StatusOK || len(list["list"].([]any)) != 0 {
		t.Errorf("another's list: %d %v", code, list)
	}
	if code, _ := c.do("DELETE", "/api/library/"+id, nil); code != http.StatusOK {
		t.Errorf("delete: %d", code)
	}
	if code, _ := c.do("GET", "/api/library/"+id, nil); code != http.StatusNotFound {
		t.Errorf("deleted: %d", code)
	}
}

// At most 20 a user, counted under a lock; a delete makes room again.
func TestTheCap(t *testing.T) {
	db := dbtest.Open(t)
	v := vectorsOf(t)
	s := &Service{DB: db, Auth: &auth.Service{DB: db}}
	me := person(t, db)
	version := owning(t, db, v, me)
	c := caller{t, s, me}
	done := make(chan int, Cap+5)
	for range Cap + 5 {
		go func() {
			code, _ := c.do("POST", "/api/library", map[string]any{"rulesetVersionId": version})
			done <- code
		}()
	}
	made := 0
	for range Cap + 5 {
		if <-done == http.StatusCreated {
			made++
		}
	}
	if made != Cap {
		t.Errorf("made %d of %d", made, Cap+5)
	}
	code, body := c.do("POST", "/api/library", map[string]any{"rulesetVersionId": version})
	if code != http.StatusBadRequest || body["code"] != "libraryFull" {
		t.Errorf("full: %d %v", code, body)
	}
	_, list := c.do("GET", "/api/library", nil)
	first := list["list"].([]any)[0].(map[string]any)["id"].(string)
	c.do("DELETE", "/api/library/"+first, nil)
	if code, _ := c.do("POST", "/api/library", map[string]any{"rulesetVersionId": version}); code != http.StatusCreated {
		t.Errorf("after a delete: %d", code)
	}
}

// No user is 401; with sign-in on, an anonymous device keeps no library.
func TestWhoKeepsALibrary(t *testing.T) {
	db := dbtest.Open(t)
	me := person(t, db)
	if code, _ := (caller{t, &Service{DB: db, Auth: &auth.Service{DB: db}}, user{}}).do("GET", "/api/library", nil); code != http.StatusUnauthorized {
		t.Errorf("no user: %d", code)
	}
	signIn := &Service{DB: db, Auth: &auth.Service{DB: db, SignIn: true}}
	if code, body := (caller{t, signIn, me}).do("GET", "/api/library", nil); code != http.StatusForbidden || body["code"] != "libraryNeedsAccount" {
		t.Errorf("anonymous with sign-in: %d %v", code, body)
	}
}

// A new device reads an empty library without becoming a user; its first write makes one.
func TestANewDevicesFirstWrite(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	a := &auth.Service{DB: db}
	fresh := caller{t, &Service{DB: db, Auth: a}, user{cookie: auth.DeviceCookie + "=" + auth.NewSecret()}}
	missing := "/api/library/" + core.NewUUID()
	if code, body := fresh.do("GET", "/api/library", nil); code != http.StatusOK || len(body["list"].([]any)) != 0 {
		t.Errorf("list: %d %v", code, body)
	}
	if code, _ := fresh.do("GET", missing, nil); code != http.StatusNotFound {
		t.Errorf("get: %d", code)
	}
	if u, err := a.DeviceUser(ctx, fresh.u.cookie); u != nil || err != nil {
		t.Fatalf("a read made a user: %v %v", u, err)
	}
	if code, _ := fresh.do("DELETE", missing, nil); code != http.StatusNotFound {
		t.Errorf("delete: %d", code)
	}
	u, err := a.DeviceUser(ctx, fresh.u.cookie)
	if u == nil || err != nil {
		t.Fatalf("the write made no user: %v", err)
	}
	t.Cleanup(func() { _, _ = db.Exec(ctx, `DELETE FROM app_user WHERE id = $1`, u.UserID) })
}

// SAVE TO MY LIBRARY copies a built character the caller's seat holds, without the GM's part; the copy goes back into a
// room as an ordinary build.save draft, which only the holder and the GM side then see; a character the caller does
// not hold, or one not built, is refused; a player who owns neither ruleset nor packs keeps it but edits it in a room.
func TestARoomCharacterToTheLibraryAndBack(t *testing.T) {
	db := dbtest.Open(t)
	v := vectorsOf(t)
	ctx := context.Background()
	s := &Service{DB: db, Auth: &auth.Service{DB: db}}
	gm, player, stranger := person(t, db), person(t, db), person(t, db)
	owning(t, db, v, gm)
	answer, err := roomdoc.Import(ctx, db, campaign.Owner{UserID: gm.id, Name: "GM"}, v.ledgerDoc(t), roomdoc.Options{})
	if err != nil {
		t.Fatal(err)
	}
	room := *answer.CampaignID
	var wren string
	_ = db.QueryRow(ctx, `SELECT id::text FROM actor WHERE campaign_id = $1 AND name = 'Wren'`, room).Scan(&wren)
	// The GM's part, to see it stay in the room.
	if _, err := db.Exec(ctx, `UPDATE actor_build SET build = jsonb_set(build::jsonb, '{gm}', '{"ok":true}')::json WHERE actor_id = $1`, wren); err != nil {
		t.Fatal(err)
	}
	seat := func(u user, actorID string) {
		var membership string
		if err := db.QueryRow(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'player') RETURNING id::text`,
			room, u.id).Scan(&membership); err != nil {
			t.Fatal(err)
		}
		if actorID != "" {
			if _, err := db.Exec(ctx, `INSERT INTO membership_character (membership_id, actor_id) VALUES ($1, $2)`, membership, actorID); err != nil {
				t.Fatal(err)
			}
		}
	}
	seat(player, wren)
	seat(stranger, "")
	p := caller{t, s, player}
	if code, body := (caller{t, s, stranger}).do("POST", "/api/library/from-room", map[string]any{"campaignId": room, "actorId": wren}); code != http.StatusBadRequest || body["code"] != "libraryNotYours" {
		t.Errorf("not held: %d %v", code, body)
	}
	if code, _ := (caller{t, s, person(t, db)}).do("POST", "/api/library/from-room", map[string]any{"campaignId": room, "actorId": wren}); code != http.StatusNotFound {
		t.Errorf("no seat: %d", code)
	}
	code, card := p.do("POST", "/api/library/from-room", map[string]any{"campaignId": room, "actorId": wren})
	if code != http.StatusCreated || card["name"] != "Wren" || card["done"] != true {
		t.Fatalf("from the room: %d %v", code, card)
	}
	// Its line is what the room's sheet shows (house decision #187).
	var archetype string
	_ = db.QueryRow(ctx, `SELECT text_value FROM actor_field WHERE actor_id = $1 AND field_id = 'archetype'`, wren).Scan(&archetype)
	if archetype == "" || card["line"] != archetype {
		t.Errorf("the copy's line: %v, the room's %q", card["line"], archetype)
	}
	_, entry := p.do("GET", "/api/library/"+card["id"].(string), nil)
	build, _ := entry["build"].(string)
	if entry["editable"] != false || strings.Contains(build, `"gm"`) || !strings.Contains(build, `"archetypeId":"lamplighter"`) {
		t.Errorf("the copy: %v", entry)
	}
	if code, body := p.do("GET", "/api/library/"+card["id"].(string)+"/rules", nil); code != http.StatusBadRequest || body["code"] != "libraryNotEditable" {
		t.Errorf("edited in a room only: %d %v", code, body)
	}
	if code, body := p.do("PATCH", "/api/library/"+card["id"].(string), map[string]any{"rev": 1, "build": build}); code != http.StatusBadRequest || body["code"] != "libraryNotEditable" {
		t.Errorf("no build save outside a room: %d %v", code, body)
	}
	if code, _ := p.do("PATCH", "/api/library/"+card["id"].(string), map[string]any{"rev": 1, "name": "Wren of the Lamps"}); code != http.StatusOK {
		t.Errorf("a rename: %d", code)
	}

	// Back into a room: a new character of the player's, the library's build as its draft, through build.save.
	var fresh string
	if err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		fresh, err = actorIn(ctx, tx, room, "Wren again")
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO membership_character (membership_id, actor_id)
			SELECT id, $2 FROM membership WHERE campaign_id = $1 AND user_id = $3`, room, fresh, player.id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	holder := cs.Ctx{CampaignID: room, UserID: &player.id, CampaignOwnerID: &gm.id, TableMode: cs.TableModeGM,
		Seat: cs.Seat{Kind: cs.SeatMember, Role: "player", CharacterIDs: []string{wren, fresh}}}
	a, issues := cs.ParseAction(map[string]any{"type": "build.save", "actorId": fresh, "build": build, "draft": true})
	if len(issues) > 0 {
		t.Fatal(schema.Prettify(issues))
	}
	if err := core.InTx(ctx, db, func(tx pgx.Tx) error { _, err := table.ApplyAction(ctx, tx, holder, a); return err }); err != nil {
		t.Fatalf("the draft: %v", err)
	}
	var stored string
	_ = db.QueryRow(ctx, `SELECT draft::text FROM actor_build WHERE actor_id = $1`, fresh).Scan(&stored)
	if want := strings.TrimSuffix(build, "}") + `,"gm":{}}`; stored != want { // a player's draft takes the stored GM part, none (#63)
		t.Errorf("the room's draft is the library's build:\n%s\n%s", stored, build)
	}
	// The library's copy stays as it was.
	if _, again := p.do("GET", "/api/library/"+card["id"].(string), nil); again["build"] != build {
		t.Errorf("the library's copy changed")
	}
	loaded, err := table.LoadSnapshot(ctx, db, room)
	if err != nil {
		t.Fatal(err)
	}
	for who, c := range map[string]cs.Ctx{"holder": holder, "stranger": {CampaignID: room, UserID: &stranger.id, CampaignOwnerID: &gm.id,
		TableMode: cs.TableModeGM, Seat: cs.Seat{Kind: cs.SeatMember, Role: "player", CharacterIDs: []string{}}}} {
		for _, x := range viewOf(loaded, c).State.Actors {
			if x.ID == fresh && (x.Ledger != nil) != (who == "holder") {
				t.Errorf("%s sees the draft: %v", who, x.Ledger != nil)
			}
		}
	}

	// A character not built yet is refused.
	if code, body := p.do("POST", "/api/library/from-room", map[string]any{"campaignId": room, "actorId": fresh}); code != http.StatusBadRequest || body["code"] != "libraryNotBuilt" {
		t.Errorf("not built: %d %v", code, body)
	}
}

func actorIn(ctx context.Context, tx pgx.Tx, room, name string) (string, error) {
	return actor.CreateActor(ctx, tx, room, "pc", name, nil)
}

func viewOf(loaded *table.Loaded, c cs.Ctx) view.SeatView {
	return view.Of(loaded.Snapshot, loaded.Compiled, c)
}
