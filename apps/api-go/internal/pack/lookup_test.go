package pack

import "testing"

func TestEntryLookupHidesGmEntriesFromPlayers(t *testing.T) {
	entries := []StoredEntry{
		{Key: "ember-wisp", Type: "creature", Name: "Ember Wisp", Visibility: "gm", Tags: []string{}},
		{Key: "reedfolk", Type: "lineage", Name: "Reedfolk", Visibility: "public", Tags: []string{}},
		{Key: "coil-rope", Type: "gear", Name: "Coil of Rope", Visibility: "party", Tags: []string{}},
	}
	gm, player := EntryLookup(entries, true), EntryLookup(entries, false)
	if e := gm("creature", "ember-wisp"); e == nil || e.Name != "Ember Wisp" {
		t.Fatalf("the GM side finds a gm entry, got %v", e)
	}
	if player("creature", "ember-wisp") != nil {
		t.Fatal("a player's lookup found a gm entry")
	}
	if player("lineage", "reedfolk") == nil || player("gear", "coil-rope") == nil {
		t.Fatal("a player finds public and party entries")
	}
	if gm("calling", "reedfolk") != nil {
		t.Fatal("a key is found only under its own type")
	}
}
