package actor

import (
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// A resource with `start` begins there (held to its bounds); one without keeps house decision #23 (full, else the floor).
func TestStartingResourcesHonourStart(t *testing.T) {
	res := func(id string, extra map[string]any) map[string]any {
		r := map[string]any{"id": id, "label": id, "scope": "entity", "max": "10", "cite": "Sample p.1"}
		for k, v := range extra {
			r[k] = v
		}
		return r
	}
	compiled, problems := engine.CompileRuleset(map[string]any{
		"id": "m", "version": "1.0.0", "core": "^1.0.0",
		"sources":  []any{map[string]any{"id": "s", "title": "T", "license": "homebrew"}},
		"entities": []any{map[string]any{"id": "pc", "label": "PC", "base": "actor"}},
		"resources": []any{
			res("plain", nil),
			res("up", map[string]any{"start": "min"}),
			res("over", map[string]any{"start": "99"}),
			res("loose", map[string]any{"start": "99", "capped": false}),
		},
		"initiative": map[string]any{"strategy": "seated", "firstPlayer": "fixed"},
	})
	if compiled == nil {
		t.Fatalf("does not compile: %v", problems)
	}
	got, err := StartingResources(compiled, "pc", map[string]any{}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]float64{"plain": 10, "up": 0, "over": 10, "loose": 99}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for _, r := range got {
		if r.Value != want[r.Resource] {
			t.Errorf("%s starts at %v, want %v", r.Resource, r.Value, want[r.Resource])
		}
	}
}
