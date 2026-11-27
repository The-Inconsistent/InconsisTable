package roomdoc

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// The export (house decision #103) writes a room as the document Import reads, so that importing it gives an equal
// room. Its ids are the room's own row ids, which are UUIDs as the document's must be. What the document has no place
// for (a running fight, seats, drafts) stays behind; a reference to something the room no longer holds (a mention, a
// prepared line, a link field naming a deleted entry or character) is left out, since the import refuses one that
// dangles, and so is what names a pack the room is no longer served (#232), counted in the export's Report.

// ErrTooLarge is a document over the import's body cap: the room's pictures make it larger than an import takes.
var ErrTooLarge = cs.Fail("roomExportTooLarge")

// picture is one picture the document carries, read whole only while it is written.
type picture struct {
	id, mime string
	size     int
}

// Report is what an export says of itself (#232, the `X-Room-Export` header; RoomExportReport in core-schema): the
// pictures it carries, the packs the room is no longer served that it leaves out of `expects`, the items of such packs
// it writes as hand-written lines, and the entries whose pack entry (`source`) it leaves out.
type Report struct {
	Pictures int `json:"pictures"`
	Packs    int `json:"packs"`
	Items    int `json:"items"`
	Sources  int `json:"sources"`
}

// prepared is a document read and known to fit, its pictures still to be written.
type prepared struct {
	campaignID string
	pictures   bool
	head       []byte
	shown      []picture
	Report     Report
}

// prepare reads the room's document. A document the import would refuse for its size is refused here, before anything
// is written.
func prepare(ctx context.Context, conn core.Conn, campaignID string, pictures bool) (*prepared, error) {
	d, shown, report, err := exportRoom(ctx, conn, campaignID, pictures)
	if err != nil {
		return nil, err
	}
	head, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	total := len(head)
	for _, p := range shown {
		total += base64.StdEncoding.EncodedLen(p.size) + 120
	}
	if total > cs.RoomMaxBytes {
		return nil, ErrTooLarge
	}
	report.Pictures = len(shown)
	return &prepared{campaignID: campaignID, pictures: pictures, head: head, shown: shown, Report: report}, nil
}

// Write writes the room's document to w. With pictures false it carries none, and no entry names one.
func Write(ctx context.Context, conn core.Conn, w io.Writer, campaignID string, pictures bool) error {
	p, err := prepare(ctx, conn, campaignID, pictures)
	if err != nil {
		return err
	}
	return p.write(ctx, conn, w)
}

// write writes the document. The pictures are written last, one at a time, so a room of large pictures is never held
// whole in memory.
func (p *prepared) write(ctx context.Context, conn core.Conn, w io.Writer) error {
	head, shown, campaignID := p.head, p.shown, p.campaignID
	if !p.pictures {
		_, err := w.Write(head)
		return err
	}
	// The document without its last brace, then its pictures.
	if _, err := w.Write(append(head[:len(head)-1], []byte(`,"images":[`)...)); err != nil {
		return err
	}
	for i, pic := range shown {
		var data []byte
		if err := conn.QueryRow(ctx, `SELECT bytes FROM image WHERE id = $1 AND campaign_id = $2`, pic.id, campaignID).Scan(&data); err != nil {
			return err
		}
		meta, _ := json.Marshal(map[string]string{"id": pic.id, "mime": pic.mime})
		if i > 0 {
			meta = append([]byte(","), meta...)
		}
		meta = append(meta[:len(meta)-1], []byte(`,"base64":"`)...)
		if _, err := w.Write(meta); err != nil {
			return err
		}
		encoder := base64.NewEncoder(base64.StdEncoding, w)
		if _, err := encoder.Write(data); err != nil {
			return err
		}
		if err := encoder.Close(); err != nil {
			return err
		}
		if _, err := w.Write([]byte(`"}`)); err != nil {
			return err
		}
	}
	_, err := w.Write([]byte("]}"))
	return err
}

