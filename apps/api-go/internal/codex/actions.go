package codex

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
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
	if existing {
		var err error
		if kind, err = entryKind(ctx, tx, cid, id); err != nil {
			return cs.Result{}, err
		}
	}
	if status != nil && kind != "quest" {
		return cs.Result{}, cs.Fail("onlyQuestStatus")
	}
	if plannedSent && kind != "scene" {
		return cs.Result{}, cs.Fail("onlySceneTests")
	}
	if !existing {
		if title == nil {
			return cs.Result{}, cs.Fail("giveTitle")
		}
		if kind == "quest" && status == nil {
			open := "open"
			status = &open
		}
		// A new entry goes last among its siblings (the other unparented entries of its kind).
		err := tx.QueryRow(ctx, `INSERT INTO codex_entry (campaign_id, kind, title, body, gm_notes, status, planned_tests, position)
			VALUES ($1, $2, $3, coalesce($4, ''), coalesce($5, ''), $6, coalesce($7::text[], '{}'),
				(SELECT coalesce(max(position) + 1, 0) FROM codex_entry WHERE campaign_id = $1 AND kind = $2 AND parent_id IS NULL))
			RETURNING id::text`, cid, kind, *title, body, notes, status, planned).Scan(&id)
		return cs.Done(id), err
	}
	_, err := tx.Exec(ctx, `UPDATE codex_entry SET title = coalesce($2, title), body = coalesce($3, body),
		gm_notes = coalesce($4, gm_notes), status = coalesce($5, status), planned_tests = coalesce($6::text[], planned_tests)
		WHERE id = $1`, id, title, body, notes, status, planned)
	return cs.Done(id), err
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

// Move is codex.move: reorders an entry among its siblings, or moves a scene to another adventure (or out of any).
// `position` says where to insert; the siblings are then renumbered 0..n-1, never trusted.
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
		if kind != "scene" || pk != "adventure" {
			return cs.Result{}, cs.Fail("sceneNeedsAdventure")
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
	if err := renumber(ctx, tx, cid, kind, parent, id, int(at)); err != nil {
		return cs.Result{}, err
	}
	if !samePtr(from, parent) {
		return cs.Done(""), renumber(ctx, tx, cid, kind, from, "", 0)
	}
	return cs.Done(""), nil
}

func samePtr(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// renumber rewrites the positions of one sibling group (same kind, same parent) as 0..n-1 in their current order,
// with `moved` (when given) inserted at index `at`, cut to the group's size.
func renumber(ctx context.Context, tx core.Conn, cid, kind string, parent *string, moved string, at int) error {
	rows, err := tx.Query(ctx, `SELECT id::text FROM codex_entry
		WHERE campaign_id = $1 AND kind = $2 AND parent_id IS NOT DISTINCT FROM $3::uuid AND id::text <> $4
		ORDER BY position, created_at, id`, cid, kind, parent, moved)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	if moved != "" {
		at = max(0, min(at, len(ids)))
		ids = slices.Insert(ids, at, moved)
	}
	positions := make([]int32, len(ids))
	for i := range ids {
		positions[i] = int32(i)
	}
	_, err = tx.Exec(ctx, `UPDATE codex_entry SET position = v.pos FROM unnest($1::uuid[], $2::int[]) AS v(id, pos)
		WHERE codex_entry.id = v.id`, ids, positions)
	return err
}

// Reveal is codex.reveal: who reads an entry. Only this campaign's characters can be listed readers, and a reader
// listed twice is one row.
func Reveal(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	if err := ownEntry(ctx, tx, cid, id); err != nil {
		return cs.Result{}, err
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
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET visibility = $2, audience_mode = $3 WHERE id = $1`,
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
	return cs.Done(""), nil
}

// Delete is codex.delete.
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("id")
	if err := ownEntry(ctx, tx, c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	var scenes bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM codex_entry WHERE parent_id = $1)`, id).Scan(&scenes); err != nil {
		return cs.Result{}, err
	}
	if scenes {
		return cs.Result{}, cs.Fail("adventureHasScenes")
	}
	_, err := tx.Exec(ctx, `DELETE FROM codex_entry WHERE id = $1`, id)
	return cs.Done(""), err
}
