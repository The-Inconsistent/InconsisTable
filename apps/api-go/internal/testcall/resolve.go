package testcall

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The rules of a called Test that need no database (apps/api/src/test-call/test-call.resolve.ts): what a call's inputs
// must look like, the two numbers computed for one character, and the outcome of a reported roll.

// String(v) of a JSON value, as an input option is compared.
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

// CheckInputs is why the GM's inputs don't fit the Test's declared `inputs`, or "". Every declared input is needed;
// extras are refused.
func CheckInputs(test *engine.CompiledTest, inputs map[string]any) string {
	declared := maps.Clone(test.Def.Inputs)
	if declared == nil {
		declared = map[string]string{}
	}
	for mark := range test.Def.Marks {
		declared[mark] = "bool" // a mark is a yes-or-no input (house decision #80)
	}
	for _, key := range slices.Sorted(maps.Keys(inputs)) {
		if _, ok := declared[key]; !ok {
			return fmt.Sprintf(`This Test has no input "%s"`, key)
		}
	}
	for _, key := range jsonbOrder(declared) {
		v, has := inputs[key]
		if !has {
			return fmt.Sprintf(`Fill in "%s"`, key)
		}
		switch _, isText := v.(string); {
		case declared[key] == "int" && !eventlog.IsWhole(v):
			return fmt.Sprintf(`"%s" takes a whole number`, key)
		case declared[key] == "bool" && !isBool(v):
			return fmt.Sprintf(`"%s" is yes or no`, key)
		case declared[key] == "text" && !isText:
			return fmt.Sprintf(`"%s" takes text`, key)
		}
		if options, listed := test.Def.InputOptions[key].([]any); listed {
			names := make([]string, len(options))
			for i, o := range options {
				names[i] = jsString(o)
			}
			if !slices.Contains(names, jsString(v)) {
				return fmt.Sprintf("%s: pick one of %s", key, strings.Join(names, ", "))
			}
		}
	}
	return ""
}

// CheckChoices is the report's choices with every one the Test declares (house decision #170), a switch left out false
// and a number left out 0, or why they don't fit: an undeclared choice, a switch that is not yes or no, a number that is
// not whole or out of 0 to its max.
func CheckChoices(test *engine.CompiledTest, chosen map[string]any) (map[string]any, string) {
	for _, key := range slices.Sorted(maps.Keys(chosen)) {
		if _, ok := test.Def.Choices[key]; !ok {
			return nil, fmt.Sprintf(`This Test has no choice "%s"`, key)
		}
	}
	out := map[string]any{}
	for _, key := range slices.Sorted(maps.Keys(test.Def.Choices)) {
		top := test.Def.Choices[key].Max
		v, has := chosen[key]
		switch {
		case !has && top == nil:
			v = false
		case !has:
			v = 0.0
		case top == nil && !isBool(v):
			return nil, fmt.Sprintf(`"%s" is yes or no`, key)
		case top != nil && (!eventlog.IsWhole(v) || v.(float64) < 0 || v.(float64) > *top):
			return nil, fmt.Sprintf(`"%s" takes a whole number from 0 to %s`, key, jsString(*top))
		}
		out[key] = v
	}
	return out, ""
}

// choicesOf is a stored report's choices as the Test reads them now: every declared one, none made when what was
// stored no longer fits the pinned ruleset.
func choicesOf(test *engine.CompiledTest, stored map[string]any) map[string]any {
	if out, bad := CheckChoices(test, stored); bad == "" {
		return out
	}
	out, _ := CheckChoices(test, nil)
	return out
}

// withChoices is the call's inputs with the taker's choices, as the target and the offers read them as ctx.
func withChoices(inputs, chosen map[string]any) map[string]any {
	out := maps.Clone(inputs)
	if out == nil {
		out = map[string]any{}
	}
	maps.Copy(out, chosen)
	return out
}

func isBool(v any) bool {
	_, ok := v.(bool)
	return ok
}

// Call is the two numbers computed for one character when a Test is called, and a Dice pool's dice.
type Call struct {
	Modifier, Target float64
	Pool             *float64
}

