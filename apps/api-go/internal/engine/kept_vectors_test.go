package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// KeptValue against packages/rules-engine/src/manifest.ts keptValue (house decision #199).
func TestKeptValueMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Kept struct {
			Cases []struct {
				How    string `json:"how"`
				Hand   any    `json:"hand"`
				Built  any    `json:"built"`
				Max    int    `json:"max"`
				Result any    `json:"result"`
			} `json:"cases"`
		} `json:"kept"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Kept.Cases) == 0 {
		t.Fatal("no kept vectors, so this test would prove nothing")
	}
	for i, x := range v.Kept.Cases {
		got := viaJSON(t, KeptValue(x.How, x.Hand, x.Built, x.Max))
		if !reflect.DeepEqual(got, x.Result) {
			t.Errorf("case %d (%s %v %v %d): want %v, got %v", i, x.How, x.Hand, x.Built, x.Max, x.Result, got)
		}
	}
}
