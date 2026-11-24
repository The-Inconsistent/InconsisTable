package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Spawn options, adjustments and the budget against packages/rules-engine/src/spawn.ts (house decision #92).

type spawnVectorFile struct {
	Spawns struct {
		Ruleset any `json:"ruleset"`
		Cases   []struct {
			Entity  string         `json:"entity"`
			Values  map[string]any `json:"values"`
			Options []string       `json:"options"`
			Room    SpawnRoom      `json:"room"`
			Mob     bool           `json:"mob"`
			Plan    any            `json:"plan"`
			Code    string         `json:"code"`
			Message string         `json:"message"`
		} `json:"cases"`
		Budgets []struct {
			Picks    []BudgetPick `json:"picks"`
			Room     SpawnRoom    `json:"room"`
			Switches []string     `json:"switches"`
			Lines    any          `json:"lines"`
		} `json:"budgets"`
	} `json:"spawns"`
}

func TestSpawnMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v spawnVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Spawns.Cases) == 0 || len(v.Spawns.Budgets) == 0 {
		t.Fatal("no spawn vectors, so this test would prove nothing")
	}
	compiled, problems := CompileRuleset(v.Spawns.Ruleset)
	if len(problems) > 0 {
		t.Fatalf("ruleset: %v", problems)
	}
	r := compiled.Ruleset
	failed, plans := 0, 0
	for i, x := range v.Spawns.Cases {
		plan, refusal := PlanSpawn(r, x.Entity, x.Values, x.Options, x.Room, x.Mob)
		var got any
		if refusal != nil {
			got = map[string]any{"code": refusal.Code, "message": refusal.Message}
		} else {
			got, plans = viaJSON(t, plan), plans+1
		}
		want := x.Plan
		if want == nil {
			want = map[string]any{"code": x.Code, "message": x.Message}
		}
		if !reflect.DeepEqual(got, want) {
			if failed++; failed <= 20 {
				t.Errorf("case %d: want %v, got %v", i, want, got)
			}
		}
	}
	if plans == 0 || plans == len(v.Spawns.Cases) {
		t.Errorf("%d of %d cases plan: the vectors need both plans and refusals", plans, len(v.Spawns.Cases))
	}
	for i, x := range v.Spawns.Budgets {
		if got := viaJSON(t, BudgetOf(r, x.Picks, x.Room, x.Switches)); !reflect.DeepEqual(got, x.Lines) {
			if failed++; failed <= 20 {
				t.Errorf("budget %d: want %v, got %v", i, x.Lines, got)
			}
		}
	}
	if failed > 0 {
		t.Errorf("%d spawn cases differ", failed)
	}
}
