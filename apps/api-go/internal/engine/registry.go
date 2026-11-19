package engine

import "slices"

// One operation of a primitive. run does steps the TypeScript runOp spreads over the op's fields, in the same order:
// parse the input, validate, apply.
type primitiveOp struct {
	perm    string
	touches string
	run     func(params any, input any, state *RuleState) ([]Delta, []TargetPattern, *Refusal)
}

type primitive struct {
	parseParams func(any) (any, *Refusal)
	ops         map[string]primitiveOp
}

func defineOp[P, I any](
	perm string,
	parse func(any) (I, *Refusal),
	targets func(P) []TargetPattern,
	validate func(P, *RuleState, I) *Refusal,
	apply func(P, *RuleState, I) []Delta,
) primitiveOp {
	return primitiveOp{perm, "state", func(params, raw any, state *RuleState) ([]Delta, []TargetPattern, *Refusal) {
		p := params.(P)
		input, refusal := parse(raw)
		if refusal != nil {
			return nil, nil, refusal
		}
		if validate != nil {
			if refusal := validate(p, state, input); refusal != nil {
				return nil, nil, refusal
			}
		}
		return apply(p, state, input), targets(p), nil
	}}
}

func definePrimitive[P any](parse func(any) (P, *Refusal), ops map[string]primitiveOp) primitive {
	return primitive{func(raw any) (any, *Refusal) {
		p, refusal := parse(raw)
		return p, refusal
	}, ops}
}

// Primitives is every primitive the platform maintains, by id. Adding one is a platform PR, never a manifest.
var primitives = map[string]primitive{
	"dice.sumVsTarget":   diceSumVsTarget,
	"dice.poolSuccesses": dicePoolSuccesses,
	"initiative.ranked":  initiativeRanked,
	"initiative.seated":  initiativeSeated,
	"initiative.sides":   initiativeSides,
	"health.tracks":      healthTracks,
	"resource.capped":    resourceCapped,
	"conditions.expire":  conditionsExpire,
	"rest":               rest,
}

// OpResult is what an accepted op proposes. Checking Perm and editableBy and writing the deltas are the caller's, since
// they need the seat and the database.
type OpResult struct {
	Deltas  []Delta `json:"deltas"`
	Touches string  `json:"touches"`
	Perm    string  `json:"perm"`
}

// RunOp takes params and input as decoded JSON, and runs one op of one primitive: parse, validate, apply, then every
// delta checked against the op's targets.
//
// ponytail: params parsing reads only what the ops read, because manifests are validated at import; move params and
// input to internal/schema when the socket actions move there, which also brings zod's wording to these refusals.
func RunOp(primitiveID, opID string, params, input any, state *RuleState) (OpResult, *Refusal) {
	prim, ok := primitives[primitiveID]
	if !ok {
		return OpResult{}, refuse("unknownPrimitive", `no primitive "%s"`, primitiveID)
	}
	op, ok := prim.ops[opID]
	if !ok {
		return OpResult{}, refuse("unknownOp", `"%s" has no op "%s"`, primitiveID, opID)
	}
	parsed, refusal := prim.parseParams(params)
	if refusal != nil {
		return OpResult{}, refusal
	}
	deltas, targets, refusal := op.run(parsed, input, state)
	if refusal != nil {
		return OpResult{}, refusal
	}
	if outside := checkDeltas(deltas, targets); outside != nil {
		return OpResult{}, outside
	}
	if deltas == nil {
		deltas = []Delta{}
	}
	return OpResult{deltas, op.touches, op.perm}, nil
}

// OpTouches says which snapshot an op changes: "state", "codex" or "both". An op the registry does not know is taken to
// change the state, as the TypeScript dispatch does.
func OpTouches(primitiveID, opID string) string {
	if op, ok := primitives[primitiveID].ops[opID]; ok {
		return op.touches
	}
	return "state"
}

// OpPerm is the permission an op declares, and whether the registry knows the op.
func OpPerm(primitiveID, opID string) (string, bool) {
	op, ok := primitives[primitiveID].ops[opID]
	return op.perm, ok
}

// IsResetEvent says whether a rest or boundary event is one a resource can reset on (ResetEvent).
func IsResetEvent(event string) bool { return slices.Contains(resetEvents, event) }

// StepsFor is which way a seat may move a value declared editableBy: the GM side both ways, a holder by editableBy.
func StepsFor(editableBy string, gmSide bool) (dec, inc bool) {
	if gmSide || editableBy == "owner" {
		return true, true
	}
	return editableBy == "ownerSpendOnly", false
}
