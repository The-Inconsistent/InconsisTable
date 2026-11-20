package engine

import (
	"fmt"
	"slices"
	"strings"
)

// ResourceState is a resource as an op sees it: its value and the bounds the caller evaluated.
type ResourceState struct {
	Value float64 `json:"value"`
	Min   float64 `json:"min"`
	// Max is nil when there is no ceiling (no max, or `capped: false`).
	Max *float64 `json:"max"`
	// Reset is the value each reset event sets it to for this holder.
	Reset map[string]float64 `json:"reset"`
	// InstantDeathAt is the overflow damage that kills outright, for health tracks.
	InstantDeathAt *float64 `json:"instantDeathAt"`
	// Limit is the max as the table shows it, also for a resource declared capped: false, whose Max is nil (health.harm
	// reads the shock limit from it, house decision #66). Nil reads as Max.
	Limit *float64 `json:"limit"`
}

// ConditionState is one actor_condition row.
type ConditionState struct {
	ID          string `json:"id"`
	ConditionID string `json:"conditionId"`
	ExpiresOn   string `json:"expiresOn"`
	// ExpiresAfter is the turns or rounds left. Nil reads as 1 (house decision #14).
	ExpiresAfter *float64 `json:"expiresAfter"`
}

// NamedResource keeps resources in the caller's order, because the rest op's deltas follow it.
type NamedResource struct {
	Name  string        `json:"name"`
	State ResourceState `json:"state"`
}

// ActorState is one actor. Fields hold decoded JSON values, so a number is a float64.
type ActorState struct {
	ID         string           `json:"id"`
	Fields     map[string]any   `json:"fields"`
	Resources  []NamedResource  `json:"resources"`
	Conditions []ConditionState `json:"conditions"`
	// Entity is the ruleset's entity type, for the ops that read it by type (health.harm); "" for none.
	Entity string `json:"entity"`
	// Scope is the actor's expression scope as the caller evaluated it, for the ops that read expressions; nil when
	// it cannot be evaluated.
	Scope *Record `json:"scope"`
}

func (a *ActorState) resource(name string) *ResourceState {
	for i := range a.Resources {
		if a.Resources[i].Name == name {
			return &a.Resources[i].State
		}
	}
	return nil
}

// TurnState is the part of the encounter's turn state that ops read.
type TurnState struct {
	Round     float64  `json:"round"`
	CurrentID *string  `json:"currentId"`
	Order     []string `json:"order"`
	FirstID   *string  `json:"firstId"`
	// Done is the members that have acted this round. Absent reads as none.
	Done []string `json:"done"`
	// The rest is read by initiative.sides only: SideOf maps a combatant to its side, Begun is nil (true) unless a fight
	// with a setup has not begun, LastSide and OutOfTurnSide are side ids, Held and Barred are lists of combatants and
	// Unable is the combatants that cannot act (the caller computes it).
	SideOf        map[string]string `json:"sideOf"`
	Begun         *bool             `json:"begun"`
	LastSide      *string           `json:"lastSide"`
	OutOfTurnSide *string           `json:"outOfTurnSide"`
	Held          []string          `json:"held"`
	Barred        []string          `json:"barred"`
	Unable        []string          `json:"unable"`
}

// RuleState is the slice of live state an op reads, loaded by the caller and scoped to one campaign. Actors stay in
// the caller's order, because the rest op's deltas follow it.
type RuleState struct {
	Actors []*ActorState `json:"actors"`
	Turn   *TurnState    `json:"turn"`
	// Pools are the shared pools (resources of scope party, gm or campaign), in the caller's order like an actor's
	// resources. Empty or absent: none loaded.
	Pools []NamedResource `json:"pools"`
}

func (s *RuleState) pool(name string) *ResourceState {
	for i := range s.Pools {
		if s.Pools[i].Name == name {
			return &s.Pools[i].State
		}
	}
	return nil
}

func (s *RuleState) actor(id string) *ActorState {
	for _, a := range s.Actors {
		if a.ID == id {
			return a
		}
	}
	return nil
}

