package engine

import (
	"math"
	"slices"
)

// clampResource is value + delta clamped to [min, max]. A max below the min collapses to the min.
func clampResource(res *ResourceState, delta float64) float64 {
	ceiling := math.Inf(1)
	if res.Max != nil {
		ceiling = math.Max(res.Min, *res.Max)
	}
	return math.Min(ceiling, math.Max(res.Min, res.Value+delta))
}

func actorResource(state *RuleState, actorID, resource string) (*ActorState, *ResourceState, *Refusal) {
	actor := state.actor(actorID)
	if actor == nil {
		return nil, nil, refuse("unknownActor", `no actor "%s"`, actorID)
	}
	res := actor.resource(resource)
	if res == nil {
		return nil, nil, refuse("unknownResource", `"%s" has no resource "%s"`, actorID, resource)
	}
	return actor, res, nil
}

type adjustInput struct {
	actorID, resource string
	delta             float64
}

func parseAdjustInput(raw any) (adjustInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return adjustInput{}, refuse("badInput", "not an object")
	}
	in := adjustInput{r.str("actorId"), r.id("resource"), r.intIn("delta", -1_000_000, 1_000_000)}
	return in, r.refusal("badInput")
}

var anyResource = []TargetPattern{{"resource", "*"}}

var resourceCapped = definePrimitive(parseEmpty("badParams"), map[string]primitiveOp{
	// A player spends their own; editableBy on the resource narrows it further.
	"adjust": defineOp("character:edit:own", parseAdjustInput,
		func(struct{}) []TargetPattern { return anyResource },
		func(_ struct{}, state *RuleState, in adjustInput) *Refusal {
			_, _, refusal := actorResource(state, in.actorID, in.resource)
			return refusal
		},
		func(_ struct{}, state *RuleState, in adjustInput) []Delta {
			_, res, _ := actorResource(state, in.actorID, in.resource)
			change := clampResource(res, in.delta) - res.Value
			if change == 0 {
				return nil
			}
			// An add, not a set: the server applies it as a clamped SQL delta, so concurrent taps never overwrite.
			return []Delta{addResource(in.actorID, in.resource, change)}
		}),
})

var resetEvents = []string{"sessionStart", "sessionEnd", "encounterEnd", "shortRest", "longRest"}

type restInput struct {
	event    string
	actorIDs []string
	listed   bool
}

func parseRestInput(raw any) (restInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return restInput{}, refuse("badInput", "not an object")
	}
	in := restInput{event: r.enum("event", resetEvents)}
	if r.has("actorIds") {
		in.listed = true
		for _, item := range r.list("actorIds", 0, 500) {
			id, ok := item.(string)
			if !ok || id == "" {
				r.fail("actorIds")
			}
			in.actorIDs = append(in.actorIDs, id)
		}
	}
	return in, r.refusal("badInput")
}

// An event never implies another: a long rest does not run the short-rest resets (house decision #16).
var rest = definePrimitive(parseEmpty("badParams"), map[string]primitiveOp{
	"apply": defineOp("session:run", parseRestInput,
		func(struct{}) []TargetPattern { return anyResource },
		func(_ struct{}, state *RuleState, in restInput) *Refusal {
			for _, id := range in.actorIDs {
				if state.actor(id) == nil {
					return refuse("unknownActor", `no actor "%s"`, id)
				}
			}
			return nil
		},
		func(_ struct{}, state *RuleState, in restInput) []Delta {
			actors := state.Actors
			if in.listed {
				actors = make([]*ActorState, 0, len(in.actorIDs))
				for _, id := range in.actorIDs {
					actors = append(actors, state.actor(id))
				}
			}
			var deltas []Delta
			for _, actor := range actors {
				for i := range actor.Resources {
					named := &actor.Resources[i]
					to, ok := named.State.Reset[in.event]
					if !ok {
						continue
					}
					change := clampResource(&named.State, to-named.State.Value) - named.State.Value
					if change != 0 {
						deltas = append(deltas, addResource(actor.ID, named.Name, change))
					}
				}
			}
			return deltas
		}),
})

// Holders in a stable order: those in the initiative order first, as the table acts, then the rest by id.
func conditionHolders(state *RuleState) []*ActorState {
	var inOrder []string
	if state.Turn != nil {
		inOrder = state.Turn.Order
	}
	var first, others []*ActorState
	for _, id := range inOrder {
		if a := state.actor(id); a != nil {
			first = append(first, a)
		}
	}
	for _, a := range state.Actors {
		if !slices.Contains(inOrder, a.ID) {
			others = append(others, a)
		}
	}
	slices.SortStableFunc(others, func(a, b *ActorState) int { return compareUnits(a.ID, b.ID) })
	return append(first, others...)
}

func expireConditions(actors []*ActorState, on string, counted bool) []Delta {
	var deltas []Delta
	for _, a := range actors {
		for _, row := range a.Conditions {
			if row.ExpiresOn != on {
				continue
			}
			target := DeltaTarget{ActorID: a.ID, Condition: row.ID}
			// An uncounted row is one tick from the end (house decision #14).
			if counted && row.ExpiresAfter != nil && *row.ExpiresAfter > 1 {
				deltas = append(deltas, Delta{target, "add", -1.0})
			} else {
				deltas = append(deltas, Delta{target, "set", nil})
			}
		}
	}
	return deltas
}

var anyCondition = []TargetPattern{{"condition", "*"}}

func parseActorID(raw any) (string, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return "", refuse("badInput", "not an object")
	}
	id := r.str("actorId")
	return id, r.refusal("badInput")
}

func conditionsAtEnd(on string, counted bool) primitiveOp {
	return defineOp("encounter:run", parseEmpty("badInput"),
		func(struct{}) []TargetPattern { return anyCondition },
		nil,
		func(_ struct{}, state *RuleState, _ struct{}) []Delta {
			return expireConditions(conditionHolders(state), on, counted)
		})
}

// ponytail: a condition counts down on its holder's own turns; "until the end of the caster's next turn" needs the
// applier on the row, an upgrade once a ruleset in scope needs it (docs/house-decisions.md #15).
var conditionsExpire = definePrimitive(parseEmpty("badParams"), map[string]primitiveOp{
	"turnEnd": defineOp("encounter:run", parseActorID,
		func(struct{}) []TargetPattern { return anyCondition },
		func(_ struct{}, state *RuleState, id string) *Refusal {
			if state.actor(id) == nil {
				return refuse("unknownActor", `no actor "%s"`, id)
			}
			return nil
		},
		func(_ struct{}, state *RuleState, id string) []Delta {
			return expireConditions([]*ActorState{state.actor(id)}, "ownTurnEnd", true)
		}),
	"roundEnd":     conditionsAtEnd("roundEnd", true),
	"encounterEnd": conditionsAtEnd("encounterEnd", false),
})
