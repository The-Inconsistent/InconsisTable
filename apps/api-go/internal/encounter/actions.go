package encounter

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The combat tracker (apps/api/src/encounter/encounter.actions.ts, docs/p1-plan.md F). Every action here is the combat
// side's (`encounter:run`). A turn change runs the engine and writes its deltas through the same pipeline as any rule,
// so the log and Undo cover it.

func running(ctx context.Context, conn core.Conn, campaignID string) (*turn.Encounter, error) {
	e, err := turn.Active(ctx, conn, campaignID)
	if err == nil && e == nil {
		return nil, cs.Fail("noEncounterRunning")
	}
	return e, err
}

// The room's ruleset runs a seated order (house decision #36): no scores, a first player.
func isSeated(ctx context.Context, conn core.Conn, campaignID string) (bool, error) {
	rules, err := compiled.Load(ctx, conn, campaignID)
	return rules != nil && rules.Ruleset.Initiative != nil && rules.Ruleset.Initiative.Strategy == "seated", err
}

// CloseEncounter ends an encounter (house decision #26), as `encounter.end` and `game.end` both do: expiry, then the
// rest, as one logged action (#15) for everyone who stays; then each temporary creature not marked `keep` is deleted.
// It returns the logged action id ("" when nothing changed). The caller has checked that a session runs.
func CloseEncounter(ctx context.Context, tx core.Conn, c cs.Ctx, encounterID string) (string, error) {
	rows, err := tx.Query(ctx, `SELECT c.actor_id::text FROM combatant c JOIN actor a ON a.id = c.actor_id
		WHERE c.encounter_id = $1 AND a.kind = 'creature' AND a.temporary AND NOT c.keep`, encounterID)
	if err != nil {
		return "", err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	doomed := map[string]bool{}
	for _, id := range ids {
		doomed[id] = true
	}
	// The creatures about to be deleted have nothing to restore.
	actionID := ""
	rc, err := ruleset.OpenIfPinned(ctx, tx, c)
	if err != nil {
		return "", err
	}
	if rc != nil {
		expired, err := rc.Run(ctx, ruleset.Run{Primitive: "conditions.expire", Op: "encounterEnd", Input: map[string]any{}, Exclude: doomed})
		if err != nil {
			return "", err
		}
		rested, err := rc.Run(ctx, ruleset.Run{Primitive: "rest", Op: "apply", Input: map[string]any{"event": "encounterEnd"}, Exclude: doomed})
		if err != nil {
			return "", err
		}
		if actionID, err = rc.ApplyRuled(ctx, slices.Concat(expired, rested)); err != nil {
			return "", err
		}
	}
	var round int
	if err := tx.QueryRow(ctx, `UPDATE encounter SET active = false, current_combatant_id = NULL, first_combatant_id = NULL
		WHERE id = $1 RETURNING round`, encounterID).Scan(&round); err != nil {
		return "", err
	}
	if err := eventlog.LogEvent(ctx, tx, c, "encounter.end", map[string]any{"encounterId": encounterID, "round": round}); err != nil {
		return "", err
	}
	// ponytail: these deletes can't be undone (house decision #26); undo skips their steps like any deleted actor
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[])`, c.CampaignID, ids); err != nil {
			return "", err
		}
	}
	return actionID, nil
}

func idList(v any) []string {
	out := []string{}
	if list, ok := v.([]any); ok {
		for _, item := range list {
			if s, isText := item.(string); isText {
				out = append(out, s)
			}
		}
	}
	return out
}

// Action runs one encounter.*, turn.* or phase.done action.
func Action(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	// House decision #28: an encounter may stay open across sessions, but nothing moves until the next one starts.
	if a.Type() != "encounter.start" {
		paused, err := ruleset.IsPaused(ctx, tx, cid)
		if err != nil {
			return cs.Result{}, err
		}
		if paused {
			return cs.Result{}, cs.Fail("sessionPaused")
		}
	}
	switch a.Type() {
	case "encounter.start":
		return start(ctx, tx, c)
	case "encounter.end":
		e, err := running(ctx, tx, cid)
		if err != nil {
			return cs.Result{}, err
		}
		id, err := CloseEncounter(ctx, tx, c, e.ID)
		return cs.Done(id), err
	case "encounter.add":
		return add(ctx, tx, cid, a)
	case "encounter.remove":
		return remove(ctx, tx, c, a.Str("combatantId"))
	case "encounter.setInitiative":
		return setInitiative(ctx, tx, cid, a)
	case "encounter.move":
		encounterID, err := ownCombatant(ctx, tx, cid, a.Str("combatantId"))
		if err != nil {
			return cs.Result{}, err
		}
		rows, err := ordered(ctx, tx, encounterID)
		if err != nil {
			return cs.Result{}, err
		}
		ids, err := MovedIDs(rows, a.Str("combatantId"), a.Str("direction"))
		if err != nil {
			return cs.Result{}, err
		}
		return cs.Done(""), renumber(ctx, tx, ids)
	case "encounter.setVisibility":
		return setColumn(ctx, tx, cid, a.Str("combatantId"), `UPDATE combatant SET visibility = $1 WHERE id = $2`, a["visibility"])
	case "encounter.keep":
		return setColumn(ctx, tx, cid, a.Str("combatantId"), `UPDATE combatant SET keep = $1 WHERE id = $2`, a["keep"])
	// A marker is a combatant's fight setting, like its view: set or cleared, not logged (house decision #92).
	case "encounter.mark":
		return setColumn(ctx, tx, cid, a.Str("combatantId"), `UPDATE combatant SET marker = $1 WHERE id = $2`, a["marker"])
	case "turn.next", "turn.prev", "phase.done":
		return turnStep(ctx, tx, c, a)
	case "turn.first":
		return first(ctx, tx, c, a.Str("combatantId"))
	}
	return cs.Result{}, cs.Fail("serverError")
}

func start(ctx context.Context, tx core.Conn, c cs.Ctx) (cs.Result, error) {
	cid := c.CampaignID
	sessionID, err := eventlog.RunningSessionID(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if sessionID == nil {
		return cs.Result{}, cs.Fail("startSessionFirst")
	}
	if e, err := turn.Active(ctx, tx, cid); err != nil || e != nil {
		if err == nil {
			err = cs.Fail("encounterRunning")
		}
		return cs.Result{}, err
	}
	// A ruleset with phases opens the game in its first one (house decision #37).
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules != nil && rules.Ruleset.Initiative == nil {
		return cs.Result{}, cs.Fail("noTurnOrder")
	}
	var phaseID *string
	if rules != nil && len(rules.Ruleset.Phases) > 0 {
		phaseID = &rules.Ruleset.Phases[0].ID
	}
	// A sides order with a setup opens not begun (house decision #60); the round is still 1.
	begun := !(rules != nil && rules.Ruleset.Initiative.Strategy == "sides" && rules.Ruleset.Initiative.Setup != nil)
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO encounter (campaign_id, session_id, phase_id, begun) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		cid, *sessionID, phaseID, begun).Scan(&id)
	if err != nil {
		return cs.Result{}, err
	}
	return cs.Done(id), eventlog.LogEvent(ctx, tx, c, "encounter.start", map[string]any{"encounterId": id})
}

func add(ctx context.Context, tx core.Conn, cid string, a cs.Action) (cs.Result, error) {
	e, err := running(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if err := AddCombatants(ctx, tx, cid, e.ID, idList(a["actorIds"]), a.Str("side"), a.Str("visibility")); err != nil {
		return cs.Result{}, err
	}
	// A seated game has a first player from the first seat on; the table's seat order is `ord`.
	seated, err := isSeated(ctx, tx, cid)
	if err != nil || e.FirstCombatantID != nil || !seated {
		return cs.Done(""), err
	}
	rows, err := ordered(ctx, tx, e.ID)
	if err != nil {
		return cs.Result{}, err
	}
	var top *string
	if len(rows) > 0 {
		top = &rows[0].ID
	}
	_, err = tx.Exec(ctx, `UPDATE encounter SET first_combatant_id = $1 WHERE id = $2`, top, e.ID)
	return cs.Done(""), err
}

func remove(ctx context.Context, tx core.Conn, c cs.Ctx, combatantID string) (cs.Result, error) {
	cid := c.CampaignID
	encounterID, err := ownCombatant(ctx, tx, cid, combatantID)
	if err != nil {
		return cs.Result{}, err
	}
	e, err := running(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	rows, err := ordered(ctx, tx, encounterID)
	if err != nil {
		return cs.Result{}, err
	}
	at := slices.IndexFunc(rows, func(r Ranked) bool { return r.ID == combatantID })
	acting := e.CurrentCombatantID != nil && *e.CurrentCombatantID == combatantID
	strategy, err := strategyOf(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if strategy == "seated" {
		if err := removeSeated(ctx, tx, c, rows, at, acting); err != nil {
			return cs.Result{}, err
		}
	} else if strategy == "sides" && acting {
		// House decision #60: the turn ends with nobody acting; it does not pass to the next row.
		if _, err := tx.Exec(ctx, `UPDATE encounter SET current_combatant_id = NULL WHERE id = $1`, e.ID); err != nil {
			return cs.Result{}, err
		}
	} else if strategy != "sides" && acting {
		// The one whose turn it is leaves: the turn passes to whoever follows, or to nobody when they were last.
		var following *string
		if at+1 < len(rows) {
			following = &rows[at+1].ID
		}
		if _, err := tx.Exec(ctx, `UPDATE encounter SET current_combatant_id = $1 WHERE id = $2`, following, e.ID); err != nil {
			return cs.Result{}, err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM combatant WHERE id = $1`, combatantID); err != nil {
		return cs.Result{}, err
	}
	left := []string{}
	for _, r := range rows {
		if r.ID != combatantID {
			left = append(left, r.ID)
		}
	}
	return cs.Done(""), renumber(ctx, tx, left)
}

