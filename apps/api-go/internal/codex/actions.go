package codex

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"math"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
)

// The codex actions (apps/api/src/codex/codex.actions.ts).

func ownEntry(ctx context.Context, tx core.Conn, campaignID, id string) error {
	_, err := entryKind(ctx, tx, campaignID, id)
	return err
}

// entryKind is the kind of one of this campaign's entries; an id from anywhere else is not found.
func entryKind(ctx context.Context, tx core.Conn, campaignID, id string) (string, error) {
	var kind string
	err := tx.QueryRow(ctx, `SELECT kind FROM codex_entry WHERE id = $1 AND campaign_id = $2`, id, campaignID).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", cs.Fail("entryNotFound")
	}
	return kind, err
}

// Save is codex.save, a patch: only the fields sent are written. GM notes need the secrets scope too, so a co-GM who
// was never shown them can't blank or overwrite them (docs/design.md §3.6).
func Save(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	if _, sent := a["gmNotes"]; sent && !cs.CanInCampaign(c, "codex:read_secret", "") {
		return cs.Result{}, cs.Fail("needSecretsScope")
	}
	text := func(key string) *string {
		if s, sent := a[key].(string); sent {
			return &s
		}
		return nil
	}
	title, body, notes, status := text("title"), text("body"), text("gmNotes"), text("status")
	layout, header := text("layout"), text("header")
	// nil leaves the column alone (SQL NULL through coalesce); a sent list, even an empty one, replaces it.
	var planned []string
	given, plannedSent := a["plannedTests"].([]any)
	if plannedSent {
		planned = []string{}
		for _, v := range given {
			if s, ok := v.(string); ok && !slices.Contains(planned, s) {
				planned = append(planned, s)
			}
		}
	}
	id, existing := a["id"].(string)
	kind := a.Str("kind")
	// imageId: a picture of this room, or null to remove it; not sent leaves it alone.
	imageID, imageSent := a["imageId"]
	picture, _ := imageID.(string)
	if picture != "" {
		has, err := image.Has(ctx, tx, cid, picture)
		if err != nil {
			return cs.Result{}, err
		}
		if !has {
			return cs.Result{}, cs.Fail("pictureNotFound")
		}
	}
	if err := sweep(ctx, tx, cid); err != nil {
		return cs.Result{}, err
	}
	if existing {
		var err error
		if kind, err = entryKind(ctx, tx, cid, id); err != nil {
			return cs.Result{}, err
		}
	}
	if status != nil {
		switch kind {
		case "quest", "scene":
			if !slices.Contains(map[string][]string{"quest": cs.QuestStatuses, "scene": cs.SceneStatuses}[kind], *status) {
				return cs.Result{}, cs.Fail("wrongStatus")
			}
		default:
			return cs.Result{}, cs.Fail("onlyQuestStatus")
		}
	}
	if plannedSent && kind != "scene" {
		return cs.Result{}, cs.Fail("onlySceneTests")
	}
	if (layout != nil || header != nil) && kind != "handout" {
		return cs.Result{}, cs.Fail("handoutOnly")
	}
	// The prepared lines replace the stored ones whole; null clears them (house decision #73).
	prep, prepSent := a["prep"]
	var prepJSON *string
	if prepSent && kind != "scene" {
		return cs.Result{}, cs.Fail("sceneOnly")
	}
	if prepSent && prep != nil {
		b, err := json.Marshal(prep)
		if err != nil {
			return cs.Result{}, err
		}
		text := string(b)
		prepJSON = &text
	}
	fields, err := checkFields(ctx, tx, c, kind, a)
	if err != nil {
		return cs.Result{}, err
	}
	// Unsent fields leave the column alone: {} merged, nothing cleared.
	setFields, clearFields := "{}", []string{}
	if fields != nil {
		setFields, clearFields = string(fields.set), fields.clear
	}
	// One scene of a room is active at a time: making one active leaves the one being played done, as taking an exit
	// does at a table (house decision #73).
	if kind == "scene" && status != nil && *status == "active" {
		if _, err := tx.Exec(ctx, `UPDATE codex_entry SET status = 'done'
			WHERE campaign_id = $1 AND kind = 'scene' AND status = 'active' AND id::text IS DISTINCT FROM $2`, cid, a["id"]); err != nil {
			return cs.Result{}, err
		}
	}
	if !existing {
		if title == nil {
			return cs.Result{}, cs.Fail("giveTitle")
		}
		if fallback := map[string]string{"quest": "open", "scene": "planned"}[kind]; status == nil && fallback != "" {
			status = &fallback
		}
		// A handout always has a layout and a header (plain, none); every other kind has neither (migration 0022).
		if kind == "handout" {
			layout, header = cmp.Or(layout, new("plain")), cmp.Or(header, new(""))
		}
		// A new entry goes last among its siblings (the other unparented entries of its kind).
		// A new entry is GM-only; without a GM nothing can be, so it is the party's.
		visibility := "gm"
		if !c.HasGM() {
			visibility = "party"
		}
		// An entry made the party's (a room without a GM) reaches the party as it is made: that is its reveal.
		err := tx.QueryRow(ctx, `INSERT INTO codex_entry (campaign_id, kind, title, body, gm_notes, status, planned_tests, visibility, position, fields, layout, header, prep, revealed_at)
			VALUES ($1, $2, $3, coalesce($4, ''), coalesce($5, ''), $6, coalesce($7::text[], '{}'), $8,
				(SELECT coalesce(max(position) + 1, 0) FROM codex_entry WHERE campaign_id = $1 AND kind = $2 AND parent_id IS NULL),
				$9::jsonb, $10, $11, $12::jsonb, CASE WHEN $8 = 'gm' THEN NULL ELSE now() END)
			RETURNING id::text`, cid, kind, *title, body, notes, status, planned, visibility, setFields, layout, header, prepJSON).Scan(&id)
		if err != nil || !imageSent {
			return cs.Done(id), err
		}
		return cs.Done(id), setPicture(ctx, tx, c, id, picture)
	}
	_, err = tx.Exec(ctx, `UPDATE codex_entry SET title = coalesce($2, title), body = coalesce($3, body),
		gm_notes = coalesce($4, gm_notes), status = coalesce($5, status), planned_tests = coalesce($6::text[], planned_tests),
		fields = (fields || $7::jsonb) - $8::text[], layout = coalesce($9, layout), header = coalesce($10, header),
		prep = CASE WHEN $11 THEN $12::jsonb ELSE prep END
		WHERE id = $1`, id, title, body, notes, status, planned, setFields, clearFields, layout, header, prepSent, prepJSON)
	if err != nil || !imageSent {
		return cs.Done(id), err
	}
	return cs.Done(id), setPicture(ctx, tx, c, id, picture)
}

