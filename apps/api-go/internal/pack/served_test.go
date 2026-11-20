package pack

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// A `private` pack is served only while its owner runs the room (CLAUDE.md, principle 4): as its GM, or, in a room without
// a GM, as the owner, who counts as the one running it (docs/adr/0009-table-modes.md). Never on another user's say-so.
func TestAPrivatePackIsServedOnlyWhereItsOwnerRunsTheRoom(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, dbtest.Fixture)
		rulesetVersion := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
		ruleset := dbtest.Scalar[string](t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
		attach := func(owner string) {
			pack := dbtest.Scalar[string](t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-' || $1, $2, 'private')
				RETURNING id::text`, owner, ruleset)
			version := dbtest.Scalar[string](t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
				VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 0, 0) RETURNING id::text`, pack, rulesetVersion)
			dbtest.Exec(t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
		}
		served := func() int {
			return dbtest.Scalar[int](t, tx, `SELECT count(*) FROM campaign_pack JOIN pack_version ON pack_version.id = campaign_pack.pack_version_id
				JOIN pack ON pack.id = pack_version.pack_id WHERE `+actor.ServedPacks("$1"), room.ID)
		}
		attach(room.Owner)
		if served() != 1 {
			t.Fatal("the owner's private pack is served to a room they run as GM")
		}
		dbtest.Exec(t, tx, `UPDATE membership SET role = 'player' WHERE campaign_id = $1`, room.ID)
		if served() != 0 {
			t.Fatal("a private pack is served where its owner is no GM")
		}
		dbtest.Exec(t, tx, `UPDATE campaign SET table_mode = 'gmless' WHERE id = $1`, room.ID)
		if served() != 1 {
			t.Fatal("the owner of a room without a GM runs it: their private pack is served")
		}
		dbtest.Exec(t, tx, `UPDATE campaign SET table_mode = 'solo' WHERE id = $1`, room.ID)
		if served() != 1 {
			t.Fatal("and alone too")
		}
		// Another user's private pack is never served on the owner's say-so: it cannot be granted.
		other := dbtest.User(t, tx, "Other")
		attach(other)
		if served() != 1 {
			t.Fatalf("another user's private pack is served: %d packs", served())
		}
	})
}
