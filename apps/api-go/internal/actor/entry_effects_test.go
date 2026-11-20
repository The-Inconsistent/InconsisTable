package actor

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// A character that picks a boon in a choose step; its Vigour maximum reads a derived value (synthetic content).
const boonRuleset = `{
	"id": "go-boons", "version": "0.1.0", "core": "^0.1.0",
	"sources": [{"id": "fixture", "title": "Go Boons", "license": "private"}],
	"entities": [
		{"id": "character", "label": "Character", "base": "actor", "fields": {},
			"derived": [{"id": "maxHp", "label": "Max Vigour", "expr": "10", "visibility": "party", "cite": "Fixture p.1"}]},
		{"id": "boon", "label": "Boon", "base": "ability", "fields": {}}
	],
	"resources": [{"id": "hp", "label": "Vigour", "cite": "Fixture p.2", "scope": "entity", "max": "derived.maxHp", "visibility": "party"}],
	"conditions": [],
	"initiative": {"strategy": "ranked", "score": "1", "cite": "Fixture p.4"},
	"health": {"tracks": [], "states": []},
	"creation": [{"kind": "choose", "id": "boon", "actor": "character", "label": "Boon", "cite": "Fixture p.5", "pick": "boon"}]
}`

func TestAChosenEntryRaisesTheNumbersOfThatActorOnly(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, boonRuleset)
		rulesetVersion := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
		rs := dbtest.Scalar[string](t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
		pack := dbtest.Scalar[string](t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-boons', $2, 'private')
			RETURNING id::text`, room.Owner, rs)
		version := dbtest.Scalar[string](t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
			VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 1, 0) RETURNING id::text`, pack, rulesetVersion)
		// visibility gm: derivation reads it whoever looks (house decision #61).
		dbtest.Exec(t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body, effects)
			VALUES ($1, 'hale', 'boon', 'Hale', '{}', 'gm', 'Fixture p.6', 'h', '{}',
			'[{"path": "derived.maxHp", "mode": "add", "value": "5", "phase": "derived"}]')`, version)
		attached := dbtest.Scalar[string](t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2) RETURNING pack_version_id::text`, room.ID, version)
		chosen := room.Actor(t, tx, "pc", "Lyra", "character")
		plain := room.Actor(t, tx, "pc", "Bram", "character")
		dbtest.Exec(t, tx, `INSERT INTO actor_choice (actor_id, step_id, ordinal, option_key) VALUES ($1, 'boon', 0, 'hale')`, chosen)

		maxHp := func() (float64, float64) {
			rules := dbtest.Must[*engine.CompiledRuleset](t)(compiled.Load(ctx, tx, room.ID))
			rows := dbtest.Must[[]Rows](t)(LoadRows(ctx, tx, room.ID))
			built := dbtest.Must[map[string]*Built](t)(Build(rules, rows, nil))
			return built[chosen].Derived["maxHp"], built[plain].Derived["maxHp"]
		}
		if a, b := maxHp(); a != 15 || b != 10 {
			t.Fatalf("the actor that chose the boon has 15 and the other 10, got %v and %v", a, b)
		}

		// A new character starts at the raised maximum.
		rules := dbtest.Must[*engine.CompiledRuleset](t)(compiled.Load(ctx, tx, room.ID))
		rows := dbtest.Must[[]Rows](t)(LoadRows(ctx, tx, room.ID))
		built := dbtest.Must[map[string]*Built](t)(Build(rules, rows, nil))
		start := dbtest.Must[[]StartingResource](t)(StartingResources(rules, "character", map[string]any{}, 1, nil, built[chosen].Entries, nil))
		if len(start) != 1 || start[0].Value != 15 {
			t.Fatalf("starts full at the raised maximum: %+v", start)
		}

		// A pack an admin took down stops adding, and adds again once it is restored.
		dbtest.Exec(t, tx, `UPDATE pack SET disabled_at = now() WHERE id = $1`, pack)
		if a, b := maxHp(); a != 10 || b != 10 {
			t.Fatalf("a taken-down pack adds nothing, got %v and %v", a, b)
		}
		dbtest.Exec(t, tx, `UPDATE pack SET disabled_at = NULL WHERE id = $1`, pack)
		if a, _ := maxHp(); a != 15 {
			t.Fatalf("a restored pack adds again, got %v", a)
		}

		// The entry leaves the attached packs: it adds nothing, and nothing fails.
		dbtest.Exec(t, tx, `DELETE FROM campaign_pack WHERE campaign_id = $1 AND pack_version_id = $2`, room.ID, attached)
		if a, b := maxHp(); a != 10 || b != 10 {
			t.Fatalf("an entry no longer attached adds nothing, got %v and %v", a, b)
		}
	})
}
