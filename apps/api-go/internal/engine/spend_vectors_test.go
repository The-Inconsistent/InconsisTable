package engine

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"testing"
)

// Spends and op input keys against packages/rules-engine/src/spend.ts and registry.ts (house decision #84).

type spendVectorFile struct {
	Spends struct {
		Rulesets []any `json:"rulesets"`
		Cases    []struct {
			Ruleset int            `json:"ruleset"`
			SpendID string         `json:"spendId"`
			Actor   ActorState     `json:"actor"`
			State   RuleState      `json:"state"`
			Inputs  map[string]any `json:"inputs"`
			Plan    any            `json:"plan"`
			Code    string         `json:"code"`
			Message string         `json:"message"`
		} `json:"cases"`
	} `json:"spends"`
	OpInputKeys map[string][]string `json:"opInputKeys"`
}

func loadSpendVectors(t *testing.T) spendVectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v spendVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Spends.Cases) == 0 || len(v.OpInputKeys) == 0 {
		t.Fatal("no spend vectors, so this test would prove nothing")
	}
	return v
}

func TestPlanSpendMatchesTypeScript(t *testing.T) {
	v := loadSpendVectors(t)
	rulesets := make([]*Ruleset, len(v.Spends.Rulesets))
	for i, input := range v.Spends.Rulesets {
		compiled, problems := CompileRuleset(input)
		if len(problems) > 0 {
			t.Fatalf("ruleset %d: %v", i, problems)
		}
		rulesets[i] = compiled.Ruleset
	}
	failed, plans := 0, 0
	for i, x := range v.Spends.Cases {
		actor := x.Actor
		state := x.State
		state.Actors = []*ActorState{&actor}
		plan, refusal := PlanSpend(rulesets[x.Ruleset], x.SpendID, &actor, &state, x.Inputs)
		problem := ""
		switch {
		case x.Plan != nil && refusal != nil:
			problem = fmt.Sprintf("want plan %v, got refusal %+v", x.Plan, *refusal)
		case x.Plan == nil && refusal == nil:
			problem = fmt.Sprintf("want %s %q, got %v", x.Code, x.Message, viaJSON(t, plan))
		case x.Plan == nil && (refusal.Code != x.Code || refusal.Message != x.Message):
			problem = fmt.Sprintf("want %s %q, got %+v", x.Code, x.Message, *refusal)
		case x.Plan != nil && !reflect.DeepEqual(viaJSON(t, plan), x.Plan):
			problem = fmt.Sprintf("want %v, got %v", x.Plan, viaJSON(t, plan))
		}
		if x.Plan != nil {
			plans++
		}
		if problem != "" {
			failed++
			if failed <= 20 {
				t.Errorf("case %d (%s): %s", i, x.SpendID, problem)
			}
		}
	}
	if plans == 0 || plans == len(v.Spends.Cases) {
		t.Errorf("%d of %d cases plan: the vectors need both plans and refusals", plans, len(v.Spends.Cases))
	}
	if failed > 0 {
		t.Errorf("%d of %d spend cases differ", failed, len(v.Spends.Cases))
	}
}

func TestOpInputKeysMatchTypeScript(t *testing.T) {
	v := loadSpendVectors(t)
	for key, want := range v.OpInputKeys {
		got := opInputKeys[key]
		if got == nil {
			got = []string{}
		}
		if !slices.Equal(got, want) {
			t.Errorf("%s: want %v, got %v", key, want, got)
		}
	}
	if len(opInputKeys) != len(v.OpInputKeys) {
		t.Errorf("Go knows %d ops, TypeScript %d", len(opInputKeys), len(v.OpInputKeys))
	}
}
