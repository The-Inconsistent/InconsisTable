// Package module holds the game modules an owner imports (docs/adr/0010-game-modules.md, decision 4; house decisions
// #122 to #125): the list of one ruleset version, its pack versions and optionally a World version that makes one game.
// A module file may carry those documents; importing it imports them through their own importers (ruleset.ImportTx,
// pack.ImportTx, world.ImportTx) in one transaction with the module, or stores nothing. A room is made from a module
// with the actions a GM would send (CreateRoom); it pins the parts, never the module.
package module

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/table"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/world"
)

// Per-owner quota, as a World's.
//
// ponytail: flat numbers for every user, as the packs' and Worlds' are; per-role limits when there is a plan to sell.
const (
	MaxModulesPerUser = 20
	MaxVersions       = 50
)

func refuse(path, message string, args ...any) *ruleset.Refused {
	return &ruleset.Refused{Problems: []engine.Problem{{Path: path, Message: fmt.Sprintf(message, args...)}}}
}

// at puts a carried document's problems at their place in the module file, under prefix.
func at(prefix string, problems []engine.Problem) []engine.Problem {
	out := make([]engine.Problem, len(problems))
	for i, p := range problems {
		switch {
		case p.Path == "(root)":
			p.Path = prefix
		case strings.HasPrefix(p.Path, "("): // (quota) stays the owner's, not the file's
		case strings.HasPrefix(p.Path, "["):
			p.Path = prefix + p.Path
		default:
			p.Path = prefix + "." + p.Path
		}
		out[i] = p
	}
	return out
}

// under is a carried document's refusal with its problems and warnings at their place in the module file. Anything
// else passes as it is.
func under(prefix string, err error) error {
	var refused *ruleset.Refused
	if !errors.As(err, &refused) {
		return err
	}
	return &ruleset.Refused{Problems: at(prefix, refused.Problems), Warnings: at(prefix, refused.Warnings)}
}

// field reads key of a decoded object, ordered or not.
func field(v any, key string) (any, bool) {
	switch o := v.(type) {
	case *schema.Obj:
		return o.Get(key)
	case map[string]any:
		x, ok := o[key]
		return x, ok
	}
	return nil, false
}

// Imported is what importing a module answers.
type Imported struct {
	OK        bool   `json:"ok"`
	ModuleID  string `json:"moduleId"`
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
	Version   string `json:"version"`
	// Unchanged: this exact version was already imported, nothing of the module was written.
	Unchanged bool `json:"unchanged"`
	// Warnings are the carried packs', by their path in the module file.
	Warnings []engine.Problem `json:"warnings"`
}

// Import stores a module, and the documents it carries, as the owner's, in one transaction. input is decoded with
// schema.DecodeJSON, so a carried pack keeps its records' order. Refusals are *ruleset.Refused, by path in the file.
func Import(ctx context.Context, db *pgxpool.Pool, userID string, input any) (*Imported, error) {
	var out *Imported
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		out, err = ImportTx(ctx, tx, userID, input)
		return err
	})
	return out, err
}

// found is a part as the importer holds it.
type found struct{ versionID, rulesetID string }

