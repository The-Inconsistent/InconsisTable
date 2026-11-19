package pack

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// An entry's effects (house decision #61) survive import, the lookups, the served rules and an export, and an export
// imports again as the same content.
func TestEntryEffectsSurviveImportServeAndExport(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner := newOwner(t, db)
	rs, err := ruleset.Import(ctx, db, owner, fixture(t, "sample-d20.json"))
	if err != nil {
		t.Fatal(err)
	}
	doc := fixture(t, "sample-pack.json")
	effects := []any{map[string]any{"path": "derived.defense", "mode": "add", "value": "3", "phase": "derived"}}
	for _, e := range doc["entries"].([]any) {
		if e.(map[string]any)["key"] == "wayfinder" {
			e.(map[string]any)["effects"] = effects
		}
	}
	imported, err := Import(ctx, db, owner, doc)
	if err != nil {
		t.Fatal(err)
	}

	var campaignID string
	if err := db.QueryRow(ctx, `INSERT INTO campaign (name, owner_user_id, ruleset_version_id) VALUES ('room', $1, $2) RETURNING id::text`,
		owner, rs.VersionID).Scan(&campaignID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, campaignID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, campaignID, imported.VersionID); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadServedEntries(ctx, db, campaignID, ServedOptions{Types: []string{"calling", "lineage"}})
	if err != nil || len(loaded) != 2 {
		t.Fatalf("loaded %d entries, %v", len(loaded), err)
	}
	for _, e := range loaded {
		var got []map[string]any
		if err := json.Unmarshal(e.Effects, &got); err != nil {
			t.Fatal(err)
		}
		if (e.Key == "wayfinder") != (len(got) == 1) {
			t.Fatalf("%s carries %v", e.Key, got)
		}
	}

	c := coreschema.Ctx{CampaignID: campaignID, UserID: &owner, Seat: coreschema.Seat{Kind: coreschema.SeatMember, Role: "gm"}}
	served, err := ReadRules(ctx, db, c, RulesQuery{Limit: defaultRulesPage})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range served.Entries {
		if e.Key != "wayfinder" && string(e.Effects) != "[]" {
			t.Fatalf("%s serves effects %s", e.Key, e.Effects)
		}
		if e.Key == "wayfinder" && len(e.Effects) < 10 {
			t.Fatalf("wayfinder serves effects %s", e.Effects)
		}
	}

	out, err := Export(ctx, db, owner, imported.PackID)
	if err != nil || out == nil {
		t.Fatal(out, err)
	}
	raw, _ := json.Marshal(out)
	var exported map[string]any
	if err := json.Unmarshal(raw, &exported); err != nil {
		t.Fatal(err)
	}
	for _, e := range exported["entries"].([]any) {
		_, has := e.(map[string]any)["effects"]
		if has != (e.(map[string]any)["key"] == "wayfinder") {
			t.Fatalf("export of %v: effects key present = %v", e.(map[string]any)["key"], has)
		}
	}
	again, err := Import(ctx, db, owner, exported)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Unchanged || !reflect.DeepEqual(again.Diff.Changed, []string{}) {
		t.Fatalf("an export imports again as the same content: %+v", again)
	}
}

// An entry's effects are checked at import against the actor types that choose its type.
func TestImportRefusesEffectsNothingChooses(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner := newOwner(t, db)
	if _, err := ruleset.Import(ctx, db, owner, fixture(t, "sample-d20.json")); err != nil {
		t.Fatal(err)
	}
	doc := fixture(t, "sample-pack.json")
	for _, e := range doc["entries"].([]any) {
		if e.(map[string]any)["key"] == "coil-rope" { // a gear: no choose step picks it
			e.(map[string]any)["effects"] = []any{map[string]any{"path": "derived.defense", "mode": "add", "value": "1", "phase": "derived"}}
		}
	}
	_, err := Import(ctx, db, owner, doc)
	var refused *ruleset.Refused
	if !errors.As(err, &refused) {
		t.Fatalf("want a refusal, got %v", err)
	}
	if refused.Problems[0].Message != `nothing chooses a "gear", so these could never apply` {
		t.Fatalf("got %v", err)
	}
}
