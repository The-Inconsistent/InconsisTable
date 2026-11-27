// Package world holds the Worlds an owner imports (docs/adr/0010-game-modules.md, decision 2; house decision #65): the
// look of one setting, in immutable versions with a hash, as a ruleset's are (internal/ruleset/import.go is the model).
// A room pins one version (campaign.setWorld, internal/campaign) and its seats read it with the room's rules
// (internal/pack/rules.go). The owner-scoped REST routes are the library's (internal/pack/http.go).
package world

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// Per-owner quota, counted over every stored World and version, hidden ones included, until they are really removed.
//
// ponytail: flat numbers for every user, as the packs' are; per-role limits when there is a plan to sell.
const (
	MaxWorldsPerUser = 20
	MaxVersions      = 50
)

// ErrTakenDown says an export was refused because an admin took the World down.
var ErrTakenDown = errors.New("world taken down")

func refuse(path, message string, args ...any) *ruleset.Refused {
	return &ruleset.Refused{Problems: []engine.Problem{{Path: path, Message: fmt.Sprintf(message, args...)}}}
}

// Imported is what importing a World answers.
type Imported struct {
	OK        bool   `json:"ok"`
	WorldID   string `json:"worldId"`
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
	Version   string `json:"version"`
	// Unchanged: this exact version was already imported, nothing was written.
	Unchanged bool `json:"unchanged"`
}

// Import stores a World as an immutable version of the owner's World. The same version with the same content is a
// no-op; with other content it is refused (raise the version). Refusals are *ruleset.Refused, answered 422.
func Import(ctx context.Context, db *pgxpool.Pool, userID string, input any) (*Imported, error) {
	var out *Imported
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		out, err = ImportTx(ctx, tx, userID, input)
		return err
	})
	return out, err
}

