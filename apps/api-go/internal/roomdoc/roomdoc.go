// Package roomdoc imports a room document (docs/adr/0012 decision 4, house decision #74) as a new room its importer
// owns and runs as GM. The document is checked whole first; then, in one transaction, every part of it goes through the
// handler the table's own action uses (table.ApplyAction), so the import can do nothing a GM at the table could not. The
// first problem refuses it whole, by the document path that caused it. A dry run does the same and rolls back.
package roomdoc

import (
	"cmp"
	"context"
	"encoding/base64"
	"errors"
	"maps"
	"math"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/table"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Problem is why a document is refused: the path in it, and the refusal (a code of the refusal table and its params).
type Problem struct {
	Path   string
	Code   string
	Params cs.Params
}

func (p *Problem) Error() string { return p.Path + ": " + cs.RefusalBody(p.Code, p.Params).Message }

func problem(code string, params cs.Params, path ...any) *Problem {
	return &Problem{schema.PathString(path), code, params}
}

// Expect is one version the document names, and whether the importer holds it.
type Expect struct {
	What     string `json:"what"`
	Slug     string `json:"slug"`
	Version  string `json:"version"`
	Imported bool   `json:"imported"`
}

// Counts are what the import makes, by kind.
type Counts struct {
	Actors   map[string]int `json:"actors"`
	Entries  map[string]int `json:"entries"`
	Pictures int            `json:"pictures"`
	Sessions int            `json:"sessions"`
	Clocks   int            `json:"clocks"`
}

// Answer is what an import answers, a dry run or not. CampaignID is nil on a dry run, whose room was rolled back.
type Answer struct {
	CampaignID *string  `json:"campaignId"`
	Name       string   `json:"name"`
	Expects    []Expect `json:"expects"`
	Counts     Counts   `json:"counts"`
}

// Options are the importer's choices: a dry run, how the table sits ("" is with a GM), and a fresh start.
type Options struct {
	DryRun    bool
	TableMode string
	// Fresh imports the room as a new group would start it (house decision #103): see fresh.
	Fresh bool
}

// Import reads a document and applies it in one transaction, committed unless it is a dry run. On a problem the answer
// still carries what was read of the document (its name, what it expects), for the refusal to show.
func Import(ctx context.Context, db *pgxpool.Pool, owner campaign.Owner, body any, opts Options) (Answer, error) {
	doc, err := read(body) // a document whose ids dangle was still read: its name goes with the refusal
	answer := Answer{Name: doc.str("room", "name")}
	if err != nil {
		return answer, err
	}
	if opts.Fresh {
		doc = fresh(doc)
	}
	answer.Counts = countsOf(doc)
	tx, err := db.Begin(ctx)
	if err != nil {
		return answer, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	versions, expects, err := lookUp(ctx, tx, owner.UserID, doc)
	answer.Expects = expects
	if err != nil {
		return answer, err
	}
	id, err := apply(ctx, tx, owner, doc, versions, opts.TableMode)
	if err != nil || opts.DryRun {
		return answer, err
	}
	if err := tx.Commit(ctx); err != nil {
		return answer, err
	}
	answer.CampaignID = &id
	return answer, nil
}

// doc is a parsed document: decoded JSON, the schema's defaults filled in.
type doc map[string]any

func (d doc) list(key string) []map[string]any {
	items, _ := d[key].([]any)
	out := make([]map[string]any, len(items))
	for i, item := range items {
		out[i], _ = item.(map[string]any)
	}
	return out
}

func (d doc) str(keys ...string) string {
	var at any = map[string]any(d)
	for _, k := range keys {
		m, _ := at.(map[string]any)
		at = m[k]
	}
	s, _ := at.(string)
	return s
}

func strs(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		s, _ := item.(string)
		out = append(out, s)
	}
	return out
}

// sortedKeys keeps the import's order the same on every run.
func sortedKeys(v any) []string {
	m, _ := v.(map[string]any)
	return slices.Sorted(maps.Keys(m))
}

// read checks a document whole before anything is written: its format and version first, then its shape and caps,
// then that every id it uses names something in it.
func read(body any) (doc, error) {
	m, _ := body.(map[string]any)
	if m["format"] != cs.RoomFormat {
		return nil, problem("roomNotDocument", nil, "format")
	}
	if m["version"] != float64(cs.RoomVersion) {
		return nil, problem("roomNotDocument", nil, "version")
	}
	out, issues := schema.Parse(cs.RoomDocument, body)
	if len(issues) > 0 {
		first := slices.MinFunc(issues, func(a, b schema.Issue) int { return len(a.Path) - len(b.Path) })
		return nil, &Problem{schema.PathString(first.Path), "badRequest", cs.Params{"detail": first.Message}}
	}
	d := doc(out.(map[string]any))
	return d, references(d)
}

// references refuses an id the document does not hold: a parent, a reader, a link, a mention, a picture, a prepared
// line's scene, entry or character, a clock's entry.
func references(d doc) error {
	entries, actors, images := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, e := range d.list("codex") {
		entries[e["id"].(string)] = true
	}
	for _, a := range d.list("actors") {
		actors[a["id"].(string)] = true
	}
	for _, p := range d.list("images") {
		images[p["id"].(string)] = true
	}
	mentions := func(text string, path ...any) error {
		for _, m := range view.MentionRE.FindAllStringSubmatch(text, -1) {
			if !entries[m[2]] {
				return problem("roomNoSuchEntry", nil, path...)
			}
		}
		return nil
	}
	for i, e := range d.list("codex") {
		if p, has := e["parentId"].(string); has && !entries[p] {
			return problem("roomNoSuchEntry", nil, "codex", i, "parentId")
		}
		for _, key := range []string{"body", "gmNotes"} {
			text, _ := e[key].(string)
			if err := mentions(text, "codex", i, key); err != nil {
				return err
			}
		}
		for j, a := range strs(e["audience"]) {
			if !actors[a] {
				return problem("roomNoSuchActor", nil, "codex", i, "audience", j)
			}
		}
		for j, l := range strs(e["links"]) {
			if !entries[l] {
				return problem("roomNoSuchEntry", nil, "codex", i, "links", j)
			}
		}
		if p, has := e["imageId"].(string); has && !images[p] {
			return problem("roomNoSuchPicture", nil, "codex", i, "imageId")
		}
		prep, _ := e["prep"].(map[string]any)
		for kind, key := range map[string]string{"exits": "sceneId", "reveals": "entryId", "picks": "entryId"} {
			for j, line := range doc(prep).list(kind) {
				if !entries[line[key].(string)] {
					return problem("roomNoSuchEntry", nil, "codex", i, "prep", kind, j, key)
				}
			}
		}
		for j, line := range doc(prep).list("tests") {
			for k, a := range strs(line["actorIds"]) {
				if !actors[a] {
					return problem("roomNoSuchActor", nil, "codex", i, "prep", "tests", j, "actorIds", k)
				}
			}
		}
	}
	for i, s := range d.list("sessions") {
		for _, key := range []string{"recap", "notes"} {
			text, _ := s[key].(string)
			if err := mentions(text, "sessions", i, key); err != nil {
				return err
			}
		}
	}
	// An item is fitted to another item of its own character, and a GIVE names a codex entry (house decision #95).
	for i, a := range d.list("actors") {
		items := map[string]bool{}
		for _, x := range doc(a).list("items") {
			items[x["id"].(string)] = true
		}
		for j, x := range doc(a).list("items") {
			if to, has := x["fittedTo"].(string); has && (!items[to] || to == x["id"]) {
				return problem("roomNoSuchItem", nil, "actors", i, "items", j, "fittedTo")
			}
			if e, has := x["entryId"].(string); has && !entries[e] {
				return problem("roomNoSuchEntry", nil, "actors", i, "items", j, "entryId")
			}
		}
	}
	for i, c := range d.list("clocks") {
		if e, has := c["entryId"].(string); has && !entries[e] {
			return problem("roomNoSuchEntry", nil, "clocks", i, "entryId")
		}
	}
	return nil
}

func countsOf(d doc) Counts {
	c := Counts{Actors: map[string]int{}, Entries: map[string]int{}, Pictures: len(d.list("images")),
		Sessions: len(d.list("sessions")), Clocks: len(d.list("clocks"))}
	for _, a := range d.list("actors") {
		c.Actors[a["kind"].(string)]++
	}
	for _, e := range d.list("codex") {
		c.Entries[e["kind"].(string)]++
	}
	return c
}

// versions are the ids of what the document expects, as the importer holds them.
type versions struct {
	ruleset, world string
	packs          []string
}

// lookUp finds each version the document expects among the importer's own, at exactly that version and, when the
// document gives one, that hash. Every one is looked up, so the answer says of each whether it is imported.
func lookUp(ctx context.Context, tx pgx.Tx, userID string, d doc) (versions, []Expect, error) {
	expects, _ := d["expects"].(map[string]any)
	var v versions
	out := []Expect{}
	var first error
	find := func(what string, raw any, sql string, path ...any) string {
		e, _ := raw.(map[string]any)
		slug, version := doc(e).str("slug"), doc(e).str("version")
		var id, hash string
		err := tx.QueryRow(ctx, sql, userID, slug, version).Scan(&id, &hash)
		found := err == nil
		wanted, hashed := e["hash"].(string)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			first = cmp.Or(first, error(problem("roomImportFirst", cs.Params{"slug": slug, "version": version}, path...)))
		case err != nil:
			first = cmp.Or(first, err)
		case hashed && wanted != hash:
			found = false
			first = cmp.Or(first, error(problem("roomHashDiffers", cs.Params{"slug": slug, "version": version}, path...)))
		}
		out = append(out, Expect{what, slug, version, found})
		return id
	}
	if r, has := expects["ruleset"]; has {
		v.ruleset = find("ruleset", r, `SELECT v.id::text, v.hash FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
			WHERE r.owner_user_id = $1 AND r.slug = $2 AND v.version = $3`, "expects", "ruleset")
	}
	packs, _ := expects["packs"].([]any)
	for i, p := range packs {
		v.packs = append(v.packs, find("pack", p, `SELECT v.id::text, v.hash FROM pack_version v JOIN pack p ON p.id = v.pack_id
			WHERE p.owner_user_id = $1 AND p.slug = $2 AND v.version = $3`, "expects", "packs", i))
	}
	if w, has := expects["world"]; has {
		v.world = find("world", w, `SELECT v.id::text, v.hash FROM world_version v JOIN world w ON w.id = v.world_id
			WHERE w.owner_user_id = $1 AND w.slug = $2 AND v.version = $3`, "expects", "world")
	}
	return v, out, first
}

