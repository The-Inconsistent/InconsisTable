// Package compiled is a room's compiled ruleset (apps/api/src/ruleset/ruleset.compiled.ts). It sits below the ruleset
// package: actors, turns and the ruleset actions all read it, and the ruleset actions build on actors, so the loader can't
// share their package without an import cycle.
package compiled

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// A manifest is an immutable document, so its compiled form is cached under the version's hash (docs/design.md §5.4).
//
// ponytail: in-process, the oldest entry goes at 64 versions; a shared cache once more than one api node runs.
const maxCompiled = 64

var cache = struct {
	sync.Mutex
	byHash map[string]*engine.CompiledRuleset
	order  []string
}{byHash: map[string]*engine.CompiledRuleset{}}

// Load is the compiled ruleset a campaign has pinned, or nil before one is.
func Load(ctx context.Context, conn core.Conn, campaignID string) (*engine.CompiledRuleset, error) {
	var versionID string
	err := conn.QueryRow(ctx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1 AND ruleset_version_id IS NOT NULL`,
		campaignID).Scan(&versionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return LoadVersion(ctx, conn, versionID)
}

// LoadVersion is the compiled form of one ruleset version, or nil when there is none.
func LoadVersion(ctx context.Context, conn core.Conn, versionID string) (*engine.CompiledRuleset, error) {
	var hash string
	err := conn.QueryRow(ctx, `SELECT hash FROM ruleset_version WHERE id = $1`, versionID).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cache.Lock()
	hit := cache.byHash[hash]
	cache.Unlock()
	if hit != nil {
		return hit, nil
	}
	// Only a miss reads the manifest document (design §5.4: read once, cache by hash).
	var raw []byte
	err = conn.QueryRow(ctx, `SELECT manifest FROM ruleset_version WHERE id = $1`, versionID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var manifest any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	compiled, problems := engine.CompileRuleset(manifest)
	// The importer validates before it stores, so this means a stored manifest the engine no longer accepts.
	if len(problems) > 0 {
		first, _ := json.Marshal(problems[0])
		return nil, fmt.Errorf("ruleset %s does not compile: %s", hash, first)
	}
	cache.Lock()
	defer cache.Unlock()
	if _, known := cache.byHash[hash]; !known {
		if len(cache.order) >= maxCompiled {
			delete(cache.byHash, cache.order[0])
			cache.order = cache.order[1:]
		}
		cache.order = append(cache.order, hash)
		cache.byHash[hash] = compiled
	}
	return cache.byHash[hash], nil
}
