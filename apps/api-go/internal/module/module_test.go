package module

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// These need a Postgres 18 (TEST_DATABASE_URL) and skip without one; each runs in a rolled-back transaction. The
// documents are the invented samples the pack tests use, and an invented World.

func fixture(t *testing.T, name string) any {
	t.Helper()
	raw, err := os.ReadFile("../pack/testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := schema.DecodeJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return schema.Plain(doc)
}

var tide = map[string]any{"id": "tide", "version": "1.0.0", "core": "^1.0.0", "name": "Tide",
	"theme": map[string]any{"schemes": map[string]any{"light": map[string]any{}}}}

func part(slug, version string) map[string]any {
	return map[string]any{"slug": slug, "version": version}
}

// whole is a module that carries its ruleset, its pack and its World.
func whole(t *testing.T) map[string]any {
	return map[string]any{"id": "game", "version": "1.0.0", "core": "^1.0.0", "name": "Game",
		"ruleset": part("sample-d20", "0.1.1"), "packs": []any{part("sample-bestiary", "0.1.0")}, "world": part("tide", "1.0.0"),
		"documents": map[string]any{"ruleset": fixture(t, "sample-d20.json"), "packs": []any{fixture(t, "sample-pack.json")},
			"world": tide}}
}

func refusedAt(t *testing.T, err error, path, message string) {
	t.Helper()
	var refused *ruleset.Refused
	if !errors.As(err, &refused) || refused.Problems[0].Path != path || !strings.Contains(refused.Problems[0].Message, message) {
		t.Fatalf("want refused at %s (%s), got %v", path, message, err)
	}
}

func count(t *testing.T, tx pgx.Tx, table, owner string) int {
	t.Helper()
	return dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM `+table+` WHERE owner_user_id = $1`, owner)
}

// savepoint runs fn in a nested transaction and rolls it back when fn fails, as the route's own transaction would.
func savepoint(t *testing.T, tx pgx.Tx, fn func(pgx.Tx) error) error {
	t.Helper()
	inner, err := tx.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := fn(inner); err != nil {
		_ = inner.Rollback(context.Background())
		return err
	}
	return inner.Commit(context.Background())
}

func TestImportCarriesAWholeGameOrNothing(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")

		// A bad pack in the module: nothing is left behind, the ruleset and the World included.
		bad := whole(t)
		badPack := fixture(t, "sample-pack.json").(map[string]any)
		badPack["entries"] = []any{map[string]any{"key": "x"}}
		bad["documents"].(map[string]any)["packs"] = []any{badPack}
		err := savepoint(t, tx, func(inner pgx.Tx) error { _, err := ImportTx(ctx, inner, owner, bad); return err })
		var refused *ruleset.Refused
		if !errors.As(err, &refused) || !strings.HasPrefix(refused.Problems[0].Path, "documents.packs[0].entries[0]") {
			t.Fatalf("a bad pack is refused at its path in the module: %v", err)
		}
		for _, table := range []string{"ruleset", "pack", "world", "game_module"} {
			if n := count(t, tx, table, owner); n != 0 {
				t.Fatalf("a refused module left %d %s rows", n, table)
			}
		}

		first := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, whole(t)))
		if first.Unchanged || first.Slug != "game" {
			t.Fatalf("first import: %+v", first)
		}
		again := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, whole(t)))
		if !again.Unchanged || again.VersionID != first.VersionID {
			t.Fatalf("the same module again is a no-op: %+v", again)
		}
		// Naming the same parts, without carrying them, is the same module: its hash leaves the documents out.
		naming := whole(t)
		delete(naming, "documents")
		if same := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, naming)); !same.Unchanged {
			t.Fatalf("naming the carried parts is the same version: %+v", same)
		}

		listed := dbtest.Must[[]Listed](t)(List(ctx, tx, owner))
		if len(listed) != 1 || len(listed[0].Versions) != 1 {
			t.Fatalf("list: %+v", listed)
		}
		v := listed[0].Versions[0]
		if v.Name != "Game" || v.Ruleset.Slug != "sample-d20" || len(v.Packs) != 1 || v.Packs[0].Slug != "sample-bestiary" ||
			v.World == nil || v.World.Slug != "tide" {
			t.Fatalf("listed version: %+v", v)
		}
		// The export is the list, each part with the hash it was found under, and no documents.
		raw := dbtest.Must[json.RawMessage](t)(Export(ctx, tx, owner, first.ModuleID))
		var exported map[string]any
		if err := json.Unmarshal(raw, &exported); err != nil {
			t.Fatal(err)
		}
		if _, carried := exported["documents"]; carried || len(exported["ruleset"].(map[string]any)["hash"].(string)) != 64 {
			t.Fatalf("export: %s", raw)
		}
		if back := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, exported)); !back.Unchanged {
			t.Fatalf("an export re-imports unchanged: %+v", back)
		}

		// Another user neither lists, exports, deletes nor builds a room from it.
		other := dbtest.User(t, tx, "Other")
		if out := dbtest.Must[[]Listed](t)(List(ctx, tx, other)); len(out) != 0 {
			t.Fatal("another user lists someone else's module")
		}
		if out := dbtest.Must[json.RawMessage](t)(Export(ctx, tx, other, first.ModuleID)); out != nil {
			t.Fatal("another user exports someone else's module")
		}
		if gone := dbtest.Must[bool](t)(Delete(ctx, tx, other, first.ModuleID)); gone {
			t.Fatal("another user deletes someone else's module")
		}
	})
}

func TestImportRefusesWhatItCannotFind(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		naming := whole(t)
		delete(naming, "documents")
		_, err := ImportTx(ctx, tx, owner, naming)
		refusedAt(t, err, "ruleset", `import the ruleset "sample-d20" 0.1.1 first`)

		// A module naming a ruleset version it does not carry.
		other := whole(t)
		other["ruleset"] = part("sample-d20", "0.2.0")
		_, err = ImportTx(ctx, tx, owner, other)
		refusedAt(t, err, "documents.ruleset", "carries sample-d20 0.1.1, which the module does not name")

		dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, whole(t)))
		wrongHash := whole(t)
		delete(wrongHash, "documents")
		wrongHash["packs"] = []any{map[string]any{"slug": "sample-bestiary", "version": "0.1.0", "hash": strings.Repeat("0", 64)}}
		wrongHash["version"] = "1.1.0"
		_, err = ImportTx(ctx, tx, owner, wrongHash)
		refusedAt(t, err, "packs[0].hash", `"sample-bestiary" 0.1.0 is imported with another hash`)

		missingPack := whole(t)
		delete(missingPack, "documents")
		missingPack["packs"] = []any{part("sample-bestiary", "9.9.9")}
		missingPack["version"] = "1.1.0"
		_, err = ImportTx(ctx, tx, owner, missingPack)
		refusedAt(t, err, "packs[0]", `import the pack "sample-bestiary" 9.9.9 first`)

		changed := whole(t)
		changed["name"] = "Renamed"
		_, err = ImportTx(ctx, tx, owner, changed)
		refusedAt(t, err, "version", "1.0.0 is already imported with other parts: raise the version")
	})
}

func TestARoomFromAModulePinsItsParts(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		versionID := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, whole(t))).VersionID
		id := dbtest.Must[string](t)(CreateRoomTx(ctx, tx, campaign.Owner{UserID: owner, Name: "Owner"}, "Game night", versionID, ""))
		if pinned := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM campaign WHERE id = $1 AND owner_user_id = $2
			AND ruleset_version_id IS NOT NULL AND world_version_id IS NOT NULL`, id, owner); pinned != 1 {
			t.Fatal("the room pins the module's ruleset and World")
		}
		if packs := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM campaign_pack WHERE campaign_id = $1`, id); packs != 1 {
			t.Fatalf("the room has %d packs attached, want 1", packs)
		}

		// A mode the ruleset is not played in is the action's own refusal, and leaves no room.
		err := savepoint(t, tx, func(inner pgx.Tx) error {
			_, err := CreateRoomTx(ctx, inner, campaign.Owner{UserID: owner, Name: "Owner"}, "Solo", versionID, cs.TableModeSolo)
			return err
		})
		var refusal *cs.Error
		if !errors.As(err, &refusal) || refusal.Code != "modeNotPlayed" {
			t.Fatalf("want modeNotPlayed, got %v", err)
		}

		// Another user cannot make a room of it: their own module is the only one they can name, and this one holds a
		// private pack (principle 4).
		other := dbtest.User(t, tx, "Other")
		_, err = CreateRoomTx(ctx, tx, campaign.Owner{UserID: other, Name: "Other"}, "Theirs", versionID, "")
		if !errors.As(err, &refusal) || refusal.Code != "moduleNotFound" {
			t.Fatalf("want moduleNotFound, got %v", err)
		}
		if rooms := count(t, tx, "campaign", other); rooms != 0 {
			t.Fatal("a refused room was left behind")
		}
	})
}