// importer applies one document as the room's owner and GM.
type importer struct {
	ctx context.Context
	tx  pgx.Tx
	gm  cs.Ctx
	d   doc
	// The document's ids to the rows made for them, and the sessions made, in order.
	actors, entries, images map[string]string
	sessionIDs              []string
}

// run applies one action through the table's own path; a refusal is the document's, at path.
func (im *importer) run(action map[string]any, path ...any) (string, error) {
	a, issues := cs.ParseAction(action)
	if len(issues) > 0 {
		return "", problem("badRequest", cs.Params{"detail": schema.Prettify(issues)}, path...)
	}
	result, err := table.ApplyAction(im.ctx, im.tx, im.gm, a)
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		return "", problem(refusal.Code, refusal.Params, path...)
	}
	return result.ID, err
}

// apply makes the room in tx, in the order house decision #74 sets: the room, its sessions, the versions it expects,
// campaign fields and pools, pictures, actors, the codex in two passes, clocks, and how the table sits.
func apply(ctx context.Context, tx pgx.Tx, owner campaign.Owner, d doc, v versions, tableMode string) (string, error) {
	id, err := campaign.NewRoom(ctx, tx, d.str("room", "name"), &owner, nil, nil)
	if err != nil {
		return "", err
	}
	im := &importer{ctx: ctx, tx: tx, d: d, actors: map[string]string{}, entries: map[string]string{}, images: map[string]string{},
		gm: cs.Ctx{CampaignID: id, UserID: &owner.UserID, CampaignOwnerID: &owner.UserID, TableMode: cs.TableModeGM,
			Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}}
	// Pools come after the actors: a pool's limits may count the party, and before any character exists such a pool
	// holds only its minimum.
	for _, step := range []func() error{im.sessions, im.settings, func() error { return im.pin(v) }, im.campaignValues,
		im.pictures, im.actorRows, im.pools, im.codexRows, im.codexWhole, im.items, im.sessionMentions, im.clocks} {
		if err := step(); err != nil {
			return "", err
		}
	}
	if tableMode != "" && tableMode != cs.TableModeGM {
		if _, err := im.run(map[string]any{"type": "campaign.setTableMode", "mode": tableMode}, "tableMode"); err != nil {
			return "", err
		}
	}
	return id, nil
}

