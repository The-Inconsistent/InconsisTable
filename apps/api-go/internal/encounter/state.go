// Package encounter holds the combat tracker. This phase ports the snapshot's read; the actions move in their phase.
package encounter

import (
	"context"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Active is the campaign's running encounter.
type Active struct {
	ID                 string
	Round              int
	CurrentCombatantID *string
	FirstCombatantID   *string
	PhaseID            *string
}

// LoadActive is the running encounter, or nil.
func LoadActive(ctx context.Context, conn core.Conn, campaignID string) (*Active, error) {
	var e Active
	err := conn.QueryRow(ctx, `SELECT id::text, round, current_combatant_id::text, first_combatant_id::text, phase_id
		FROM encounter WHERE campaign_id = $1 AND active`, campaignID).
		Scan(&e.ID, &e.Round, &e.CurrentCombatantID, &e.FirstCombatantID, &e.PhaseID)
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

// Load is the running encounter as the GM sees it, whole: combatants in turn order, each with its health and
// conditions. The Seat view cuts it down for every other seat. paused is whether no session is running.
func Load(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset, built map[string]*actor.Built,
	paused bool) (*cs.Encounter, error) {
	e, err := LoadActive(ctx, conn, campaignID)
	if err != nil || e == nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, `SELECT c.id::text, c.actor_id::text, actor.name, c.side, c.ord, c.initiative_score,
		c.visibility, c.keep, c.done FROM combatant c JOIN actor ON actor.id = c.actor_id
		WHERE c.encounter_id = $1 AND actor.campaign_id = $2 ORDER BY c.ord, c.id`, e.ID, campaignID)
	if err != nil {
		return nil, err
	}
	resource, hasHealth := HealthResource(compiled)
	done := []string{}
	order := []string{}
	combatants, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.Combatant, error) {
		var c cs.Combatant
		var isDone bool
		if err := r.Scan(&c.ID, &c.ActorID, &c.Name, &c.Side, &c.Ord, &c.Initiative, &c.Visibility, &c.Keep, &isDone); err != nil {
			return c, err
		}
		if isDone {
			done = append(done, c.ID)
		}
		order = append(order, c.ActorID)
		b := built[c.ActorID]
		c.HP, c.Bar = healthOf(b, resource, hasHealth)
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
				c.Conditions = append(c.Conditions, cs.CombatantCondition{ID: x.ConditionID, Left: left, ExpiresOn: x.ExpiresOn})
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
	if compiled == nil {
		return out, nil
	}
	r := compiled.Ruleset
	for _, p := range r.Phases {
		out.Phases = append(out.Phases, cs.EncounterPhase{ID: p.ID, Label: p.Label, Mode: p.Mode})
	}
	if r.Initiative.Strategy == "seated" {
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
