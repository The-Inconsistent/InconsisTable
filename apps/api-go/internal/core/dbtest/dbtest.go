// Package dbtest gives Go tests a real Postgres 18: the one TEST_DATABASE_URL names, migrated. Tests that need it skip
// without it, so `go test ./...` still runs everywhere.
package dbtest

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Open is the migrated test database, or skips the test.
func Open(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := core.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err := core.RunMigrations(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}

// Tx runs fn in a transaction that is always rolled back, so a test leaves no rows behind.
func Tx(t *testing.T, db *pgxpool.Pool, fn func(tx pgx.Tx)) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	fn(tx)
}

// Must fails the test on an error.
func Must[T any](t *testing.T) func(T, error) T {
	return func(v T, err error) T {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
}

// Exec runs one statement or fails the test.
func Exec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// Scalar reads one value or fails the test.
func Scalar[T any](t *testing.T, tx pgx.Tx, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return v
}

// Room is a campaign with an owner who sits as its GM.
type Room struct {
	ID    string
	Owner string
}

// GM is the owner's seat.
func (r Room) GM() cs.Ctx {
	owner := r.Owner
	return cs.Ctx{CampaignID: r.ID, UserID: &owner, CampaignOwnerID: &owner, Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
}

// User makes an app user and returns its id.
func User(t *testing.T, tx pgx.Tx, name string) string {
	t.Helper()
	return Scalar[string](t, tx, `INSERT INTO app_user (id, name) VALUES (uuidv7()::text, $1) RETURNING id`, name)
}

// NewRoom makes a campaign whose owner is its GM.
func NewRoom(t *testing.T, tx pgx.Tx) Room {
	t.Helper()
	owner := User(t, tx, "Owner")
	id := Scalar[string](t, tx, `INSERT INTO campaign (name, owner_user_id) VALUES ('Room', $1) RETURNING id::text`, owner)
	Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, id, owner)
	return Room{id, owner}
}

// Seat sits a user in the room as a player holding actorIDs, and returns the seat.
func (r Room) Seat(t *testing.T, tx pgx.Tx, userID string, actorIDs ...string) cs.Ctx {
	t.Helper()
	membership := Scalar[string](t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'player') RETURNING id::text`, r.ID, userID)
	for _, a := range actorIDs {
		Exec(t, tx, `INSERT INTO membership_character (membership_id, actor_id) VALUES ($1, $2)`, membership, a)
	}
	owner := r.Owner
	return cs.Ctx{CampaignID: r.ID, UserID: &userID, CampaignOwnerID: &owner,
		Seat: cs.Seat{Kind: cs.SeatMember, Role: "player", Scopes: []string{}, CharacterIDs: actorIDs}}
}

// Actor makes an actor of the room, typed when entity is not "", and returns its id.
func (r Room) Actor(t *testing.T, tx pgx.Tx, kind, name, entity string) string {
	t.Helper()
	return Scalar[string](t, tx, `INSERT INTO actor (campaign_id, kind, name, entity_type) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		r.ID, kind, name, entity)
}

// Pin imports a manifest as the owner's and pins it to the room. The manifest must compile.
func (r Room) Pin(t *testing.T, tx pgx.Tx, manifest string) {
	t.Helper()
	version := r.AddVersion(t, tx, manifest, "0.1.0", "")
	Exec(t, tx, `UPDATE campaign SET ruleset_version_id = $1 WHERE id = $2`, version, r.ID)
}

// AddVersion imports a manifest as the owner's without pinning it, and returns the version id: a new version of
// rulesetID, or, with "", a ruleset of its own.
func (r Room) AddVersion(t *testing.T, tx pgx.Tx, manifest, version, rulesetID string) string {
	t.Helper()
	var input any
	if err := json.Unmarshal([]byte(manifest), &input); err != nil {
		t.Fatal(err)
	}
	compiled, problems := engine.CompileRuleset(input)
	if len(problems) > 0 {
		t.Fatalf("fixture does not compile: %v", problems)
	}
	normalized, err := json.Marshal(compiled.Ruleset.Normalized)
	if err != nil {
		t.Fatal(err)
	}
	hash := engine.Sha256Hex(engine.CanonicalJSON(compiled.Ruleset.Normalized))
	if rulesetID == "" {
		rulesetID = Scalar[string](t, tx, `INSERT INTO ruleset (owner_user_id, slug, title) VALUES ($1, $2, 'Fixture') RETURNING id::text`,
			r.Owner, compiled.Ruleset.ID)
	}
	return Scalar[string](t, tx, `INSERT INTO ruleset_version (ruleset_id, version, hash, manifest) VALUES ($1, $2, $3, $4)
		RETURNING id::text`, rulesetID, version, hash, normalized)
}

// Fixture is a small ruleset of our own invention ("Fixture p.N" points at no book; CLAUDE.md): a character with Grit,
// Vigour that the server clamps to a derived max, and Focus a player may only spend.
const Fixture = `{
	"id": "go-fixture", "version": "0.1.0", "core": "^0.1.0",
	"sources": [{"id": "fixture", "title": "Go Fixture Rules", "license": "private"}],
	"entities": [{
		"id": "character", "label": "Character", "base": "actor",
		"fields": {
			"level": {"type": "int", "label": "Level", "min": 1, "max": 20, "visibility": "party"},
			"note": {"type": "text", "label": "Note", "visibility": "party", "editableBy": "owner", "maxLength": 20}
		},
		"derived": [{"id": "maxHp", "label": "Max Vigour", "expr": "4 + level * 2", "visibility": "party", "cite": "Fixture p.1"}]
	}],
	"resources": [
		{"id": "hp", "label": "Vigour", "cite": "Fixture p.2", "scope": "entity", "max": "derived.maxHp", "visibility": "party",
			"resetOn": [{"event": "longRest", "to": "max"}]},
		{"id": "focus", "label": "Focus", "cite": "Fixture p.3", "scope": "entity", "max": "3", "visibility": "party",
			"editableBy": "ownerSpendOnly"}
	],
	"conditions": [],
	"initiative": {"strategy": "ranked", "score": "level", "cite": "Fixture p.4"},
	"health": {"tracks": [], "states": []}
}`