// mentioned is a text with every mention's id the new one (references checked them all).
func (im *importer) mentioned(text string) string {
	return view.MentionRE.ReplaceAllStringFunc(text, func(m string) string {
		local := view.MentionRE.FindStringSubmatch(m)[2]
		return m[:len(m)-len(local)-1] + im.entries[local] + ")"
	})
}

// sessions come first, before any ruleset is pinned, so their rests touch nothing. Each is started and ended; their
// numbers come out 1..n and their dates are the import's.
func (im *importer) sessions() error {
	for i, s := range im.d.list("sessions") {
		id, err := im.run(map[string]any{"type": "session.start", "title": doc(s).str("title")}, "sessions", i)
		if err != nil {
			return err
		}
		// An abandoned session ends without its award, as session.abandon ends one (house decision #85).
		end := "session.end"
		if abandoned, _ := s["abandoned"].(bool); abandoned {
			end = "session.abandon"
		}
		if _, err := im.run(map[string]any{"type": end, "recap": doc(s).str("recap")}, "sessions", i, "recap"); err != nil {
			return err
		}
		if notes := doc(s).str("notes"); notes != "" {
			if _, err := im.run(map[string]any{"type": "session.edit", "sessionId": id, "notes": notes}, "sessions", i, "notes"); err != nil {
				return err
			}
		}
		// When it was played and what it awarded (#232): no action writes either, as revealedAt is kept below. A time the
		// document leaves out stays the import's; the award is the document's, since no ruleset is pinned yet to give one.
		var award *int
		if n, has := s["award"].(float64); has {
			award = new(int(n))
		}
		if _, err := im.tx.Exec(im.ctx, `UPDATE session SET started_at = coalesce(nullif($2, '')::timestamptz, started_at),
			ended_at = coalesce(nullif($3, '')::timestamptz, ended_at), award = $4 WHERE id = $1`,
			id, doc(s).str("startedAt"), doc(s).str("endedAt"), award); err != nil {
			return err
		}
		im.sessionIDs = append(im.sessionIDs, id)
	}
	return nil
}