// ImportTx is Import inside the caller's transaction. The carried documents go first (ruleset, packs, World), then each
// part the module names is looked up among the owner's own, at that version and, when the module gives one, that hash.
func ImportTx(ctx context.Context, tx pgx.Tx, userID string, input any) (*Imported, error) {
	doc, problems := engine.ValidateModule(input)
	if len(problems) > 0 {
		return nil, &ruleset.Refused{Problems: problems}
	}
	if err := ruleset.LockImport(ctx, tx, userID); err != nil {
		return nil, err
	}
	documents, _ := field(input, "documents")
	part := func(key string) map[string]any { p, _ := doc[key].(map[string]any); return p }
	named := func(p map[string]any) (string, string) {
		slug, _ := p["slug"].(string)
		version, _ := p["version"].(string)
		return slug, version
	}
	// carries checks that a carried document is the part the module names there.
	carries := func(path string, p map[string]any, slug, version string) error {
		wantSlug, wantVersion := named(p)
		if p == nil || slug != wantSlug || version != wantVersion {
			return refuse(path, "carries %s %s, which the module does not name", slug, version)
		}
		return nil
	}
	// lookUp finds a named part among the owner's own and fills in its hash; the newest row of that version wins.
	lookUp := func(path, what string, p map[string]any, sql string) (found, error) {
		slug, version := named(p)
		var f found
		var hash string
		err := tx.QueryRow(ctx, sql, userID, slug, version).Scan(&f.versionID, &hash, &f.rulesetID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return f, refuse(path, `import the %s "%s" %s first, or carry it in the module`, what, slug, version)
		case err != nil:
			return f, err
		}
		if wanted, given := p["hash"].(string); given && wanted != hash {
			return f, refuse(path+".hash", `"%s" %s is imported with another hash`, slug, version)
		}
		p["hash"] = hash
		return f, nil
	}
	warnings := []engine.Problem{}

	rulesetPart := part("ruleset")
	if carried, has := field(documents, "ruleset"); has {
		got, err := ruleset.ImportTx(ctx, tx, userID, schema.Plain(carried))
		if err != nil {
			return nil, under("documents.ruleset", err)
		}
		if err := carries("documents.ruleset", rulesetPart, got.Slug, got.Version); err != nil {
			return nil, err
		}
	}
	rs, err := lookUp("ruleset", "ruleset", rulesetPart, `SELECT v.id::text, v.hash, r.id::text FROM ruleset_version v
		JOIN ruleset r ON r.id = v.ruleset_id WHERE r.owner_user_id = $1 AND r.slug = $2 AND v.version = $3`)
	if err != nil {
		return nil, err
	}

	packs, _ := doc["packs"].([]any)
	packPart := func(slug, version string) map[string]any {
		for _, p := range packs {
			if s, v := named(p.(map[string]any)); s == slug && v == version {
				return p.(map[string]any)
			}
		}
		return nil
	}
	carriedPacks, _ := field(documents, "packs")
	list, _ := carriedPacks.([]any)
	for i, carried := range list {
		path := fmt.Sprintf("documents.packs[%d]", i)
		got, err := pack.ImportTx(ctx, tx, userID, carried, rs.versionID)
		if err != nil {
			return nil, under(path, err)
		}
		if err := carries(path, packPart(got.Slug, got.Version), got.Slug, got.Version); err != nil {
			return nil, err
		}
		warnings = append(warnings, at(path, got.Warnings)...)
	}
	packIDs := make([]string, len(packs))
	for i, p := range packs {
		path := fmt.Sprintf("packs[%d]", i)
		f, err := lookUp(path, "pack", p.(map[string]any), `SELECT v.id::text, v.hash, p.ruleset_id::text FROM pack_version v
			JOIN pack p ON p.id = v.pack_id WHERE p.owner_user_id = $1 AND p.slug = $2 AND v.version = $3
			ORDER BY v.created_at DESC, v.id DESC LIMIT 1`)
		if err != nil {
			return nil, err
		}
		// The gate campaign.attachPack keeps: a pack goes with its own ruleset.
		// ponytail: the same ruleset, not its range against the version (no range is matched anywhere yet); match
		// ruleset_range once the core version check (ADR 0010 decision 6) brings a semver matcher.
		if f.rulesetID != rs.rulesetID {
			slug, _ := named(p.(map[string]any))
			return nil, refuse(path, `"%s" is written for another ruleset than the module's`, slug)
		}
		packIDs[i] = f.versionID
	}

	worldPart := part("world")
	var worldID *string
	if carried, has := field(documents, "world"); has {
		got, err := world.ImportTx(ctx, tx, userID, schema.Plain(carried))
		if err != nil {
			return nil, under("documents.world", err)
		}
		if err := carries("documents.world", worldPart, got.Slug, got.Version); err != nil {
			return nil, err
		}
	}
	if worldPart != nil {
		f, err := lookUp("world", "World", worldPart, `SELECT v.id::text, v.hash, '' FROM world_version v
			JOIN world w ON w.id = v.world_id WHERE w.owner_user_id = $1 AND w.slug = $2 AND v.version = $3`)
		if err != nil {
			return nil, err
		}
		worldID = &f.versionID
	}

	// The module as stored: the list, each part with the hash it was found under, without the documents.
	delete(doc, "documents")
	out, err := store(ctx, tx, userID, doc, rs.versionID, worldID, packIDs)
	if out != nil {
		out.Warnings = warnings
	}
	return out, err
}

