package view

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// A gm definition's label, in every language it is given in (issue #159), goes with the definition.
func TestSeatManifestSendsAPlayerNoWordOfAGmLabel(t *testing.T) {
	input := manifest()
	doom := input["resources"].([]any)[1].(map[string]any)
	doom["label"] = map[string]any{"en": "Doom", "vi": "Tai hoạ"}
	player := cs.Ctx{CampaignID: "c", Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}}
	served, err := json.Marshal(SeatManifest(input, player))
	if err != nil {
		t.Fatal(err)
	}
	for _, word := range []string{"Doom", "Tai hoạ"} {
		if strings.Contains(string(served), word) {
			t.Errorf("a player is sent %q, a gm resource's label", word)
		}
	}
}

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

func withTables() map[string]any {
	m := manifest()
	entry := func(id string) any { return map[string]any{"id": id, "label": id} }
	m["tables"] = map[string]any{
		"season": map[string]any{"title": "Season", "visibility": "party", "entries": []any{entry("frost")}},
		"role":   map[string]any{"title": "Role", "visibility": "owner", "entries": []any{entry("mole")}},
		"omen":   map[string]any{"title": "Omen", "visibility": "gm", "entries": []any{entry("doom")}},
	}
	return m
}

// The entries of a gm or owner table are what a roll or a deal keeps secret: only the side that runs the table with a
// GM reads them, and a seat that deals without one still sees the titles.
func TestSeatManifestKeepsTheEntriesOfSecretTablesFromTheTable(t *testing.T) {
	entries := func(m map[string]any, id string) int {
		return len(m["tables"].(map[string]any)[id].(map[string]any)["entries"].([]any))
	}
	input := withTables()
	for name, c := range map[string]cs.Ctx{
		"player":         {Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}},
		"co-GM combat":   {Seat: cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"combat", "party"}}},
		"screen":         {Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}},
		"player no GM":   {TableMode: cs.TableModeGMLess, Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}},
		"stale GM no GM": {TableMode: cs.TableModeGMLess, Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}},
	} {
		got := SeatManifest(input, c)
		if entries(got, "season") != 1 || entries(got, "role") != 0 || entries(got, "omen") != 0 {
			t.Errorf("%s: got %v", name, got["tables"])
		}
		if got["tables"].(map[string]any)["role"].(map[string]any)["title"] != "Role" {
			t.Errorf("%s: lost the title", name)
		}
	}
	if !reflect.DeepEqual(input, withTables()) {
		t.Error("the manifest the seat view was made from was written to")
	}
	for name, c := range map[string]cs.Ctx{
		"gm":          {Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}},
		"co-GM":       {Seat: cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"session"}}},
		"admin no GM": {TableMode: cs.TableModeGMLess, Seat: cs.Seat{Kind: cs.SeatAdmin}},
	} {
		if got := SeatManifest(input, c); entries(got, "role") != 1 || entries(got, "omen") != 1 {
			t.Errorf("%s: should read every entry: %v", name, got["tables"])
		}
	}
}

func TestSeatManifestIsWholeOnTheGmSide(t *testing.T) {
	gm := cs.Ctx{CampaignID: "c", Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
	if !reflect.DeepEqual(SeatManifest(manifest(), gm), manifest()) {
		t.Error("the GM reads the whole manifest")
	}
}
