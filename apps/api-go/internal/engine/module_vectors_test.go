package engine

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

// The game module twin against packages/rules-engine/src/module.ts (vectors/module.ts).
func TestModulesMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Modules struct {
			MaxBytes int `json:"maxBytes"`
			MaxPacks int `json:"maxPacks"`
			Cases    []struct {
				Input    any            `json:"input"`
				Ok       bool           `json:"ok"`
				Module   map[string]any `json:"module"`
				Hash     string         `json:"hash"`
				Problems []Problem      `json:"problems"`
			} `json:"cases"`
		} `json:"modules"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	m := v.Modules
	if m.MaxBytes != MaxModuleBytes || m.MaxPacks != MaxModulePacks {
		t.Errorf("caps: want %d bytes and %d packs, got %d and %d", m.MaxBytes, m.MaxPacks, MaxModuleBytes, MaxModulePacks)
	}
	f := &failures{t: t}
	accepted := 0
	for i, x := range m.Cases {
		module, found := ValidateModule(x.Input)
		switch {
		case x.Ok && len(found) > 0:
			f.add("case %d: want it accepted, got %v", i, problemKeys(found))
		case !x.Ok && !slices.Equal(problemKeys(found), problemKeys(x.Problems)):
			f.add("case %d\n  want %v\n  got  %v", i, problemKeys(x.Problems), problemKeys(found))
		case x.Ok:
			accepted++
			if got := viaJSON(t, module); !reflect.DeepEqual(got, viaJSON(t, x.Module)) {
				f.add("case %d module: %s", i, firstDifference("", viaJSON(t, x.Module), got))
			}
			if got := ModuleHash(module); got != x.Hash {
				f.add("case %d hash: want %s, got %s", i, x.Hash, got)
			}
		}
	}
	f.done(len(m.Cases))
	if accepted < 5 {
		t.Errorf("only %d modules accepted, so this proves little", accepted)
	}
}
