package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// The widget list against packages/rules-engine/src/widgets.ts (house decision #83). The manifests that use widget rows
// are in the manifest vectors.
func TestWidgetListMatchesTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Widgets struct {
			List    any      `json:"list"`
			Targets []string `json:"targets"`
		} `json:"widgets"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	mine, err := json.Marshal(Widgets)
	if err != nil {
		t.Fatal(err)
	}
	var ours any
	if err := json.Unmarshal(mine, &ours); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ours, v.Widgets.List) {
		t.Fatalf("widgets differ:\n go %s\n ts %v", mine, v.Widgets.List)
	}
	if !reflect.DeepEqual(LayoutTargets, v.Widgets.Targets) {
		t.Fatalf("layout targets differ: go %v, ts %v", LayoutTargets, v.Widgets.Targets)
	}
}
