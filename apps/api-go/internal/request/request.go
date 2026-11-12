// Package request holds spend requests: a player asks to spend from a resource they cannot change themselves, and the
// GM side approves or denies (docs/p2-plan.md group C, house decision #43). Approval spends through the same pipeline a
// GM's resource delta uses, so it is clamped (CLAUDE.md, principle 6), logged and undoable.
package request

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// MaxPending is how many requests one user may have waiting.
const MaxPending = 5

// answersKept is how many of a player's latest answers the snapshot carries, and for how long.
const (
	answersKept = 10
	answersFor  = 10 * time.Minute
)

// Load is the campaign's pending requests, oldest first, whole. The Seat view decides what each seat gets.
func Load(ctx context.Context, conn core.Conn, campaignID string) ([]cs.SpendRequest, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, user_id, actor_id::text, resource_id, amount, note, created_at
		FROM spend_request WHERE campaign_id = $1 AND status = 'pending' ORDER BY created_at, id`, campaignID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.SpendRequest, error) {
		var q cs.SpendRequest
		var at time.Time
		err := r.Scan(&q.ID, &q.UserID, &q.ActorID, &q.ResourceID, &q.Amount, &q.Note, &at)
		q.CreatedAt = core.ISOTime(at)
		return q, err
	})
	if out == nil {
		out = []cs.SpendRequest{}
	}
	return out, err
}

// LoadAnswers is the recent approved and denied requests of the room, newest first, with their askers: the Seat view
// gives each player their own (with userId), so a phone can say what the GM answered.
func LoadAnswers(ctx context.Context, conn core.Conn, campaignID string) ([]cs.RequestAnswer, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, user_id, actor_id::text, resource_id, amount, status, reason
		FROM spend_request WHERE campaign_id = $1 AND status IN ('approved', 'denied') AND resolved_at > now() - $2::interval
		ORDER BY resolved_at DESC, id DESC LIMIT 100`, campaignID, answersFor.String())
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.RequestAnswer, error) {
		var a cs.RequestAnswer
		return a, r.Scan(&a.ID, &a.UserID, &a.ActorID, &a.ResourceID, &a.Amount, &a.Status, &a.Reason)
	})
	if out == nil {
		out = []cs.RequestAnswer{}
	}
	return out, err
}

// Send is request.send. Only a resource the seat may not change itself, on a character it holds, can be asked for.
//
// ponytail: shared pools have no storage yet, so a request with no actor is refused; the table already allows a NULL
// actor_id for the day party-scope pools land. A room without a GM applies a request at once instead of queuing it.
func Send(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if c.UserID == nil {
		return cs.Result{}, cs.Fail("noPermission")
	}
	actorID, resource := a.Str("actorId"), a.Str("resourceId")
	if actorID == "" {
		return cs.Result{}, cs.Fail("requestNoPool")
	}
	if session, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID); err != nil {
		return cs.Result{}, err
	} else if session == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b, ok := rc.Built[actorID]
	if !ok {
		return cs.Result{}, cs.Fail("characterNotFound")
	}
	if !slices.Contains(view.HeldBy(c), actorID) {
		return cs.Result{}, cs.Fail("notYourCharacter")
	}
	res, known := rc.Compiled.Resources[resource]
	if !known {
		return cs.Result{}, cs.Fail("noResourceHere", cs.Params{"resource": resource})
	}
	// Only an entity-scoped resource a player can see: a `gm` one is hidden from them, a gm or campaign pool is not theirs
	// to spend from (#43). A health track takes damage through its own op.
	if res.Def.Scope != "entity" || res.Def.Visibility == "gm" {
		return cs.Result{}, cs.Fail("requestNotAllowed")
	}
	if _, bounded := b.Bounds[resource]; !bounded {
		return cs.Result{}, cs.Fail("noResourceHere", cs.Params{"resource": resource})
	}
	for _, t := range rc.Compiled.Ruleset.Health.Tracks {
		if t.Resource == resource {
			return cs.Result{}, cs.Fail("hpThroughDamage")
		}
	}
	if dec, _ := engine.StepsFor(res.Def.EditableBy, false); dec {
		return cs.Result{}, cs.Fail("requestSpendYourself")
	}
	amount, _ := a["amount"].(float64)
	if !c.HasGM() {
		// Nobody answers a request without a GM, so the table does: the spend applies at once, through the same clamped,
		// logged path an approval takes, under the asker's name. Everything above has been checked as for a request.
		table := c
		table.Seat = cs.Seat{Kind: cs.SeatAdmin}
		actionID, err := spend(ctx, tx, table, actorID, resource, int(amount))
		return cs.Done(actionID), err
	}
	var waiting int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM spend_request WHERE campaign_id = $1 AND user_id = $2 AND status = 'pending'`,
		c.CampaignID, *c.UserID).Scan(&waiting); err != nil {
		return cs.Result{}, err
	}
	if waiting >= MaxPending {
		return cs.Result{}, cs.Fail("requestLimit")
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO spend_request (campaign_id, user_id, actor_id, resource_id, amount, note)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
		c.CampaignID, *c.UserID, actorID, resource, int(amount), a.Str("note")).Scan(&id)
	return cs.Done(id), err
}

// Cancel is request.cancel: the asker's own pending request. Another user's request is not found, not refused, so its
// existence is not confirmed.
func Cancel(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if c.UserID == nil {
		return cs.Result{}, cs.Fail("noPermission")
	}
	id := a.Str("id")
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM spend_request WHERE id = $1 AND campaign_id = $2 AND user_id = $3 FOR UPDATE`,
		id, c.CampaignID, *c.UserID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("requestNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if status != "pending" {
		return cs.Result{}, cs.Fail("requestAnswered")
	}
	_, err = tx.Exec(ctx, `UPDATE spend_request SET status = 'cancelled', resolved_at = now() WHERE id = $1`, id)
	return cs.Done(id), err
}

