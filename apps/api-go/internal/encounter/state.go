// Package encounter holds the combat tracker: the snapshot's read and the encounter, turn and phase actions.
package encounter

import (
	"context"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// Active is the campaign's running encounter.
type Active struct {
	ID                 string
	Round              int
	CurrentCombatantID *string
	FirstCombatantID   *string
	PhaseID            *string
	Begun              bool
	LastSide           *string
	OutOfTurnSide      *string
	// Used is the uses of spends limited per round (house decision #91), each engine.UsedKey.
	Used []string
}

// usedNow is the spend ids an actor used this round, once per use (house decision #91); nil when none.
func usedNow(e *Active, actorID string) []string {
	var out []string
	prefix := strconv.Itoa(e.Round) + ":" + actorID + ":"
	for _, u := range e.Used {
		if id, found := strings.CutPrefix(u, prefix); found {
			out = append(out, id)
		}
	}
	return out
}

// LoadActive is the running encounter, or nil.
func LoadActive(ctx context.Context, conn core.Conn, campaignID string) (*Active, error) {
	var e Active
	err := conn.QueryRow(ctx, `SELECT id::text, round, current_combatant_id::text, first_combatant_id::text, phase_id,
		begun, last_side, out_of_turn_side, used FROM encounter WHERE campaign_id = $1 AND active`, campaignID).
		Scan(&e.ID, &e.Round, &e.CurrentCombatantID, &e.FirstCombatantID, &e.PhaseID, &e.Begun, &e.LastSide, &e.OutOfTurnSide, &e.Used)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// HealthResource is the resource the tracker draws as health: the ruleset's first health track.
func HealthResource(compiled *engine.CompiledRuleset) (string, bool) {
	if compiled == nil || len(compiled.Ruleset.Health.Tracks) == 0 {
		return "", false
	}
	return compiled.Ruleset.Health.Tracks[0].Resource, true
}

// One actor's health as the tracker shows it: the numbers, and the fraction for the bar.
func healthOf(b *actor.Built, resource string, known bool) (*cs.HP, *float64) {
	if !known || b == nil {
		return nil, nil
	}
	value, hasValue := b.Resources[resource]
	bounds, hasBounds := b.Bounds[resource]
	if !hasValue || !hasBounds {
		return nil, nil
	}
	hp := &cs.HP{Value: value, Max: bounds.Max}
	if bounds.Max == nil || *bounds.Max-bounds.Min <= 0 {
		return hp, nil
	}
	bar := math.Min(1, math.Max(0, (value-bounds.Min)/(*bounds.Max-bounds.Min)))
	return hp, &bar
}

// harmOf is a combatant's bar and members under health.harm (house decision #66): a mob's members over their max, or
// for anyone else 1 - wounds / max held to 0..1 (1 with no max).
func harmOf(b *actor.Built, harm *engine.Harm) (*float64, *cs.HP) {
	if b == nil {
		return nil, nil
	}
	if harm.Mob != nil {
		if bounds, carried := b.Bounds[harm.Mob.Members]; carried {
			members := &cs.HP{Value: b.Resources[harm.Mob.Members], Max: bounds.Max}
			if bounds.Max == nil || *bounds.Max <= 0 {
				return nil, members
			}
			bar := math.Min(1, math.Max(0, members.Value / *bounds.Max))
			return &bar, members
		}
	}
	bar := 1.0
	if bounds := b.Bounds[harm.Wounds]; bounds.Max != nil && *bounds.Max > 0 {
		bar = math.Min(1, math.Max(0, 1 - b.Resources[harm.Wounds] / *bounds.Max))
	}
	return &bar, nil
}

// statesOf is the ruleset's health states that hold for the actor, in manifest order; none when they cannot be read.
func statesOf(compiled *engine.CompiledRuleset, b *actor.Built) []cs.CombatantState {
	out := []cs.CombatantState{}
	if compiled == nil || b == nil || b.Scope == nil {
		return out
	}
	held, err := compiled.HealthStatesOf(b.Entity, b.Scope)
	if err != nil {
		return out
	}
	for _, s := range compiled.HealthStates {
		if slices.Contains(held, s.ID) {
			label := s.ID
			if s.Label != nil {
				label = *s.Label
			}
			out = append(out, cs.CombatantState{ID: s.ID, Label: label})
		}
	}
	return out
}

// Load is the running encounter as the GM sees it, whole: combatants in turn order, each with its health and
// conditions. The Seat view cuts it down for every other seat. paused is whether no session is running.
func Load(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset, built map[string]*actor.Built,
	paused bool) (*cs.Encounter, error) {
	e, err := LoadActive(ctx, conn, campaignID)
	if err != nil || e == nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, `SELECT c.id::text, c.actor_id::text, actor.name, c.side, c.ord, c.initiative_score,
		c.visibility, c.keep, c.done, c.held, c.barred, c.marker FROM combatant c JOIN actor ON actor.id = c.actor_id
		WHERE c.encounter_id = $1 AND actor.campaign_id = $2 ORDER BY c.ord, c.id`, e.ID, campaignID)
	if err != nil {
		return nil, err
	}
	resource, hasHealth := HealthResource(compiled)
	done := []string{}
	order := []string{}
	sideOf, held, barred := map[string]string{}, []string{}, []string{}
	combatants, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.Combatant, error) {
		var c cs.Combatant
		var isDone, isHeld, isBarred bool
		var marker *string
		if err := r.Scan(&c.ID, &c.ActorID, &c.Name, &c.Side, &c.Ord, &c.Initiative, &c.Visibility, &c.Keep, &isDone, &isHeld, &isBarred, &marker); err != nil {
			return c, err
		}
		if marker != nil {
			c.Marker = *marker
		}
		sideOf[c.ActorID] = c.Side
		if isHeld {
			held = append(held, c.ActorID)
		}
		if isBarred {
			barred = append(barred, c.ActorID)
		}
		if isDone {
			done = append(done, c.ID)
		}
		order = append(order, c.ActorID)
		b := built[c.ActorID]
		c.HP, c.Bar = healthOf(b, resource, hasHealth)
		// A ruleset with both reads its health track (house decision #66).
		if compiled != nil && compiled.Ruleset.Health.Harm != nil && !hasHealth {
			c.Bar, c.Members = harmOf(b, compiled.Ruleset.Health.Harm)
		}
		c.States = statesOf(compiled, b)
		c.Used = usedNow(e, c.ActorID)
		c.Conditions = []cs.CombatantCondition{}
		if b != nil {
			for _, x := range b.Conditions {
				var left *int
				if x.ExpiresOn == "ownTurnEnd" || x.ExpiresOn == "roundEnd" {
					n := 1
					if x.ExpiresAfter != nil {
						n = int(*x.ExpiresAfter)
					}
					left = &n
				}
				stacks := 0
				if x.Stacks > 1 {
					stacks = int(x.Stacks)
				}
				c.Conditions = append(c.Conditions, cs.CombatantCondition{ID: x.ConditionID, Left: left, ExpiresOn: x.ExpiresOn, Stacks: stacks})
			}
		}
		return c, nil
	})
	if err != nil {
		return nil, err
	}
	if combatants == nil {
		combatants = []cs.Combatant{}
	}
	out := &cs.Encounter{
		ID: e.ID, Round: e.Round, CurrentID: e.CurrentCombatantID, FirstID: e.FirstCombatantID, PhaseID: e.PhaseID,
		Phases: []cs.EncounterPhase{}, Done: done, Paused: paused, ConditionDefs: []cs.ConditionDef{}, EndMet: []int{},
		Combatants: combatants,
	}
	if out.TurnBack, err = turnBackOf(ctx, conn, campaignID, built); err != nil {
		return nil, err
	}
	if compiled == nil {
		return out, nil
	}
	r := compiled.Ruleset
	acting := (*string)(nil)
	for _, c := range combatants {
		if e.CurrentCombatantID != nil && c.ID == *e.CurrentCombatantID {
			acting = &c.ActorID
		}
	}
	// The round ends after this turn: in a ranked or seated order, whoever acts is the last of it.
	// ponytail: a round of phases ends after its last phase, not its last seat; ask the phases once a ruleset needs it.
	roundEnding := acting != nil && len(order) > 0 && order[len(order)-1] == *acting
	if r.Initiative != nil && r.Initiative.Strategy == "sides" {
		roundEnding = sidesOf(out, e, compiled, built, sideOf, held, barred)
	}
	out.Reminders = remindersNow(compiled, built, remindersAsk{
		acting: acting, roundEnding: roundEnding, order: order, held: held, barred: barred, round: e.Round,
	})
	for _, p := range r.Phases {
		out.Phases = append(out.Phases, cs.EncounterPhase{ID: p.ID, Label: p.Label, Mode: p.Mode})
	}
	if r.Initiative != nil && r.Initiative.Strategy == "seated" {
		out.FirstPlayer = &r.Initiative.FirstPlayer
	}
	if hasHealth {
		track := r.Health.Tracks[0]
		out.Health = &cs.EncounterHealth{Resource: resource, Temp: track.Temp, DeathSaves: len(track.DeathSaves) > 0 && string(track.DeathSaves) != "null"}
	}
	// Told to every seat, even when a trigger reads a hidden value (house decision #38).
	scopes := map[string]*engine.Record{}
	for id, b := range built {
		scopes[id] = b.Scope
	}
	out.EndMet = compiled.EndMet(scopes, order, float64(e.Round))
	if compiled.Scoring != nil {
		out.Scoring = &cs.ScoringMode{Mode: compiled.Scoring.Def.Mode}
	}
	// The ruleset's conditions in manifest order, as TypeScript's Object.entries over the compiled record reads them.
	for _, c := range r.Conditions {
		out.ConditionDefs = append(out.ConditionDefs, cs.ConditionDef{ID: c.ID, Label: c.Label, Duration: c.Duration})
	}
	return out, nil
}