// Refusal says why an op does not apply. Code is the contract with the client, Message is detail for people.
type Refusal struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func refuse(code, format string, args ...any) *Refusal {
	return &Refusal{code, fmt.Sprintf(format, args...)}
}

// DeltaTarget says where a delta writes. Exactly one of the shapes is filled, through the constructors below.
type DeltaTarget struct {
	ActorID   string `json:"actorId,omitempty"`
	Resource  string `json:"resource,omitempty"`
	Field     string `json:"field,omitempty"`
	Condition string `json:"condition,omitempty"`
	// ApplyCondition names a condition of the manifest, with "add" of 1 only: applied once more as condition.add does
	// (its stacking rule; no count, expiring manual). The pipeline turns it into a write on the row (house decision #66).
	ApplyCondition string `json:"applyCondition,omitempty"`
	Turn           string `json:"turn,omitempty"`
	Test           string `json:"test,omitempty"`
	// Pool is a shared pool's resource id (scope party, gm or campaign), used with "add" only.
	Pool string `json:"pool,omitempty"`
	// Clock is a room clock's id: a counted target with no actor, written by internal/clock (not a ruleset primitive,
	// so the TypeScript DeltaTarget has no twin of it).
	Clock string `json:"clock,omitempty"`
}

// Delta is one proposed change. Value is a float64, string, bool, []string or nil.
type Delta struct {
	Target DeltaTarget `json:"target"`
	Kind   string      `json:"kind"`
	Value  any         `json:"value"`
}

func addResource(actorID, resource string, by float64) Delta {
	return Delta{DeltaTarget{ActorID: actorID, Resource: resource}, "add", by}
}

func setField(actorID, field string, value any) Delta {
	return Delta{DeltaTarget{ActorID: actorID, Field: field}, "set", value}
}

func addPool(pool string, by float64) Delta {
	return Delta{DeltaTarget{Pool: pool}, "add", by}
}

func setTurn(key string, value any) Delta {
	return Delta{DeltaTarget{Turn: key}, "set", value}
}

func setTest(key string, value any) Delta {
	return Delta{DeltaTarget{Test: key}, "set", value}
}

// optional turns a possibly absent id into a delta value.
func optional(id *string) any {
	if id == nil {
		return nil
	}
	return *id
}

func sameID(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func firstID(order []string) *string {
	if len(order) == 0 {
		return nil
	}
	return &order[0]
}

// TargetPattern is what an op may write. Name "*" means any, for resources and fields.
type TargetPattern struct {
	Kind string
	Name string
}

func (p TargetPattern) matches(t DeltaTarget) bool {
	named := func(name string) bool { return p.Name == "*" || p.Name == name }
	switch {
	case t.Resource != "":
		return p.Kind == "resource" && named(t.Resource)
	case t.Field != "":
		return p.Kind == "field" && named(t.Field)
	case t.Condition != "" || t.ApplyCondition != "":
		return p.Kind == "condition"
	case t.Turn != "":
		return p.Kind == "turn" && p.Name == t.Turn
	case t.Pool != "":
		return p.Kind == "pool" && named(t.Pool)
	}
	return p.Kind == "test" && p.Name == t.Test
}

func (t DeltaTarget) json() string {
	var parts []string
	add := func(key, value string) {
		if value != "" {
			parts = append(parts, esString(key)+":"+esString(value))
		}
	}
	add("actorId", t.ActorID)
	add("resource", t.Resource)
	add("field", t.Field)
	add("condition", t.Condition)
	add("applyCondition", t.ApplyCondition)
	add("turn", t.Turn)
	add("test", t.Test)
	add("pool", t.Pool)
	return "{" + strings.Join(parts, ",") + "}"
}

// checkDeltas keeps every delta inside the op's declared targets.
func checkDeltas(deltas []Delta, targets []TargetPattern) *Refusal {
	for _, d := range deltas {
		inside := slices.ContainsFunc(targets, func(p TargetPattern) bool { return p.matches(d.Target) })
		if !inside {
			return refuse("outOfTargets", "delta writes %s, outside the op's targets", d.Target.json())
		}
	}
	return nil
}
