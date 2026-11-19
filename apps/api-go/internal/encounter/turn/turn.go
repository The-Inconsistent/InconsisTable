// Package turn is the running encounter's turn as the engine reads it, and the one place a `turn` delta is written
// (apps/api/src/encounter/encounter.turn.ts). Combatants are named by their actor id in the engine's state: an actor is in
// an encounter once.
//
// It sits below the encounter package, not in it: the delta pipeline and the ruleset context write turns, and the
// encounter actions call both, so the turn primitives can't share a package with those actions without an import cycle.
package turn

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// Encounter is the campaign's running encounter row.
type Encounter struct {
	ID                 string
	Round              int
	CurrentCombatantID *string
	FirstCombatantID   *string
	PhaseID            *string
	// Begun is false only for a sides fight with a setup that has not begun (house decision #57).
	Begun         bool
	LastSide      *string
	OutOfTurnSide *string
}

// Combatant is one combatant row, as the turn reads it.
type Combatant struct {
	ID      string
	ActorID string
	Side    string
	Done    bool
	Held    bool
	Barred  bool
}

func (c Combatant) flag(key string) bool {
	switch key {
	case Held:
		return c.Held
	case Barred:
		return c.Barred
	}
	return c.Done
}

// Active is the campaign's running encounter, or nil.
func Active(ctx context.Context, conn core.Conn, campaignID string) (*Encounter, error) {
	var e Encounter
	err := conn.QueryRow(ctx, `SELECT id::text, round, current_combatant_id::text, first_combatant_id::text, phase_id,
		begun, last_side, out_of_turn_side FROM encounter WHERE campaign_id = $1 AND active`, campaignID).
		Scan(&e.ID, &e.Round, &e.CurrentCombatantID, &e.FirstCombatantID, &e.PhaseID, &e.Begun, &e.LastSide, &e.OutOfTurnSide)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// Ordered is the combatants of one encounter in turn order.
func Ordered(ctx context.Context, conn core.Conn, encounterID string) ([]Combatant, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, actor_id::text, side, done, held, barred FROM combatant
		WHERE encounter_id = $1 ORDER BY ord, id`, encounterID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Combatant, error) {
		var c Combatant
		return c, r.Scan(&c.ID, &c.ActorID, &c.Side, &c.Done, &c.Held, &c.Barred)
	})
}

// Turn is what the ops read (round, whose turn, the order, all as actor ids), plus the phase and who marked it done.
// The state's Unable is not loaded here: it takes the built actors, which this package sits below (ruleset.Unable).
type Turn struct {
	engine.TurnState
	PhaseID *string
	Done    []string
}

func actorOf(rows []Combatant, combatantID *string) *string {
	if combatantID == nil {
		return nil
	}
	for _, c := range rows {
		if c.ID == *combatantID {
			id := c.ActorID
			return &id
		}
	}
	return nil
}

// Load is the running encounter's turn, or nil with no encounter.
func Load(ctx context.Context, conn core.Conn, campaignID string) (*Turn, error) {
	e, err := Active(ctx, conn, campaignID)
	if err != nil || e == nil {
		return nil, err
	}
	rows, err := Ordered(ctx, conn, e.ID)
	if err != nil {
		return nil, err
	}
	t := &Turn{
		TurnState: engine.TurnState{
			Round: float64(e.Round), CurrentID: actorOf(rows, e.CurrentCombatantID), Order: []string{},
			FirstID: actorOf(rows, e.FirstCombatantID),
			SideOf:  map[string]string{}, Begun: &e.Begun, LastSide: e.LastSide, OutOfTurnSide: e.OutOfTurnSide,
			Held: []string{}, Barred: []string{},
		},
		PhaseID: e.PhaseID,
		Done:    []string{},
	}
	for _, c := range rows {
		t.Order = append(t.Order, c.ActorID)
		t.SideOf[c.ActorID] = c.Side
		if c.Done {
			t.Done = append(t.Done, c.ActorID)
		}
		if c.Held {
			t.Held = append(t.Held, c.ActorID)
		}
		if c.Barred {
			t.Barred = append(t.Barred, c.ActorID)
		}
	}
	// The primitives read Done through the state; keep the two lists one.
	t.TurnState.Done = t.Done
	return t, nil
}

// Keys a turn delta may name.
const (
	Round     = "round"
	CurrentID = "currentId"
	Order     = "order"
	FirstID   = "firstId"
	PhaseID   = "phaseId"
	Done      = "done"
	// The sides order's own values (house decision #57).
	Begun         = "begun"
	LastSide      = "lastSide"
	OutOfTurnSide = "outOfTurnSide"
	Held          = "held"
	Barred        = "barred"
)

func optional(id *string) any {
	if id == nil {
		return nil
	}
	return *id
}

func anyList(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// Read is a turn value now, as decoded JSON, for undo to compare with what a step left.
func Read(ctx context.Context, conn core.Conn, campaignID, key string) (any, error) {
	t, err := Load(ctx, conn, campaignID)
	if err != nil || t == nil {
		return nil, err
	}
	switch key {
	case Order:
		return anyList(t.Order), nil
	case FirstID:
		return optional(t.FirstID), nil
	case PhaseID:
		return optional(t.PhaseID), nil
	case Done:
		return anyList(t.Done), nil
	case Held:
		return anyList(t.Held), nil
	case Barred:
		return anyList(t.Barred), nil
	case Begun:
		return t.Begun == nil || *t.Begun, nil
	case LastSide:
		return optional(t.LastSide), nil
	case OutOfTurnSide:
		return optional(t.OutOfTurnSide), nil
	case CurrentID:
		return optional(t.CurrentID), nil
	}
	return t.Round, nil
}

// Write sets `round`, `currentId`, `firstId`, `phaseId` or `done` of the running encounter and says what it held before
// and after, as decoded JSON. `currentId` is an actor id (or null before anyone has acted). The order belongs to the
// tracker: initiative scores and the GM's tie moves set it. A phaseId must name a phase of the pinned ruleset.
func Write(ctx context.Context, tx core.Conn, campaignID, key string, value any) (before, after any, err error) {
	e, err := Active(ctx, tx, campaignID)
	if err != nil {
		return nil, nil, err
	}
	if e == nil {
		return nil, nil, cs.Fail("noEncounterRunning")
	}
	switch key {
	case Round:
		n, isNumber := value.(float64)
		if !isNumber || n != math.Trunc(n) || math.Abs(n) > 9007199254740991 || n < 1 {
			return nil, nil, cs.Fail("roundWholeNumber")
		}
		_, err := tx.Exec(ctx, `UPDATE encounter SET round = $1 WHERE id = $2`, int64(n), e.ID)
		return float64(e.Round), n, err
	case Order:
		return nil, nil, cs.Fail("orderFromInitiative")
	case PhaseID:
		rules, err := compiled.Load(ctx, tx, campaignID)
		if err != nil {
			return nil, nil, err
		}
		var phases []engine.Phase
		if rules != nil {
			phases = rules.Ruleset.Phases
		}
		id, isText := value.(string)
		if value != nil && !(isText && slices.ContainsFunc(phases, func(p engine.Phase) bool { return p.ID == id })) {
			return nil, nil, cs.Fail("noSuchPhase")
		}
		_, err = tx.Exec(ctx, `UPDATE encounter SET phase_id = $1 WHERE id = $2`, value, e.ID)
		return optional(e.PhaseID), value, err
	}
	switch key {
	case Begun:
		on, isBool := value.(bool)
		if !isBool {
			return nil, nil, cs.Fail("badInput", cs.Params{"detail": "begun is true or false"})
		}
		_, err := tx.Exec(ctx, `UPDATE encounter SET begun = $1 WHERE id = $2`, on, e.ID)
		return e.Begun, on, err
	case LastSide, OutOfTurnSide:
		if _, isText := value.(string); value != nil && !isText {
			return nil, nil, cs.Fail("badInput", cs.Params{"detail": key + " is a side id or null"})
		}
		column, was := "last_side", e.LastSide
		if key == OutOfTurnSide {
			column, was = "out_of_turn_side", e.OutOfTurnSide
		}
		_, err := tx.Exec(ctx, `UPDATE encounter SET `+column+` = $1 WHERE id = $2`, value, e.ID)
		return optional(was), value, err
	}
	rows, err := Ordered(ctx, tx, e.ID)
	if err != nil {
		return nil, nil, err
	}
	if flagColumn := map[string]string{Done: "done", Held: "held", Barred: "barred"}[key]; flagColumn != "" {
		// Actor ids of the fight; one that has left (Undo bringing back an earlier list) is dropped without a word.
		want := map[string]bool{}
		if list, isList := value.([]any); isList {
			for _, v := range list {
				if s, ok := v.(string); ok {
					want[s] = true
				}
			}
		}
		was, now := []any{}, []any{}
		for _, flag := range []bool{true, false} {
			ids := []string{}
			for _, r := range rows {
				if want[r.ActorID] == flag {
					ids = append(ids, r.ID)
				}
			}
			if len(ids) > 0 {
				if _, err := tx.Exec(ctx, `UPDATE combatant SET `+flagColumn+` = $1 WHERE id = ANY($2::uuid[])`, flag, ids); err != nil {
					return nil, nil, err
				}
			}
		}
		for _, r := range rows {
			if r.flag(key) {
				was = append(was, r.ActorID)
			}
			if want[r.ActorID] {
				now = append(now, r.ActorID)
			}
		}
		return was, now, nil
	}
	// `firstId` is held exactly like `currentId`: an actor id of the fight, or null.
	column, held := "current_combatant_id", e.CurrentCombatantID
	if key == FirstID {
		column, held = "first_combatant_id", e.FirstCombatantID
	}
	before = optional(actorOf(rows, held))
	if value == nil {
		_, err := tx.Exec(ctx, `UPDATE encounter SET `+column+` = NULL WHERE id = $1`, e.ID)
		return before, nil, err
	}
	for _, c := range rows {
		if c.ActorID == value {
			_, err := tx.Exec(ctx, `UPDATE encounter SET `+column+` = $1 WHERE id = $2`, c.ID, e.ID)
			return before, c.ActorID, err
		}
	}
	return nil, nil, cs.Fail("notInFight")
}
