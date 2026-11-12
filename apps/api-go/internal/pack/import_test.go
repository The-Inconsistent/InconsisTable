package pack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// These tests need a Postgres 18 (TEST_DATABASE_URL), migrated by dbtest.Open; without one they are skipped, so
// `bun run test:go` stays free of a database. They use their own random users and remove what they wrote.
func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return dbtest.Open(t)
}

func fixture(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

var counter int

// newOwner is a user id nobody else has, and removes what the test made for it.
func newOwner(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	counter++
	id := fmt.Sprintf("test-pack-%d-%d", os.Getpid(), counter)
	ctx := context.Background()
	if _, err := db.Exec(ctx, `INSERT INTO app_user (id, name) VALUES ($1, $1)`, id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, sql := range []string{
			`DELETE FROM campaign WHERE owner_user_id = $1`,
			`DELETE FROM pack WHERE owner_user_id = $1`,
			`DELETE FROM ruleset WHERE owner_user_id = $1`, // its versions go with it
			`DELETE FROM app_user WHERE id = $1`,
		} {
			_, _ = db.Exec(ctx, sql, id)
		}
	})
	return id
}

func TestImportRefusesThePackOverTheQuota(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner := newOwner(t, db)
	if _, err := ruleset.Import(ctx, db, owner, fixture(t, "sample-d20.json")); err != nil {
		t.Fatal(err)
	}
	for i := range MaxPacksPerUser {
		p := fixture(t, "sample-pack.json")
		p["id"] = fmt.Sprintf("pack-%d", i)
		if _, err := Import(ctx, db, owner, p); err != nil {
			t.Fatalf("pack %d: %v", i, err)
		}
	}
	p := fixture(t, "sample-pack.json")
	p["id"] = "one-too-many"
	_, err := Import(ctx, db, owner, p)
	var refused *ruleset.Refused
	if !errors.As(err, &refused) || refused.Problems[0].Path != "(quota)" || refused.Problems[0].Message != "at most 50 packs" {
		t.Fatalf("the 51st pack must be refused by the quota, got %v", err)
	}
	// A new version of a pack already there is not a new pack.
	again := fixture(t, "sample-pack.json")
	again["id"] = "pack-0"
	again["version"] = "0.2.0"
	if out, err := Import(ctx, db, owner, again); err != nil || out.Unchanged {
		t.Fatalf("a new version of an owned pack must import, got %v, %v", out, err)
	}
}

func TestAPrivatePackIsNotServedToAnotherOwnersRoom(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	owner, rival := newOwner(t, db), newOwner(t, db)
	rs, err := ruleset.Import(ctx, db, owner, fixture(t, "sample-d20.json"))
	if err != nil {
		t.Fatal(err)
	}
	imported, err := Import(ctx, db, owner, fixture(t, "sample-pack.json"))
	if err != nil {
		t.Fatal(err)
	}
	room := func(by string) string {
		var id string
		if err := db.QueryRow(ctx, `INSERT INTO campaign (name, owner_user_id, ruleset_version_id) VALUES ('room', $1, $2) RETURNING id::text`,
			by, rs.VersionID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, id, by); err != nil {
			t.Fatal(err)
		}
		// Attached straight into the table: the attach action's own checks are not what is under test.
		if _, err := db.Exec(ctx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, id, imported.VersionID); err != nil {
			t.Fatal(err)
		}
		return id
	}
	read := func(campaignID, userID, role string) *Rules {
		c := coreschema.Ctx{CampaignID: campaignID, UserID: &userID, Seat: coreschema.Seat{Kind: coreschema.SeatMember, Role: role}}
		out, err := ReadRules(ctx, db, c, RulesQuery{Limit: defaultRulesPage})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	mine := room(owner)
	if got := read(mine, owner, "gm"); len(got.Packs) != 1 || got.Total != 4 {
		t.Fatalf("the owner's GM reads the whole pack, got %d packs and %d entries", len(got.Packs), got.Total)
	}
	if got := read(mine, "someone", "player"); got.Total != 3 {
		t.Fatalf("a player never reads a gm entry, got %d entries", got.Total)
	}

	// The rival is the GM of a room that holds the owner's private pack, but the owner is no GM there.
	theirs := room(rival)
	if got := read(theirs, rival, "gm"); len(got.Packs) != 0 || len(got.Entries) != 0 || got.Total != 0 {
		t.Fatalf("a private pack must stay out of another owner's room, got %d packs and %d entries", len(got.Packs), got.Total)
	}
	loaded, err := LoadServedEntries(ctx, db, theirs, ServedOptions{})
	if err != nil || len(loaded) != 0 {
		t.Fatalf("the lookup must not serve it either, got %d entries, %v", len(loaded), err)
	}
	if loaded, err = LoadServedEntries(ctx, db, mine, ServedOptions{Types: []string{"creature"}}); err != nil || len(loaded) != 1 {
		t.Fatalf("the owner's room serves its creature, got %d entries, %v", len(loaded), err)
	}
}