// sessionMentions points the mentions of the recaps and notes at the room's entries, once the codex holds them.
func (im *importer) sessionMentions() error {
	for i, s := range im.d.list("sessions") {
		edit := map[string]any{"type": "session.edit", "sessionId": im.sessionIDs[i]}
		for _, key := range []string{"recap", "notes"} {
			if text := doc(s).str(key); view.MentionRE.MatchString(text) {
				edit[key] = im.mentioned(text)
			}
		}
		if len(edit) > 2 {
			if _, err := im.run(edit, "sessions", i); err != nil {
				return err
			}
		}
	}
	return nil
}

// settings are the next session and the safety lines; after the sessions, since starting one clears the next one.
func (im *importer) settings() error {
	room, _ := im.d["room"].(map[string]any)
	update := map[string]any{"type": "campaign.update"}
	for _, key := range []string{"nextSessionAt", "nextSessionPlace"} {
		if v, has := room[key]; has {
			update[key] = v
		}
	}
	if len(update) > 1 {
		if _, err := im.run(update, "room"); err != nil {
			return err
		}
	}
	if safety, has := room["safety"].(map[string]any); has {
		_, err := im.run(map[string]any{"type": "campaign.setSafety", "lines": safety["lines"], "veils": safety["veils"],
			"xCard": safety["xCard"]}, "room", "safety")
		return err
	}
	return nil
}

// pin pins the ruleset, attaches the packs and pins the World, each the importer's own at the named version.
func (im *importer) pin(v versions) error {
	if v.ruleset != "" {
		if _, err := im.run(map[string]any{"type": "campaign.setRuleset", "rulesetVersionId": v.ruleset}, "expects", "ruleset"); err != nil {
			return err
		}
	}
	for i, p := range v.packs {
		if _, err := im.run(map[string]any{"type": "campaign.attachPack", "packVersionId": p}, "expects", "packs", i); err != nil {
			return err
		}
	}
	if v.world != "" {
		_, err := im.run(map[string]any{"type": "campaign.setWorld", "worldVersionId": v.world}, "expects", "world")
		return err
	}
	return nil
}

// campaignValues sets the campaign fields, then moves each pool from where it stands to the document's value through
// the pool's own adjust, which clamps: a value the pool cannot hold is refused, never changed in silence.
func (im *importer) campaignValues() error {
	fields, _ := im.d["campaignFields"].(map[string]any)
	for _, key := range sortedKeys(fields) {
		if _, err := im.run(map[string]any{"type": "campaign.setField", "fieldId": key, "value": fields[key]}, "campaignFields", key); err != nil {
			return err
		}
	}
	return nil
}

// pools moves each pool to the document's value through the pool's own adjust, and refuses a value it cannot hold.
func (im *importer) pools() error {
	pools, _ := im.d["pools"].(map[string]any)
	if len(pools) == 0 {
		return nil
	}
	now := func(key string) (float64, error) {
		rc, err := ruleset.Open(im.ctx, im.tx, im.gm)
		if err != nil {
			return 0, err
		}
		return rc.Pools[key].State.Value, nil
	}
	for _, key := range sortedKeys(pools) {
		want, _ := pools[key].(float64)
		before, err := now(key)
		if err != nil {
			return refusedAt(err, "pools", key)
		}
		if want == before {
			continue
		}
		if _, err := im.run(map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjustPool",
			"input": map[string]any{"resource": key, "delta": want - before}}, "pools", key); err != nil {
			return err
		}
		if got, err := now(key); err != nil || got != want {
			return cmp.Or(err, error(problem("roomValueClamped", cs.Params{"now": got, "value": want}, "pools", key)))
		}
	}
	return nil
}

// refusedAt is a refusal from outside an action (opening the ruleset) placed at a path; anything else stays as it is.
func refusedAt(err error, path ...any) error {
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		return problem(refusal.Code, refusal.Params, path...)
	}
	return err
}

// pictures go into the room's store, held to its own checks and limits.
func (im *importer) pictures() error {
	for i, p := range im.d.list("images") {
		data, err := base64.StdEncoding.DecodeString(doc(p).str("base64"))
		if err != nil {
			return problem("roomPictureEncoding", nil, "images", i, "base64")
		}
		id, err := codex.StorePicture(im.ctx, im.tx, im.gm, doc(p).str("mime"), data)
		if err != nil {
			return refusedAt(err, "images", i)
		}
		im.images[doc(p).str("id")] = id
	}
	return nil
}

