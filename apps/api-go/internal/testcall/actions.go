package testcall

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// test.call and test.close are `test:call`, test.report is `test:report:own` (apps/api/src/test-call/test-call.actions.ts;
// the dispatch checked the permission, with the called character as the target). The dice stay physical: nothing here
// rolls (docs/house-decisions.md #1).

func testOf(rules *engine.CompiledRuleset, testID string) (*engine.CompiledTest, error) {
	if rules == nil {
		return nil, cs.Fail("noRuleset")
	}
	if test := rules.Tests[testID]; test != nil {
		return test, nil
	}
	return nil, cs.Fail("noSuchTest", cs.Params{"test": testID})
}

// The Test's declaration as stored, which the resolve ops take as their params.
func paramsOf(rules *engine.CompiledRuleset, testID string) any {
	tests, _ := rules.Ruleset.Normalized["tests"].(map[string]any)
	return tests[testID]
}

type call struct{ id, testID string }

// An open call of this campaign; an id from the client is never trusted.
func openCall(ctx context.Context, conn core.Conn, campaignID, callID string) (call, error) {
	var c call
	var status string
	err := conn.QueryRow(ctx, `SELECT id::text, test_id, status FROM test_call WHERE id = $1 AND campaign_id = $2`,
		callID, campaignID).Scan(&c.id, &c.testID, &status)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return c, cs.Fail("testNotHere")
	case err == nil && status == "closed":
		return c, cs.Fail("testClosed")
	}
	return c, err
}