// linkable are the kinds a scene may link (docs/p2-plan.md, group A).
var linkable = []string{"npc", "location", "faction", "item", "handout", "lore", "quest"}

// Link is codex.link; linking twice is one link. Unlink removes it, and is fine when there is none.
func Link(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	kind, err := entryKind(ctx, tx, c.CampaignID, a.Str("id"))
	if err != nil {
		return cs.Result{}, err
	}
	target, err := entryKind(ctx, tx, c.CampaignID, a.Str("targetId"))
	if err != nil {
		return cs.Result{}, err
	}
	if kind != "scene" || !slices.Contains(linkable, target) {
		return cs.Result{}, cs.Fail("cantLinkThat")
	}
	_, err = tx.Exec(ctx, `INSERT INTO codex_link (entry_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		a.Str("id"), a.Str("targetId"))
	return cs.Done(""), err
}

// Unlink is codex.unlink.
func Unlink(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if err := ownEntry(ctx, tx, c.CampaignID, a.Str("id")); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `DELETE FROM codex_link WHERE entry_id = $1 AND target_id = $2`, a.Str("id"), a.Str("targetId"))
	return cs.Done(""), err
}

// maxDepth is how many levels an entry tree holds, a root being the first (house decision #69).
const maxDepth = 8

// Move is codex.move: reorders an entry among its siblings, or moves it under another entry (or out of any). An entry
// sits under one of its own kind, a scene under an adventure; never under itself or its own descendant, and never so its
// branch reaches below maxDepth. `position` says where to insert; the siblings are then renumbered 0..n-1, never trusted.
func Move(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	kind, err := entryKind(ctx, tx, cid, id)
	if err != nil {
		return cs.Result{}, err
	}
	var parent *string
	if p, ok := a["parentId"].(string); ok {
		pk, err := entryKind(ctx, tx, cid, p)
		if err != nil {
			return cs.Result{}, err
		}
		if kind == "scene" && pk != "adventure" {
			return cs.Result{}, cs.Fail("sceneNeedsAdventure")
		}
		if kind != "scene" && pk != kind {
			return cs.Result{}, cs.Fail("parentOtherKind")
		}
		if err := fitsUnder(ctx, tx, id, p); err != nil {
			return cs.Result{}, err
		}
		parent = &p
	}
	var from *string
	if err := tx.QueryRow(ctx, `SELECT parent_id::text FROM codex_entry WHERE id = $1`, id).Scan(&from); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET parent_id = $2 WHERE id = $1`, id, parent); err != nil {
		return cs.Result{}, err
	}
	at, _ := a["position"].(float64)
	if err := renumber(ctx, tx, cid, kind, parent, []string{id}, int(at)); err != nil {
		return cs.Result{}, err
	}
	if !samePtr(from, parent) {
		return cs.Done(""), renumber(ctx, tx, cid, kind, from, nil, 0)
	}
	return cs.Done(""), nil
}

