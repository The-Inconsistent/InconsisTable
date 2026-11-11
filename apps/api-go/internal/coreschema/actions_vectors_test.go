package coreschema

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The socket's schemas against packages/core-schema (vectors/table.ts): the same inputs pass with the same output, and
// the same are refused. The refusal text only travels as detail, so it is not compared (ADR 0008).
func TestActionsMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/actions.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Actions []struct {
			Schema string `json:"schema"`
			Input  any    `json:"input"`
			Ok     bool   `json:"ok"`
			Output any    `json:"output"`
		} `json:"actions"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Actions) < 1000 {
		t.Fatalf("only %d action vectors, so this test would prove little", len(v.Actions))
	}
	seen := map[string]bool{}
	for _, c := range v.Actions {
		var out any
		var ok bool
		switch c.Schema {
		case "Action":
			a, issues := ParseAction(c.Input)
			ok, out = issues == nil, map[string]any(a)
			if ok {
				seen[a.Type()] = true
			}
		case "BookPage", "BookServing":
			s := map[string]schema.Schema{"BookPage": BookPage, "BookServing": BookServing}[c.Schema]
			parsed, issues := schema.Parse(s, c.Input)
			ok, out = len(issues) == 0, parsed
		case "BookAck":
			out, ok = BookAck(c.Input)
		default:
			t.Fatalf("unknown schema %s", c.Schema)
		}
		if ok != c.Ok {
			t.Errorf("%s %s: TypeScript ok=%v, Go ok=%v", c.Schema, engine.CanonicalJSON(c.Input), c.Ok, ok)
			continue
		}
		if ok {
			if want, got := engine.CanonicalJSON(c.Output), engine.CanonicalJSON(viaJSON(t, out)); want != got {
				t.Errorf("%s %s:\n want %s\n  got %s", c.Schema, engine.CanonicalJSON(c.Input), want, got)
			}
		}
	}
	for actionType := range ActionPerms {
		if !seen[actionType] {
			t.Errorf("no accepted vector for %s", actionType)
		}
	}
}
