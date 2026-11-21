package campaign

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/clock"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// A step undo passed over: a deleted actor, or a turn of an encounter that has ended or a holder who left the fight.
type skipped struct {
	ActorID string `json:"actorId,omitempty"`
	Turn    string `json:"turn,omitempty"`
	Pool    string `json:"pool,omitempty"`
	Reason  string `json:"reason"`
}

const sessionDeltas = `campaign_id = $1 AND session_id = $2 AND type = 'delta'`

// Undo is event.undo (docs/p1-plan.md, decisions 2-3; apps/api/src/campaign/event.actions.ts). One logged action of
// the running session, the newest one that is not undone, is taken back in reverse order inside this transaction, and
// an `undo` event records it. A step that can no longer be taken back refuses the whole undo, and nothing is written.
// There is no redo: the inverse writes are in the undo event, not in new `delta` rows, so they can't be undone in turn.
func Undo(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if sessionID == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	var actionID string
	err = tx.QueryRow(ctx, `SELECT action_id::text FROM session_event WHERE `+sessionDeltas+`
		AND undone_by IS NULL AND action_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`, cid, *sessionID).Scan(&actionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("nothingToUndo")
	}
	if err != nil {
		return cs.Result{}, err
	}
	return cs.Done(actionID), undoAction(ctx, tx, c, *sessionID, actionID)
}