// Export is the room's document as decoded JSON, pictures and all: what Write writes, for a caller that wants it whole.
func Export(ctx context.Context, conn core.Conn, campaignID string, pictures bool) (map[string]any, error) {
	var buf bytes.Buffer
	if err := Write(ctx, conn, &buf, campaignID, pictures); err != nil {
		return nil, err
	}
	var d map[string]any
	return d, json.Unmarshal(buf.Bytes(), &d)
}

// exporter reads one room in the document's terms.
type exporter struct {
	ctx        context.Context
	conn       core.Conn
	id         string
	rules      *engine.CompiledRuleset
	entries    map[string]bool // the room's codex entries and actors, for a reference to be kept only when it holds
	actors     map[string]bool
	pictureIDs map[string]bool
	// What the actors were built with, for the pools' bounds.
	characters float64
	campaign   map[string]any
	// When it is written: a session still running ends then (#232).
	at     time.Time
	report Report
}

// exportRoom is the document without its pictures' bytes, and the pictures it carries in the order they are written.
func exportRoom(ctx context.Context, conn core.Conn, campaignID string, pictures bool) (map[string]any, []picture, Report, error) {
	rules, err := compiled.Load(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, Report{}, err
	}
	ex := &exporter{ctx: ctx, conn: conn, id: campaignID, rules: rules, entries: map[string]bool{}, actors: map[string]bool{},
		pictureIDs: map[string]bool{}, at: time.Now().UTC()}
	d := map[string]any{"format": cs.RoomFormat, "version": cs.RoomVersion, "exportedAt": ex.at.Format(time.RFC3339Nano)}
	room, expects, err := ex.room()
	if err != nil {
		return nil, nil, Report{}, err
	}
	d["room"] = room
	if len(expects) > 0 {
		d["expects"] = expects
	}
	entries, err := codex.Load(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, Report{}, err
	}
	// In the order they were made: ids are uuidv7, and the entries an import makes share one time.
	slices.SortFunc(entries.Entries, func(a, b cs.CodexEntry) int { return strings.Compare(a.ID, b.ID) })
	for _, e := range entries.Entries {
		ex.entries[e.ID] = true
	}
	actors, err := ex.actorList()
	if err != nil {
		return nil, nil, Report{}, err
	}
	if len(actors) > 0 {
		d["actors"] = actors
	}
	if err := ex.values(d); err != nil {
		return nil, nil, Report{}, err
	}
	if list := ex.codex(entries.Entries, pictures); len(list) > 0 {
		d["codex"] = list
	}
	for key, read := range map[string]func() ([]any, error){"sessions": ex.sessions, "clocks": ex.clocks} {
		list, err := read()
		if err != nil {
			return nil, nil, Report{}, err
		}
		if len(list) > 0 {
			d[key] = list
		}
	}
	if !pictures || len(ex.pictureIDs) == 0 {
		return d, nil, ex.report, nil
	}
	rows, err := conn.Query(ctx, `SELECT id::text, mime, size FROM image WHERE campaign_id = $1 AND id = ANY($2::uuid[])
		ORDER BY created_at, id`, campaignID, slices.Sorted(maps.Keys(ex.pictureIDs)))
	if err != nil {
		return nil, nil, Report{}, err
	}
	shown, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (picture, error) {
		var p picture
		return p, r.Scan(&p.id, &p.mime, &p.size)
	})
	return d, shown, ex.report, err
}