// The log keeps the whole story (the recap draws on it); it is a GM-side document and never reaches a phone.
func logEvent(ctx context.Context, tx core.Conn, c cs.Ctx, kind string, payload map[string]any) error {
	sessionID, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO session_event (campaign_id, session_id, type, seat_user_id, payload) VALUES ($1, $2, $3, $4, $5)`,
		c.CampaignID, sessionID, kind, c.UserID, body)
	return err
}

// Action runs test.call, test.report or test.close.
func Action(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	switch a.Type() {
	case "test.call":
		return callTest(ctx, tx, c, a)
	case "test.report":
		return report(ctx, tx, c, a)
	}
	return closeCall(ctx, tx, c, a)
}

type target struct {
	ActorID  string   `json:"actorId"`
	Modifier float64  `json:"modifier"`
	Target   float64  `json:"target"`
	Pool     *float64 `json:"pool"`
}

func callTest(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	testID := a.Str("testId")
	test, err := testOf(rules, testID)
	if err != nil {
		return cs.Result{}, err
	}
	inputs, _ := a["inputs"].(map[string]any)
	if bad := CheckInputs(test, inputs); bad != "" {
		return cs.Result{}, cs.Fail("testProblem", cs.Params{"detail": bad})
	}
	rows, err := actor.LoadRows(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	campaign, err := actor.LoadCampaign(ctx, tx, cid, rules)
	if err != nil {
		return cs.Result{}, err
	}
	built, err := actor.Build(rules, rows, campaign)
	if err != nil {
		return cs.Result{}, err
	}
	// Computed now, for each character, and kept: what the phone shows must not move under a player's hand.
	targets := []target{}
	for _, actorID := range idList(a["actorIds"]) {
		if slices.ContainsFunc(targets, func(t target) bool { return t.ActorID == actorID }) {
			continue
		}
		b := built[actorID]
		switch {
		case b == nil:
			return cs.Result{}, cs.Fail("characterNotFound")
		case b.Entity == "":
			return cs.Result{}, cs.Fail("notBuilt", cs.Params{"name": b.Row.Name})
		case b.Scope == nil:
			return cs.Result{}, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
		case test.Def.Entities != nil && !slices.Contains(*test.Def.Entities, b.Entity):
			// The Test names the actor types that take it (house decision #50).
			return cs.Result{}, cs.Fail("testNotForType", cs.Params{"name": b.Row.Name})
		}
		r, problem, err := EvaluateCall(test, b.Scope, inputs)
		if err != nil {
			return cs.Result{}, err
		}
		if problem != "" {
			return cs.Result{}, cs.Fail("callProblem", cs.Params{"name": b.Row.Name, "detail": problem})
		}
		targets = append(targets, target{actorID, r.Modifier, r.Target, r.Pool})
	}
	hideTarget, _ := a["hideTarget"].(bool)
	if !c.HasGM() {
		// Without a GM any seat calls a Test, for characters, and nothing in it is kept from the table
		// (docs/adr/0009-table-modes.md, p2-plan decision 3).
		for _, t := range targets {
			if kind := built[t.ActorID].Row.Kind; kind != "pc" && kind != "companion" {
				return cs.Result{}, cs.Fail("testCharactersOnly")
			}
		}
		ids := make([]string, len(targets))
		for i, t := range targets {
			ids[i] = t.ActorID
		}
		// A number read from an owner or gm field is not the table's to see, so such a Test is not called without a GM.
		if test.Def.Kind != "reported" {
			if hideTarget {
				return cs.Result{}, cs.Fail("testTargetShown")
			}
			if !everyoneMay(test.TargetVisibility, ids, built, true) || !everyoneMay(test.ModifierVisibility, ids, built, true) {
				return cs.Result{}, cs.Fail("testTableOnly")
			}
		}
	}
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	inputsJSON, err := json.Marshal(inputs)
	if err != nil {
		return cs.Result{}, err
	}
	showOutcome, _ := a["showOutcome"].(bool)
	var callID string
	if err := tx.QueryRow(ctx, `INSERT INTO test_call (campaign_id, session_id, test_id, inputs, hide_target, show_outcome, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`, cid, sessionID, testID, inputsJSON, hideTarget, showOutcome, c.UserID).
		Scan(&callID); err != nil {
		return cs.Result{}, err
	}
	for _, t := range targets {
		if _, err := tx.Exec(ctx, `INSERT INTO test_call_target (call_id, actor_id, modifier, target, pool) VALUES ($1, $2, $3, $4, $5)`,
			callID, t.ActorID, int64(t.Modifier), int64(t.Target), intOrNil(t.Pool)); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(callID), logEvent(ctx, tx, c, "test.call", map[string]any{
		"callId": callID, "testId": testID, "inputs": inputs, "hideTarget": hideTarget, "targets": targets,
	})
}

func intOrNil(n *float64) any {
	if n == nil {
		return nil
	}
	return int64(*n)
}

func idList(v any) []string {
	out := []string{}
	list, _ := v.([]any)
	for _, item := range list {
		if s, isText := item.(string); isText {
			out = append(out, s)
		}
	}
	return out
}

// reportRow is a report's columns: the faces as read, the die before the modifier, the total and the outcome, and for
// a Dice pool the dice counted per band, the special dice's faces, and what the server worked out.
type reportRow struct {
	Advantage        string         `json:"advantage"`
	ReportedByUserID *string        `json:"reportedByUserId"`
	ReportedByRole   string         `json:"reportedByRole"`
	ReportedAt       time.Time      `json:"reportedAt"`
	Faces            []float64      `json:"faces"`
	Natural          *float64       `json:"natural"`
	Total            float64        `json:"total"`
	Outcome          string         `json:"outcome"`
	BandCounts       map[string]any `json:"bandCounts"`
	SpecialFaces     []any          `json:"specialFaces"`
	Margin           *float64       `json:"margin"`
	Shifts           *float64       `json:"shifts"`
	Flags            []string       `json:"flags"`
}

var advantageModes = []string{"none", "advantage", "disadvantage"}

func report(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, actorID := c.CampaignID, a.Str("actorId")
	open, err := openCall(ctx, tx, cid, a.Str("callId"))
	if err != nil {
		return cs.Result{}, err
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	test, err := testOf(rules, open.testID)
	if err != nil {
		return cs.Result{}, err
	}
	var modifier, targetNumber int32
	var pool *int32
	err = tx.QueryRow(ctx, `SELECT modifier, target, pool FROM test_call_target WHERE call_id = $1 AND actor_id = $2`,
		open.id, actorID).Scan(&modifier, &targetNumber, &pool)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("notCalled")
	}
	if err != nil {
		return cs.Result{}, err
	}
	var had bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM test_report WHERE call_id = $1 AND actor_id = $2)`, open.id, actorID).
		Scan(&had); err != nil {
		return cs.Result{}, err
	}
	// A player's first report stands, so a roll that failed can't be quietly retaken; the GM side corrects one, and without a
	// GM the owner does (the other players are players there too).
	corrects := cs.CanInCampaign(c, "test:call", "")
	if !c.HasGM() {
		corrects = c.Seat.Kind == cs.SeatMember && view.IsOwner(c)
	}
	if had && !corrects {
		return cs.Result{}, cs.Fail("alreadyReported")
	}
	// The schema allows a roll or an outcome; which one this Test takes is the ruleset's.
	outcome, hasOutcome := a["outcome"].(string)
	reported := test.Def.Kind == "reported"
	switch {
	case reported && !hasOutcome:
		return cs.Result{}, cs.Fail("testTakesOutcome")
	case !reported && hasOutcome:
		return cs.Result{}, cs.Fail("testTakesDice")
	}
	advantage := a.Str("advantage")
	if advantage == "" {
		advantage = "none"
	}
	if !slices.Contains(advantageModes, advantage) {
		return cs.Result{}, cs.Fail("badAdvantage", cs.Params{"advantage": a["advantage"]})
	}
	roll, _ := a["roll"].(map[string]any)
	row := reportRow{
		Advantage: advantage, ReportedByUserID: c.UserID, ReportedByRole: c.Seat.SeatRole(), ReportedAt: time.Now(),
		Flags: []string{},
	}
	params := paramsOf(rules, open.testID)
	if reported {
		// The table rolled and worked it out; the server only checks the outcome is one the Test lists.
		if !slices.ContainsFunc(test.Def.Outcomes, func(o engine.ReportedOutcome) bool { return o.ID == outcome }) {
			return cs.Result{}, cs.Fail("unknownOutcome")
		}
		row.Outcome = outcome
	} else if test.Def.Kind == "poolSuccesses" {
		if advantage != "none" {
			return cs.Result{}, cs.Fail("poolNoAdvantage")
		}
		dice := 0.0
		if pool != nil {
			dice = float64(*pool)
		}
		r, problem := ResolvePoolRoll(params, float64(targetNumber), dice, roll)
		if problem != "" {
			return cs.Result{}, cs.Fail("testProblem", cs.Params{"detail": problem})
		}
		// The engine just accepted the roll; a band left out counted none, and no special dice is none.
		row.BandCounts, _ = roll["counts"].(map[string]any)
		if row.BandCounts == nil {
			row.BandCounts = map[string]any{}
		}
		row.SpecialFaces, _ = roll["special"].([]any)
		if row.SpecialFaces == nil {
			row.SpecialFaces = []any{}
		}
		row.Total, row.Outcome, row.Margin, row.Shifts, row.Flags = r.Total, r.Outcome, &r.Margin, &r.Shift, r.Flags
	} else {
		r, problem := ResolveRoll(params, float64(targetNumber), float64(modifier), advantage, roll)
		if problem != "" {
			return cs.Result{}, cs.Fail("testProblem", cs.Params{"detail": problem})
		}
		if faces, isList := roll["faces"].([]any); isList {
			row.Faces = []float64{}
			for _, f := range faces {
				if n, isNumber := f.(float64); isNumber {
					row.Faces = append(row.Faces, n)
				}
			}
		}
		row.Natural, row.Total, row.Outcome = r.Natural, r.Total, r.Outcome
	}
	bandCounts, err := jsonOrNil(row.BandCounts)
	if err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO test_report (call_id, actor_id, advantage, faces, "natural", total, band_counts,
			special_faces, margin, shifts, flags, outcome, reported_by_user_id, reported_by_role, reported_at)
		VALUES ($1, $2, $3, $4::float8[]::integer[], $5::float8::integer, $6::float8::integer, $7, $8::float8[]::integer[],
			$9::float8::integer, $10::float8::integer, $11, $12, $13, $14, $15)
		ON CONFLICT (call_id, actor_id) DO UPDATE SET advantage = excluded.advantage, faces = excluded.faces,
			"natural" = excluded."natural", total = excluded.total, band_counts = excluded.band_counts,
			special_faces = excluded.special_faces, margin = excluded.margin, shifts = excluded.shifts, flags = excluded.flags,
			outcome = excluded.outcome, reported_by_user_id = excluded.reported_by_user_id,
			reported_by_role = excluded.reported_by_role, reported_at = excluded.reported_at`,
		open.id, actorID, row.Advantage, row.Faces, row.Natural, row.Total, bandCounts, numbers(row.SpecialFaces), row.Margin,
		row.Shifts, row.Flags, row.Outcome, row.ReportedByUserID, row.ReportedByRole, row.ReportedAt); err != nil {
		return cs.Result{}, err
	}
	payload := map[string]any{"callId": open.id, "actorId": actorID, "replaced": had}
	fields, err := json.Marshal(row)
	if err != nil {
		return cs.Result{}, err
	}
	if err := json.Unmarshal(fields, &payload); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), logEvent(ctx, tx, c, "test.report", payload)
}

func jsonOrNil(v map[string]any) (any, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// The special dice's faces as numbers for the integer[] column; nil stays NULL.
func numbers(list []any) []float64 {
	if list == nil {
		return nil
	}
	out := make([]float64, len(list))
	for i, v := range list {
		out[i], _ = v.(float64)
	}
	return out
}

func closeCall(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	open, err := openCall(ctx, tx, c.CampaignID, a.Str("callId"))
	if err != nil {
		return cs.Result{}, err
	}
	reveal, _ := a["reveal"].(bool)
	if _, err := tx.Exec(ctx, `UPDATE test_call SET status = 'closed', closed_at = now(), revealed = $1 WHERE id = $2`,
		reveal, open.id); err != nil {
		return cs.Result{}, err
	}
	rows, err := tx.Query(ctx, `SELECT actor_id::text, "natural", total, margin, flags, outcome FROM test_report WHERE call_id = $1`, open.id)
	if err != nil {
		return cs.Result{}, err
	}
	reports, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (map[string]any, error) {
		var actorID, outcome string
		var natural, margin *int32
		var total int32
		var flags []string
		err := r.Scan(&actorID, &natural, &total, &margin, &flags, &outcome)
		if flags == nil {
			flags = []string{}
		}
		return map[string]any{"actorId": actorID, "natural": natural, "total": total, "margin": margin, "flags": flags,
			"outcome": outcome}, err
	})
	if err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), logEvent(ctx, tx, c, "test.close", map[string]any{
		"callId": open.id, "testId": open.testID, "revealed": reveal, "reports": reports,
	})
}
