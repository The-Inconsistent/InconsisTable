package engine

import (
	"encoding/json"
	"testing"
)

// Confirmed generator runs (house decision #98), against what generators.ts checkRun answered.
type generatorVectorFile struct {
	Manifests []any `json:"generatorManifests"`
	Runs      []struct {
		Manifest  int            `json:"manifest"`
		Generator string         `json:"generator"`
		Run       GeneratorRun   `json:"run"`
		Campaign  map[string]any `json:"campaign"`
		Served    []struct {
			Entity string         `json:"entity"`
			Key    string         `json:"key"`
			Name   string         `json:"name"`
			Body   map[string]any `json:"body"`
		} `json:"served"`
		Result any `json:"result"`
	} `json:"generatorRuns"`
}

func TestGeneratorRunsMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v generatorVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Runs) == 0 {
		t.Fatal("no generator vectors, so this test would prove nothing")
	}
	compiled := make([]*CompiledRuleset, len(v.Manifests))
	for i, m := range v.Manifests {
		compiled[i] = mustCompile(t, m)
	}
	for i, c := range v.Runs {
		r := compiled[c.Manifest].Ruleset
		var g *Generator
		for k := range r.Generators {
			if r.Generators[k].ID == c.Generator {
				g = &r.Generators[k]
			}
		}
		served := func(entity, key string) *ServedEntry {
			for _, e := range c.Served {
				if e.Entity == entity && e.Key == key {
					return &ServedEntry{Key: e.Key, Name: e.Name, Body: e.Body}
				}
			}
			return nil
		}
		root, each, refused := CheckRun(r, g, c.Run, served, c.Campaign)
		var got any
		if refused != nil {
			got = map[string]any{"ok": false, "code": refused.Code, "params": refused.Params}
		} else {
			got = map[string]any{"ok": true, "root": root, "each": each}
		}
		if CanonicalJSON(roundTrip(t, got)) != CanonicalJSON(c.Result) {
			t.Errorf("run %d (%s): want %s, got %s", i, c.Generator, CanonicalJSON(c.Result), CanonicalJSON(roundTrip(t, got)))
		}
	}
}
