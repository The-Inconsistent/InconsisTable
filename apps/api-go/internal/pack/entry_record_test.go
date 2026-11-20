package pack

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

func orNone(s *string) string {
	if s == nil {
		return "<none>"
	}
	return *s
}

// ledgerVectors are the ledger ruleset and, as TypeScript wrote it, a pack whose records arrive with their keys in
// reverse, with the text TypeScript answers for each record (apps/api-go/vectors/generate.ts, ledgerPacks).
func ledgerVectors(t *testing.T) (manifest map[string]any, input json.RawMessage, want map[string]string) {
	t.Helper()
	raw, err := os.ReadFile("../engine/testdata/vectors.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		LedgerPacks struct {
			Rulesets []map[string]any `json:"rulesets"`
			Cases    []struct {
				Input   json.RawMessage `json:"input"`
				Records []*string       `json:"records"`
			} `json:"cases"`
		} `json:"ledgerPacks"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	shuffled := v.LedgerPacks.Cases[1]
	var entries struct {
		Entries []struct {
			Key string `json:"key"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(shuffled.Input, &entries); err != nil {
		t.Fatal(err)
	}
	want = map[string]string{}
	for i, e := range entries.Entries {
		want[e.Key] = *shuffled.Records[i]
	}
	return v.LedgerPacks.Rulesets[0], shuffled.Input, want
}

// A catalogue record (house decision #62) is stored in its schema's key order whatever order it came in, and survives
// the lookup, the served rules and an export byte for byte; an export imports again unchanged, and into another
// owner's library as the same bytes. An entry without a record has none anywhere.
func TestEntryRecordsKeepTheirOrderThroughImportServeAndExport(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner := newOwner(t, db)
	manifest, input, want := ledgerVectors(t)
	rs, err := ruleset.Import(ctx, db, owner, manifest)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := schema.DecodeJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	// An entry of a type no kind names, without a record, and for the GM only.
	hero := schema.NewObj().Set("key", "sample-hero").Set("type", "hero").Set("name", "Sample Hero").
		Set("cite", "Base p.1").Set("body", schema.NewObj().Set("xp", 3.0))
	entries, _ := doc.(*schema.Obj).Get("entries")
	doc.(*schema.Obj).Set("entries", append(entries.([]any), hero))
	imported, err := Import(ctx, db, owner, doc)
	if err != nil {
		t.Fatal(err)
	}

	stored := func(versionID string) map[string]*string {
		rows, err := db.Query(ctx, `SELECT key, record::text FROM pack_entry WHERE pack_version_id = $1`, versionID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]*string{}
		for rows.Next() {
			var key string
			var record *string
			if err := rows.Scan(&key, &record); err != nil {
				t.Fatal(err)
			}
			out[key] = record
		}
		return out
	}
	first := stored(imported.VersionID)
	if len(first) != len(want)+1 || first["sample-hero"] != nil {
		t.Fatalf("stored %d entries, the hero's record %v", len(first), first["sample-hero"])
	}
	for key, text := range want {
		if got := first[key]; got == nil || *got != text {
			t.Errorf("%s stored\n  %v\n  want %s", key, orNone(got), text)
		}
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

	loaded, err := LoadServedEntries(ctx, db, campaignID, ServedOptions{})
	if err != nil || len(loaded) != len(want)+1 {
		t.Fatalf("loaded %d entries, %v", len(loaded), err)
	}
	for _, e := range loaded {
		if text, ok := want[e.Key]; (ok && string(e.Record) != text) || (!ok && e.Record != nil) {
			t.Errorf("lookup of %s: record %s", e.Key, e.Record)
		}
	}

	player := newOwner(t, db)
	for _, c := range []coreschema.Ctx{
		{CampaignID: campaignID, UserID: &owner, Seat: coreschema.Seat{Kind: coreschema.SeatMember, Role: "gm"}},
		{CampaignID: campaignID, UserID: &player, Seat: coreschema.Seat{Kind: coreschema.SeatMember, Role: "player"}},
	} {
		served, err := ReadRules(ctx, db, c, RulesQuery{Limit: maxRulesPage})
		if err != nil {
			t.Fatal(err)
		}
		reply, err := json.Marshal(served)
		if err != nil {
			t.Fatal(err)
		}
		var read struct {
			Entries []struct {
				Key    string          `json:"key"`
				Record json.RawMessage `json:"record"`
			} `json:"entries"`
		}
		if err := json.Unmarshal(reply, &read); err != nil {
			t.Fatal(err)
		}
		records := 0
		heroServed := false
		for _, e := range read.Entries {
			if e.Key == "sample-hero" {
				heroServed = true
				if string(e.Record) != "null" {
					t.Errorf("the hero serves record %s", e.Record)
				}
				continue
			}
			records++
			if string(e.Record) != want[e.Key] {
				t.Errorf("rules for %s as %s: record %s", e.Key, c.Seat.Role, e.Record)
			}
		}
		// The hero is a gm entry: served to the GM side only.
		if heroServed != (c.Seat.Role == "gm") || records != len(want) {
			t.Errorf("as %s: %d records served, the gm entry among them: %v", c.Seat.Role, records, heroServed)
		}
	}

	out, err := Export(ctx, db, owner, imported.PackID)
	if err != nil || out == nil {
		t.Fatal(out, err)
	}
	for _, e := range out.Entries {
		if text, ok := want[e.Key]; (ok && string(e.Record) != text) || (!ok && e.Record != nil) {
			t.Errorf("export of %s: record %s", e.Key, e.Record)
		}
	}
	exported, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	again := func(userID string) *Imported {
		doc, err := schema.DecodeJSON(exported)
		if err != nil {
			t.Fatal(err)
		}
		result, err := Import(ctx, db, userID, doc)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	if same := again(owner); !same.Unchanged || len(same.Diff.Changed) != 0 {
		t.Fatalf("an export imports again as the same content: %+v", same)
	}
	other := newOwner(t, db)
	if _, err := ruleset.Import(ctx, db, other, manifest); err != nil {
		t.Fatal(err)
	}
	copied := stored(again(other).VersionID)
	for key, text := range first {
		if (text == nil) != (copied[key] == nil) || (text != nil && *text != *copied[key]) {
			t.Errorf("%s after export and import: %v, was %v", key, orNone(copied[key]), orNone(text))
		}
	}
}
