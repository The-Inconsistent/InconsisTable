package ruleset

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
)

// ponytail: a flat cap per owner on stored versions, never pruned (a pinned version can't go); a quota in bytes and a
// way to delete unpinned versions once people import often.
const MaxVersions = 100

// Refused is an import the owner has to fix: problems by path, and warnings that don't block. The REST route answers
// it 422.
type Refused struct{ Problems, Warnings []engine.Problem }

func (e *Refused) Error() string {
	if len(e.Problems) > 0 {
		return e.Problems[0].Message
	}
	return "Import refused"
}

func refuse(path, format string, args ...any) *Refused {
	return &Refused{Problems: []engine.Problem{{Path: path, Message: fmt.Sprintf(format, args...)}}}
}

// Imported is what importing a ruleset answers.
type Imported struct {
	OK        bool   `json:"ok"`
	RulesetID string `json:"rulesetId"`
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
	Version   string `json:"version"`
	// Unchanged: this exact version was already imported, nothing was written.
	Unchanged bool `json:"unchanged"`
}

// LockImport serializes one owner's imports (rulesets and packs alike) to the end of the transaction.
func LockImport(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "import:"+userID)
	return err
}

// Import stores a manifest as an immutable version of the owner's ruleset. The same version number with the same
// content is a no-op; with different content it is refused (fix it by raising the version, which is what makes it
// immutable).
func Import(ctx context.Context, db *pgxpool.Pool, userID string, input any) (*Imported, error) {
	compiled, problems := engine.CompileRuleset(input)
	if len(problems) == 0 {
		problems = importProblems(compiled.Ruleset)
	}
	if len(problems) > 0 {
		return nil, &Refused{Problems: problems}
	}
	manifest := compiled.Ruleset.Normalized
	hash := engine.Sha256Hex(engine.CanonicalJSON(manifest))
	slug, _ := manifest["id"].(string)
	version, _ := manifest["version"].(string)
	title := slug
	if sources, _ := manifest["sources"].([]any); len(sources) > 0 {
		if first, _ := sources[0].(map[string]any); first != nil {
			if t, ok := first["title"].(string); ok {
				title = t
			}
		}
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}

	var out *Imported
	err = core.InTx(ctx, db, func(tx pgx.Tx) error {
		if err := LockImport(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ruleset (owner_user_id, slug, title) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			userID, slug, title); err != nil {
			return err
		}
		var rulesetID string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM ruleset WHERE owner_user_id = $1 AND slug = $2`, userID, slug).
			Scan(&rulesetID); err != nil {
			return err
		}
		base := Imported{OK: true, RulesetID: rulesetID, Slug: slug, Version: version}

		var sameID, sameHash string
		err := tx.QueryRow(ctx, `SELECT id::text, hash FROM ruleset_version WHERE ruleset_id = $1 AND version = $2`,
			rulesetID, version).Scan(&sameID, &sameHash)
		if err == nil {
			if sameHash == hash {
				base.VersionID, base.Unchanged = sameID, true
				out = &base
				return nil
			}
			return refuse("version", "%s is already imported with other content: raise the version", version)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		var used int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM ruleset_version
			JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id WHERE ruleset.owner_user_id = $1`, userID).Scan(&used); err != nil {
			return err
		}
		if used >= MaxVersions {
			return refuse("(quota)", "at most %d ruleset versions", MaxVersions)
		}

		// `extends` is recorded as a link to the owner's own version; the engine does not merge the two (the manifest
		// must stand alone), so this only keeps the parent from being deleted while a version extends it.
		var extendsVersionID *string
		if parent, _ := manifest["extends"].(map[string]any); parent != nil {
			parentSlug, _ := parent["id"].(string)
			parentVersion, _ := parent["version"].(string)
			var id string
			err := tx.QueryRow(ctx, `SELECT ruleset_version.id::text FROM ruleset_version
				JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id
				WHERE ruleset.owner_user_id = $1 AND ruleset.slug = $2 AND ruleset_version.version = $3`,
				userID, parentSlug, parentVersion).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return refuse("extends", "import %s %s first", parentSlug, parentVersion)
			}
			if err != nil {
				return err
			}
			extendsVersionID = &id
		}

		if err := tx.QueryRow(ctx, `INSERT INTO ruleset_version (ruleset_id, version, hash, extends_version_id, manifest)
			VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, rulesetID, version, hash, extendsVersionID, raw).
			Scan(&base.VersionID); err != nil {
			return err
		}
		out = &base
		return nil
	})
	return out, err
}

// VersionInfo is one version in the list.
type VersionInfo struct {
	ID        string `json:"id"`
	Version   string `json:"version"`
	CreatedAt string `json:"createdAt"`
	// Modes are the ways a table can sit for it (the manifest's game block); a game with none is played with a GM.
	Modes []string `json:"modes"`
	// Game is what the manifest says the game is, for the lobby's Choose game; null without a game block.
	Game *GameInfo `json:"game"`
}

// GameInfo is the descriptive part of the manifest's game block (the cite stays in the manifest).
type GameInfo struct {
	Title   string   `json:"title"`
	Family  *string  `json:"family,omitempty"`
	Genres  []string `json:"genres"`
	Players struct {
		Min int `json:"min"`
		Max int `json:"max"`
	} `json:"players"`
}

// Listed is one of the owner's rulesets with its versions, newest first.
type Listed struct {
	ID       string        `json:"id"`
	Slug     string        `json:"slug"`
	Title    string        `json:"title"`
	Versions []VersionInfo `json:"versions"`
}

// List is the owner's rulesets with their versions, newest first. Manifests stay out of the list.
func List(ctx context.Context, conn core.Conn, userID string) ([]Listed, error) {
	rows, err := conn.Query(ctx, `SELECT ruleset.id::text, ruleset.slug, ruleset.title, ruleset_version.id::text,
			ruleset_version.version, ruleset_version.created_at,
			coalesce(ruleset_version.manifest->'game'->'modes', '["gm"]'::jsonb),
			ruleset_version.manifest->'game'
		FROM ruleset JOIN ruleset_version ON ruleset_version.ruleset_id = ruleset.id
		WHERE ruleset.owner_user_id = $1 ORDER BY ruleset_version.created_at DESC, ruleset_version.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Listed{}
	at := map[string]int{}
	for rows.Next() {
		var id, slug, title string
		var v VersionInfo
		var createdAt time.Time
		var modes, game []byte
		if err := rows.Scan(&id, &slug, &title, &v.ID, &v.Version, &createdAt, &modes, &game); err != nil {
			return nil, err
		}
		if game != nil {
			v.Game = &GameInfo{}
			if err := json.Unmarshal(game, v.Game); err != nil {
				return nil, err
			}
			if v.Game.Genres == nil {
				v.Game.Genres = []string{}
			}
		}
		if err := json.Unmarshal(modes, &v.Modes); err != nil {
			return nil, err
		}
		v.CreatedAt = core.ISOTime(createdAt)
		i, known := at[id]
		if !known {
			i = len(out)
			at[id] = i
			out = append(out, Listed{ID: id, Slug: slug, Title: title, Versions: []VersionInfo{}})
		}
		out[i].Versions = append(out[i].Versions, v)
	}
	return out, rows.Err()
}

// Export is the newest version's manifest of the owner's own ruleset, as stored (what Import took, normalized). Nil
// when it isn't theirs, the same answer as a ruleset that doesn't exist.
func Export(ctx context.Context, conn core.Conn, userID, rulesetID string) (json.RawMessage, error) {
	var manifest []byte
	err := conn.QueryRow(ctx, `SELECT ruleset_version.manifest FROM ruleset_version
		JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id WHERE ruleset.id = $1 AND ruleset.owner_user_id = $2
		ORDER BY ruleset_version.created_at DESC, ruleset_version.id DESC LIMIT 1`, rulesetID, userID).Scan(&manifest)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return manifest, err
}