// actorRows makes every actor, then builds each that has a build and gives every one its fields, then gives each its
// resources and conditions. A typed actor's fields and resources are written as a creation writes them
// (actor.WriteStart, which actor.create runs for every typed actor): its starting resources come from those fields, and
// a value the document gives stands over the start, checked against the field's declaration.
func (im *importer) actorRows() error {
	actors := im.d.list("actors")
	for i, a := range actors {
		create := map[string]any{"type": "actor.create", "kind": a["kind"], "name": a["name"]}
		path := []any{"actors", i}
		if entity, typed := a["entityType"]; typed {
			create["entityType"], path = entity, append(path, "entityType")
		}
		id, err := im.run(create, path...)
		if err != nil {
			return err
		}
		im.actors[doc(a).str("id")] = id
		if err := im.spawnOptions(i, a, id); err != nil {
			return err
		}
	}
	for i, a := range actors {
		id := im.actors[doc(a).str("id")]
		if build, built := a["build"]; built {
			if _, err := im.run(map[string]any{"type": "build.save", "actorId": id, "build": build}, "actors", i, "build"); err != nil {
				return err
			}
		}
		fields, _ := a["fields"].(map[string]any)
		// A typed actor's fields come with its start; a built one's, the values its build does not write, through
		// field.set one by one after the build, as the GM sets them at the table.
		if _, typed := a["entityType"]; typed {
			if err := im.start(id, a); err != nil {
				return refusedAt(err, "actors", i, "fields")
			}
			continue
		}
		for _, key := range sortedKeys(fields) {
			if _, err := im.run(map[string]any{"type": "field.set", "actorId": id, "field": key, "value": fields[key]},
				"actors", i, "fields", key); err != nil {
				return err
			}
		}
	}
	for i, a := range actors {
		if err := im.held(i, a); err != nil {
			return err
		}
		if err := im.resources(i, a); err != nil {
			return err
		}
		if err := im.conditions(i, a); err != nil {
			return err
		}
		if err := im.standing(a); err != nil {
			return err
		}
	}
	return nil
}

// conditions applies each of an actor's conditions through condition.add, once for each of its stacks (#232), as the
// table stacks one. Stacks it would not reach (a condition that does not stack, or past its most) are refused, never
// changed in silence.
func (im *importer) conditions(i int, a map[string]any) error {
	id := im.actors[doc(a).str("id")]
	list, _ := a["conditions"].([]any)
	for j, c := range list {
		condition, stacks := "", 1.0
		switch c := c.(type) {
		case string:
			condition = c
		case map[string]any:
			condition, _ = c["id"].(string)
			stacks, _ = c["stacks"].(float64)
		}
		for range int(stacks) {
			if _, err := im.run(map[string]any{"type": "condition.add", "actorId": id, "condition": condition}, "actors", i, "conditions", j); err != nil {
				return err
			}
		}
		var got float64
		if err := im.tx.QueryRow(im.ctx, `SELECT coalesce(max(stacks), 0) FROM actor_condition WHERE actor_id = $1 AND condition_id = $2`,
			id, condition).Scan(&got); err != nil {
			return err
		}
		if got != stacks {
			return problem("roomValueClamped", cs.Params{"now": got, "value": stacks}, "actors", i, "conditions", j)
		}
	}
	return nil
}

// standing is what no action writes of an actor (#232): its status (a character whose seat went is retired) and where
// its ledger build's next advance counts from, as build.ascend leaves them.
func (im *importer) standing(a map[string]any) error {
	id := im.actors[doc(a).str("id")]
	if status := doc(a).str("status"); status != "" {
		if _, err := im.tx.Exec(im.ctx, `UPDATE actor SET status = $2 WHERE id = $1`, id, status); err != nil {
			return err
		}
	}
	xp, hasXP := a["xpAtAscension"].(float64)
	waived, _ := a["packageWaived"].(bool)
	if !hasXP && !waived {
		return nil
	}
	_, err := im.tx.Exec(im.ctx, `INSERT INTO actor_build (actor_id, xp_at_ascension, package_waived) VALUES ($1, $2, $3)
		ON CONFLICT (actor_id) DO UPDATE SET xp_at_ascension = EXCLUDED.xp_at_ascension, package_waived = EXCLUDED.package_waived`,
		id, int(xp), waived)
	return err
}

// spawnOptions keeps the spawn options a spawned actor was made with (house decision #92): each one the ruleset declares
// for the actor's type. Their `when` was read at the spawn and is not read again, as the adjustments made then are not.
func (im *importer) spawnOptions(i int, a map[string]any, id string) error {
	options := strs(a["spawnOptions"])
	if len(options) == 0 {
		return nil
	}
	rules, err := compiled.Load(im.ctx, im.tx, im.gm.CampaignID)
	if err != nil {
		return err
	}
	entity := doc(a).str("entityType")
	for j, option := range options {
		var declared *engine.SpawnOption
		if rules != nil && rules.Ruleset.Spawn != nil {
			if at := slices.IndexFunc(rules.Ruleset.Spawn.Options, func(o engine.SpawnOption) bool { return o.ID == option }); at >= 0 {
				declared = &rules.Ruleset.Spawn.Options[at]
			}
		}
		if declared == nil {
			return problem("noSuchOption", cs.Params{"detail": option}, "actors", i, "spawnOptions", j)
		}
		if entity == "" || (declared.Entities != nil && !slices.Contains(*declared.Entities, entity)) {
			return problem("optionNotHere", cs.Params{"detail": declared.Label}, "actors", i, "spawnOptions", j)
		}
	}
	_, err = im.tx.Exec(im.ctx, `UPDATE actor SET spawn_options = $2 WHERE id = $1`, id, options)
	return err
}

