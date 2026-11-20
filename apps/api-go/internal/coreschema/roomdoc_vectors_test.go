package coreschema

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The room document refuses and accepts what packages/core-schema's RoomDocument does, word for word (vectors/roomdoc.ts).
func TestRoomDocumentMatchesTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/roomdoc.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Shapes []struct {
			Label  string `json:"label"`
			Input  any    `json:"input"`
			Ok     bool   `json:"ok"`
			Output any    `json:"output"`
			Pretty string `json:"pretty"`
		} `json:"shapes"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Shapes) < 10 {
		t.Fatal("too few vectors to prove anything")
	}
	for _, x := range v.Shapes {
		out, issues := schema.Parse(RoomDocument, x.Input)
		switch {
		case x.Ok && len(issues) > 0:
			t.Errorf("%s: want it accepted, got %s", x.Label, schema.Prettify(issues))
		case !x.Ok && schema.Prettify(issues) != x.Pretty:
			t.Errorf("%s:\n  want %q\n  got  %q", x.Label, x.Pretty, schema.Prettify(issues))
		case x.Ok && !reflect.DeepEqual(viaJSON(t, out), x.Output):
			t.Errorf("%s: want %v, got %v", x.Label, x.Output, out)
		}
	}
}
