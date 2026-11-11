package game

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The end of a game (apps/api/src/game/game.actions.ts, house decisions #38-#40). Both actions are the combat side's
// (`encounter:run`); they are logged as events of their own, not as deltas, so Undo never takes them back.

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

func wholes(xs []float64) []int64 {
	out := make([]int64, len(xs))
	for i, x := range xs {
		out[i] = int64(x)
	}
	return out
}

// End is game.end: the server scores every actor of the order, hidden values too (house decision #40), ranks them,
// keeps the rows and closes the encounter.
func End(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	// House decision #28, as encounter.end: nothing ends while the table is away.
	paused, err := ruleset.IsPaused(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if paused {
		return cs.Result{}, cs.Fail("sessionPaused")
	}
	e, err := turn.Active(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if e == nil {
		return cs.Result{}, cs.Fail("noEncounterRunning")
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	scoring := rc.Compiled.Scoring
	if scoring == nil {
		return cs.Result{}, cs.Fail("noScoring")
	}
	t, err := rc.Turn(ctx)
	if err != nil {
		return cs.Result{}, err
	}
	order := []string{}
	if t != nil {
		order = t.Order
	}
	scopes := map[string]*engine.Record{}
	for id, b := range rc.Built {
		scopes[id] = b.Scope
	}
	rows, err := rc.Compiled.ScoreRows(scopes, order)
	var exprErr engine.ExprError
	if errors.As(err, &exprErr) {
		return cs.Result{}, cs.Fail("callProblem", cs.Params{"name": "score", "detail": exprErr.Message})
	}
	if err != nil {
		return cs.Result{}, err
	}
	met := rc.Compiled.EndMet(scopes, order, float64(e.Round))
	ranked := engine.RankResults(scoring.Def, rows, met)
	endedEarly := len(met) == 0
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	for _, r := range ranked {
		name := ""
		if b := rc.Built[r.ActorID]; b != nil {
			name = b.Row.Name
		}
		if _, err := tx.Exec(ctx, `INSERT INTO session_result (campaign_id, session_id, encounter_id, actor_id, name, score,
			tiebreaks, place, outcome, ended_early) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			cid, sessionID, e.ID, r.ActorID, name, int64(r.Score), wholes(r.Tiebreaks), r.Place, r.Outcome, endedEarly); err != nil {
			return cs.Result{}, err
		}
	}
	if err := logEvent(ctx, tx, c, "game.end", map[string]any{"encounterId": e.ID, "endedEarly": endedEarly, "results": ranked}); err != nil {
		return cs.Result{}, err
	}
	id, err := encounter.CloseEncounter(ctx, tx, c, e.ID)
	return cs.Done(id), err
}

// SetResult is result.set: the GM corrects one competing row's score, and the game is ranked again. The id comes from
// the client, so the row must be this campaign's.
func SetResult(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, resultID := c.CampaignID, a.Str("resultId")
	score, _ := a["score"].(float64)
	var encounterID, name string
	var before int32
	var outcome *string
	err := tx.QueryRow(ctx, `SELECT encounter_id::text, name, score, outcome FROM session_result WHERE id = $1 AND campaign_id = $2`,
		resultID, cid).Scan(&encounterID, &name, &before, &outcome)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("resultNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if outcome != nil {
		return cs.Result{}, cs.Fail("coopNoScore")
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil || rules.Scoring == nil {
		return cs.Result{}, cs.Fail("noScoring")
	}
	rows, err := tx.Query(ctx, `SELECT id::text, score, tiebreaks FROM session_result WHERE encounter_id = $1 AND campaign_id = $2`,
		encounterID, cid)
	if err != nil {
		return cs.Result{}, err
	}
	// The row ids stand in for actor ids: a character who is gone has none.
	game, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (engine.ScoreRow, error) {
		var row engine.ScoreRow
		var s int32
		var tiebreaks []int32
		err := r.Scan(&row.ActorID, &s, &tiebreaks)
		row.Score = float64(s)
		if row.ActorID == resultID {
			row.Score = score
		}
		// A row kept under fewer tiebreaks than the ruleset now has compares them as equal.
		row.Tiebreaks = make([]float64, max(len(tiebreaks), len(rules.Scoring.Tiebreaks)))
		for i, t := range tiebreaks {
			row.Tiebreaks[i] = float64(t)
		}
		return row, err
	})
	if err != nil {
		return cs.Result{}, err
	}
	for _, r := range engine.RankResults(rules.Scoring.Def, game, nil) {
		if _, err := tx.Exec(ctx, `UPDATE session_result SET score = $1, place = $2 WHERE id = $3`, int64(r.Score), r.Place, r.ActorID); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(""), logEvent(ctx, tx, c, "result.set", map[string]any{
		"resultId": resultID, "name": name, "before": before, "after": score,
	})
}
