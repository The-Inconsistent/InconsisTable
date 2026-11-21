package request

import (
	"context"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/item"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/testcall"
)

// Acquiring an item by a Test (house decision #102): a seat asks for a served pack entry for a character it holds; the
// side that runs the table approves (the Test is called) or denies, as every request goes. Without a GM the Test is
// called at once, as the table.

// hostOf is how a request stores the host an acquired fitting goes on: `to:<item id>` or `line:<card>/<name>`.
func hostOf(ask item.Ask) *string {
	switch {
	case ask.To != "":
		return new("to:" + ask.To)
	case ask.Line != "":
		return new("line:" + ask.Line)
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// askOf reads a pending acquisition back.
func askOf(w waiting) item.Ask {
	ask := item.Ask{ActorID: w.actorID, Type: w.acquireType, Key: w.acquireKey, Picks: w.inputs}
	if to, ok := strings.CutPrefix(w.acquireHost, "to:"); ok {
		ask.To = to
	} else if line, ok := strings.CutPrefix(w.acquireHost, "line:"); ok {
		ask.Line = line
	}
	if ask.Picks == nil {
		ask.Picks = map[string]any{}
	}
	return ask
}

// sendAcquire is request.send of an acquisition: checked as it would be called now (item.Plan), one pending per
// character (acquireAsked), then queued for the GM side, or without a GM called at once as the table.
func sendAcquire(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action, max int) (cs.Result, error) {
	ask := item.AskOf(a)
	if !slices.Contains(heldBy(c), ask.ActorID) {
		return cs.Result{}, cs.Fail("notYourCharacter")
	}
	if _, _, err := item.Plan(ctx, tx, c, ask); err != nil {
		return cs.Result{}, err
	}
	if !c.HasGM() {
		table := c
		table.Seat = cs.Seat{Kind: cs.SeatAdmin}
		id, err := callAcquire(ctx, tx, table, ask)
		return cs.Done(id), err
	}
	var asked bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM spend_request WHERE campaign_id = $1 AND actor_id = $2
		AND status = 'pending' AND acquire_key IS NOT NULL)`, c.CampaignID, ask.ActorID).Scan(&asked); err != nil {
		return cs.Result{}, err
	}
	if asked {
		return cs.Result{}, cs.Fail("acquireAsked")
	}
	if err := underLimit(ctx, tx, c, max); err != nil {
		return cs.Result{}, err
	}
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO spend_request (campaign_id, user_id, actor_id, acquire_type, acquire_key, acquire_host,
			inputs, note)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
		c.CampaignID, *c.UserID, ask.ActorID, ask.Type, ask.Key, hostOf(ask), ask.Picks, a.Str("note")).Scan(&id)
	return cs.Done(id), err
}

// callAcquire calls the acquisition's Test for the character with the inputs it works out now, and marks the call with
// what a pass grants. It returns the call's id.
func callAcquire(ctx context.Context, tx core.Conn, c cs.Ctx, ask item.Ask) (string, error) {
	testID, acq, err := item.Plan(ctx, tx, c, ask)
	if err != nil {
		return "", err
	}
	inputs := map[string]any{}
	for name, in := range acq.Inputs {
		inputs[name] = in.Total
	}
	callID, err := testcall.CallTest(ctx, tx, c, testID, inputs, []string{ask.ActorID}, false, false)
	if err != nil {
		return "", err
	}
	return callID, item.MarkCall(ctx, tx, callID, acq)
}