// turnBackOf is what TURN BACK would take back now (house decision #82), worded for the tracker's button; nil with no
// session running or no turn step in its log of this fight.
func turnBackOf(ctx context.Context, conn core.Conn, campaignID string, built map[string]*actor.Built) (*cs.EncounterTurnBack, error) {
	sessionID, err := eventlog.RunningSessionID(ctx, conn, campaignID)
	if err != nil || sessionID == nil {
		return nil, err
	}
	step, err := eventlog.LastTurnStep(ctx, conn, campaignID, *sessionID)
	if err != nil || step == nil {
		return nil, err
	}
	out := &cs.EncounterTurnBack{Kind: step.Kind, Round: step.Round, Later: len(step.Actions) - 1}
	if step.Holder != nil && built[*step.Holder] != nil {
		out.Name = built[*step.Holder].Row.Name
	}
	return out, nil
}

// remindersAsk is the moment the reminders are asked about: who acts (nil between turns), whether the round ends
// after this turn (or has ended, waiting for the next), and every combatant's flags.
type remindersAsk struct {
	acting       *string
	roundEnding  bool
	order        []string
	held, barred []string
	round        int
}

// remindersNow is the reminder lines due now (house decision #81): a turn's start and end lines for whoever acts, and
// the round's end lines, asked of every combatant, while the round is ending. Nil when none is due.
func remindersNow(rules *engine.CompiledRuleset, built map[string]*actor.Built, ask remindersAsk) []cs.EncounterReminder {
	actors := map[string]engine.ReminderActor{}
	for _, id := range ask.order {
		b := built[id]
		if b == nil {
			continue
		}
		held := []string{}
		for _, x := range b.Conditions {
			held = append(held, x.ConditionID)
		}
		actors[id] = engine.ReminderActor{Scope: b.Scope, Conditions: held, Held: slices.Contains(ask.held, id),
			Barred: slices.Contains(ask.barred, id)}
	}
	var out []cs.EncounterReminder
	add := func(at string, order []string) {
		for _, l := range rules.RemindersOf(at, actors, order, float64(ask.round)) {
			out = append(out, cs.EncounterReminder{At: at, Source: l.Source, ID: l.ID, Text: l.Text, Cite: l.Cite, ActorIDs: l.ActorIDs})
		}
	}
	if ask.acting != nil {
		add("turnStart", []string{*ask.acting})
		add("turnEnd", []string{*ask.acting})
	}
	if ask.roundEnding {
		add("roundEnd", ask.order)
	}
	return out
}