// Seated: the engine moves the first player and the turn (#36, #3); the order itself is the tracker's.
func removeSeated(ctx context.Context, tx core.Conn, c cs.Ctx, rows []Ranked, at int, acting bool) error {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return err
	}
	if at < 0 {
		return cs.Fail("notInFight")
	}
	// With phases, the one acting leaves as if their turn ended, so the phase or round moves on as #37 says.
	after := rc
	if len(rc.Compiled.Ruleset.Phases) > 0 && acting && len(rows) > 1 {
		if err := step(ctx, rc, func(state *engine.RuleState, t *turn.Turn) ([]engine.Delta, error) {
			return PlanNext(rc.Compiled.Ruleset, state, t)
		}); err != nil {
			return err
		}
		if after, err = ruleset.Open(ctx, tx, c); err != nil { // the context holds the turn it first read
			return err
		}
	}
	deltas, err := after.Run(ctx, ruleset.Run{Primitive: "initiative.seated", Op: "remove", Input: map[string]any{"id": rows[at].ActorID}})
	if err != nil {
		return err
	}
	for _, d := range deltas {
		if d.Target.Turn != "" && d.Target.Turn != turn.Order {
			if _, _, err := turn.Write(ctx, tx, c.CampaignID, d.Target.Turn, actor.JSONValue(d.Value)); err != nil {
				return err
			}
		}
	}
	return nil
}