// fitsUnder refuses putting entry id under parent when parent is id or sits inside it, or when id's branch would then
// reach below maxDepth. Both walks stop past maxDepth, so a tree already too deep cannot keep them going.
func fitsUnder(ctx context.Context, tx core.Conn, id, parent string) error {
	var depth int
	var loops bool
	if err := tx.QueryRow(ctx, `WITH RECURSIVE up AS (
			SELECT id, parent_id, 1 AS depth FROM codex_entry WHERE id = $1
			UNION ALL SELECT e.id, e.parent_id, up.depth + 1 FROM codex_entry e JOIN up ON e.id = up.parent_id WHERE up.depth <= $3)
		SELECT count(*), coalesce(bool_or(id::text = $2), false) FROM up`, parent, id, maxDepth).Scan(&depth, &loops); err != nil {
		return err
	}
	if loops {
		return cs.Fail("wouldLoop")
	}
	var height int
	if err := tx.QueryRow(ctx, `WITH RECURSIVE down AS (
			SELECT id, 1 AS depth FROM codex_entry WHERE id = $1
			UNION ALL SELECT e.id, down.depth + 1 FROM codex_entry e JOIN down ON e.parent_id = down.id WHERE down.depth <= $2)
		SELECT max(depth) FROM down`, id, maxDepth).Scan(&height); err != nil {
		return err
	}
	if depth+height > maxDepth {
		return cs.Fail("tooDeep", cs.Params{"limit": maxDepth})
	}
	return nil
}