// sidesOf adds a sides order's part to the encounter and to each combatant (house decision #60). `sideUp` is the
// primitive's own, read from the turn as it stands. It says whether the round ends once whoever acts is done: the fight
// has begun and nobody would be pending.
func sidesOf(out *cs.Encounter, e *Active, rules *engine.CompiledRuleset, built map[string]*actor.Built, sideOf map[string]string, held, barred []string) bool {
	order := make([]string, len(out.Combatants))
	for i, c := range out.Combatants {
		order[i] = c.ActorID
	}
	unable := ruleset.Unable(rules, built, order)
	acting := (*string)(nil)
	done := []string{}
	for _, c := range out.Combatants {
		if e.CurrentCombatantID != nil && c.ID == *e.CurrentCombatantID {
			acting = &c.ActorID
		}
		if slices.Contains(out.Done, c.ID) {
			done = append(done, c.ActorID)
		}
	}
	t := &engine.TurnState{
		Round: float64(e.Round), CurrentID: acting, Order: order, Done: done, SideOf: sideOf, Begun: &e.Begun,
		LastSide: e.LastSide, OutOfTurnSide: e.OutOfTurnSide, Held: held, Barred: barred, Unable: unable,
	}
	up := (*string)(nil)
	if side, ok := engine.SideUp(rules.Ruleset.Normalized["initiative"], t); ok {
		up = &side
	}
	out.EncounterSides = &cs.EncounterSides{Begun: e.Begun, LastSide: e.LastSide, OutOfTurnSide: e.OutOfTurnSide, SideUp: up}
	for i, c := range out.Combatants {
		out.Combatants[i].CombatantSides = &cs.CombatantSides{
			Held: slices.Contains(held, c.ActorID), Barred: slices.Contains(barred, c.ActorID), Unable: slices.Contains(unable, c.ActorID),
		}
	}
	after := *t
	after.CurrentID, after.Done = nil, done
	if acting != nil {
		after.Done = append(slices.Clone(done), *acting)
	}
	_, pending := engine.SideUp(rules.Ruleset.Normalized["initiative"], &after)
	return e.Begun && !pending
}
