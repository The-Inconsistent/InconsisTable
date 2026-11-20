package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Typed results read on a lookup and applied to a target (house decision #87), against what TypeScript answered.
type lookupVectorFile struct {
	Manifests []any `json:"lookupManifests"`
	Lookups   []struct {
		Manifest  int                `json:"manifest"`
		TableID   string             `json:"tableId"`
		Result    float64            `json:"result"`
		Inputs    map[string]any     `json:"inputs"`
		Fields    map[string]any     `json:"fields"`
		Derived   map[string]any     `json:"derived"`
		Resources map[string]float64 `json:"resources"`
		Plan      any                `json:"plan"`
	} `json:"lookups"`
}

// planJSON is the plan as lookups.ts planLookup answers it.
func planJSON(read *LookupRead, steps []LookupStep, refused *LookupRefusal) any {
	if refused != nil {
		out := map[string]any{"ok": false, "code": refused.Code}
		switch refused.Code {
		case "tableResultOut":
			out["min"], out["max"] = refused.Min, refused.Max
		case "tableInput":
			out["input"] = refused.Input
		case "unreadable":
			out["detail"] = refused.Detail
		}
		return out
	}
	list := make([]any, len(steps))
	for i, s := range steps {
		list[i] = s.JSON()
	}
	return map[string]any{"ok": true, "total": read.Total, "entry": read.Entry, "steps": list}
}

func TestLookupsMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v lookupVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Lookups) == 0 {
		t.Fatal("no lookup vectors, so this test would prove nothing")
	}
	compiled := make([]*CompiledRuleset, len(v.Manifests))
	for i, m := range v.Manifests {
		compiled[i] = mustCompile(t, m)
	}
	f := &failures{t: t}
	applied, refused := 0, 0
	for i, x := range v.Lookups {
		scope := ActorScope(x.Fields, &Record{x.Derived}, x.Resources, 0, nil)
		read, steps, no := compiled[x.Manifest].PlanLookup(x.TableID, x.Result, x.Inputs, scope)
		if no == nil {
			applied++
		} else {
			refused++
		}
		got := viaJSON(t, planJSON(read, steps, no))
		if !reflect.DeepEqual(got, x.Plan) {
			f.add("lookup %d (%s %v %v): want %v, got %v", i, x.TableID, x.Result, x.Inputs, x.Plan, got)
		}
	}
	f.done(len(v.Lookups))
	if applied == 0 || refused == 0 {
		t.Errorf("%d applied and %d refused, so this proves little", applied, refused)
	}
}
