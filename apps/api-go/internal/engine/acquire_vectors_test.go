package engine

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

// planAcquire against packages/rules-engine/src/acquire.ts (house decision #102).
func TestPlanAcquireMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Acquire struct {
			Rulesets []any `json:"rulesets"`
			Cases    []struct {
				Ruleset int            `json:"ruleset"`
				Actor   ActorState     `json:"actor"`
				Item    AcquireItem    `json:"item"`
				Picks   map[string]any `json:"picks"`
				Plan    any            `json:"plan"`
				Code    string         `json:"code"`
				Message string         `json:"message"`
			} `json:"cases"`
		} `json:"acquire"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Acquire.Cases) == 0 {
		t.Fatal("no acquire vectors, so this test would prove nothing")
	}
	rulesets := make([]*Ruleset, len(v.Acquire.Rulesets))
	for i, input := range v.Acquire.Rulesets {
		compiled, problems := CompileRuleset(input)
		if len(problems) > 0 {
			t.Fatalf("ruleset %d: %v", i, problems)
		}
		rulesets[i] = compiled.Ruleset
	}
	failed, plans := 0, 0
	for i, x := range v.Acquire.Cases {
		actor := x.Actor
		plan, refusal := PlanAcquire(rulesets[x.Ruleset], &actor, x.Item, x.Picks)
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
				t.Errorf("case %d (%s): %s", i, x.Item.Key, problem)
			}
		}
	}
	if plans < 50 || plans == len(v.Acquire.Cases) {
		t.Errorf("%d of %d cases plan: the vectors should hold plans and refusals both", plans, len(v.Acquire.Cases))
	}
	if failed > 0 {
		t.Errorf("%d of %d acquire cases differ", failed, len(v.Acquire.Cases))
	}
}