// held holds the records a document's actor holds (house decision #88), kept in a held kind's list field and written
// with the fields, to what a grant holds them to: each an entry the room is served, none twice, no more than the
// kind's max. A refusal names the field.
func (im *importer) held(i int, a map[string]any) error {
	fields, _ := a["fields"].(map[string]any)
	entity, _ := a["entityType"].(string)
	if len(fields) == 0 || entity == "" {
		return nil
	}
	rules, err := compiled.Load(im.ctx, im.tx, im.gm.CampaignID)
	if err != nil || rules == nil {
		return err
	}
	name, _ := a["name"].(string)
	for _, id := range slices.Sorted(maps.Keys(rules.Ruleset.Held)) {
		kind := rules.Ruleset.Held[id]
		keys, given := fields[kind.Field].([]any)
		if !given || !slices.Contains(kind.Entities, entity) {
			continue
		}
		at := []any{"actors", i, "fields", kind.Field}
		if len(keys) > kind.MaxOrDefault() {
			return problem("heldFull", cs.Params{"name": name, "kind": kind.Label}, at...)
		}
		seen := map[string]bool{}
		for _, v := range keys {
			key, _ := v.(string)
			entry, served, err := actor.ServedEntryName(im.ctx, im.tx, im.gm.CampaignID, kind.Entry, key)
			if err != nil {
				return err
			}
			if !served {
				return problem("heldNoEntry", cs.Params{"entry": key}, at...)
			}
			if seen[key] {
				return problem("heldAlready", cs.Params{"name": name, "entry": entry}, at...)
			}
			seen[key] = true
		}
	}
	return nil
}

// start writes a typed actor's fields and starting resources, the document's values over the ruleset's.
func (im *importer) start(id string, a map[string]any) error {
	rules, err := compiled.Load(im.ctx, im.tx, im.gm.CampaignID)
	if err != nil || rules == nil {
		return err
	}
	fields, _ := a["fields"].(map[string]any)
	given, _ := a["resources"].(map[string]any)
	resources := map[string]float64{}
	for key, v := range given {
		resources[key], _ = v.(float64)
	}
	_, err = actor.WriteStart(im.ctx, im.tx, im.gm, rules, []actor.StartTarget{{ActorID: id, Fields: maps.Clone(fields), Resources: resources}})
	return err
}