// CancelPending cancels every pending request of the room: the session ended, so nobody is waiting on an answer.
func CancelPending(ctx context.Context, tx core.Conn, campaignID string) error {
	_, err := tx.Exec(ctx, `UPDATE spend_request SET status = 'cancelled', resolved_at = now()
		WHERE campaign_id = $1 AND status = 'pending'`, campaignID)
	return err
}

// The pending request of this room, locked, or the refusal.
func pending(ctx context.Context, tx core.Conn, campaignID, id string) (actorID, resource string, amount int, err error) {
	var status string
	var actor *string
	err = tx.QueryRow(ctx, `SELECT status, actor_id::text, resource_id, amount FROM spend_request
		WHERE id = $1 AND campaign_id = $2 FOR UPDATE`, id, campaignID).Scan(&status, &actor, &resource, &amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", 0, cs.Fail("requestNotFound")
	}
	if err != nil {
		return "", "", 0, err
	}
	if status != "pending" {
		return "", "", 0, cs.Fail("requestAnswered")
	}
	if actor != nil {
		actorID = *actor
	}
	return actorID, resource, amount, nil
}

// Approve is request.approve: -amount through the resource.capped adjust op and the actor pipeline, as a GM's own delta,
// so the server clamps it and the log keeps it for event.undo. A spend that no longer applies (the resource is gone,
// the character is deleted, a seat without the scope for it) refuses, and the request stays for the GM to deny.
func Approve(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("id")
	actorID, resource, amount, err := pending(ctx, tx, c.CampaignID, id)
	if err != nil {
		return cs.Result{}, err
	}
	actionID, err := spend(ctx, tx, c, actorID, resource, amount)
	if err != nil {
		return cs.Result{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE spend_request SET status = 'approved', resolved_at = now() WHERE id = $1`, id)
	return cs.Done(actionID), err
}

// spend takes amount off the resource: the resource.capped adjust op and the actor pipeline, as a GM's own delta. It
// returns the logged action's id.
func spend(ctx context.Context, tx core.Conn, c cs.Ctx, actorID, resource string, amount int) (string, error) {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return "", err
	}
	deltas, err := rc.Run(ctx, ruleset.Run{Primitive: "resource.capped", Op: "adjust", NoTurn: true,
		Input: map[string]any{"actorId": actorID, "resource": resource, "delta": float64(-amount)}})
	if err != nil {
		return "", err
	}
	return rc.Apply(ctx, deltas)
}

// Deny is request.deny, with the GM's reason if they gave one.
func Deny(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("id")
	if _, _, _, err := pending(ctx, tx, c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE spend_request SET status = 'denied', reason = $2, resolved_at = now() WHERE id = $1`,
		id, a.Str("reason"))
	return cs.Done(id), err
}
