// Package clock holds progress clocks: segmented clocks the GM fills and empties during play (docs/p2-plan.md group C,
// docs/design.md §3.4). A table tool the GM makes, not a book rule, so there is no cite. A tick is a counted delta the
// server clamps (CLAUDE.md, principle 6), logged so event.undo takes it back.
package clock

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Load is the campaign's clocks by position, whole. The Seat view decides what each seat gets.
func Load(ctx context.Context, conn core.Conn, campaignID string) ([]cs.Clock, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, name, segments, filled, visibility, entry_id::text, position FROM clock
		WHERE campaign_id = $1 ORDER BY position, created_at`, campaignID)
	if err != nil {
		return nil, err
	}
	clocks, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.Clock, error) {
		var c cs.Clock
		return c, r.Scan(&c.ID, &c.Name, &c.Segments, &c.Filled, &c.Visibility, &c.EntryID, &c.Position)
	})
	if clocks == nil {
		clocks = []cs.Clock{}
	}
	return clocks, err
}

// An entry of this campaign, or entryNotFound: a clock never points into another room's codex.
func ownEntry(ctx context.Context, tx core.Conn, campaignID, id string) error {
	err := tx.QueryRow(ctx, `SELECT 1 FROM codex_entry WHERE id = $1 AND campaign_id = $2`, id, campaignID).Scan(new(int))
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Fail("entryNotFound")
	}
	return err
}

// Create is clock.create. The room holds at most cs.MaxClocks; the action transaction holds the campaign row, so two
// creates never both pass the count.
func Create(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM clock WHERE campaign_id = $1`, cid).Scan(&count); err != nil {
		return cs.Result{}, err
	}
	if count >= cs.MaxClocks {
		return cs.Result{}, cs.Fail("clockLimit")
	}
	entryID, _ := a["entryId"].(string)
	var entry *string
	if entryID != "" {
		if err := ownEntry(ctx, tx, cid, entryID); err != nil {
			return cs.Result{}, err
		}
		entry = &entryID
	}
	segments, _ := a["segments"].(float64)
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO clock (campaign_id, name, segments, visibility, entry_id, position)
		VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), 0) + 1 FROM clock WHERE campaign_id = $1))
		RETURNING id::text`, cid, a.Str("name"), int(segments), a.Str("visibility"), entry).Scan(&id)
	return cs.Done(id), err
}

// Tick is clock.tick: filled moves by delta and stays inside 0..segments. The change that was made is logged, so undo
// adds back what the tick took (the same shape as a resource).
func Tick(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	delta, _ := a["delta"].(float64)
	w, err := TickBy(ctx, tx, c.CampaignID, a.Str("id"), int(delta))
	if err != nil {
		return cs.Result{}, err
	}
	actionID := core.NewUUID()
	if _, err := eventlog.Record(ctx, tx, c, actionID, []eventlog.Written{w}); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(actionID), nil
}

// TickBy moves one clock by delta, clamped, and says what it did (event.undo calls it with the inverse).
func TickBy(ctx context.Context, tx core.Conn, campaignID, id string, delta int) (eventlog.Written, error) {
	var before, after int
	err := tx.QueryRow(ctx, `WITH old AS (SELECT id, filled FROM clock WHERE id = $1 AND campaign_id = $2 FOR UPDATE)
		UPDATE clock SET filled = LEAST(GREATEST(clock.filled + $3, 0), clock.segments)
		FROM old WHERE clock.id = old.id RETURNING old.filled, clock.filled`, id, campaignID, delta).Scan(&before, &after)
	if errors.Is(err, pgx.ErrNoRows) {
		return eventlog.Written{}, cs.Fail("clockNotFound")
	}
	return eventlog.Written{
		Target: engine.DeltaTarget{Clock: id}, Kind: "add", Before: float64(before), After: float64(after),
	}, err
}

// Update is clock.update, a patch. Lowering segments clamps filled.
func Update(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("id")
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT true FROM clock WHERE id = $1 AND campaign_id = $2 FOR UPDATE`, id, cid).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return cs.Result{}, cs.Fail("clockNotFound")
		}
		return cs.Result{}, err
	}
	var name, visibility *string
	if s, sent := a["name"].(string); sent {
		name = &s
	}
	if s, sent := a["visibility"].(string); sent {
		visibility = &s
	}
	var segments *int
	if n, sent := a["segments"].(float64); sent {
		v := int(n)
		segments = &v
	}
	// entryId: absent keeps it, null clears it, an id sets it.
	entry, entrySent := a["entryId"]
	var entryID *string
	if s, isID := entry.(string); isID {
		if err := ownEntry(ctx, tx, cid, s); err != nil {
			return cs.Result{}, err
		}
		entryID = &s
	}
	_, err := tx.Exec(ctx, `UPDATE clock SET name = coalesce($2, name), segments = coalesce($3, segments),
		visibility = coalesce($4, visibility), entry_id = CASE WHEN $5 THEN $6::uuid ELSE entry_id END,
		filled = LEAST(filled, coalesce($3, segments)) WHERE id = $1`, id, name, segments, visibility, entrySent, entryID)
	return cs.Done(id), err
}

// Delete is clock.delete.
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM clock WHERE id = $1 AND campaign_id = $2`, a.Str("id"), c.CampaignID)
	if err == nil && tag.RowsAffected() == 0 {
		return cs.Result{}, cs.Fail("clockNotFound")
	}
	return cs.Done(""), err
}