// room is the room's name, next session and safety lines, and the versions it expects by slug, version and hash.
func (ex *exporter) room() (map[string]any, map[string]any, error) {
	var name string
	var nextAt *time.Time
	var place *string
	var safety map[string]any
	var ruleset, world *expect
	err := ex.conn.QueryRow(ex.ctx, `SELECT c.name, c.next_session_at, c.next_session_place, c.safety,
			(SELECT json_build_object('slug', r.slug, 'version', v.version, 'hash', v.hash) FROM ruleset_version v
				JOIN ruleset r ON r.id = v.ruleset_id WHERE v.id = c.ruleset_version_id),
			(SELECT json_build_object('slug', w.slug, 'version', v.version, 'hash', v.hash) FROM world_version v
				JOIN world w ON w.id = v.world_id WHERE v.id = c.world_version_id)
		FROM campaign c WHERE c.id = $1`, ex.id).Scan(&name, &nextAt, &place, &safety, &ruleset, &world)
	if err != nil {
		return nil, nil, err
	}
	room := map[string]any{"name": name}
	if nextAt != nil {
		room["nextSessionAt"] = core.ISOTime(*nextAt)
	}
	if place != nil && *place != "" {
		room["nextSessionPlace"] = *place
	}
	if safety != nil {
		room["safety"] = safety
	}
	expects := map[string]any{}
	if ruleset != nil {
		expects["ruleset"] = ruleset
	}
	if world != nil {
		expects["world"] = world
	}
	// A pack the room is no longer served (taken down, or private to someone who no longer runs it) is left out and
	// counted (#232): the import could not attach it, and what was made from it is left out or written by hand below.
	rows, err := ex.conn.Query(ex.ctx, `SELECT pack.slug, v.version, v.hash, `+actor.ServedPacks("$1")+` FROM campaign_pack
		JOIN pack_version v ON v.id = campaign_pack.pack_version_id JOIN pack ON pack.id = v.pack_id
		WHERE campaign_pack.campaign_id = $1 ORDER BY campaign_pack.created_at, pack.slug`, ex.id)
	if err != nil {
		return nil, nil, err
	}
	packs := []expect{}
	var e expect
	var served bool
	if _, err := pgx.ForEachRow(rows, []any{&e.Slug, &e.Version, &e.Hash, &served}, func() error {
		if served {
			packs = append(packs, e)
		} else {
			ex.report.Packs++
		}
		return nil
	}); err != nil {
		return nil, nil, err
	}
	if len(packs) > 0 {
		expects["packs"] = packs
	}
	return room, expects, nil
}

// expect is one version a document names.
type expect struct {
	Slug    string `json:"slug"`
	Version string `json:"version"`
	Hash    string `json:"hash"`
}

