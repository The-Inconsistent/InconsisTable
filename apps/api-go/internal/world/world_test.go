package world

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// These need a Postgres 18 (TEST_DATABASE_URL) and skip without one; each runs in a rolled-back transaction.

// doc is an invented World: one light set whose ink is the given colour.
func doc(slug, version, ink string) map[string]any {
	return map[string]any{"id": slug, "version": version, "core": "^1.0.0", "name": "Tide " + version,
		"theme": map[string]any{"schemes": map[string]any{"light": map[string]any{"ink": ink}}}}
}

func refusedAt(t *testing.T, err error, path, message string) {
	t.Helper()
	var refused *ruleset.Refused
	if !errors.As(err, &refused) || refused.Problems[0].Path != path || refused.Problems[0].Message != message {
		t.Fatalf("want refused at %s (%s), got %v", path, message, err)
	}
}

func TestImportStoresImmutableVersions(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		first := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc("tide", "1.0.0", "#000000")))
		if first.Unchanged || first.Slug != "tide" || first.Version != "1.0.0" {
			t.Fatalf("first import: %+v", first)
		}
		again := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc("tide", "1.0.0", "#000000")))
		if !again.Unchanged || again.VersionID != first.VersionID || again.WorldID != first.WorldID {
			t.Fatalf("the same version again is a no-op: %+v", again)
		}
		_, err := ImportTx(ctx, tx, owner, doc("tide", "1.0.0", "#111111"))
		refusedAt(t, err, "version", "1.0.0 is already imported with other content: raise the version")
		second := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc("tide", "1.1.0", "#111111")))
		if second.WorldID != first.WorldID || second.VersionID == first.VersionID {
			t.Fatalf("a new version is stored beside the old: %+v", second)
		}

		listed := dbtest.Must[[]Listed](t)(List(ctx, tx, owner))
		if len(listed) != 1 || len(listed[0].Versions) != 2 || listed[0].Versions[0].Version != "1.1.0" ||
			listed[0].Versions[0].Name != "Tide 1.1.0" {
			t.Fatalf("list: %+v", listed)
		}
		exported := dbtest.Must[json.RawMessage](t)(Export(ctx, tx, owner, first.WorldID))
		var got map[string]any
		if err := json.Unmarshal(exported, &got); err != nil {
			t.Fatal(err)
		}
		if got["version"] != "1.1.0" {
			t.Fatalf("export is the newest version: %v", got)
		}
		// The export imports again as the same version.
		if back := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, got)); !back.Unchanged {
			t.Fatalf("an export re-imports unchanged: %+v", back)
		}

		other := dbtest.User(t, tx, "Other")
		if out := dbtest.Must[json.RawMessage](t)(Export(ctx, tx, other, first.WorldID)); out != nil {
			t.Fatal("another user exports someone else's World")
		}
		if out := dbtest.Must[[]Listed](t)(List(ctx, tx, other)); len(out) != 0 {
			t.Fatal("another user lists someone else's World")
		}
		// The same slug under another owner is that owner's own World.
		mine := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, other, doc("tide", "1.0.0", "#222222")))
		if mine.WorldID == first.WorldID {
			t.Fatal("two owners share one World")
		}
	})
}

func TestImportRefusesWhatTheValidatorRefuses(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		_, err := ImportTx(context.Background(), tx, owner, doc("tide", "1.0.0", "#f2e5c6"))
		refusedAt(t, err, "theme.schemes.light", `"ink" on "paper" is 1.00:1, under 4.5:1`)
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM world WHERE owner_user_id = $1`, owner); n != 0 {
			t.Fatal("a refused World was stored")
		}
	})
}

func TestImportQuota(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		for i := range MaxVersions {
			dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc("tide", fmt.Sprintf("1.%d.0", i), "#000000")))
		}
		_, err := ImportTx(ctx, tx, owner, doc("tide", "2.0.0", "#000000"))
		refusedAt(t, err, "(quota)", "at most 50 versions of one World")
		for i := 1; i < MaxWorldsPerUser; i++ {
			dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc(fmt.Sprintf("w%d", i), "1.0.0", "#000000")))
		}
		_, err = ImportTx(ctx, tx, owner, doc("one-too-many", "1.0.0", "#000000"))
		refusedAt(t, err, "(quota)", "at most 20 Worlds")
	})
}

func TestHideDeletesOnlyWhatNoRoomPins(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		loose := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, room.Owner, doc("loose", "1.0.0", "#000000")))
		pinned := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, room.Owner, doc("pinned", "1.0.0", "#000000")))
		dbtest.Exec(t, tx, `UPDATE campaign SET world_version_id = $1 WHERE id = $2`, pinned.VersionID, room.ID)

		if out := dbtest.Must[*Hidden](t)(HideTx(ctx, tx, dbtest.User(t, tx, "Other"), loose.WorldID)); out != nil {
			t.Fatal("another user hid someone else's World")
		}
		if out := dbtest.Must[*Hidden](t)(HideTx(ctx, tx, room.Owner, loose.WorldID)); out == nil || !out.Deleted {
			t.Fatalf("an unpinned World is removed: %+v", out)
		}
		if out := dbtest.Must[*Hidden](t)(HideTx(ctx, tx, room.Owner, pinned.WorldID)); out == nil || out.Deleted {
			t.Fatalf("a pinned World stays: %+v", out)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM world WHERE owner_user_id = $1`, room.Owner); n != 1 {
			t.Fatalf("want the pinned World kept, %d left", n)
		}
		if out := dbtest.Must[[]Listed](t)(List(ctx, tx, room.Owner)); len(out) != 0 {
			t.Fatal("a hidden World is still listed")
		}
		// Importing it again brings it back.
		dbtest.Must[*Imported](t)(ImportTx(ctx, tx, room.Owner, doc("pinned", "1.0.0", "#000000")))
		if out := dbtest.Must[[]Listed](t)(List(ctx, tx, room.Owner)); len(out) != 1 {
			t.Fatal("a re-imported World is not listed again")
		}
	})
}

func TestATakenDownWorldIsNeitherExportedNorImported(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		owner := dbtest.User(t, tx, "Owner")
		w := dbtest.Must[*Imported](t)(ImportTx(ctx, tx, owner, doc("tide", "1.0.0", "#000000")))
		dbtest.Exec(t, tx, `UPDATE world SET disabled_at = now() WHERE id = $1`, w.WorldID)
		if _, err := Export(ctx, tx, owner, w.WorldID); !errors.Is(err, ErrTakenDown) {
			t.Fatalf("want ErrTakenDown, got %v", err)
		}
		_, err := ImportTx(ctx, tx, owner, doc("tide", "1.1.0", "#000000"))
		refusedAt(t, err, "id", "this World was taken down by an admin")
		if out := dbtest.Must[[]Listed](t)(List(ctx, tx, owner)); len(out) != 1 || !out[0].Disabled {
			t.Fatalf("the owner sees it taken down: %+v", out)
		}
	})
}