// TurnBack is event.turnBack (house decision #82): every live logged action of the running fight back to and including
// its newest turn step (an action that changed who acts or the round), newest first, each taken back as Undo takes back
// one. A refusal of any of them refuses the whole step, naming which, and nothing is written.
func TurnBack(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if sessionID == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	step, err := eventlog.LastTurnStep(ctx, tx, cid, *sessionID)
	if err != nil {
		return cs.Result{}, err
	}
	if step == nil {
		return cs.Result{}, cs.Fail("nothingToTurnBack")
	}
	for i, actionID := range step.Actions {
		err := undoAction(ctx, tx, c, *sessionID, actionID)
		var refusal *cs.Error
		if errors.As(err, &refusal) {
			return cs.Result{}, cs.Fail("turnBackRefused", cs.Params{"n": i + 1, "count": len(step.Actions), "reason": refusal.Error()})
		}
		if err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(step.Actions[len(step.Actions)-1]), nil
}

// undoAction takes back one logged action of the running session, its writes in reverse order, and records the undo.
func undoAction(ctx context.Context, tx core.Conn, c cs.Ctx, sessionID, actionID string) error {
	cid := c.CampaignID
	var author *string
	if err := tx.QueryRow(ctx, `SELECT seat_user_id FROM session_event WHERE `+sessionDeltas+` AND action_id = $3 LIMIT 1`,
		cid, sessionID, actionID).Scan(&author); err != nil {
		return err
	}
	// Without a GM every seat undoes its own steps and the owner any step. A guest has no user to match, so none.
	if !c.HasGM() && c.Seat.Kind != cs.SeatAdmin && !view.IsOwner(c) && (c.UserID == nil || author == nil || *author != *c.UserID) {
		return cs.Fail("undoOthers")
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return err
	}
	if rules == nil {
		return cs.Fail("noRuleset")
	}
	rows, err := tx.Query(ctx, `SELECT payload FROM session_event WHERE `+sessionDeltas+` AND action_id = $3
		ORDER BY created_at DESC, id DESC`, cid, sessionID, actionID)
	if err != nil {
		return err
	}
	payloads, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		return err
	}

	written := []eventlog.Written{}
	passed := []skipped{}
	for _, payload := range payloads {
		logged, err := eventlog.Parse(payload)
		if err != nil {
			return err
		}
		t := logged.Target
		if t.Item != "" {
			// An item row is set whole (house decision #95), undone only while it holds what the step left.
			current, err := actor.ItemValue(ctx, tx, cid, t.Item)
			if err != nil {
				return err
			}
			inverse, refused := eventlog.Invert(logged, current)
			if refused != nil {
				return refused
			}
			w, err := actor.WriteDelta(ctx, tx, actor.Write{CampaignID: cid, Delta: *inverse})
			if err != nil {
				return err
			}
			written = append(written, w)
			continue
		}
		if t.Clock != "" {
			w, skip, err := undoClock(ctx, tx, cid, logged)
			if err != nil {
				return err
			}
			if skip != nil {
				passed = append(passed, *skip)
			}
			if w != nil {
				written = append(written, *w)
			}
			continue
		}
		// Read again for every step: an inverse can move another actor's bounds (a level back down lowers the max).
		actorRows, err := actor.LoadRows(ctx, tx, cid)
		if err != nil {
			return err
		}
		campaign, err := actor.LoadCampaign(ctx, tx, cid, rules)
		if err != nil {
			return err
		}
		built, err := actor.Build(rules, actorRows, campaign)
		if err != nil {
			return err
		}
		if t.Test != "" {
			return cs.Fail("cantUndoKind")
		}
		if t.Turn != "" {
			w, skip, err := undoTurn(ctx, tx, cid, logged)
			if err != nil {
				return err
			}
			if skip != nil {
				passed = append(passed, *skip)
			}
			if w != nil {
				written = append(written, *w)
			}
			continue
		}
		if t.Pool != "" {
			// Counted like a resource. Its bounds are read again: party.characters may have moved since.
			inverse, refused := eventlog.Invert(logged, nil)
			if refused != nil || inverse == nil {
				if refused != nil {
					return refused
				}
				continue
			}
			pool, declared, err := actor.BuildPool(rules, t.Pool, nil, actor.CountCharacters(actorRows), campaign)
			if err != nil {
				return err
			}
			if !declared {
				passed = append(passed, skipped{Pool: t.Pool, Reason: "gone"})
				continue
			}
			w, err := actor.WriteDelta(ctx, tx, actor.Write{CampaignID: cid, Delta: *inverse, Bounds: &pool.Bounds, PoolScope: pool.Scope})
			if err != nil {
				return err
			}
			written = append(written, w)
			continue
		}
		b, ok := built[t.ActorID]
		if !ok {
			// A deleted actor can't be brought back, so its steps are skipped and noted; the GM moves past them.
			passed = append(passed, skipped{ActorID: t.ActorID, Reason: "deleted"})
			continue
		}
		fieldType := ""
		if t.Field != "" {
			fieldType = actor.FieldTypeOf(rules, b, t.Field, logged.Before, logged.After)
		}
		var current any
		if t.Resource == "" {
			if current, err = actor.ReadTarget(ctx, tx, cid, t, fieldType); err != nil {
				return err
			}
		}
		inverse, refused := eventlog.Invert(logged, current)
		if refused != nil {
			return refused
		}
		if inverse == nil {
			continue
		}
		write := actor.Write{CampaignID: cid, Delta: *inverse, FieldType: fieldType}
		if bounds, bounded := b.Bounds[t.Resource]; t.Resource != "" && bounded {
			write.Bounds = &bounds
		}
		w, err := actor.WriteDelta(ctx, tx, write)
		if err != nil {
			return err
		}
		written = append(written, w)
	}

	payload, err := json.Marshal(map[string]any{"undone": actionID, "deltas": written, "skipped": passed})
	if err != nil {
		return err
	}
	var eventID string
	if err := tx.QueryRow(ctx, `INSERT INTO session_event (campaign_id, session_id, type, action_id, seat_user_id, payload)
		VALUES ($1, $2, 'undo', $3, $4, $5) RETURNING id::text`, cid, sessionID, core.NewUUID(), c.UserID, payload).Scan(&eventID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE session_event SET undone_by = $4 WHERE `+sessionDeltas+` AND action_id = $3`,
		cid, sessionID, actionID, eventID)
	return err
}

// A clock tick is counted like a resource: undo ticks back the change that was made, and a deleted clock is passed over.
func undoClock(ctx context.Context, tx core.Conn, cid string, logged eventlog.Written) (*eventlog.Written, *skipped, error) {
	inverse, refused := eventlog.Invert(logged, nil)
	if refused != nil || inverse == nil {
		return nil, nil, nilIfNone(refused)
	}
	w, err := clock.TickBy(ctx, tx, cid, logged.Target.Clock, int(inverse.Value.(float64)))
	var refusal *cs.Error
	if errors.As(err, &refusal) && refusal.Code == "clockNotFound" {
		return nil, &skipped{Reason: "deleted"}, nil
	}
	return &w, nil, err
}

// A refusal as an error, keeping a nil one nil (a nil *coreschema.Error is not a nil error).
func nilIfNone(refused *cs.Error) error {
	if refused == nil {
		return nil
	}
	return refused
}

// The round and the turn belong to the running encounter. Once it has ended there is nothing to put back.
//
// ponytail: a step of an earlier encounter of this session is compared with the running one by value only
func undoTurn(ctx context.Context, tx core.Conn, cid string, logged eventlog.Written) (*eventlog.Written, *skipped, error) {
	key := logged.Target.Turn
	e, err := turn.Active(ctx, tx, cid)
	if err != nil {
		return nil, nil, err
	}
	if e == nil {
		return nil, &skipped{Turn: key, Reason: "ended"}, nil
	}
	order := func() ([]string, error) {
		t, err := turn.Load(ctx, tx, cid)
		if err != nil || t == nil {
			return nil, err
		}
		return t.Order, nil
	}
	// Someone who left the fight since has no flag to compare: the list is read without them.
	if key == turn.Done || key == turn.Held || key == turn.Barred {
		here, err := order()
		if err != nil {
			return nil, nil, err
		}
		present := func(v any) any {
			list, isList := v.([]any)
			if !isList {
				return v
			}
			out := []any{}
			for _, id := range list {
				if s, ok := id.(string); ok && slices.Contains(here, s) {
					out = append(out, id)
				}
			}
			return out
		}
		logged.Before, logged.After = present(logged.Before), present(logged.After)
	}
	current, err := turn.Read(ctx, tx, cid, key)
	if err != nil {
		return nil, nil, err
	}
	inverse, refused := eventlog.Invert(logged, current)
	if refused != nil || inverse == nil {
		return nil, nil, nilIfNone(refused)
	}
	// The holder it would hand the turn back to has left the fight since: nothing to put back, the rest still reverts.
	if back, isID := inverse.Value.(string); (key == turn.CurrentID || key == turn.FirstID) && isID {
		here, err := order()
		if err != nil {
			return nil, nil, err
		}
		if !slices.Contains(here, back) {
			return nil, &skipped{Turn: key, Reason: "gone"}, nil
		}
	}
	w, err := actor.WriteDelta(ctx, tx, actor.Write{CampaignID: cid, Delta: *inverse})
	return &w, nil, err
}