func setInitiative(ctx context.Context, tx core.Conn, cid string, a cs.Action) (cs.Result, error) {
	seated, err := isSeated(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if seated {
		return cs.Result{}, cs.Fail("noSeatedScores")
	}
	encounterID, err := ownCombatant(ctx, tx, cid, a.Str("combatantId"))
	if err != nil {
		return cs.Result{}, err
	}
	var score *int64
	if n, isNumber := a["score"].(float64); isNumber {
		whole := int64(n)
		score = &whole
	}
	if _, err := tx.Exec(ctx, `UPDATE combatant SET initiative_score = $1 WHERE id = $2`, score, a.Str("combatantId")); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), rerank(ctx, tx, encounterID)
}

func setColumn(ctx context.Context, tx core.Conn, cid, combatantID, sql string, value any) (cs.Result, error) {
	if _, err := ownCombatant(ctx, tx, cid, combatantID); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, sql, value, combatantID)
	return cs.Done(""), err
}

// stepID plans one turn change against the context's turn and applies it, returning the logged action id.
func stepID(ctx context.Context, rc *ruleset.Context, plan func(*engine.RuleState, *turn.Turn) ([]engine.Delta, error)) (string, error) {
	t, err := rc.Turn(ctx)
	if err != nil {
		return "", err
	}
	if t == nil {
		return "", cs.Fail("noEncounterRunning")
	}
	deltas, err := plan(rc.State(nil, &t.TurnState), t)
	if err != nil {
		return "", err
	}
	return rc.Apply(ctx, deltas)
}

func step(ctx context.Context, rc *ruleset.Context, plan func(*engine.RuleState, *turn.Turn) ([]engine.Delta, error)) error {
	_, err := stepID(ctx, rc, plan)
	return err
}

func turnStep(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	r := rc.Compiled.Ruleset
	id, err := stepID(ctx, rc, func(state *engine.RuleState, t *turn.Turn) ([]engine.Delta, error) {
		switch a.Type() {
		case "turn.next":
			return PlanNext(r, state, t)
		case "turn.prev":
			return PlanPrev(r, t)
		}
		return PlanDone(r, state, t, a.Str("actorId"))
	})
	return cs.Done(id), err
}

func first(ctx context.Context, tx core.Conn, c cs.Ctx, combatantID string) (cs.Result, error) {
	encounterID, err := ownCombatant(ctx, tx, c.CampaignID, combatantID)
	if err != nil {
		return cs.Result{}, err
	}
	seated, err := isSeated(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	if !seated {
		return cs.Result{}, cs.Fail("notSeated")
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	rows, err := ordered(ctx, tx, encounterID)
	if err != nil {
		return cs.Result{}, err
	}
	at := slices.IndexFunc(rows, func(r Ranked) bool { return r.ID == combatantID })
	if at < 0 {
		return cs.Result{}, cs.Fail("notInFight")
	}
	deltas, err := rc.Run(ctx, ruleset.Run{Primitive: "initiative.seated", Op: "first", Input: map[string]any{"id": rows[at].ActorID}})
	if err != nil {
		return cs.Result{}, err
	}
	id, err := rc.Apply(ctx, deltas)
	return cs.Done(id), err
}
