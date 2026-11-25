package view

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// House decision #114: an actor behind a combatant the GM shows in full reaches every seat while the fight runs, with
// only what a seat reads of an actor it does not hold. `bar` and `hidden` send nothing, and nothing stays once the
// fight ends. The manifest is the vectors' (sample-d20's creature: `name` public, `level` gm, Vigour party).
func TestAFoeShownInFullIsSentWithItsReadableValuesOnly(t *testing.T) {
	raw, err := os.ReadFile("../coreschema/testdata/views.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Manifest any `json:"manifest"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	compiled, problems := engine.CompileRuleset(v.Manifest)
	if len(problems) > 0 {
		t.Fatalf("the vector manifest does not compile: %v", problems)
	}
	owner := "someone"
	foe := func(id string) cs.Actor {
		return cs.Actor{
			ID: id, Kind: "creature", Name: id, Status: "active", OwnerUserID: &owner, Entity: "creature",
			Fields:    map[string]any{"name": id, "level": float64(3), "healthState": "ok"},
			Resources: map[string]float64{"hp": 5}, Derived: map[string]float64{"maxHp": 9},
			Conditions: []string{}, ConditionTimers: []cs.ConditionTimer{}, SpawnOptions: []string{"quick"},
		}
	}
	at := func(actorID, visibility string) cs.Combatant {
		return cs.Combatant{ID: "c-" + actorID, ActorID: actorID, Name: actorID, Side: "foe", Visibility: visibility,
			Conditions: []cs.CombatantCondition{}, States: []cs.CombatantState{}}
	}
	state := cs.LiveState{
		Campaign: cs.CampaignInfo{TableMode: cs.TableModeGM},
		Actors:   []cs.Actor{foe("ogre"), foe("imp"), foe("wisp")},
		Encounter: &cs.Encounter{ID: "e", Round: 1, Combatants: []cs.Combatant{
			at("ogre", "full"), at("imp", "bar"), at("wisp", "hidden"),
		}},
	}
	user := "u"
	player := cs.Ctx{CampaignID: "c", UserID: &user, Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}}
	screen := cs.Ctx{CampaignID: "c", Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
	sent := func(s cs.LiveState, c cs.Ctx) []cs.Actor { return Of(Snapshot{State: s}, compiled, c).State.Actors }
	ids := func(actors []cs.Actor) []string {
		out := []string{}
		for _, a := range actors {
			out = append(out, a.ID)
		}
		return out
	}
	for name, c := range map[string]cs.Ctx{"player": player, "screen": screen} {
		got := sent(state, c)
		if !slices.Equal(ids(got), []string{"ogre"}) {
			t.Fatalf("%s: sent %v, want only the ogre (full)", name, ids(got))
		}
		ogre := got[0]
		if _, ok := ogre.Fields["level"]; ok {
			t.Errorf("%s: sent the gm field level", name)
		}
		if ogre.Fields["name"] != "ogre" || ogre.Resources["hp"] != 5 {
			t.Errorf("%s: the readable values are missing: %v %v", name, ogre.Fields, ogre.Resources)
		}
		if ogre.OwnerUserID != nil || ogre.SpawnOptions != nil {
			t.Errorf("%s: sent the GM side's parts of the actor", name)
		}
	}
	over := state
	over.Encounter = nil
	if got := sent(over, player); len(got) != 0 {
		t.Errorf("after the fight: sent %v", ids(got))
	}
	dropped := state
	e := *state.Encounter
	e.Combatants = []cs.Combatant{at("ogre", "bar"), at("imp", "bar"), at("wisp", "hidden")}
	dropped.Encounter = &e
	if got := sent(dropped, player); len(got) != 0 {
		t.Errorf("at bar: sent %v", ids(got))
	}
	gm := cs.Ctx{CampaignID: "c", UserID: &user, Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
	if got := sent(over, gm); len(got) != 3 {
		t.Errorf("the GM side reads every actor, got %v", ids(got))
	}
}