// store writes the module's version: the same version with the same hash is a no-op, with another it is refused.
func store(ctx context.Context, tx pgx.Tx, userID string, doc map[string]any, rulesetID string, worldID *string,
	packIDs []string) (*Imported, error) {
	slug, _ := doc["id"].(string)
	version, _ := doc["version"].(string)
	hash := engine.ModuleHash(doc)
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	var moduleID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM game_module WHERE owner_user_id = $1 AND slug = $2`, userID, slug).Scan(&moduleID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		var mine int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM game_module WHERE owner_user_id = $1`, userID).Scan(&mine); err != nil {
			return nil, err
		}
		if mine >= MaxModulesPerUser {
			return nil, refuse("(quota)", "at most %d game modules", MaxModulesPerUser)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO game_module (owner_user_id, slug) VALUES ($1, $2) RETURNING id::text`,
			userID, slug).Scan(&moduleID); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	}
	out := Imported{OK: true, ModuleID: moduleID, Slug: slug, Version: version}
	var sameID, sameHash string
	err = tx.QueryRow(ctx, `SELECT id::text, hash FROM game_module_version WHERE module_id = $1 AND version = $2`,
		moduleID, version).Scan(&sameID, &sameHash)
	if err == nil {
		if sameHash != hash {
			return nil, refuse("version", "%s is already imported with other parts: raise the version", version)
		}
		out.VersionID, out.Unchanged = sameID, true
		return &out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var versions int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM game_module_version WHERE module_id = $1`, moduleID).Scan(&versions); err != nil {
		return nil, err
	}
	if versions >= MaxVersions {
		return nil, refuse("(quota)", "at most %d versions of one game module", MaxVersions)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO game_module_version (module_id, version, hash, document, ruleset_version_id,
		world_version_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`, moduleID, version, hash, raw, rulesetID, worldID).
		Scan(&out.VersionID); err != nil {
		return nil, err
	}
	for i, id := range packIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO game_module_pack (module_version_id, position, pack_version_id) VALUES ($1, $2, $3)`,
			out.VersionID, i, id); err != nil {
			return nil, err
		}
	}
	return &out, nil
}

// Part is one part of a listed version.
type Part struct {
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
	Version   string `json:"version"`
}

// VersionInfo is one version in the list, with what Choose game shows of it: its ruleset's modes and game block.
type VersionInfo struct {
	ID        string            `json:"id"`
	Version   string            `json:"version"`
	Name      string            `json:"name"`
	CreatedAt string            `json:"createdAt"`
	Ruleset   Part              `json:"ruleset"`
	Packs     []Part            `json:"packs"`
	World     *Part             `json:"world"`
	Modes     []string          `json:"modes"`
	Game      *ruleset.GameInfo `json:"game"`
}

// Listed is one of the owner's modules with its versions, newest first.
type Listed struct {
	ID       string        `json:"id"`
	Slug     string        `json:"slug"`
	Versions []VersionInfo `json:"versions"`
}