func samePtr(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// renumber rewrites the positions of one sibling group (same kind, same parent) as 0..n-1 in their current order,
// with `moved` (in their order) inserted at index `at`, cut to the group's size.
func renumber(ctx context.Context, tx core.Conn, cid, kind string, parent *string, moved []string, at int) error {
	if moved == nil {
		moved = []string{} // a nil slice is SQL NULL, and `<> ALL(NULL)` would match no row
	}
	rows, err := tx.Query(ctx, `SELECT id::text FROM codex_entry
		WHERE campaign_id = $1 AND kind = $2 AND parent_id IS NOT DISTINCT FROM $3::uuid AND id::text <> ALL($4::text[])
		ORDER BY position, created_at, id`, cid, kind, parent, moved)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	at = max(0, min(at, len(ids)))
	ids = slices.Insert(ids, at, moved...)
	positions := make([]int32, len(ids))
	for i := range ids {
		positions[i] = int32(i)
	}
	_, err = tx.Exec(ctx, `UPDATE codex_entry SET position = v.pos FROM unnest($1::uuid[], $2::int[]) AS v(id, pos)
		WHERE codex_entry.id = v.id`, ids, positions)
	return err
}

// Reveal is codex.reveal: who reads an entry, and whether the table sees its picture; either may be sent alone. Only
// this campaign's characters can be listed readers, and a reader listed twice is one row.
func Reveal(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	if err := ownEntry(ctx, tx, cid, id); err != nil {
		return cs.Result{}, err
	}
	logged := map[string]any{"entryId": id}
	if shown, sent := a["imageRevealed"].(bool); sent {
		if _, err := tx.Exec(ctx, `UPDATE codex_entry SET image_revealed = $2 WHERE id = $1`, id, shown); err != nil {
			return cs.Result{}, err
		}
		logged["imageRevealed"] = shown
	}
	if _, sent := a["visibility"]; !sent {
		return cs.Done(""), eventlog.LogEvent(ctx, tx, c, "codex.reveal", logged)
	}
	if !c.HasGM() && a.Str("visibility") == "gm" {
		return cs.Result{}, cs.Fail("noGmHere")
	}
	listed := a.Str("audienceMode") == "listed"
	audience := []string{}
	given, _ := a["audience"].([]any)
	for _, v := range given {
		if s, ok := v.(string); ok && !slices.Contains(audience, s) {
			audience = append(audience, s)
		}
	}
	if listed && a.Str("visibility") != "gm" && len(audience) == 0 {
		return cs.Result{}, cs.Fail("pickAudience")
	}
	if listed {
		var known int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[])`, cid, audience).
			Scan(&known); err != nil {
			return cs.Result{}, err
		}
		if known != len(audience) {
			return cs.Result{}, cs.Fail("characterNotFound")
		}
	}
	// The time it reached the party or a reader; sealed, it has none (house decision #86).
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET visibility = $2, audience_mode = $3,
		revealed_at = CASE WHEN $2 = 'gm' THEN NULL ELSE now() END WHERE id = $1`,
		id, a.Str("visibility"), a.Str("audienceMode")); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM codex_reveal WHERE entry_id = $1`, id); err != nil {
		return cs.Result{}, err
	}
	if listed && len(audience) > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO codex_reveal (entry_id, actor_id) SELECT $1, unnest($2::uuid[])`, id, audience); err != nil {
			return cs.Result{}, err
		}
	}
	logged["visibility"], logged["audienceMode"] = a.Str("visibility"), a.Str("audienceMode")
	return cs.Done(""), eventlog.LogEvent(ctx, tx, c, "codex.reveal", logged)
}

// Delete is codex.delete. An adventure that still has scenes stays; any other entry's children become roots, after
// the roots there are (house decision #69).
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	kind, err := entryKind(ctx, tx, cid, id)
	if err != nil {
		return cs.Result{}, err
	}
	rows, err := tx.Query(ctx, `SELECT id::text FROM codex_entry WHERE parent_id = $1 AND kind = 'scene'`, id)
	if err != nil {
		return cs.Result{}, err
	}
	scenes, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return cs.Result{}, err
	}
	if withScenes, _ := a["withScenes"].(bool); len(scenes) > 0 && !withScenes {
		return cs.Result{}, cs.Fail("adventureHasScenes")
	}
	// With the flag its scenes go first, each as codex.delete deletes one; what pointed at them stays, unlinked (Auspex
	// rules-flow §11.163, house decision #86).
	for _, scene := range scenes {
		if _, err := Delete(ctx, tx, c, cs.Action{"type": "codex.delete", "id": scene}); err != nil {
			return cs.Result{}, err
		}
	}
	var parent *string
	if err := tx.QueryRow(ctx, `SELECT parent_id::text FROM codex_entry WHERE id = $1`, id).Scan(&parent); err != nil {
		return cs.Result{}, err
	}
	rows, err = tx.Query(ctx, `SELECT id::text FROM codex_entry WHERE parent_id = $1 ORDER BY position, created_at, id`, id)
	if err != nil {
		return cs.Result{}, err
	}
	children, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return cs.Result{}, err
	}
	// Its children become roots, after the roots there are, as Auspex's location tree has it (house decision #69).
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET parent_id = NULL WHERE parent_id = $1`, id); err != nil {
		return cs.Result{}, err
	}
	var picture *string
	if err := tx.QueryRow(ctx, `DELETE FROM codex_entry WHERE id = $1 RETURNING image_id::text`, id).Scan(&picture); err != nil {
		return cs.Result{}, err
	}
	if err := dropUnused(ctx, tx, cid, picture); err != nil {
		return cs.Result{}, err
	}
	if parent != nil {
		if err := renumber(ctx, tx, cid, kind, parent, nil, 0); err != nil {
			return cs.Result{}, err
		}
	}
	if err := renumber(ctx, tx, cid, kind, nil, children, math.MaxInt32); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), sweep(ctx, tx, cid)
}
