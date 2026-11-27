package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// withFittedCard against packages/rules-engine/src/acquire.ts (house decision #102).
func TestWithFittedCardMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Fittings struct {
			Cases []struct {
				Card   map[string]any `json:"card"`
				Fitted []Fitted       `json:"fitted"`
				Result any            `json:"result"`
			} `json:"cases"`
		} `json:"fittings"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Fittings.Cases) == 0 {
		t.Fatal("no fitting vectors, so this test would prove nothing")
	}
	failed := 0
	for i, x := range v.Fittings.Cases {
		card, by := WithFittedCard(x.Card, x.Fitted)
		got := viaJSON(t, map[string]any{"card": card, "by": by})
		if !reflect.DeepEqual(got, x.Result) {
			failed++
			if failed <= 20 {
				t.Errorf("case %d: want %v, got %v", i, x.Result, got)
			}
		}
	}
	if failed > 0 {
		t.Errorf("%d of %d fitting cases differ", failed, len(v.Fittings.Cases))
	}
}
