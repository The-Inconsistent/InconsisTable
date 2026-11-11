package view

import (
	"reflect"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func def(id, visibility string) map[string]any {
	return map[string]any{"id": id, "visibility": visibility}
}

func manifest() map[string]any {
	return map[string]any{
		"id": "m",
		"entities": []any{map[string]any{
			"id":      "pc",
			"fields":  map[string]any{"name": def("name", "public"), "secret": def("secret", "gm"), "bond": def("bond", "party")},
			"derived": []any{def("ac", "public"), def("hidden", "gm")},
		}},
		"resources":  []any{def("hp", "party"), def("doom", "gm")},
		"conditions": []any{def("dazed", "public"), def("cursed", "gm")},
	}
}

func TestSeatManifestHidesGmDefinitionsFromPlayers(t *testing.T) {
	input := manifest()
	player := cs.Ctx{CampaignID: "c", Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}}
	got := SeatManifest(input, player)
	entity := got["entities"].([]any)[0].(map[string]any)
	if fields := entity["fields"].(map[string]any); len(fields) != 2 || fields["secret"] != nil {
		t.Errorf("a player reads no gm field, got %v", fields)
	}
	if derived := entity["derived"].([]any); len(derived) != 1 {
		t.Errorf("a player reads no gm derived value, got %v", derived)
	}
	if got["resources"].([]any)[0].(map[string]any)["id"] != "hp" || len(got["resources"].([]any)) != 1 {
		t.Errorf("a player reads no gm resource, got %v", got["resources"])
	}
	if len(got["conditions"].([]any)) != 1 {
		t.Errorf("a player reads no gm condition, got %v", got["conditions"])
	}
	if !reflect.DeepEqual(input, manifest()) {
		t.Error("the manifest the seat view was made from was written to")
	}
}

func TestSeatManifestIsWholeOnTheGmSide(t *testing.T) {
	gm := cs.Ctx{CampaignID: "c", Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
	if !reflect.DeepEqual(SeatManifest(manifest(), gm), manifest()) {
		t.Error("the GM reads the whole manifest")
	}
}