// EvaluateCall is the modifier and the number to beat for one character, from its expression scope and the call's
// inputs. A Dice pool also gets the dice to roll: its pool plus the modifier, never below zero. An expression that
// can't be evaluated comes back as its message.
func EvaluateCall(test *engine.CompiledTest, scope *engine.Record, inputs map[string]any) (Call, string, error) {
	with := &engine.Record{Fields: maps.Clone(scope.Fields)}
	with.Fields["ctx"] = engine.ValueFromJSON(inputs)
	var out Call
	var err error
	if out.Modifier, err = engine.EvaluateInt(test.Modifier, with); err == nil {
		if out.Target, err = engine.EvaluateInt(test.Target, with); err == nil && test.Pool != nil {
			var pool float64
			if pool, err = engine.EvaluateInt(test.Pool, with); err == nil {
				size := engine.PoolSize(pool, out.Modifier)
				out.Pool = &size
			}
		}
	}
	var exprErr engine.ExprError
	if errors.As(err, &exprErr) {
		return Call{}, exprErr.Message, nil
	}
	return out, "", err
}

// What a resolve op set, by test key.
func setByKey(deltas []engine.Delta) map[string]any {
	out := map[string]any{}
	for _, d := range deltas {
		if _, seen := out[d.Target.Test]; d.Target.Test != "" && !seen {
			out[d.Target.Test] = d.Value
		}
	}
	return out
}

var outcomes = []string{"success", "failure", "critical", "criticalSuccess", "criticalFailure"}

const unresolved = "The roll couldn't be resolved"

// Resolved is a reported roll's result. Natural is nil when only a total was reported without it; Margin, Shifts and
// Flags are a Dice pool's.
type Resolved struct {
	Natural       *float64
	Total         float64
	Outcome       string
	Margin, Shift float64
	Flags         []string
}

func resolve(primitive string, params any, input map[string]any) (Resolved, string) {
	result, refusal := engine.RunOp(primitive, "resolve", params, input, &engine.RuleState{Actors: []*engine.ActorState{}})
	if refusal != nil {
		return Resolved{}, refusal.Message
	}
	set := setByKey(result.Deltas)
	var r Resolved
	var ok bool
	if r.Outcome, ok = set["outcome"].(string); !ok || !slices.Contains(outcomes, r.Outcome) {
		return Resolved{}, unresolved
	}
	if r.Total, ok = set["total"].(float64); !ok {
		return Resolved{}, unresolved
	}
	if n, isNumber := set["natural"].(float64); isNumber {
		r.Natural = &n
	}
	return r, ""
}

// ResolveRoll is a reported roll resolved by the engine's `dice.sumVsTarget.resolve`: the dice are physical, the
// arithmetic is ours.
func ResolveRoll(params any, target, modifier float64, advantage string, roll map[string]any) (Resolved, string) {
	return resolve("dice.sumVsTarget", params, map[string]any{"target": target, "modifier": modifier, "advantage": advantage, "roll": roll})
}

// ResolvePoolRoll is a reported Dice pool resolved by the engine's `dice.poolSuccesses.resolve`: the server counts, the
// dice stay physical. pool is the dice the character was told to roll, kept when the Test was called.
func ResolvePoolRoll(params any, target, pool float64, roll map[string]any) (Resolved, string) {
	result, refusal := engine.RunOp("dice.poolSuccesses", "resolve", params, map[string]any{"target": target, "pool": pool, "roll": roll},
		&engine.RuleState{Actors: []*engine.ActorState{}})
	if refusal != nil {
		return Resolved{}, refusal.Message
	}
	set := setByKey(result.Deltas)
	var r Resolved
	var okOutcome, okTotal, okMargin, okShifts bool
	r.Outcome, okOutcome = set["outcome"].(string)
	r.Total, okTotal = set["total"].(float64)
	r.Margin, okMargin = set["margin"].(float64)
	r.Shift, okShifts = set["shifts"].(float64)
	flags, okFlags := set["flags"].([]string)
	for _, f := range flags {
		okFlags = okFlags && (f == "critical" || f == "complication")
	}
	if !okOutcome || !slices.Contains(outcomes, r.Outcome) || !okTotal || !okMargin || !okShifts || !okFlags {
		return Resolved{}, unresolved
	}
	r.Flags = flags
	return r, ""
}
