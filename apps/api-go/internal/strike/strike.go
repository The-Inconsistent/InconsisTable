// Package strike is strike.apply (house decision #99): a strike's typed total, worked out again on the server with the
// engine's PlanStrike, lands through health.harm's hit as one logged action. The app never rolls and never decides a
// hit: the table types the total, and the ruleset's outcomes say what it does. A client cannot apply harm the strike
// does not give, since it sends the total, never the harm.
package strike

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// Apply is strike.apply. Both sides are combatants of the running fight; the means is one the attacker has now; the
// total is read by the strike's outcomes; the hit is health.harm's, refused as it refuses. The strike itself is logged
// beside the hit's writes (a `strike` event under the same action), so the fight's log can say who struck whom with
// what; Undo and TURN BACK take back the writes, which the log then shows as taken back.
func Apply(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	strikeID := a.Str("strikeId")
	s, _ := rc.Compiled.Ruleset.StrikeOf(strikeID)
	if s == nil {
		return cs.Result{}, cs.Fail("noSuchStrike", cs.Params{"strike": strikeID})
	}
	attackerID, targetID := a.Str("attackerId"), a.Str("targetId")
	// The side that runs the fight applies any strike; the seat that holds the attacker only its own (house decision
	// #113), whose writes the server's plan decides, so they are not asked of the seat's editableBy.
	byOwner := false
	if refused := cs.RequirePerm(c, "encounter:run", ""); refused != nil {
		if err := ownerMay(ctx, tx, c, s, refused, attackerID, targetID); err != nil {
			return cs.Result{}, err
		}
		byOwner = true
	}
	if err := inFight(ctx, tx, c.CampaignID, attackerID, targetID); err != nil {
		return cs.Result{}, err
	}
	var used []string
	if s.Limit != nil {
		t, err := rc.Turn(ctx)
		if err != nil {
			return cs.Result{}, err
		}
		var ts *engine.TurnState
		if t != nil {
			ts = &t.TurnState
		}
		var refusal *engine.Refusal
		if used, refusal = engine.RoundUse(ts, attackerID, "strike:"+strikeID, s.Label, s.Limit.Max); refusal != nil {
			return cs.Result{}, cs.Fail(refusal.Code, cs.Params{"detail": refusal.Message})
		}
	}
	attacker, err := side(rc, attackerID)
	if err != nil {
		return cs.Result{}, err
	}
	target, err := side(rc, targetID)
	if err != nil {
		return cs.Result{}, err
	}
	pick, _ := a["means"].(map[string]any)
	means, meansName, err := meansOf(ctx, tx, c.CampaignID, s, attacker, pick)
	if err != nil {
		return cs.Result{}, err
	}
	inputs, _ := a["inputs"].(map[string]any)
	total, _ := a["total"].(float64)
	plan, refused := rc.Compiled.PlanStrike(strikeID,
		engine.StrikeSide{Entity: attacker.Entity, Scope: attacker.Scope},
		engine.StrikeSide{Entity: target.Entity, Scope: target.Scope}, means, inputs, &total)
	if refused != nil {
		if refused.Code == "noSuchStrike" {
			return cs.Result{}, cs.Fail("noSuchStrike", cs.Params{"strike": strikeID})
		}
		return cs.Result{}, cs.Fail(refused.Code, cs.Params{"detail": refused.Message})
	}
	if plan.Harm == nil {
		return cs.Result{}, cs.Fail("strikeNoHarm")
	}
	input := map[string]any{"actorId": targetID}
	if plan.Harm.Wounds != 0 {
		input["wounds"] = plan.Harm.Wounds
	}
	if plan.Harm.Shock != 0 {
		input["shock"] = plan.Harm.Shock
	}
	deltas, err := rc.Run(ctx, ruleset.Run{Primitive: "health.harm", Op: "hit", Input: input})
	if err != nil {
		return cs.Result{}, err
	}
	// A strike limited per round records its use in the turn (house decision #91), so Undo and TURN BACK return it.
	if used != nil {
		deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{Turn: turn.Used}, Kind: "set", Value: used})
	}
	actionID := core.NewUUID()
	id, err := actor.ApplyDeltas(ctx, tx, actor.Apply{Ctx: c, Compiled: rc.Compiled, Built: rc.Built, Deltas: deltas,
		Pools: rc.Pools, ActionID: actionID, Trusted: byOwner})
	if err != nil || id == "" {
		return cs.Result{OK: true, ID: id}, err
	}
	payload := map[string]any{"strikeId": strikeID, "attackerId": attackerID, "targetId": targetID, "means": meansName,
		"total": total, "outcome": plan.Outcome.ID, "wounds": plan.Harm.Wounds, "shock": plan.Harm.Shock}
	if err := logStrike(ctx, tx, c, actionID, payload); err != nil {
		return cs.Result{}, err
	}
	return cs.Result{OK: true, ID: id}, nil
}