// resources moves each of an actor's resources from where it stands to the document's value through the action the
// table moves it with: a health track's damage or heal, a count-up harm's hit, any other resource's own adjust. The
// health ones go first, so damage never takes from spare points the document gives. A value it would not hold is
// refused, never changed in silence.
func (im *importer) resources(i int, a map[string]any) error {
	values, _ := a["resources"].(map[string]any)
	if len(values) == 0 {
		return nil
	}
	id := im.actors[doc(a).str("id")]
	now := func(key string) (float64, bool, *engine.Ruleset, error) {
		rc, err := ruleset.Open(im.ctx, im.tx, im.gm)
		if err != nil {
			return 0, false, nil, refusedAt(err, "actors", i, "resources", key)
		}
		if built := rc.Built[id]; built != nil && built.State != nil {
			for _, r := range built.State.Resources {
				if r.Name == key {
					return r.State.Value, true, rc.Compiled.Ruleset, nil
				}
			}
		}
		return 0, false, rc.Compiled.Ruleset, nil
	}
	keys := sortedKeys(values)
	if _, _, rules, err := now(""); err == nil {
		health := map[string]bool{}
		for _, t := range rules.Health.Tracks {
			health[t.Resource] = true
		}
		if h := rules.Health.Harm; h != nil {
			health[h.Wounds] = true
		}
		slices.SortStableFunc(keys, func(x, y string) int { return cmp.Compare(boolInt(!health[x]), boolInt(!health[y])) })
	}
	for _, key := range keys {
		want, _ := values[key].(float64)
		before, held, rules, err := now(key)
		if err != nil {
			return err
		}
		// A resource the actor does not hold goes to the op too, which refuses it in its own words.
		if want != before || !held {
			if _, err := im.run(moveResource(rules, id, key, want-before), "actors", i, "resources", key); err != nil {
				return err
			}
		}
		if after, _, _, err := now(key); err != nil || after != want {
			return cmp.Or(err, error(problem("roomValueClamped", cs.Params{"now": after, "value": want}, "actors", i, "resources", key)))
		}
	}
	return nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// moveResource is the action that moves one of an actor's resources by delta, as the table moves it.
func moveResource(rules *engine.Ruleset, actorID, key string, delta float64) map[string]any {
	op := func(primitive, name string, input map[string]any) map[string]any {
		input["actorId"] = actorID
		return map[string]any{"type": "rule.op", "primitive": primitive, "op": name, "input": input}
	}
	for _, t := range rules.Health.Tracks {
		if t.Resource == key && delta < 0 {
			return op("health.tracks", "damage", map[string]any{"amount": -delta, "track": key})
		}
		if t.Resource == key {
			return op("health.tracks", "heal", map[string]any{"amount": delta, "track": key})
		}
	}
	if h := rules.Health.Harm; h != nil && h.Wounds == key {
		return op("health.harm", "hit", map[string]any{"wounds": delta})
	}
	if h := rules.Health.Harm; h != nil && h.Shock != nil && *h.Shock == key {
		return op("health.harm", "hit", map[string]any{"shock": delta})
	}
	return op("resource.capped", "adjust", map[string]any{"resource": key, "delta": delta})
}

// codexRows is the codex's first pass: every entry with its kind and title, so the second pass can point at any of them.
func (im *importer) codexRows() error {
	for i, e := range im.d.list("codex") {
		id, err := im.run(map[string]any{"type": "codex.save", "kind": e["kind"], "title": e["title"]}, "codex", i)
		if err != nil {
			return err
		}
		im.entries[doc(e).str("id")] = id
	}
	return nil
}

// codexWhole is the second pass: the tree, then each entry's texts with their mentions, fields, layout, links, planned
// Tests, status, prep, picture, and who reads it.
func (im *importer) codexWhole() error {
	if err := im.tree(); err != nil {
		return err
	}
	for i, e := range im.d.list("codex") {
		id, kind := im.entries[doc(e).str("id")], e["kind"]
		save := func(path string, keys ...string) error {
			action := map[string]any{"type": "codex.save", "id": id, "kind": kind}
			for _, key := range keys {
				if v, has := e[key]; has {
					action[key] = v
				}
			}
			if len(action) == 3 {
				return nil
			}
			_, err := im.run(action, "codex", i, path)
			return err
		}
		texts := map[string]any{}
		for _, key := range []string{"body", "gmNotes"} {
			if text, has := e[key].(string); has {
				texts[key] = im.mentioned(text)
			}
		}
		if len(texts) > 0 {
			texts["type"], texts["id"], texts["kind"] = "codex.save", id, kind
			if _, err := im.run(texts, "codex", i, firstKey(e, "body", "gmNotes")); err != nil {
				return err
			}
		}
		if given, has := e["fields"].(map[string]any); has && len(given) > 0 {
			fields, err := im.linked(i, kind, given)
			if err != nil {
				return err
			}
			if _, err := im.run(map[string]any{"type": "codex.save", "id": id, "kind": kind, "fields": fields}, "codex", i, "fields"); err != nil {
				return err
			}
		}
		if err := save(firstKey(e, "layout", "header"), "layout", "header"); err != nil {
			return err
		}
		// The pack entry it was made from, served to the room as a ref is; its page is read again (house decision #97).
		if err := save("source", "source"); err != nil {
			return err
		}
		for j, target := range strs(e["links"]) {
			if _, err := im.run(map[string]any{"type": "codex.link", "id": id, "targetId": im.entries[target]}, "codex", i, "links", j); err != nil {
				return err
			}
		}
		if err := cmp.Or(save("plannedTests", "plannedTests"), save("status", "status")); err != nil {
			return err
		}
		if prep, has := e["prep"].(map[string]any); has {
			if _, err := im.run(map[string]any{"type": "codex.save", "id": id, "kind": kind, "prep": im.prep(prep)}, "codex", i, "prep"); err != nil {
				return err
			}
		}
		if picture, has := e["imageId"].(string); has {
			if _, err := im.run(map[string]any{"type": "codex.save", "id": id, "kind": kind, "imageId": im.images[picture]}, "codex", i, "imageId"); err != nil {
				return err
			}
		}
		if err := im.readers(i, e, id); err != nil {
			return err
		}
	}
	return nil
}

// linked is an entry's fields with every link (a field the room's ruleset declares as `entry`, house decision #76)
// naming the row made for the document's entry. A link to an entry the document does not hold is refused.
func (im *importer) linked(i int, kind any, given map[string]any) (map[string]any, error) {
	rules, err := compiled.Load(im.ctx, im.tx, im.gm.CampaignID)
	if err != nil || rules == nil || rules.Ruleset.Codex == nil {
		return given, err
	}
	k, _ := kind.(string)
	defs := rules.Ruleset.Codex.Kinds[k].Fields
	out := maps.Clone(given)
	for _, key := range sortedKeys(given) {
		old, isID := given[key].(string)
		if defs[key].Type != "entry" || !isID {
			continue
		}
		made, known := im.entries[old]
		if !known {
			return nil, problem("roomNoSuchEntry", nil, "codex", i, "fields", key)
		}
		out[key] = made
	}
	return out, nil
}

func firstKey(e map[string]any, keys ...string) string {
	for _, k := range keys {
		if _, has := e[k]; has {
			return k
		}
	}
	return keys[0]
}

// tree puts every entry in its place: under its parent, among its siblings (the entries of its kind under the same
// parent) by its position, the ones without one after, in document order. Each is moved in that order to its rank, so
// the room's positions come out 0..n-1.
func (im *importer) tree() error {
	type place struct {
		i        int
		parent   string
		position float64
	}
	groups := map[string][]place{}
	var order []string
	for i, e := range im.d.list("codex") {
		parent := doc(e).str("parentId")
		position, given := e["position"].(float64)
		if !given {
			position = math.Inf(1)
		}
		key := doc(e).str("kind") + "/" + parent
		if _, seen := groups[key]; !seen {
			order = append(order, key)
		}
		groups[key] = append(groups[key], place{i, parent, position})
	}
	for _, key := range order {
		group := groups[key]
		slices.SortStableFunc(group, func(a, b place) int { return cmp.Compare(a.position, b.position) })
		for rank, p := range group {
			e := im.d.list("codex")[p.i]
			move := map[string]any{"type": "codex.move", "id": im.entries[doc(e).str("id")], "parentId": nil, "position": float64(rank)}
			path := "position"
			if p.parent != "" {
				move["parentId"], path = im.entries[p.parent], "parentId"
			}
			if _, err := im.run(move, "codex", p.i, path); err != nil {
				return err
			}
		}
	}
	return nil
}

// prep is a scene's prepared lines with the document's scenes, entries and characters as the room's.
func (im *importer) prep(prep map[string]any) map[string]any {
	out := maps.Clone(prep)
	rewrite := func(kind string, fix func(line map[string]any)) {
		lines := doc(prep).list(kind)
		copied := make([]any, len(lines))
		for j, line := range lines {
			l := maps.Clone(line)
			fix(l)
			copied[j] = l
		}
		out[kind] = copied
	}
	rewrite("exits", func(l map[string]any) { l["sceneId"] = im.entries[doc(l).str("sceneId")] })
	rewrite("reveals", func(l map[string]any) { l["entryId"] = im.entries[doc(l).str("entryId")] })
	// A pick line names its entry as the room has it (house decision #89); its rows keep their ids, which live in the
	// entry's field value and travel unchanged.
	rewrite("picks", func(l map[string]any) { l["entryId"] = im.entries[doc(l).str("entryId")] })
	rewrite("tests", func(l map[string]any) {
		ids := []any{}
		for _, a := range strs(l["actorIds"]) {
			ids = append(ids, im.actors[a])
		}
		l["actorIds"] = ids
	})
	return out
}

// readers is who reads an entry and whether the table sees its picture, through codex.reveal. An entry that says
// nothing of either stays as a new one is: the GM's.
func (im *importer) readers(i int, e map[string]any, id string) error {
	reveal := map[string]any{"type": "codex.reveal", "id": id}
	_, visible := e["visibility"]
	_, mode := e["audienceMode"]
	_, listed := e["audience"]
	if visible || mode || listed {
		audience := []any{}
		for _, a := range strs(e["audience"]) {
			audience = append(audience, im.actors[a])
		}
		reveal["visibility"] = cmp.Or(doc(e).str("visibility"), "gm")
		reveal["audienceMode"] = cmp.Or(doc(e).str("audienceMode"), "all")
		reveal["audience"] = audience
	}
	if shown, has := e["imageRevealed"]; has {
		reveal["imageRevealed"] = shown
	}
	if len(reveal) == 2 {
		return nil
	}
	if _, err := im.run(reveal, "codex", i, "visibility"); err != nil {
		return err
	}
	// The reveal stamped the import's time; a time the document gives is kept, on an entry it reveals only (house
	// decision #86).
	if at := doc(e).str("revealedAt"); at != "" {
		_, err := im.tx.Exec(im.ctx, `UPDATE codex_entry SET revealed_at = $2::timestamptz WHERE id = $1 AND visibility <> 'gm'`,
			id, at)
		return err
	}
	return nil
}

// clocks are made as clock.create takes them, then ticked to how full they are.
func (im *importer) clocks() error {
	for i, c := range im.d.list("clocks") {
		create := map[string]any{"type": "clock.create", "name": c["name"]}
		for _, key := range []string{"segments", "visibility"} {
			if v, has := c[key]; has {
				create[key] = v
			}
		}
		if entry, has := c["entryId"].(string); has {
			create["entryId"] = im.entries[entry]
		}
		id, err := im.run(create, "clocks", i)
		if err != nil {
			return err
		}
		if filled, _ := c["filled"].(float64); filled > 0 {
			if _, err := im.run(map[string]any{"type": "clock.tick", "id": id, "delta": filled}, "clocks", i, "filled"); err != nil {
				return err
			}
		}
	}
	return nil
}
