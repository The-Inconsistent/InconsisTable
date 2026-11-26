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
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/request"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// A step undo passed over: a deleted actor, or a turn of an encounter that has ended or a holder who left the fight.
type skipped struct {
	ActorID string `json:"actorId,omitempty"`
	Turn    string `json:"turn,omitempty"`
	Pool    string `json:"pool,omitempty"`
	EntryID string `json:"entryId,omitempty"`
	Reason  string `json:"reason"`
}

// undoEvent is the payload of an `undo` event: the action it took back, what it wrote (the store a redo reads back,
// house decision #132), what it passed over, and the requests it reopened (house decision #119).
type undoEvent struct {
	Undone   string             `json:"undone"`
	Deltas   []eventlog.Written `json:"deltas"`
	Skipped  []skipped          `json:"skipped"`
	Reopened []string           `json:"reopened,omitempty"`
}

const sessionDeltas = `campaign_id = $1 AND session_id = $2 AND type = 'delta'`

// Undo is event.undo (docs/p1-plan.md, decisions 2-3; apps/api/src/campaign/event.actions.ts). One logged action of
// the running session is taken back in reverse order inside this transaction, and an `undo` event records it: the one
// named by `actionId` (undo by line, house decision #131), else the newest one that is not undone. A step that can no
// longer be taken back refuses the whole undo, and nothing is written. Redo takes the undo back in turn (Redo).
func Undo(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if sessionID == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	actionID := a.Str("actionId")
	if actionID != "" {
		// A line of this session's log, still standing. The id is the client's, so it is looked up in the session only.
		var live *bool
		if err := tx.QueryRow(ctx, `SELECT bool_and(undone_by IS NULL) FROM session_event WHERE `+sessionDeltas+`
			AND action_id = $3`, cid, *sessionID, actionID).Scan(&live); err != nil {
			return cs.Result{}, err
		}
		if live == nil {
			return cs.Result{}, cs.Fail("nothingToUndo")
		}
		if !*live {
			return cs.Result{}, cs.Fail("alreadyUndone")
		}
		return cs.Done(actionID), undoAction(ctx, tx, c, *sessionID, actionID)
	}
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

// Redo is event.redo (house decision #132): the undo that took back this logged action of the running session is
// taken back in turn, its writes in reverse order, as Auspex's undo of an undo is a redo. The action stands again (its
// own log lines, so Undo reaches it as before) and the undo is marked taken back by a `redo` event. Refused when a
// later live action wrote one of the same values, when the undo deleted codex entries (they are gone), and when a
// request the undo reopened was answered since (it would spend twice).
func Redo(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if sessionID == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	actionID := a.Str("actionId")
	var undoID *string
	err = tx.QueryRow(ctx, `SELECT undone_by::text FROM session_event WHERE `+sessionDeltas+` AND action_id = $3 LIMIT 1`,
		cid, *sessionID, actionID).Scan(&undoID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && undoID == nil) {
		return cs.Result{}, cs.Fail("nothingToRedo")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if err := mayTakeBack(ctx, tx, c, *sessionID, actionID); err != nil {
		return cs.Result{}, err
	}
	var payload []byte
	if err := tx.QueryRow(ctx, `SELECT payload FROM session_event WHERE id = $1 AND campaign_id = $2 AND type = 'undo'`,
		*undoID, cid).Scan(&payload); err != nil {
		return cs.Result{}, err
	}
	var undone undoEvent
	if err := json.Unmarshal(payload, &undone); err != nil {
		return cs.Result{}, err
	}
	// The undo wrote newest first; its writes are taken back oldest first, which is the order the action wrote them.
	logged := slices.Clone(undone.Deltas)
	slices.Reverse(logged)
	for _, w := range logged {
		if w.Target.Entry != "" {
			return cs.Result{}, cs.Fail("cantRedoKind")
		}
	}
	if err := laterFirst(ctx, tx, laterAsk{cid: cid, sessionID: *sessionID, actionID: actionID, since: *undoID,
		logged: logged, code: "redoLaterFirst"}); err != nil {
		return cs.Result{}, err
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	// The asks first: a refusal there leaves every value as it was.
	if err := request.Reapprove(ctx, tx, cid, undone.Reopened, actionID); err != nil {
		return cs.Result{}, err
	}
	written, passed, err := takeBack(ctx, tx, c, rules, logged)
	if err != nil {
		return cs.Result{}, err
	}
	body, err := json.Marshal(map[string]any{"redone": actionID, "undo": *undoID, "deltas": written, "skipped": passed})
	if err != nil {
		return cs.Result{}, err
	}
	var eventID string
	if err := tx.QueryRow(ctx, `INSERT INTO session_event (campaign_id, session_id, type, action_id, seat_user_id, payload)
		VALUES ($1, $2, 'redo', $3, $4, $5) RETURNING id::text`, cid, *sessionID, core.NewUUID(), c.UserID, body).Scan(&eventID); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE session_event SET undone_by = $2 WHERE id = $1`, *undoID, eventID); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE session_event SET undone_by = NULL WHERE `+sessionDeltas+` AND action_id = $3`,
		cid, *sessionID, actionID); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(actionID), nil
}

// mayTakeBack is the author check Undo, TURN BACK and Redo share: without a GM every seat takes back its own steps and
// the owner any step. A guest has no user to match, so none.
func mayTakeBack(ctx context.Context, tx core.Conn, c cs.Ctx, sessionID, actionID string) error {
	var author *string
	if err := tx.QueryRow(ctx, `SELECT seat_user_id FROM session_event WHERE `+sessionDeltas+` AND action_id = $3 LIMIT 1`,
		c.CampaignID, sessionID, actionID).Scan(&author); err != nil {
		return err
	}
	if !c.HasGM() && c.Seat.Kind != cs.SeatAdmin && !view.IsOwner(c) && (c.UserID == nil || author == nil || *author != *c.UserID) {
		return cs.Fail("undoOthers")
	}
	return nil
}

// laterAsk is what laterFirst looks for: a live action of the session logged after the event `since` (not actionID
// itself) that wrote one of the set values in logged; code is the refusal that names it.
type laterAsk struct {
	cid, sessionID, actionID, since string
	logged                          []eventlog.Written
	code                            string
}

// laterFirst refuses when a later live action wrote one of the values this one set (house decision #131), naming the
// value and that action, so the GM undoes it first, as Auspex's "Undo X first". Counted values (a resource, a pool, a
// clock, a condition's count) are left out: their inverse is a change, which keeps a later one's effect.
func laterFirst(ctx context.Context, tx core.Conn, ask laterAsk) error {
	targets := []string{}
	// A condition is a row: a later row of the same condition on the same actor is the same value too (an add after an
	// undone add makes a new row, which a redo would double).
	condActors, condIDs := []string{}, []string{}
	for _, w := range ask.logged {
		t := w.Target
		if t.Resource != "" || t.Pool != "" || t.Clock != "" || t.Entry != "" || (t.Condition != "" && w.Kind == "add") {
			continue
		}
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		targets = append(targets, string(b))
		if t.Condition != "" {
			for _, row := range []any{w.Before, w.After} {
				if r, isRow := row.(map[string]any); isRow {
					if id, ok := r["conditionId"].(string); ok {
						condActors, condIDs = append(condActors, t.ActorID), append(condIDs, id)
					}
				}
			}
		}
	}
	if len(targets) == 0 {
		return nil
	}
	var blocker string
	var payload []byte
	err := tx.QueryRow(ctx, `SELECT e.action_id::text, e.payload FROM session_event e
		WHERE e.campaign_id = $1 AND e.session_id = $2 AND e.type = 'delta' AND e.undone_by IS NULL AND e.action_id <> $3
		AND (e.created_at, e.id) > (SELECT created_at, id FROM session_event WHERE id = $4)
		AND (e.payload->'target' IN (SELECT t::jsonb FROM unnest($5::text[]) t)
			OR (e.payload->'target'->>'actorId', coalesce(e.payload->'after'->>'conditionId', e.payload->'before'->>'conditionId'))
				IN (SELECT * FROM unnest($6::text[], $7::text[])))
		ORDER BY e.created_at, e.id LIMIT 1`, ask.cid, ask.sessionID, ask.actionID, ask.since, targets, condActors, condIDs).
		Scan(&blocker, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	w, err := eventlog.Parse(payload)
	if err != nil {
		return err
	}
	t := w.Target
	// A condition row's id says nothing to the GM: the condition it holds does.
	for _, v := range []any{w.After, w.Before} {
		if row, isRow := v.(map[string]any); isRow && t.Condition != "" {
			if id, ok := row["conditionId"].(string); ok {
				t.Condition = id
				break
			}
		}
	}
	return cs.Fail(ask.code, cs.Params{"target": eventlog.DescribeTarget(t), "actionId": blocker})
}

// undoAction takes back one logged action of the running session, its writes in reverse order, and records the undo.
func undoAction(ctx context.Context, tx core.Conn, c cs.Ctx, sessionID, actionID string) error {
	cid := c.CampaignID
	if err := mayTakeBack(ctx, tx, c, sessionID, actionID); err != nil {
		return err
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return err
	}
	if rules == nil {
		return cs.Fail("noRuleset")
	}
	rows, err := tx.Query(ctx, `SELECT id::text, payload FROM session_event WHERE `+sessionDeltas+` AND action_id = $3
		ORDER BY created_at DESC, id DESC`, cid, sessionID, actionID)
	if err != nil {
		return err
	}
	type row struct {
		ID      string
		Payload []byte
	}
	read, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		return err
	}
	logged := make([]eventlog.Written, len(read))
	for i, r := range read {
		if logged[i], err = eventlog.Parse(r.Payload); err != nil {
			return err
		}
	}
	if len(read) > 0 {
		if err := laterFirst(ctx, tx, laterAsk{cid: cid, sessionID: sessionID, actionID: actionID, since: read[0].ID,
			logged: logged, code: "undoLaterFirst"}); err != nil {
			return err
		}
	}
	written, passed, err := takeBack(ctx, tx, c, rules, logged)
	if err != nil {
		return err
	}
	// A request this action approved is waiting again (house decision #119); a redo approves it again.
	reopened, err := request.Reopen(ctx, tx, cid, actionID)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(undoEvent{Undone: actionID, Deltas: written, Skipped: passed, Reopened: reopened})
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

// takeBack writes the inverse of each logged write, in the order given, and says what it wrote and passed over. Undo
// gives it an action's writes newest first; Redo gives it an undo's writes, oldest first.
func takeBack(ctx context.Context, tx core.Conn, c cs.Ctx, rules *engine.CompiledRuleset, writes []eventlog.Written) ([]eventlog.Written, []skipped, error) {
	cid := c.CampaignID
	written := []eventlog.Written{}
	passed := []skipped{}
	for _, logged := range writes {
		t := logged.Target
		if t.Item != "" {
			// An item row is set whole (house decision #95), undone only while it holds what the step left.
			current, err := actor.ItemValue(ctx, tx, cid, t.Item)
			if err != nil {
				return nil, nil, err
			}
			inverse, refused := eventlog.Invert(logged, current)
			if refused != nil {
				return nil, nil, refused
			}
			w, err := actor.WriteDelta(ctx, tx, actor.Write{CampaignID: cid, Delta: *inverse})
			if err != nil {
				return nil, nil, err
			}
			written = append(written, w)
			continue
		}
		if t.Clock != "" {
			w, skip, err := undoClock(ctx, tx, cid, logged)
			if err != nil {
				return nil, nil, err
			}
			if skip != nil {
				passed = append(passed, *skip)
			}
			if w != nil {
				written = append(written, *w)
			}
			continue
		}
		if t.Entry != "" {
			// An entry the action made (house decision #97) goes as codex.delete takes one; one already deleted is passed
			// over. The log is newest first, so the entries inside a made one go before it.
			_, err := codex.Delete(ctx, tx, c, cs.Action{"type": "codex.delete", "id": t.Entry})
			var refusal *cs.Error
			switch {
			case errors.As(err, &refusal) && refusal.Code == "entryNotFound":
				passed = append(passed, skipped{EntryID: t.Entry, Reason: "deleted"})
			case err != nil:
				return nil, nil, err
			default:
				written = append(written, eventlog.Written{Target: t, Kind: "create", Before: true, After: nil})
			}
			continue
		}
		// Read again for every step: an inverse can move another actor's bounds (a level back down lowers the max).
		actorRows, err := actor.LoadRows(ctx, tx, cid)
		if err != nil {
			return nil, nil, err
		}
		campaign, err := actor.LoadCampaign(ctx, tx, cid, rules)
		if err != nil {
			return nil, nil, err
		}
		built, err := actor.Build(rules, actorRows, campaign)
		if err != nil {
			return nil, nil, err
		}
		if t.Test != "" {
			return nil, nil, cs.Fail("cantUndoKind")
		}
		if t.Turn != "" {
			w, skip, err := undoTurn(ctx, tx, cid, logged)
			if err != nil {
				return nil, nil, err
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
					return nil, nil, refused
				}
				continue
			}
			pool, declared, err := actor.BuildPool(rules, t.Pool, nil, actor.CountCharacters(actorRows), campaign)
			if err != nil {
				return nil, nil, err
			}
			if !declared {
				passed = append(passed, skipped{Pool: t.Pool, Reason: "gone"})
				continue
			}
			w, err := actor.WriteDelta(ctx, tx, actor.Write{CampaignID: cid, Delta: *inverse, Bounds: &pool.Bounds, PoolScope: pool.Scope})
			if err != nil {
				return nil, nil, err
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
				return nil, nil, err
			}
		}
		inverse, refused := eventlog.Invert(logged, current)
		if refused != nil {
			return nil, nil, refused
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
			return nil, nil, err
		}
		written = append(written, w)
	}
	return written, passed, nil
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