// ImportTx is Import inside the caller's transaction.
func ImportTx(ctx context.Context, tx pgx.Tx, userID string, input any) (*Imported, error) {
	doc, problems := engine.ValidateWorld(input)
	if len(problems) > 0 {
		return nil, &ruleset.Refused{Problems: problems}
	}
	hash := engine.WorldHash(doc)
	slug, _ := doc["id"].(string)
	version, _ := doc["version"].(string)
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	// The same lock as rulesets and packs: one owner's imports run one at a time, so the quota counts hold.
	if err := ruleset.LockImport(ctx, tx, userID); err != nil {
		return nil, err
	}
	var worldID string
	var disabled bool
	err = tx.QueryRow(ctx, `SELECT id::text, disabled_at IS NOT NULL FROM world WHERE owner_user_id = $1 AND slug = $2`,
		userID, slug).Scan(&worldID, &disabled)
	switch {
	case err == nil && disabled:
		return nil, refuse("id", "this World was taken down by an admin")
	case errors.Is(err, pgx.ErrNoRows):
		var mine int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM world WHERE owner_user_id = $1`, userID).Scan(&mine); err != nil {
			return nil, err
		}
		if mine >= MaxWorldsPerUser {
			return nil, refuse("(quota)", "at most %d Worlds", MaxWorldsPerUser)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO world (owner_user_id, slug) VALUES ($1, $2) RETURNING id::text`, userID, slug).
			Scan(&worldID); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	}
	// Importing again brings back a World its owner had hidden.
	if _, err := tx.Exec(ctx, `UPDATE world SET hidden_at = NULL WHERE id = $1`, worldID); err != nil {
		return nil, err
	}
	out := Imported{OK: true, WorldID: worldID, Slug: slug, Version: version}

	var sameID, sameHash string
	err = tx.QueryRow(ctx, `SELECT id::text, hash FROM world_version WHERE world_id = $1 AND version = $2`, worldID, version).
		Scan(&sameID, &sameHash)
	if err == nil {
		if sameHash != hash {
			return nil, refuse("version", "%s is already imported with other content: raise the version", version)
		}
		out.VersionID, out.Unchanged = sameID, true
		return &out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var versions int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM world_version WHERE world_id = $1`, worldID).Scan(&versions); err != nil {
		return nil, err
	}
	if versions >= MaxVersions {
		return nil, refuse("(quota)", "at most %d versions of one World", MaxVersions)
	}
	err = tx.QueryRow(ctx, `INSERT INTO world_version (world_id, version, hash, document, bytes) VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text`, worldID, version, hash, raw, len(engine.CanonicalJSON(doc))).Scan(&out.VersionID)
	return &out, err
}

// VersionInfo is one version in the list.
type VersionInfo struct {
	ID        string `json:"id"`
	Version   string `json:"version"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// Listed is one of the owner's Worlds with its versions, newest first.
type Listed struct {
	ID       string        `json:"id"`
	Slug     string        `json:"slug"`
	Disabled bool          `json:"disabled"`
	Versions []VersionInfo `json:"versions"`
}

// List is the owner's Worlds that are not hidden, with their versions, newest first. Documents stay out of the list.
func List(ctx context.Context, conn core.Conn, userID string) ([]Listed, error) {
	rows, err := conn.Query(ctx, `SELECT world.id::text, world.slug, world.disabled_at IS NOT NULL, world_version.id::text,
			world_version.version, world_version.document->>'name', world_version.created_at
		FROM world JOIN world_version ON world_version.world_id = world.id
		WHERE world.owner_user_id = $1 AND world.hidden_at IS NULL
		ORDER BY world_version.created_at DESC, world_version.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Listed{}
	at := map[string]int{}
	for rows.Next() {
		var l Listed
		var v VersionInfo
		var createdAt time.Time
		if err := rows.Scan(&l.ID, &l.Slug, &l.Disabled, &v.ID, &v.Version, &v.Name, &createdAt); err != nil {
			return nil, err
		}
		v.CreatedAt = core.ISOTime(createdAt)
		i, known := at[l.ID]
		if !known {
			i = len(out)
			at[l.ID] = i
			l.Versions = []VersionInfo{}
			out = append(out, l)
		}
		out[i].Versions = append(out[i].Versions, v)
	}
	return out, rows.Err()
}

// Export is the newest version's document of the owner's own World, as stored (what Import took, parsed). Nil when it
// isn't theirs, the same answer as a World that doesn't exist; ErrTakenDown after a takedown.
func Export(ctx context.Context, conn core.Conn, userID, worldID string) (json.RawMessage, error) {
	var disabled bool
	var document []byte
	err := conn.QueryRow(ctx, `SELECT world.disabled_at IS NOT NULL, world_version.document FROM world
		JOIN world_version ON world_version.world_id = world.id WHERE world.id = $1 AND world.owner_user_id = $2
		ORDER BY world_version.created_at DESC, world_version.id DESC LIMIT 1`, worldID, userID).Scan(&disabled, &document)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, err
	case disabled:
		return nil, ErrTakenDown
	}
	return document, nil
}

// Hidden is what hiding a World answers: whether it was really removed.
type Hidden struct {
	Deleted bool `json:"deleted"`
}

// Hide is "delete" for the owner: the World leaves their list at once, and is really removed when no room pins any
// version of it (a pinned one stays, so the room keeps its look). Nil when it isn't theirs.
func Hide(ctx context.Context, db *pgxpool.Pool, userID, worldID string) (*Hidden, error) {
	var out *Hidden
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		out, err = HideTx(ctx, tx, userID, worldID)
		return err
	})
	return out, err
}

// HideTx is Hide inside the caller's transaction.
func HideTx(ctx context.Context, tx pgx.Tx, userID, worldID string) (*Hidden, error) {
	tag, err := tx.Exec(ctx, `UPDATE world SET hidden_at = now() WHERE id = $1 AND owner_user_id = $2`, worldID, userID)
	if err != nil || tag.RowsAffected() == 0 {
		return nil, err
	}
	var pinned bool
	// A version a game module names stays too, as a pinned one does.
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM world_version WHERE world_id = $1
		AND (id IN (SELECT world_version_id FROM campaign) OR id IN (SELECT world_version_id FROM game_module_version)))`,
		worldID).Scan(&pinned); err != nil {
		return nil, err
	}
	if pinned {
		return &Hidden{false}, nil
	}
	_, err = tx.Exec(ctx, `DELETE FROM world WHERE id = $1`, worldID)
	return &Hidden{true}, err
}
