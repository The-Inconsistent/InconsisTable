package view

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Every sample's manifest as each seat is served it compiles, and is the one TypeScript serves (house decision #101;
// vectors/table.ts writes them).
func TestServedManifestsCompileAndMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../coreschema/testdata/served-manifests.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Inputs    map[string]any `json:"inputs"`
		Manifests []struct {
			Fixture  string    `json:"fixture"`
			SeatName string    `json:"seatName"`
			Ctx      vectorCtx `json:"ctx"`
			Manifest any       `json:"manifest"`
		} `json:"manifests"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Inputs) < 10 || len(v.Manifests) < 100 {
		t.Fatalf("only %d fixtures and %d manifests, so this test would prove little", len(v.Inputs), len(v.Manifests))
	}
	compiled := map[string]*engine.CompiledRuleset{}
	for name, input := range v.Inputs {
		c, problems := engine.CompileRuleset(input)
		if len(problems) > 0 {
			t.Fatalf("%s does not compile: %v", name, problems)
		}
		compiled[name] = c
	}
	for _, c := range v.Manifests {
		ctx := cs.Ctx{
			CampaignID: c.Ctx.CampaignID, UserID: c.Ctx.UserID, CampaignOwnerID: c.Ctx.CampaignOwnerID, TableMode: c.Ctx.TableMode,
			Seat: cs.Seat{Kind: c.Ctx.Seat.Kind, Role: c.Ctx.Seat.Role, Scopes: c.Ctx.Seat.Scopes, CharacterIDs: c.Ctx.Seat.CharacterIDs},
		}
		normalized := compiled[c.Fixture].Ruleset.Normalized
		before := engine.CanonicalJSON(normalized)
		got := SeatManifest(normalized, ctx)
		label := c.Fixture + ", " + c.SeatName + " (" + c.Ctx.TableMode + ")"
		if _, problems := engine.CompileRuleset(got); len(problems) > 0 {
			t.Errorf("%s: the served manifest does not compile: %v", label, problems)
		}
		if want, have := engine.CanonicalJSON(c.Manifest), canonical(t, got); want != have {
			t.Errorf("%s: manifest\n want %s\n  got %s", label, want, have)
		}
		if engine.CanonicalJSON(normalized) != before {
			t.Fatalf("%s: the seat's manifest wrote into the room's", label)
		}
	}
}

// A strike its owner sends that a player's copy does not carry as declared is refused at import, as TypeScript refuses
// it (house decision #112; vectors/table.ts writes them).
func TestOwnerStrikeProblemsMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../coreschema/testdata/served-manifests.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Owner struct {
			Fixtures map[string]any              `json:"OWNER_STRIKE_FIXTURES"`
			Problems map[string][]engine.Problem `json:"ownerStrikes"`
		} `json:"owner"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	refused := 0
	for name, input := range v.Owner.Fixtures {
		c, problems := engine.CompileRuleset(input)
		if len(problems) > 0 {
			t.Fatalf("%s does not compile: %v", name, problems)
		}
		got := OwnerStrikeProblems(c.Ruleset.Normalized)
		if want := v.Owner.Problems[name]; !reflect.DeepEqual(append([]engine.Problem{}, got...), append([]engine.Problem{}, want...)) {
			t.Errorf("%s:\n want %v\n  got %v", name, want, got)
		}
		refused += len(got)
	}
	if refused < 2 {
		t.Fatalf("only %d refused, so this test would prove little", refused)
	}
}

// A problem no part answers leaves the manifest as it is: a cut never reaches past the document.
func TestCompilableGivesUpWithoutWriting(t *testing.T) {
	m := map[string]any{"id": "x"}
	got := compilable(m)
	if !reflect.DeepEqual(got, map[string]any{"id": "x"}) {
		t.Errorf("got %v", got)
	}
}
