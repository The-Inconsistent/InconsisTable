package roomdoc

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/world"
)

// The documents and fixtures of vectors/room-documents.ts, as vectors/roomdoc.ts writes them.
type vectors struct {
	Documents map[string]json.RawMessage `json:"documents"`
	Fixtures  map[string]json.RawMessage `json:"fixtures"`
}

func load(t *testing.T) vectors {
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

// document is a fresh copy of one of the documents, as decoded JSON.
func (v vectors) document(t *testing.T, name string) map[string]any {
	t.Helper()
	var d map[string]any
	if err := json.Unmarshal(v.Documents[name], &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func (v vectors) fixture(t *testing.T, name string) any {
	t.Helper()
	d, err := schema.DecodeJSON(v.Fixtures[name])
	if err != nil {
		t.Fatal(err)
	}
	return schema.Plain(d)
}

var users int

// library is a committed user of the test's own, holding the d20 ruleset, its pack and the World, and the ledger
// ruleset and its pack; everything it owns goes after the test.
func library(t *testing.T, db *pgxpool.Pool, v vectors, skip ...string) campaign.Owner {
	t.Helper()
	ctx := context.Background()
	users++
	owner := campaign.Owner{UserID: fmt.Sprintf("test-roomdoc-%d-%d-%d", os.Getpid(), time.Now().UnixNano(), users), Name: "Importer"}
	if _, err := db.Exec(ctx, `INSERT INTO app_user (id, name) VALUES ($1, $2)`, owner.UserID, owner.Name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, sql := range []string{`DELETE FROM campaign WHERE owner_user_id = $1`, `DELETE FROM pack WHERE owner_user_id = $1`,
			`DELETE FROM ruleset WHERE owner_user_id = $1`, `DELETE FROM world WHERE owner_user_id = $1`, `DELETE FROM app_user WHERE id = $1`} {
			if _, err := db.Exec(ctx, sql, owner.UserID); err != nil {
				t.Errorf("%s: %v", sql, err)
			}
		}
	})
	must := func(_ any, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	has := func(name string) bool { return !slices.Contains(skip, name) }
	if has("d20Ruleset") {
		must(ruleset.Import(ctx, db, owner.UserID, v.fixture(t, "d20Ruleset")))
	}
	if has("d20Pack") {
		must(pack.Import(ctx, db, owner.UserID, v.fixture(t, "d20Pack")))
	}
	if has("world") {
		must(world.Import(ctx, db, owner.UserID, v.fixture(t, "world")))
	}
	must(ruleset.Import(ctx, db, owner.UserID, v.fixture(t, "ledgerRuleset")))
	must(pack.Import(ctx, db, owner.UserID, v.fixture(t, "ledgerPack")))
	return owner
}

// rowsOf counts, table by table, every row an import writes for a room of this owner's.
func rowsOf(t *testing.T, db *pgxpool.Pool, owner string) map[string]int {
	t.Helper()
	rooms := `(SELECT id FROM campaign WHERE owner_user_id = $1)`
	actors := `(SELECT id FROM actor WHERE campaign_id IN ` + rooms + `)`
	entries := `(SELECT id FROM codex_entry WHERE campaign_id IN ` + rooms + `)`
	counts := map[string]string{
		"campaign":        `SELECT count(*) FROM campaign WHERE owner_user_id = $1`,
		"membership":      `SELECT count(*) FROM membership WHERE user_id = $1`,
		"session":         `SELECT count(*) FROM session WHERE campaign_id IN ` + rooms,
		"session_event":   `SELECT count(*) FROM session_event WHERE campaign_id IN ` + rooms,
		"campaign_pack":   `SELECT count(*) FROM campaign_pack WHERE campaign_id IN ` + rooms,
		"campaign_field":  `SELECT count(*) FROM campaign_field WHERE campaign_id IN ` + rooms,
		"resource_pool":   `SELECT count(*) FROM resource_pool WHERE campaign_id IN ` + rooms,
		"image":           `SELECT count(*) FROM image WHERE campaign_id IN ` + rooms,
		"actor":           `SELECT count(*) FROM actor WHERE campaign_id IN ` + rooms,
		"actor_field":     `SELECT count(*) FROM actor_field WHERE actor_id IN ` + actors,
		"actor_resource":  `SELECT count(*) FROM actor_resource WHERE actor_id IN ` + actors,
		"actor_condition": `SELECT count(*) FROM actor_condition WHERE actor_id IN ` + actors,
		"actor_choice":    `SELECT count(*) FROM actor_choice WHERE actor_id IN ` + actors,
		"actor_build":     `SELECT count(*) FROM actor_build WHERE actor_id IN ` + actors,
		"codex_entry":     `SELECT count(*) FROM codex_entry WHERE campaign_id IN ` + rooms,
		"codex_link":      `SELECT count(*) FROM codex_link WHERE entry_id IN ` + entries,
		"codex_reveal":    `SELECT count(*) FROM codex_reveal WHERE entry_id IN ` + entries,
		"clock":           `SELECT count(*) FROM clock WHERE campaign_id IN ` + rooms,
	}
	out := map[string]int{}
	for table, sql := range counts {
		var n int
		if err := db.QueryRow(context.Background(), sql, owner).Scan(&n); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		out[table] = n
	}
	return out
}

func empty(rows map[string]int) bool {
	for _, n := range rows {
		if n != 0 {
			return false
		}
	}
	return true
}

func viaJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// room reads a room back in the document's terms: every id the room's own turned into the document's (by the names and
// titles, unique in these documents), so it can be compared with the document it came from.
type room struct {
	t      *testing.T
	db     *pgxpool.Pool
	id     string
	local  map[string]string // a row's id to the document's
	parsed map[string]any
}

func readRoom(t *testing.T, db *pgxpool.Pool, id string, d map[string]any) *room {
	t.Helper()
	parsed, issues := schema.Parse(cs.RoomDocument, d)
	if len(issues) > 0 {
		t.Fatal(schema.Prettify(issues))
	}
	r := &room{t, db, id, map[string]string{}, parsed.(map[string]any)}
	byName := func(sql, key, field string) {
		for _, item := range doc(r.parsed).list(key) {
			var rowID string
			if err := db.QueryRow(context.Background(), sql, id, item[field]).Scan(&rowID); err != nil {
				t.Fatalf("%s %v: %v", key, item[field], err)
			}
			r.local[rowID] = item["id"].(string)
		}
	}
	byName(`SELECT id::text FROM actor WHERE campaign_id = $1 AND name = $2`, "actors", "name")
	byName(`SELECT id::text FROM codex_entry WHERE campaign_id = $1 AND title = $2`, "codex", "title")
	for _, e := range doc(r.parsed).list("codex") {
		if picture, has := e["imageId"].(string); has {
			var rowID string
			if err := db.QueryRow(context.Background(), `SELECT image_id::text FROM codex_entry WHERE campaign_id = $1 AND title = $2`,
				id, e["title"]).Scan(&rowID); err != nil {
				t.Fatal(err)
			}
			r.local[rowID] = picture
		}
	}
	return r
}

func (r *room) back(rowID string) string {
	if local, has := r.local[rowID]; has {
		return local
	}
	return "unknown:" + rowID
}

func (r *room) text(s string) string {
	return view.MentionRE.ReplaceAllStringFunc(s, func(m string) string {
		id := view.MentionRE.FindStringSubmatch(m)[2]
		return strings.Replace(m, "("+id+")", "("+r.back(id)+")", 1)
	})
}

func (r *room) query(sql string, args ...any) [][]any {
	r.t.Helper()
	rows, err := r.db.Query(context.Background(), sql, args...)
	if err != nil {
		r.t.Fatal(err)
	}
	defer rows.Close()
	var out [][]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			r.t.Fatal(err)
		}
		out = append(out, values)
	}
	return out
}

func (r *room) equal(what string, want, got any) {
	r.t.Helper()
	if w, g := viaJSON(r.t, want), viaJSON(r.t, got); !reflect.DeepEqual(w, g) {
		r.t.Errorf("%s:\n  want %v\n  got  %v", what, w, g)
	}
}

func or(v any, fallback any) any {
	if v == nil {
		return fallback
	}
	return v
}

func sorted(v any) []string {
	out := strs(v)
	slices.Sort(out)
	return out
}

// entries compares every entry with the one the document gave: its texts with their mentions, who reads it, its parent
// and place, its links, planned Tests, status, fields, layout, prep and picture.
func (r *room) entries() {
	for _, e := range doc(r.parsed).list("codex") {
		kind := e["kind"].(string)
		row := r.query(`SELECT id::text, body, gm_notes, visibility, audience_mode, coalesce(parent_id::text, ''), position,
			planned_tests, status, fields, layout, header, prep, coalesce(image_id::text, ''), image_revealed
			FROM codex_entry WHERE campaign_id = $1 AND title = $2`, r.id, e["title"])[0]
		id := row[0].(string)
		got := map[string]any{"body": r.text(row[1].(string)), "gmNotes": r.text(row[2].(string)), "visibility": row[3],
			"audienceMode": row[4], "plannedTests": or(row[7], []any{}), "status": row[8], "fields": row[9], "layout": row[10],
			"header": row[11], "prep": row[12], "imageRevealed": row[14]}
		if row[5] != "" {
			got["parentId"] = r.back(row[5].(string))
		}
		if row[13] != "" {
			got["imageId"] = r.back(row[13].(string))
		}
		if prep, has := got["prep"].(map[string]any); has {
			for _, line := range doc(prep).list("exits") {
				line["sceneId"] = r.back(line["sceneId"].(string))
			}
			for _, line := range doc(prep).list("reveals") {
				line["entryId"] = r.back(line["entryId"].(string))
			}
			for _, line := range doc(prep).list("tests") {
				ids := []any{}
				for _, a := range strs(line["actorIds"]) {
					ids = append(ids, r.back(a))
				}
				line["actorIds"] = ids
			}
		}
		audience, links := []string{}, []string{}
		for _, x := range r.query(`SELECT actor_id::text FROM codex_reveal WHERE entry_id = $1`, id) {
			audience = append(audience, r.back(x[0].(string)))
		}
		for _, x := range r.query(`SELECT target_id::text FROM codex_link WHERE entry_id = $1`, id) {
			links = append(links, r.back(x[0].(string)))
		}
		slices.Sort(audience)
		slices.Sort(links)
		got["audience"], got["links"] = audience, links

		statuses := map[string]any{"quest": "open", "scene": "planned"}
		want := map[string]any{"body": or(e["body"], ""), "gmNotes": or(e["gmNotes"], ""), "visibility": or(e["visibility"], "gm"),
			"audienceMode": or(e["audienceMode"], "all"), "audience": sorted(e["audience"]), "links": sorted(e["links"]),
			"plannedTests": or(e["plannedTests"], []any{}), "status": or(e["status"], statuses[kind]), "fields": or(e["fields"], map[string]any{}),
			"layout": nil, "header": nil, "prep": e["prep"], "imageRevealed": or(e["imageRevealed"], false)}
		if kind == "handout" {
			want["layout"], want["header"] = or(e["layout"], "plain"), or(e["header"], "")
		}
		for _, key := range []string{"parentId", "imageId"} {
			if v, has := e[key]; has {
				want[key] = v
			}
		}
		if position, has := e["position"]; has {
			want["position"], got["position"] = position, row[6]
		}
		r.equal("entry "+e["title"].(string), want, got)
	}
}

// actors compares each actor's kind and type, the fields, resources and conditions the document gave, and a build.
func (r *room) actors() {
	for _, a := range doc(r.parsed).list("actors") {
		row := r.query(`SELECT id::text, kind, entity_type FROM actor WHERE campaign_id = $1 AND name = $2`, r.id, a["name"])[0]
		id := row[0].(string)
		r.equal("actor "+a["name"].(string)+" kind", a["kind"], row[1])
		if entity, has := a["entityType"]; has {
			r.equal("actor type", entity, row[2])
		}
		fields := map[string]any{}
		for _, x := range r.query(`SELECT field_id, coalesce(int_value::text, text_value) FROM actor_field WHERE actor_id = $1`, id) {
			fields[x[0].(string)] = x[1]
		}
		given, _ := a["fields"].(map[string]any)
		for key, want := range given {
			r.equal("field "+key, fmt.Sprint(want), fields[key])
		}
		resources := map[string]any{}
		for _, x := range r.query(`SELECT resource_id, value FROM actor_resource WHERE actor_id = $1`, id) {
			resources[x[0].(string)] = x[1]
		}
		values, _ := a["resources"].(map[string]any)
		for key, want := range values {
			r.equal("resource "+key, want, resources[key])
		}
		conditions := []string{}
		for _, x := range r.query(`SELECT condition_id FROM actor_condition WHERE actor_id = $1`, id) {
			conditions = append(conditions, x[0].(string))
		}
		slices.Sort(conditions)
		r.equal("conditions", sorted(a["conditions"]), conditions)
		if build, has := a["build"].(string); has {
			var stored string
			if err := r.db.QueryRow(context.Background(), `SELECT build::text FROM actor_build WHERE actor_id = $1`, id).Scan(&stored); err != nil {
				r.t.Fatal(err)
			}
			var want, got map[string]any
			_ = json.Unmarshal([]byte(build), &want)
			_ = json.Unmarshal([]byte(stored), &got)
			delete(got, "gm") // the GM's part of a build, none in the document
			r.equal("build", want, got)
		}
	}
}

// rest compares the room's settings, its pins, sessions, pools, campaign fields, clocks and pictures.
func (r *room) rest() {
	d := doc(r.parsed)
	settings := r.query(`SELECT name, next_session_at, coalesce(next_session_place, ''), safety FROM campaign WHERE id = $1`, r.id)[0]
	room, _ := d["room"].(map[string]any)
	r.equal("name", room["name"], settings[0])
	if at, has := room["nextSessionAt"].(string); has {
		want, _ := time.Parse(time.RFC3339Nano, at)
		r.equal("next session", want.UTC(), settings[1].(time.Time).UTC())
	}
	r.equal("place", or(room["nextSessionPlace"], ""), settings[2])
	if safety, has := room["safety"]; has {
		r.equal("safety", safety, settings[3])
	}
	sessions := r.query(`SELECT number, title, recap, notes, ended_at IS NOT NULL FROM session WHERE campaign_id = $1 ORDER BY number`, r.id)
	if len(sessions) != len(d.list("sessions")) {
		r.t.Fatalf("sessions: want %d, got %d", len(d.list("sessions")), len(sessions))
	}
	for i, s := range d.list("sessions") {
		r.equal(fmt.Sprintf("session %d", i+1), []any{i + 1, or(s["title"], ""), or(s["recap"], ""), or(s["notes"], ""), true},
			[]any{sessions[i][0], sessions[i][1], r.text(sessions[i][2].(string)), r.text(sessions[i][3].(string)), sessions[i][4]})
	}
	pools := map[string]any{}
	for _, x := range r.query(`SELECT resource_id, value FROM resource_pool WHERE campaign_id = $1`, r.id) {
		pools[x[0].(string)] = x[1]
	}
	r.equal("pools", or(d["pools"], map[string]any{}), pools)
	// A campaign field reads as the room holds it: a value equal to the field's default leaves no row.
	given, _ := d["campaignFields"].(map[string]any)
	rules, err := compiled.Load(context.Background(), r.db, r.id)
	if err != nil {
		r.t.Fatal(err)
	}
	if rules != nil {
		values, err := actor.LoadCampaign(context.Background(), r.db, r.id, rules)
		if err != nil {
			r.t.Fatal(err)
		}
		for key, want := range given {
			r.equal("campaign field "+key, want, values[key])
		}
	}
	clocks := r.query(`SELECT name, segments, filled, visibility, coalesce(entry_id::text, '') FROM clock WHERE campaign_id = $1 ORDER BY position`, r.id)
	for i, c := range d.list("clocks") {
		got := map[string]any{"name": clocks[i][0], "segments": clocks[i][1], "filled": clocks[i][2], "visibility": clocks[i][3]}
		want := map[string]any{"name": c["name"], "segments": or(c["segments"], 4), "filled": or(c["filled"], 0), "visibility": or(c["visibility"], "gm")}
		if entry := clocks[i][4].(string); entry != "" {
			got["entryId"] = r.back(entry)
		}
		if entry, has := c["entryId"]; has {
			want["entryId"] = entry
		}
		r.equal("clock "+c["name"].(string), want, got)
	}
	for _, p := range d.list("images") {
		var rowID string
		for row, local := range r.local {
			if local == p["id"] {
				rowID = row
			}
		}
		var mime string
		var data []byte
		if err := r.db.QueryRow(context.Background(), `SELECT mime, bytes FROM image WHERE id = $1 AND campaign_id = $2`, rowID, r.id).
			Scan(&mime, &data); err != nil {
			r.t.Fatalf("picture %v: %v", p["id"], err)
		}
		want, _ := base64.StdEncoding.DecodeString(p["base64"].(string))
		r.equal("picture", []any{p["mime"], want}, []any{mime, data})
	}
	expects, _ := d["expects"].(map[string]any)
	pins := r.query(`SELECT coalesce((SELECT r.slug || ' ' || v.version FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
			WHERE v.id = c.ruleset_version_id), ''),
		coalesce((SELECT w.slug || ' ' || v.version FROM world_version v JOIN world w ON w.id = v.world_id WHERE v.id = c.world_version_id), '')
		FROM campaign c WHERE c.id = $1`, r.id)[0]
	pinned := func(e any) string {
		m, _ := e.(map[string]any)
		if m == nil {
			return ""
		}
		return fmt.Sprint(m["slug"], " ", m["version"])
	}
	r.equal("pins", []any{pinned(expects["ruleset"]), pinned(expects["world"])}, pins)
	var packs []string
	for _, x := range r.query(`SELECT p.slug || ' ' || v.version FROM campaign_pack cp JOIN pack_version v ON v.id = cp.pack_version_id
		JOIN pack p ON p.id = v.pack_id WHERE cp.campaign_id = $1 ORDER BY 1`, r.id) {
		packs = append(packs, x[0].(string))
	}
	var wantPacks []string
	for _, p := range doc(expects).list("packs") {
		wantPacks = append(wantPacks, pinned(p))
	}
	slices.Sort(wantPacks)
	r.equal("packs", or(wantPacks, []string{}), or(packs, []string{}))
}

// Each document comes in whole, and the room read back is the document: every entry, parent, link, reader, field,
// layout, prepared line's reference, picture and mention, as the document's own ids.
func TestEachDocumentReadsBackAsItself(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	for _, name := range []string{"d20", "bare", "ledger"} {
		t.Run(name, func(t *testing.T) {
			d := v.document(t, name)
			started := time.Now()
			answer, err := Import(context.Background(), db, owner, d, Options{})
			if err != nil {
				t.Fatal(err)
			}
			took := time.Since(started)
			if answer.CampaignID == nil {
				t.Fatal("no room")
			}
			var actions int // every action bumps the room's state version once
			_ = db.QueryRow(context.Background(), `SELECT state_version FROM campaign WHERE id = $1`, *answer.CampaignID).Scan(&actions)
			t.Logf("%s imported in %v, %d actions", name, took, actions)
			want := countsOf(doc(d))
			if !reflect.DeepEqual(answer.Counts, want) {
				t.Errorf("counts: want %v, got %v", want, answer.Counts)
			}
			r := readRoom(t, db, *answer.CampaignID, d)
			r.entries()
			r.actors()
			r.rest()
			var role string
			if err := db.QueryRow(context.Background(), `SELECT role FROM membership WHERE campaign_id = $1 AND user_id = $2`,
				*answer.CampaignID, owner.UserID).Scan(&role); err != nil || role != "gm" {
				t.Errorf("the importer sits as gm: %q %v", role, err)
			}
			var seats int
			_ = db.QueryRow(context.Background(), `SELECT count(*) FROM membership WHERE campaign_id = $1`, *answer.CampaignID).Scan(&seats)
			if seats != 1 {
				t.Errorf("no seat comes with a document: %d", seats)
			}
		})
	}
}

// A dry run answers what it would make, and leaves nothing behind.
func TestADryRunLeavesNothing(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	answer, err := Import(context.Background(), db, owner, v.document(t, "d20"), Options{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if answer.CampaignID != nil || answer.Name != "Harbour Watch" || answer.Counts.Entries["scene"] != 2 || answer.Counts.Actors["pc"] != 1 ||
		answer.Counts.Pictures != 1 || answer.Counts.Sessions != 2 || answer.Counts.Clocks != 1 {
		t.Errorf("answer: %+v", answer)
	}
	if want := []Expect{{"ruleset", "sample-d20", "0.1.3-room", true}, {"pack", "sample-bestiary", "0.1.0", true},
		{"world", "sample-tidewater", "0.1.0", true}}; !reflect.DeepEqual(answer.Expects, want) {
		t.Errorf("expects: %+v", answer.Expects)
	}
	if rows := rowsOf(t, db, owner.UserID); !empty(rows) {
		t.Errorf("a dry run left rows: %v", rows)
	}
}

// at sets a value at a path of a decoded document.
func at(d map[string]any, value any, path ...any) {
	var cur any = d
	for i, key := range path {
		last := i == len(path)-1
		switch k := key.(type) {
		case string:
			m := cur.(map[string]any)
			if last {
				m[k] = value
				return
			}
			cur = m[k]
		case int:
			l := cur.([]any)
			if last {
				l[k] = value
				return
			}
			cur = l[k]
		}
	}
}

// Every refusal names the document path that caused it and the handler's own refusal, and leaves no row behind.
func TestARefusedDocumentNamesItsPathAndLeavesNothing(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	cases := []struct {
		name, document string
		change         func(d map[string]any)
		path, code     string
	}{
		{"wrong format", "d20", func(d map[string]any) { d["format"] = "another-app" }, "format", "roomNotDocument"},
		{"wrong version", "d20", func(d map[string]any) { d["version"] = 2.0 }, "version", "roomNotDocument"},
		{"an unknown key", "d20", func(d map[string]any) { at(d, true, "codex", 2, "secret") }, "codex[2]", "badRequest"},
		{"a dangling prepared line", "d20", func(d map[string]any) {
			at(d, "00000000-0000-4000-8000-000000000999", "codex", 6, "prep", "reveals", 0, "entryId")
		}, "codex[6].prep.reveals[0].entryId", "roomNoSuchEntry"},
		{"a dangling mention", "d20", func(d map[string]any) {
			at(d, "See @[Gone](00000000-0000-4000-8000-000000000999).", "codex", 3, "body")
		}, "codex[3].body", "roomNoSuchEntry"},
		{"a reader not in the document", "d20", func(d map[string]any) {
			at(d, []any{"00000000-0000-4000-8000-000000000999"}, "codex", 3, "audience")
		}, "codex[3].audience[0]", "roomNoSuchActor"},
		{"a parent not in the document", "d20", func(d map[string]any) {
			at(d, "00000000-0000-4000-8000-000000000999", "codex", 1, "parentId")
		}, "codex[1].parentId", "roomNoSuchEntry"},
		{"a missing picture", "d20", func(d map[string]any) { d["images"] = []any{} }, "codex[1].imageId", "roomNoSuchPicture"},
		{"a pack not imported", "d20", func(d map[string]any) { at(d, "not-mine", "expects", "packs", 0, "slug") }, "expects.packs[0]", "roomImportFirst"},
		{"another version", "d20", func(d map[string]any) { at(d, "9.9.9", "expects", "ruleset", "version") }, "expects.ruleset", "roomImportFirst"},
		{"a hash that differs", "d20", func(d map[string]any) { at(d, "deadbeef", "expects", "world", "hash") }, "expects.world", "roomHashDiffers"},
		{"a pool it cannot hold", "d20", func(d map[string]any) { d["pools"] = map[string]any{"luck": 5.0} }, "pools.luck", "roomValueClamped"},
		{"no such pool", "d20", func(d map[string]any) { d["pools"] = map[string]any{"gold": 5.0} }, "pools.gold", "unknownPool"},
		{"a field out of range", "d20", func(d map[string]any) { at(d, 99.0, "actors", 0, "fields", "level") }, "actors[0].fields", "fieldInvalid"},
		{"a resource past its max", "d20", func(d map[string]any) { at(d, 99.0, "actors", 0, "resources", "hp") }, "actors[0].resources.hp", "roomValueClamped"},
		{"no such condition", "d20", func(d map[string]any) { at(d, []any{"cursed"}, "actors", 0, "conditions") }, "actors[0].conditions[0]", "noCondition"},
		{"no such type", "d20", func(d map[string]any) { at(d, "dragon", "actors", 1, "entityType") }, "actors[1].entityType", "noSuchEntity"},
		{"an undeclared entry field", "d20", func(d map[string]any) { at(d, map[string]any{"rank": 1.0}, "codex", 2, "fields") }, "codex[2].fields", "noSuchEntryField"},
		{"a scene under a place", "d20", func(d map[string]any) { at(d, "00000000-0000-4000-8000-000000000010", "codex", 6, "parentId") }, "codex[6].parentId", "sceneNeedsAdventure"},
		{"a bad build", "ledger", func(d map[string]any) { at(d, `{"tier":1}`, "actors", 0, "build") }, "actors[0].build", ""},
		{"a typed actor without a ruleset", "bare", func(d map[string]any) {
			d["actors"] = []any{map[string]any{"id": "00000000-0000-4000-8000-000000000050", "kind": "pc", "name": "Lone", "entityType": "character"}}
		}, "actors[0].entityType", "noRuleset"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := v.document(t, c.document)
			c.change(d)
			_, err := Import(context.Background(), db, owner, d, Options{})
			var p *Problem
			if !errors.As(err, &p) {
				t.Fatalf("want a refusal, got %v", err)
			}
			if p.Path != c.path || (c.code != "" && p.Code != c.code) {
				t.Errorf("want %s at %s, got %s at %s (%s)", c.code, c.path, p.Code, p.Path, p.Error())
			}
			if rows := rowsOf(t, db, owner.UserID); !empty(rows) {
				t.Errorf("a refused import left rows: %v", rows)
			}
		})
	}
}

// The pack has to be the importer's own: another user's copy of it grants nothing (principle 4).
func TestAPackOfAnotherUserIsNotTheImporters(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	library(t, db, v) // holds every version the document names
	owner := library(t, db, v, "d20Pack")
	_, err := Import(context.Background(), db, owner, v.document(t, "d20"), Options{DryRun: true})
	var p *Problem
	if !errors.As(err, &p) || p.Path != "expects.packs[0]" || p.Code != "roomImportFirst" {
		t.Fatalf("want roomImportFirst at expects.packs[0], got %v", err)
	}
}

// A hash, when the document gives one, is the imported version's.
func TestAMatchingHashImports(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	owner := library(t, db, v)
	var hash string
	if err := db.QueryRow(context.Background(), `SELECT v.hash FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
		WHERE r.owner_user_id = $1 AND r.slug = 'sample-d20'`, owner.UserID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	d := v.document(t, "d20")
	at(d, hash, "expects", "ruleset", "hash")
	if _, err := Import(context.Background(), db, owner, d, Options{DryRun: true}); err != nil {
		t.Fatal(err)
	}
}

// The route: only a user who may create a room imports one; a refusal is 422 with its path and what was read.
func TestTheRouteIsForCreators(t *testing.T) {
	db := dbtest.Open(t)
	v := load(t)
	s := &Service{DB: db, Auth: &auth.Service{DB: db}}
	post := func(cookie string, body any, query string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(http.MethodPost, "/api/campaigns/import"+query, strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		w := httptest.NewRecorder()
		core.Serve(s.Import)(w, r)
		return w
	}
	if w := post("", v.document(t, "bare"), ""); w.Code != http.StatusUnauthorized {
		t.Errorf("no device: %d", w.Code)
	}
	device := auth.DeviceCookie + "=" + auth.NewSecret()
	user, err := s.Auth.DeviceUser(context.Background(), device)
	if err != nil || user == nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM campaign WHERE owner_user_id = $1`, user.UserID)
		_, _ = db.Exec(context.Background(), `DELETE FROM app_user WHERE id = $1`, user.UserID)
	})
	if _, err := db.Exec(context.Background(), `UPDATE app_user SET role = 'user' WHERE id = $1`, user.UserID); err != nil {
		t.Fatal(err)
	}
	if w := post(device, v.document(t, "bare"), ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "creatorsOnly") {
		t.Errorf("not a creator: %d %s", w.Code, w.Body)
	}
	if _, err := db.Exec(context.Background(), `UPDATE app_user SET role = 'creator' WHERE id = $1`, user.UserID); err != nil {
		t.Fatal(err)
	}
	dry := post(device, v.document(t, "bare"), "?dryRun=1")
	if dry.Code != http.StatusOK || !strings.Contains(dry.Body.String(), `"campaignId":null`) {
		t.Errorf("dry run: %d %s", dry.Code, dry.Body)
	}
	d := v.document(t, "d20")
	refused := post(device, d, "?dryRun=1")
	var body map[string]any
	_ = json.Unmarshal(refused.Body.Bytes(), &body)
	if refused.Code != http.StatusUnprocessableEntity || body["path"] != "expects.ruleset" || body["code"] != "roomImportFirst" ||
		body["name"] != "Harbour Watch" || len(body["expects"].([]any)) != 3 {
		t.Errorf("refused: %d %s", refused.Code, refused.Body)
	}
	made := post(device, v.document(t, "bare"), "")
	var answer Answer
	_ = json.Unmarshal(made.Body.Bytes(), &answer)
	if made.Code != http.StatusCreated || answer.CampaignID == nil {
		t.Errorf("import: %d %s", made.Code, made.Body)
	}
}
