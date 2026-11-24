package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Strikes against packages/rules-engine/src/strike.ts (house decision #99).

type strikeVectorFile struct {
	Strikes struct {
		Rulesets []any `json:"rulesets"`
		Cases    []struct {
			Ruleset  int            `json:"ruleset"`
			StrikeID string         `json:"strikeId"`
			Attacker StrikeSide     `json:"attacker"`
			Target   StrikeSide     `json:"target"`
			Means    map[string]any `json:"means"`
			Inputs   map[string]any `json:"inputs"`
			Total    *float64       `json:"total"`
			Result   any            `json:"result"`
		} `json:"cases"`
	} `json:"strikes"`
}

func TestPlanStrikeMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v strikeVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Strikes.Cases) == 0 {
		t.Fatal("no strike vectors, so this test would prove nothing")
	}
	rulesets := make([]*CompiledRuleset, len(v.Strikes.Rulesets))
	for i, input := range v.Strikes.Rulesets {
		compiled, problems := CompileRuleset(input)
		if len(problems) > 0 {
			t.Fatalf("ruleset %d: %v", i, problems)
		}
		rulesets[i] = compiled
	}
	failed, plans, harms := 0, 0, 0
	for i, x := range v.Strikes.Cases {
		plan, refusal := rulesets[x.Ruleset].PlanStrike(x.StrikeID, x.Attacker, x.Target, x.Means, x.Inputs, x.Total)
		var got any
		if refusal != nil {
			got = viaJSON(t, refusal)
		} else {
			got = viaJSON(t, plan)
			plans++
			if plan.Harm != nil {
				harms++
			}
		}
		if !reflect.DeepEqual(got, x.Result) {
			failed++
			if failed <= 20 {
				t.Errorf("case %d (%s): want %v, got %v", i, x.StrikeID, x.Result, got)
			}
		}
	}
	if failed > 0 {
		t.Fatalf("%d of %d strike cases differ", failed, len(v.Strikes.Cases))
	}
	if plans < 300 || harms < 100 {
		t.Fatalf("only %d plans and %d hits among %d cases: the vectors reach too little", plans, harms, len(v.Strikes.Cases))
	}
	t.Logf("%d strike cases, %d plans, %d hits", len(v.Strikes.Cases), plans, harms)
}