// List is the owner's modules, each version with its parts, newest first. Nobody else's: a module is never offered to
// another user (principle 4, house decision #123).
func List(ctx context.Context, conn core.Conn, userID string) ([]Listed, error) {
	rows, err := conn.Query(ctx, `SELECT m.id::text, m.slug, v.id::text, v.version, v.document->>'name', v.created_at,
			rv.id::text, r.slug, rv.version, coalesce(rv.manifest->'game'->'modes', '["gm"]'::jsonb), rv.manifest->'game',
			coalesce((SELECT json_agg(json_build_object('versionId', pv.id, 'slug', p.slug, 'version', pv.version)
				ORDER BY mp.position) FROM game_module_pack mp JOIN pack_version pv ON pv.id = mp.pack_version_id
				JOIN pack p ON p.id = pv.pack_id WHERE mp.module_version_id = v.id), '[]'),
			(SELECT json_build_object('versionId', wv.id, 'slug', w.slug, 'version', wv.version) FROM world_version wv
				JOIN world w ON w.id = wv.world_id WHERE wv.id = v.world_version_id)
		FROM game_module m JOIN game_module_version v ON v.module_id = m.id
		JOIN ruleset_version rv ON rv.id = v.ruleset_version_id JOIN ruleset r ON r.id = rv.ruleset_id
		WHERE m.owner_user_id = $1 ORDER BY v.created_at DESC, v.id DESC`, userID)
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
		var modes, game, packs, worldPart []byte
		if err := rows.Scan(&l.ID, &l.Slug, &v.ID, &v.Version, &v.Name, &createdAt, &v.Ruleset.VersionID, &v.Ruleset.Slug,
			&v.Ruleset.Version, &modes, &game, &packs, &worldPart); err != nil {
			return nil, err
		}
		v.CreatedAt = core.ISOTime(createdAt)
		if err := json.Unmarshal(modes, &v.Modes); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(packs, &v.Packs); err != nil {
			return nil, err
		}
		if worldPart != nil {
			if err := json.Unmarshal(worldPart, &v.World); err != nil {
				return nil, err
			}
		}
		if game != nil {
			v.Game = &ruleset.GameInfo{}
			if err := json.Unmarshal(game, v.Game); err != nil {
				return nil, err
			}
			if v.Game.Genres == nil {
				v.Game.Genres = []string{}
			}
		}
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

// Export is the newest version of the owner's own module, as stored: the list, each part with its hash, and none of
// the documents (house decision #123). Nil when it isn't theirs, the same answer as a module that doesn't exist.
func Export(ctx context.Context, conn core.Conn, userID, moduleID string) (json.RawMessage, error) {
	var document []byte
	err := conn.QueryRow(ctx, `SELECT v.document FROM game_module m JOIN game_module_version v ON v.module_id = m.id
		WHERE m.id = $1 AND m.owner_user_id = $2 ORDER BY v.created_at DESC, v.id DESC LIMIT 1`, moduleID, userID).Scan(&document)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return document, err
}

// Delete removes the owner's own module and its versions; its parts stay in the library. No room is held by it (house
// decision #124), so it goes at once. False when it isn't theirs.
func Delete(ctx context.Context, conn core.Conn, userID, moduleID string) (bool, error) {
	tag, err := conn.Exec(ctx, `DELETE FROM game_module WHERE id = $1 AND owner_user_id = $2`, moduleID, userID)
	return tag.RowsAffected() > 0, err
}

// CreateRoom makes a room of the owner's from one version of their own module, in one transaction: the room with its
// ruleset and how the table sits (campaign.NewRoom, as POST /api/campaigns makes one), then each pack attached and the
// World pinned through the action the one running the room would send (house decision #74's path). A refusal of any of
// them is its own (*coreschema.Error).
func CreateRoom(ctx context.Context, db *pgxpool.Pool, owner campaign.Owner, name, moduleVersionID, tableMode string) (string, error) {
	var id string
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		id, err = CreateRoomTx(ctx, tx, owner, name, moduleVersionID, tableMode)
		return err
	})
	return id, err
}

// CreateRoomTx is CreateRoom inside the caller's transaction.
func CreateRoomTx(ctx context.Context, tx pgx.Tx, owner campaign.Owner, name, moduleVersionID, tableMode string) (string, error) {
	var id string
	err := func() error {
		var rulesetID string
		var worldID *string
		err := tx.QueryRow(ctx, `SELECT v.ruleset_version_id::text, v.world_version_id::text FROM game_module_version v
			JOIN game_module m ON m.id = v.module_id WHERE v.id = $1 AND m.owner_user_id = $2`, moduleVersionID, owner.UserID).
			Scan(&rulesetID, &worldID)
		if errors.Is(err, pgx.ErrNoRows) {
			return cs.Fail("moduleNotFound")
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT pack_version_id::text FROM game_module_pack WHERE module_version_id = $1
			ORDER BY position`, moduleVersionID)
		if err != nil {
			return err
		}
		packs, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		// The room is made with its ruleset and its mode at once, as POST /api/campaigns makes one, so a game played only
		// without a GM gets its room (pinning the ruleset afterwards would check it against a room with a GM).
		mode, seat := cs.TableModeGM, "gm"
		var modeParam *string
		if tableMode != "" && tableMode != cs.TableModeGM {
			mode, seat, modeParam = tableMode, "player", &tableMode
		}
		if id, err = campaign.NewRoom(ctx, tx, name, &owner, &rulesetID, modeParam); err != nil {
			return err
		}
		// The owner as the room seats them: its GM, or, in a room without a GM, the player who counts as running it.
		runner := cs.Ctx{CampaignID: id, UserID: &owner.UserID, CampaignOwnerID: &owner.UserID, TableMode: mode,
			Seat: cs.Seat{Kind: cs.SeatMember, Role: seat}}
		var actions []map[string]any
		for _, p := range packs {
			actions = append(actions, map[string]any{"type": "campaign.attachPack", "packVersionId": p})
		}
		if worldID != nil {
			actions = append(actions, map[string]any{"type": "campaign.setWorld", "worldVersionId": *worldID})
		}
		for _, action := range actions {
			a, issues := cs.ParseAction(action)
			if len(issues) > 0 {
				return fmt.Errorf("module room action %v: %s", action["type"], schema.Prettify(issues))
			}
			if _, err := table.ApplyAction(ctx, tx, runner, a); err != nil {
				return err
			}
		}
		return nil
	}()
	return id, err
}