// ownerMay is the owner's path (house decision #113) for a seat without encounter:run: the seat holds the attacker,
// the strike lets its owner send it, the attacker is the combatant acting now (in a sides order, the member acting),
// a session runs, and the target is shown in full. Everything is read from the room as it stands, never the client.
func ownerMay(ctx context.Context, tx core.Conn, c cs.Ctx, s *engine.Strike, refused *cs.Error, attackerID, targetID string) error {
	if !cs.CanInCampaign(c, "character:edit:own", attackerID) {
		if refused.Code == "screenReadOnly" {
			return refused
		}
		return cs.Fail("notYourCharacter")
	}
	if !s.ByOwner {
		return cs.Fail("strikeNotByOwner")
	}
	var acting, shown *string
	err := tx.QueryRow(ctx, `SELECT cur.actor_id::text, t.visibility FROM encounter e
		LEFT JOIN combatant cur ON cur.id = e.current_combatant_id AND cur.encounter_id = e.id
		LEFT JOIN combatant t ON t.encounter_id = e.id AND t.actor_id = $2
		WHERE e.campaign_id = $1 AND e.active`, c.CampaignID, targetID).Scan(&acting, &shown)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Fail("strikeNotInFight")
	}
	if err != nil {
		return err
	}
	if acting == nil || *acting != attackerID {
		return cs.Fail("strikeNotYourTurn")
	}
	session, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return err
	}
	if session == nil {
		return cs.Fail("sessionPaused")
	}
	if shown == nil {
		return cs.Fail("strikeNotInFight")
	}
	if *shown != "full" {
		return cs.Fail("strikeTargetHidden")
	}
	return nil
}

// inFight refuses a side that is not a combatant of the room's running fight.
func inFight(ctx context.Context, tx core.Conn, campaignID string, ids ...string) error {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var found int
	err := tx.QueryRow(ctx, `SELECT count(DISTINCT c.actor_id) FROM combatant c JOIN encounter e ON e.id = c.encounter_id
		WHERE e.campaign_id = $1 AND e.active AND c.actor_id = ANY($2::uuid[])`, campaignID, ids).Scan(&found)
	if err != nil {
		return err
	}
	if found != len(want) {
		return cs.Fail("strikeNotInFight")
	}
	return nil
}

// side is one side of the strike as the rules read it, or why it cannot be read (randomtable's lookupTarget's refusals).
func side(rc *ruleset.Context, id string) (*actor.Built, error) {
	b := rc.Built[id]
	switch {
	case b == nil:
		return nil, cs.Fail("characterNotFound")
	case b.Entity == "":
		return nil, cs.Fail("notBuilt", cs.Params{"name": b.Row.Name})
	case b.Scope == nil:
		return nil, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
	}
	return b, nil
}

// meansOf is the picked means as it stands, and its name for the log: a line of the attacker's saved sheet, a pack
// entry the room is served whose key the attacker's list field holds, or an item of the kind the attacker holds whose
// entry the room is served (a hand-written item has no values to strike with). Nil for none picked; the engine refuses
// a means the strike does not take, or a missing one it needs.
func meansOf(ctx context.Context, tx core.Conn, campaignID string, s *engine.Strike, b *actor.Built, pick map[string]any) (map[string]any, *string, error) {
	if pick == nil {
		return nil, nil, nil
	}
	source, _ := pick["source"].(float64)
	ref, _ := pick["ref"].(string)
	if s.Means == nil {
		return map[string]any{}, nil, nil // the engine refuses it: this strike takes no means
	}
	missing := cs.Fail("noSuchMeans", cs.Params{"name": b.Row.Name})
	if int(source) >= len(s.Means) {
		return nil, nil, missing
	}
	m := s.Means[int(source)]
	if m.From == "ledger" {
		var text string
		err := tx.QueryRow(ctx, `SELECT sheet::text FROM actor_build JOIN actor ON actor.id = actor_build.actor_id
			WHERE actor_build.actor_id = $1 AND actor.campaign_id = $2 AND sheet IS NOT NULL`, b.Row.ID, campaignID).Scan(&text)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, missing
		}
		if err != nil {
			return nil, nil, err
		}
		var sheet map[string]any
		if err := json.Unmarshal([]byte(text), &sheet); err != nil {
			return nil, nil, err
		}
		lines, _ := sheet[m.Lines].([]any)
		i, err := strconv.Atoi(ref)
		if err != nil || i < 0 || i >= len(lines) {
			return nil, nil, missing
		}
		line, _ := lines[i].(map[string]any)
		if line == nil {
			return nil, nil, missing
		}
		name, _ := line["name"].(string)
		return line, &name, nil
	}
	entryType, key := m.Entry, ref
	if m.From == "items" {
		i := slices.IndexFunc(b.Items, func(x actor.ItemRow) bool { return x.ID == ref && x.Kind == m.Kind && x.Served })
		if i < 0 {
			return nil, nil, missing
		}
		entryType, key = *b.Items[i].EntryType, *b.Items[i].EntryKey
	} else {
		keys, _ := b.Fields[m.Field].([]any)
		if !slices.Contains(keys, any(ref)) {
			return nil, nil, missing
		}
	}
	var name string
	var body []byte
	err := tx.QueryRow(ctx, `SELECT e.name, e.body FROM campaign_pack
		JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id
		JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE campaign_pack.campaign_id = $1 AND e.type = $2 AND e.key = $3 AND `+actor.ServedPacks("$1")+`
		ORDER BY pack.slug LIMIT 1`, campaignID, entryType, key).Scan(&name, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, missing
	}
	if err != nil {
		return nil, nil, err
	}
	values := map[string]any{}
	if err := json.Unmarshal(body, &values); err != nil {
		return nil, nil, err
	}
	return values, &name, nil
}

// logStrike writes the strike as an event of its own beside the hit's writes, under the same action: not a delta, so
// Undo never reads it, and the fight's log reads it as taken back once that action's writes are.
func logStrike(ctx context.Context, tx core.Conn, c cs.Ctx, actionID string, payload map[string]any) error {
	sessionID, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO session_event (campaign_id, session_id, type, action_id, seat_user_id, payload)
		VALUES ($1, $2, 'strike', $3, $4, $5)`, c.CampaignID, sessionID, actionID, c.UserID, body)
	return err
}
