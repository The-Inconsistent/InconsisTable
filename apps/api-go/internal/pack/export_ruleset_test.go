package pack

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

func TestRulesetExportIsTheOwnersNewestManifest(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, other := newOwner(t, db), newOwner(t, db)
	first, err := ruleset.Import(ctx, db, owner, fixture(t, "sample-d20.json"))
	if err != nil {
		t.Fatal(err)
	}
	next := fixture(t, "sample-d20.json")
	next["version"] = "9.9.9"
	if _, err := ruleset.Import(ctx, db, owner, next); err != nil {
		t.Fatal(err)
	}
	raw, err := ruleset.Export(ctx, db, owner, first.RulesetID)
	if err != nil || raw == nil {
		t.Fatalf("owner export: %v, %v", raw, err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil || back["version"] != "9.9.9" {
		t.Fatalf("want the newest version, got %v, %v", back["version"], err)
	}
	if out, err := ruleset.Import(ctx, db, owner, back); err != nil || !out.Unchanged {
		t.Fatalf("re-importing the export must be unchanged, got %v, %v", out, err)
	}
	if raw, err := ruleset.Export(ctx, db, other, first.RulesetID); raw != nil || err != nil {
		t.Fatalf("another user must get nothing, got %s, %v", raw, err)
	}
	if raw, err := ruleset.Export(ctx, db, owner, "019a0000-0000-7000-8000-000000000000"); raw != nil || err != nil {
		t.Fatalf("a missing id must get nothing, got %s, %v", raw, err)
	}
}
