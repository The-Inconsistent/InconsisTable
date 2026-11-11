package view

import (
	"encoding/json"
	"os"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

type vectorCtx struct {
	UserID          *string `json:"userId"`
	CampaignOwnerID *string `json:"campaignOwnerId"`
	CampaignID      string  `json:"campaignId"`
	Seat            struct {
		Kind         cs.SeatKind `json:"kind"`
		Role         string      `json:"role"`
		Scopes       []string    `json:"scopes"`
		CharacterIDs []string    `json:"characterIds"`
	} `json:"seat"`
}

func canonical(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatal(err)
	}
	return engine.CanonicalJSON(decoded)
}

// The Seat view is the security boundary, so Go must send every seat exactly what apps/api/src/view sends it: the
// vectors run both over the same synthetic snapshots for every kind of seat (vectors/table.ts).
func TestSeatViewsMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../coreschema/testdata/views.json") // beside the other core vectors, which git and Prettier ignore
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Manifest  any `json:"manifest"`
		Snapshots map[string]struct {
			State   json.RawMessage `json:"state"`
			Codex   json.RawMessage `json:"codex"`
			Drafts  map[string]any  `json:"drafts"`
			Ruleset bool            `json:"ruleset"`
		} `json:"snapshots"`
		Views []struct {
			Snapshot string    `json:"snapshot"`
			SeatName string    `json:"seatName"`
			Ctx      vectorCtx `json:"ctx"`
			State    any       `json:"state"`
			Codex    any       `json:"codex"`
		} `json:"views"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Views) < 50 {
		t.Fatalf("only %d seat views, so this test would prove little", len(v.Views))
	}
	compiled, problems := engine.CompileRuleset(v.Manifest)
	if len(problems) > 0 {
		t.Fatalf("the vector manifest does not compile: %v", problems)
	}
	for _, c := range v.Views {
		snap := v.Snapshots[c.Snapshot]
		var s Snapshot
		if err := json.Unmarshal(snap.State, &s.State); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(snap.Codex, &s.Codex); err != nil {
			t.Fatal(err)
		}
		s.Drafts = snap.Drafts
		// The snapshot as Go reads it must be the snapshot TypeScript wrote, or a field is missing from the Go shapes.
		var whole any
		if err := json.Unmarshal(snap.State, &whole); err != nil {
			t.Fatal(err)
		}
		if want, got := engine.CanonicalJSON(whole), canonical(t, s.State); want != got {
			t.Fatalf("%s: the Go state shape drops something:\n want %s\n  got %s", c.Snapshot, want, got)
		}
		ctx := cs.Ctx{
			CampaignID: c.Ctx.CampaignID, UserID: c.Ctx.UserID, CampaignOwnerID: c.Ctx.CampaignOwnerID,
			Seat: cs.Seat{Kind: c.Ctx.Seat.Kind, Role: c.Ctx.Seat.Role, Scopes: c.Ctx.Seat.Scopes, CharacterIDs: c.Ctx.Seat.CharacterIDs},
		}
		var ruleset *engine.CompiledRuleset
		if snap.Ruleset {
			ruleset = compiled
		}
		before := canonical(t, s.State)
		got := Of(s, ruleset, ctx)
		if want, have := engine.CanonicalJSON(c.State), canonical(t, got.State); want != have {
			t.Errorf("%s, %s: state\n want %s\n  got %s", c.Snapshot, c.SeatName, want, have)
		}
		if want, have := engine.CanonicalJSON(c.Codex), canonical(t, got.Codex); want != have {
			t.Errorf("%s, %s: codex\n want %s\n  got %s", c.Snapshot, c.SeatName, want, have)
		}
		// Every socket of a campaign reads the same snapshot, so a seat's view must never write into it.
		if after := canonical(t, s.State); after != before {
			t.Fatalf("%s, %s: the view wrote into the shared snapshot", c.Snapshot, c.SeatName)
		}
	}
}
