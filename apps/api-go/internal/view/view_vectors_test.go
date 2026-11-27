package view

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

type vectorCtx struct {
	UserID          *string `json:"userId"`
	CampaignOwnerID *string `json:"campaignOwnerId"`
	CampaignID      string  `json:"campaignId"`
	TableMode       string  `json:"tableMode"`
	Seat            struct {
		Kind         cs.SeatKind `json:"kind"`
		Role         string      `json:"role"`
		Scopes       []string    `json:"scopes"`
		CharacterIDs []string    `json:"characterIds"`
	} `json:"seat"`
}

// A seat that does not run the fight is sent a creature only when the GM shows it in full, and then none of its `gm`
// values; a combatant shown as a bar carries no numbers (house decision #117).
func assertFoesShownInFull(t *testing.T, name string, s Snapshot, got SeatView, compiled *engine.CompiledRuleset, c cs.Ctx) {
	t.Helper()
	sight := SightOf(c)
	if sight.All || sight.Combat || s.State.Encounter == nil {
		return
	}
	full := map[string]bool{}
	for _, cb := range s.State.Encounter.Combatants {
		full[cb.ActorID] = full[cb.ActorID] || cb.Visibility == "full"
	}
	for _, a := range got.State.Actors {
		if slices.Contains(partyKinds, a.Kind) || holds(HeldBy(c), a.ID) {
			continue
		}
		if !full[a.ID] {
			t.Errorf("%s: sent %s, which is not shown in full", name, a.ID)
		}
		if compiled == nil {
			continue
		}
		gm := func(v string) bool { return v == "" || v == "gm" }
		for _, e := range compiled.Ruleset.Entities {
			for key, def := range e.Fields {
				if _, sent := a.Fields[key]; sent && e.ID == a.Entity && gm(def.Visibility) {
					t.Errorf("%s: sent the gm field %s of %s", name, key, a.ID)
				}
			}
		}
		if ce := compiled.Entities[a.Entity]; ce != nil {
			for _, d := range ce.Derived {
				if _, sent := a.Derived[d.ID]; sent && gm(d.Visibility) {
					t.Errorf("%s: sent the gm derived value %s of %s", name, d.ID, a.ID)
				}
			}
		}
		for _, x := range compiled.Ruleset.Resources {
			if _, sent := a.Resources[x.ID]; sent && gm(x.Visibility) {
				t.Errorf("%s: sent the gm resource %s of %s", name, x.ID, a.ID)
			}
		}
		for _, x := range compiled.Ruleset.Conditions {
			if slices.Contains(a.Conditions, x.ID) && gm(x.Visibility) {
				t.Errorf("%s: sent the gm condition %s of %s", name, x.ID, a.ID)
			}
		}
		// A held record names its entry only where the seat reads the kind's list (#88, #117).
		for _, r := range a.Held {
			kind := compiled.Ruleset.Held[r.Kind]
			if _, readable := a.Fields[kind.Field]; r.Key != nil && !readable {
				t.Errorf("%s: sent the held record %s of %s, whose list the seat may not read", name, *r.Key, a.ID)
			}
		}
	}
	if got.State.Encounter != nil {
		for _, cb := range got.State.Encounter.Combatants {
			if cb.Visibility == "bar" && cb.HP != nil {
				t.Errorf("%s: sent the numbers of %s, shown as a bar", name, cb.ActorID)
			}
		}
	}
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
			Snapshot         string    `json:"snapshot"`
			PackVisibilities []string  `json:"packVisibilities"`
			SeatName         string    `json:"seatName"`
			Ctx              vectorCtx `json:"ctx"`
			State            any       `json:"state"`
			Codex            any       `json:"codex"`
			Manifest         any       `json:"manifest"`
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
			CampaignID: c.Ctx.CampaignID, UserID: c.Ctx.UserID, CampaignOwnerID: c.Ctx.CampaignOwnerID, TableMode: c.Ctx.TableMode,
			Seat: cs.Seat{Kind: c.Ctx.Seat.Kind, Role: c.Ctx.Seat.Role, Scopes: c.Ctx.Seat.Scopes, CharacterIDs: c.Ctx.Seat.CharacterIDs},
		}
		var ruleset *engine.CompiledRuleset
		if snap.Ruleset {
			ruleset = compiled
		}
		before := canonical(t, s.State)
		got := Of(s, ruleset, ctx)
		// The pack route reads the mode from the room it loads, as Of reads it from the snapshot.
		fresh := ctx
		fresh.TableMode = s.State.Campaign.TableMode
		if want, have := engine.CanonicalJSON(toAny(c.PackVisibilities)), engine.CanonicalJSON(toAny(ReadableEntryVisibilities(fresh))); want != have {
			t.Errorf("%s, %s: pack visibilities want %s, got %s", c.Snapshot, c.SeatName, want, have)
		}
		assertNothingForTheGM(t, c.Snapshot+", "+c.SeatName, s.State.Campaign.TableMode, c.Ctx.Seat.Kind, got, ReadableEntryVisibilities(fresh))
		assertFoesShownInFull(t, c.Snapshot+", "+c.SeatName, s, got, ruleset, fresh)
		if want, have := engine.CanonicalJSON(c.State), canonical(t, got.State); want != have {
			t.Errorf("%s, %s: state\n want %s\n  got %s", c.Snapshot, c.SeatName, want, have)
		}
		if want, have := engine.CanonicalJSON(c.Codex), canonical(t, got.Codex); want != have {
			t.Errorf("%s, %s: codex\n want %s\n  got %s", c.Snapshot, c.SeatName, want, have)
		}
		// The manifest the rules route serves this seat (decision 5 of house decision #71 among the rest).
		var manifest any
		if ruleset != nil {
			manifest = SeatManifest(ruleset.Ruleset.Normalized, fresh)
		}
		if want, have := engine.CanonicalJSON(c.Manifest), canonical(t, manifest); want != have {
			t.Errorf("%s, %s: manifest\n want %s\n  got %s", c.Snapshot, c.SeatName, want, have)
		}
		// Every socket of a campaign reads the same snapshot, so a seat's view must never write into it.
		if after := canonical(t, s.State); after != before {
			t.Fatalf("%s, %s: the view wrote into the shared snapshot", c.Snapshot, c.SeatName)
		}
	}
}