// actorList is every actor of the room in the order it was made: a built one with its build and the fields its build
// does not write, a typed one with its type and fields, each with its resources, conditions, items and spawn options.
// A temporary creature is left out: it lives only as long as its fight, which does not travel, and the import would
// make it permanent; whatever refers to it is then dropped as a reference to an actor the room no longer holds.
func (ex *exporter) actorList() ([]any, error) {
	all, err := actor.LoadRows(ex.ctx, ex.conn, ex.id)
	if err != nil {
		return nil, err
	}
	tempRows, err := ex.conn.Query(ex.ctx, `SELECT id::text FROM actor WHERE campaign_id = $1 AND temporary`, ex.id)
	if err != nil {
		return nil, err
	}
	temporary, err := pgx.CollectRows(tempRows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	rows := slices.DeleteFunc(all, func(r actor.Rows) bool { return slices.Contains(temporary, r.Actor.ID) })
	var campaign map[string]any
	if ex.rules != nil {
		if campaign, err = actor.LoadCampaign(ex.ctx, ex.conn, ex.id, ex.rules); err != nil {
			return nil, err
		}
	}
	ex.characters, ex.campaign = actor.CountCharacters(rows), campaign
	built, err := actor.Build(ex.rules, rows, campaign)
	if err != nil {
		return nil, err
	}
	builds := map[string]string{}
	buildRows, err := ex.conn.Query(ex.ctx, `SELECT b.actor_id::text, b.build::text FROM actor_build b JOIN actor a ON a.id = b.actor_id
		WHERE a.campaign_id = $1 AND b.build IS NOT NULL`, ex.id)
	if err != nil {
		return nil, err
	}
	var buildID, buildText string
	if _, err := pgx.ForEachRow(buildRows, []any{&buildID, &buildText}, func() error {
		builds[buildID] = buildText
		return nil
	}); err != nil {
		return nil, err
	}
	// Where each ledger build's next advance counts from (#232), on any actor build.ascend gave a row.
	type advance struct {
		xp     int
		waived bool
	}
	advances := map[string]advance{}
	advanceRows, err := ex.conn.Query(ex.ctx, `SELECT b.actor_id::text, b.xp_at_ascension, b.package_waived FROM actor_build b
		JOIN actor a ON a.id = b.actor_id WHERE a.campaign_id = $1`, ex.id)
	if err != nil {
		return nil, err
	}
	var adv advance
	if _, err := pgx.ForEachRow(advanceRows, []any{&buildID, &adv.xp, &adv.waived}, func() error {
		advances[buildID] = adv
		return nil
	}); err != nil {
		return nil, err
	}
	for _, r := range rows {
		ex.actors[r.Actor.ID] = true
	}
	var writes map[string]bool
	if ex.rules != nil && ex.rules.Ruleset.Build != nil {
		writes = actor.BuildWrites(ex.rules.Ruleset.Build)
	}
	out := []any{}
	for _, r := range rows {
		b := built[r.Actor.ID]
		a := map[string]any{"id": r.Actor.ID, "kind": r.Actor.Kind, "name": r.Actor.Name}
		build, isBuilt := builds[r.Actor.ID]
		switch {
		case isBuilt:
			a["build"] = build
		case b.Entity != "":
			a["entityType"] = b.Entity
		}
		if b.Entity != "" {
			fields := map[string]any{}
			for key, v := range b.Fields {
				if v != nil && !(isBuilt && writes[key]) {
					fields[key] = v
				}
			}
			if len(fields) > 0 {
				a["fields"] = fields
			}
			if len(b.Resources) > 0 {
				a["resources"] = b.Resources
			}
			if len(r.Actor.SpawnOptions) > 0 {
				a["spawnOptions"] = r.Actor.SpawnOptions
			}
		}
		if len(r.Conditions) > 0 {
			list := make([]any, len(r.Conditions))
			for i, c := range r.Conditions {
				list[i] = c.ConditionID
				if c.Stacks > 1 {
					list[i] = map[string]any{"id": c.ConditionID, "stacks": c.Stacks}
				}
			}
			a["conditions"] = list
		}
		if r.Actor.Status != "active" {
			a["status"] = r.Actor.Status
		}
		if b := advances[r.Actor.ID]; b.xp != 0 || b.waived {
			a["xpAtAscension"], a["packageWaived"] = b.xp, b.waived
		}
		if items := ex.items(r.Items); len(items) > 0 {
			a["items"] = items
		}
		out = append(out, a)
	}
	return out, nil
}

// items are an actor's items as the document holds them, a GIVE's codex entry only while the room still has it.
func (ex *exporter) items(rows []actor.ItemRow) []any {
	out := []any{}
	for _, x := range rows {
		item := map[string]any{"id": x.ID, "kind": x.Kind}
		switch {
		case x.EntryKey != nil && x.Served:
			item["entry"] = *x.EntryKey
		case x.EntryKey != nil:
			// A pack the room is no longer served (#232): a hand-written line named by its key, as the sheet names it.
			item["name"] = x.Label()
			ex.report.Items++
		default:
			item["name"] = x.Name
		}
		if x.Note != "" {
			item["note"] = x.Note
		}
		if x.Quantity != nil {
			item["quantity"] = *x.Quantity
		}
		if x.FittedTo != nil {
			item["fittedTo"] = *x.FittedTo
		}
		if x.FittedLine != nil {
			item["fittedLine"] = *x.FittedLine // a line of the saved build (house decision #102)
		}
		if x.Source != "hand" {
			item["source"] = x.Source
		}
		if x.CodexEntryID != nil && ex.entries[*x.CodexEntryID] {
			item["entryId"] = *x.CodexEntryID
		}
		out = append(out, item)
	}
	return out
}

// values are the campaign fields the room has set and its pools as they stand.
func (ex *exporter) values(d map[string]any) error {
	if ex.rules == nil {
		return nil
	}
	rows, err := actor.LoadCampaignRows(ex.ctx, ex.conn, ex.id)
	if err != nil {
		return err
	}
	if fields := actor.StoredCampaign(ex.rules, rows); len(fields) > 0 {
		d["campaignFields"] = fields
	}
	poolRows, err := actor.LoadPools(ex.ctx, ex.conn, ex.id)
	if err != nil {
		return err
	}
	pools, err := actor.BuildPools(ex.rules, poolRows, ex.characters, ex.campaign)
	if err != nil {
		return err
	}
	stored := map[string]bool{}
	for _, r := range poolRows {
		stored[r.ResourceID] = true
	}
	// A pool is written as the room holds it within its bounds now: one left over a maximum that has since dropped
	// (a character gone from a pool counting the party) is written at that maximum, which the import can reach.
	values := map[string]any{}
	for _, p := range pools {
		if !stored[p.ID] {
			continue
		}
		value := max(p.State.Value, p.Bounds.Min)
		if ceiling := p.Bounds.Ceiling(); ceiling != nil {
			value = min(value, *ceiling)
		}
		values[p.ID] = value
	}
	if len(values) > 0 {
		d["pools"] = values
	}
	return nil
}

// codex is every entry as the document holds it. A reference to an entry or character the room no longer has is left
// out: a mention becomes its words, a prepared line naming one goes, a link field naming one is cleared.
func (ex *exporter) codex(entries []cs.CodexEntry, pictures bool) []any {
	out := []any{}
	for _, e := range entries {
		x := map[string]any{"id": e.ID, "kind": e.Kind, "title": e.Title, "position": e.Position}
		for key, text := range map[string]string{"body": e.Body, "gmNotes": e.GMNotes} {
			if text != "" {
				x[key] = ex.mentions(text)
			}
		}
		if e.Visibility != "gm" || e.AudienceMode != "all" || len(e.Audience) > 0 {
			x["visibility"], x["audienceMode"] = e.Visibility, e.AudienceMode
			audience := []string{}
			for _, a := range e.Audience {
				if ex.actors[a] {
					audience = append(audience, a)
				}
			}
			slices.Sort(audience)
			x["audience"] = audience
			// Every listed reader is gone (deleted, or a temporary creature left out): nobody but the GM side reads it, and
			// the import refuses a listed entry with nobody to show it to.
			if e.AudienceMode == "listed" && len(audience) == 0 {
				x["visibility"] = "gm"
			}
		}
		if e.ParentID != nil {
			x["parentId"] = *e.ParentID
		}
		if len(e.Links) > 0 {
			x["links"] = e.Links
		}
		if len(e.PlannedTests) > 0 {
			x["plannedTests"] = e.PlannedTests
		}
		if e.Status != nil {
			x["status"] = *e.Status
		}
		if fields := ex.fields(e.Kind, e.Fields); len(fields) > 0 {
			x["fields"] = fields
		}
		if e.Layout != nil {
			x["layout"] = *e.Layout
		}
		if e.Header != nil && *e.Header != "" {
			x["header"] = *e.Header
		}
		if prep, has := e.Prep.(map[string]any); has && prep != nil {
			x["prep"] = ex.prep(prep)
		}
		if pictures && e.ImageID != nil {
			x["imageId"] = *e.ImageID
			ex.pictureIDs[*e.ImageID] = true
		}
		if pictures && e.ImageRevealed {
			x["imageRevealed"] = true
		}
		// The pack entry it was made from (house decision #97), while the room is served it; the import checks it is and
		// reads its page again. One no longer served is left out and counted (#232).
		if source, has := e.Source.(map[string]any); has {
			if entity, _ := source["entity"].(string); ex.served(entity, source["key"]) {
				x["source"] = e.Source
			} else {
				ex.report.Sources++
			}
		}
		if e.RevealedAt != nil && e.Visibility != "gm" {
			x["revealedAt"] = *e.RevealedAt
		}
		out = append(out, x)
	}
	return out
}

// served says whether the room is served the pack entry of that type and key.
func (ex *exporter) served(entity string, key any) bool {
	var served bool
	err := ex.conn.QueryRow(ex.ctx, `SELECT EXISTS (SELECT 1 FROM campaign_pack JOIN pack_version v ON v.id = campaign_pack.pack_version_id
		JOIN pack ON pack.id = v.pack_id JOIN pack_entry e ON e.pack_version_id = v.id
		WHERE e.type = $2 AND e.key = $3 AND `+actor.ServedPacks("$1")+`)`, ex.id, entity, key).Scan(&served)
	return err == nil && served
}

// mentions is a text with every mention of an entry the room no longer has turned into its words.
func (ex *exporter) mentions(text string) string {
	return view.MentionRE.ReplaceAllStringFunc(text, func(m string) string {
		parts := view.MentionRE.FindStringSubmatch(m)
		if ex.entries[parts[2]] {
			return m
		}
		return parts[1]
	})
}

// fields are an entry's field values, a link field (`entry`, house decision #76) only while it names an entry here, a
// pack field (`ref`) only while the room is served what it names (#232, counted with the sources).
func (ex *exporter) fields(kind string, given map[string]any) map[string]any {
	out := maps.Clone(given)
	if ex.rules == nil || ex.rules.Ruleset.Codex == nil {
		return out
	}
	for key, def := range ex.rules.Ruleset.Codex.Kinds[kind].Fields {
		id, isID := out[key].(string)
		switch {
		case def.Type == "entry" && isID && !ex.entries[id]:
			delete(out, key)
		case def.Type == "ref" && isID && !ex.served(def.Entity, id):
			delete(out, key)
			ex.report.Sources++
		}
	}
	return out
}

// prep is a scene's prepared lines without those naming an entry the room no longer has, and without the characters it
// no longer has among a Test line's takers.
func (ex *exporter) prep(prep map[string]any) map[string]any {
	out := maps.Clone(prep)
	keep := func(kind, key string) {
		lines := []any{}
		for _, line := range doc(prep).list(kind) {
			if id, _ := line[key].(string); ex.entries[id] {
				lines = append(lines, line)
			}
		}
		if _, has := prep[kind]; has {
			out[kind] = lines
		}
	}
	keep("exits", "sceneId")
	keep("reveals", "entryId")
	keep("picks", "entryId")
	if _, has := prep["tests"]; has {
		lines := []any{}
		for _, line := range doc(prep).list("tests") {
			l := maps.Clone(line)
			ids := []any{}
			for _, a := range strs(line["actorIds"]) {
				if ex.actors[a] {
					ids = append(ids, a)
				}
			}
			l["actorIds"] = ids
			lines = append(lines, l)
		}
		out["tests"] = lines
	}
	return out
}

// sessions are the room's sessions in order, each with its title, recap, notes, whether it was abandoned, when it
// started and ended, and its award (#232). One still running ends at the export's time: nothing is live in a new room.
func (ex *exporter) sessions() ([]any, error) {
	rows, err := ex.conn.Query(ex.ctx, `SELECT title, recap, notes, abandoned, started_at, ended_at, award FROM session
		WHERE campaign_id = $1 ORDER BY number`, ex.id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var title, recap, notes string
		var abandoned bool
		var started time.Time
		var ended *time.Time
		var award *int
		if err := r.Scan(&title, &recap, &notes, &abandoned, &started, &ended, &award); err != nil {
			return nil, err
		}
		s := map[string]any{"startedAt": core.ISOTime(started), "endedAt": core.ISOTime(*cmp.Or(ended, &ex.at))}
		if award != nil {
			s["award"] = *award
		}
		for key, text := range map[string]string{"title": title, "recap": ex.mentions(recap), "notes": ex.mentions(notes)} {
			if text != "" {
				s[key] = text
			}
		}
		if abandoned {
			s["abandoned"] = true
		}
		return s, nil
	})
}

// clocks are the room's clocks in their order.
func (ex *exporter) clocks() ([]any, error) {
	rows, err := ex.conn.Query(ex.ctx, `SELECT name, segments, filled, visibility, entry_id::text FROM clock
		WHERE campaign_id = $1 ORDER BY position, created_at`, ex.id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var name, visibility string
		var segments, filled int
		var entry *string
		if err := r.Scan(&name, &segments, &filled, &visibility, &entry); err != nil {
			return nil, err
		}
		c := map[string]any{"name": name, "segments": segments, "filled": filled, "visibility": visibility}
		if entry != nil {
			c["entryId"] = *entry
		}
		return c, nil
	})
}
