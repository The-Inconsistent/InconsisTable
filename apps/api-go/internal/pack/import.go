package pack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Per-owner quota (docs/design.md §4.6). Counted over every stored version, hidden packs included, until they are
// really removed. A new version drops the older ones no room has attached, so re-importing a fix doesn't eat the quota.
//
// ponytail: flat numbers for every user; per-role limits when there is a plan to sell.
const (
	MaxPacksPerUser     = 50
	MaxPackBytesPerUser = 50 * 1024 * 1024
)

const entryInsertChunk = 1000 // 1000 rows x 13 columns stays well under Postgres' 65535 parameters

// Which ruleset a pack names, read before the pack is checked (the check needs that ruleset).
var rulesetRef = schema.Object(schema.Req("ruleset", schema.Object(
	schema.Req("id", schema.String().Max(64).Regex(`^[a-z0-9]+(-[a-z0-9]+)*$`, "use kebab-case")))))

// Imported is what importing a pack answers.
type Imported struct {
	OK        bool             `json:"ok"`
	PackID    string           `json:"packId"`
	VersionID string           `json:"versionId"`
	Slug      string           `json:"slug"`
	Version   string           `json:"version"`
	Diff      engine.PackDiff  `json:"diff"`
	Warnings  []engine.Problem `json:"warnings"`
	// Unchanged: the content equals the latest version, so nothing was written.
	Unchanged bool `json:"unchanged"`
}

func problemsOrEmpty(p []engine.Problem) []engine.Problem {
	if p == nil {
		return []engine.Problem{}
	}
	return p
}

// normalized is what an import writes, from a pack that passed ValidatePack: each entry with its content hash, the hash
// of the whole version, and its size. The version's hash covers the ruleset version it was checked against, so the same
// file re-imported after a ruleset change is a new version with an empty diff.
type normalized struct {
	entries []normalizedEntry
	hash    string
	bytes   int
}

type normalizedEntry struct {
	fields      map[string]any
	key         string
	contentHash string
}

func normalize(p *engine.Pack, rulesetVersionID string) normalized {
	raw, _ := p.Normalized["entries"].([]any)
	entries := make([]normalizedEntry, len(raw))
	keyed := make([]any, len(raw))
	order := make([]int, len(raw))
	for i, item := range raw {
		fields := item.(map[string]any)
		key, _ := fields["key"].(string)
		entries[i] = normalizedEntry{fields, key, engine.ContentHash(fields)}
		order[i] = i
	}
	// Keys are ASCII (the schema's pattern), so byte order is JavaScript's.
	slices.SortFunc(order, func(a, b int) int { return strings.Compare(entries[a].key, entries[b].key) })
	for n, i := range order {
		keyed[n] = []any{entries[i].key, entries[i].contentHash}
	}
	doc := map[string]any{
		"version":          p.Normalized["version"],
		"ruleset":          p.Normalized["ruleset"],
		"rulesetVersionId": rulesetVersionID,
		"sources":          p.Normalized["sources"],
		"entries":          keyed,
	}
	if attribution, ok := p.Normalized["attribution"]; ok {
		doc["attribution"] = attribution
	}
	return normalized{entries, engine.Sha256Hex(engine.CanonicalJSON(doc)), len(engine.CanonicalJSON(p.Normalized))}
}

// Import checks a pack file as the owner's: against the newest version of the owner's ruleset it names, then in one
// transaction writes a new immutable version with one row per entry and reports what changed against the previous one.
// The uploaded file itself is not kept. Refusals (problems by path, quota, a taken-down pack) are *ruleset.Refused.
// input is decoded with schema.DecodeJSON, so a record keeps its order (engine.ValidatePack).
func Import(ctx context.Context, db *pgxpool.Pool, userID string, input any) (*Imported, error) {
	var out *Imported
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		out, err = ImportTx(ctx, tx, userID, input, "")
		return err
	})
	return out, err
}

// ImportTx is Import inside the caller's transaction. checkAgainst, when given, is the one version of the owner's
// ruleset the pack is checked against (a game module's), in place of the newest.
func ImportTx(ctx context.Context, tx pgx.Tx, userID string, input any, checkAgainst string) (*Imported, error) {
	ref, issues := schema.Parse(rulesetRef, input)
	if len(issues) > 0 {
		return nil, &ruleset.Refused{Problems: []engine.Problem{{Path: "ruleset.id", Message: "name the ruleset the pack is written for"}}}
	}
	slug := schema.Plain(ref).(map[string]any)["ruleset"].(map[string]any)["id"].(string)

	var rulesetID, rulesetVersionID string
	var manifestRaw []byte
	err := tx.QueryRow(ctx, `SELECT ruleset.id::text, ruleset_version.id::text, ruleset_version.manifest FROM ruleset
		JOIN ruleset_version ON ruleset_version.ruleset_id = ruleset.id
		WHERE ruleset.owner_user_id = $1 AND ruleset.slug = $2 AND ($3 = '' OR ruleset_version.id::text = $3)
		ORDER BY ruleset_version.created_at DESC, ruleset_version.id DESC LIMIT 1`, userID, slug, checkAgainst).
		Scan(&rulesetID, &rulesetVersionID, &manifestRaw)
	if errors.Is(err, pgx.ErrNoRows) && checkAgainst != "" {
		return nil, &ruleset.Refused{Problems: []engine.Problem{{Path: "ruleset.id", Message: fmt.Sprintf(`written for "%s", not for the module's ruleset`, slug)}}}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ruleset.Refused{Problems: []engine.Problem{{Path: "ruleset.id", Message: fmt.Sprintf(`import the ruleset "%s" first (My rulesets)`, slug)}}}
	}
	if err != nil {
		return nil, err
	}
	var manifestDoc any
	if err := json.Unmarshal(manifestRaw, &manifestDoc); err != nil {
		return nil, err
	}
	manifest, problems := engine.ValidateRuleset(manifestDoc)
	if len(problems) > 0 {
		return nil, fmt.Errorf("stored ruleset %s no longer validates", rulesetVersionID) // ours, not the owner's
	}

	p, found, warnings := engine.ValidatePack(input, manifest)
	warnings = problemsOrEmpty(warnings)
	if len(found) > 0 {
		return nil, &ruleset.Refused{Problems: found, Warnings: warnings}
	}
	next := normalize(p, rulesetVersionID)
	refuse := func(path, format string, args ...any) *ruleset.Refused {
		return &ruleset.Refused{Problems: []engine.Problem{{Path: path, Message: fmt.Sprintf(format, args...)}}, Warnings: warnings}
	}
	sources, err := json.Marshal(p.Normalized["sources"])
	if err != nil {
		return nil, err
	}

	var out *Imported
	err = func() error {
		if err := ruleset.LockImport(ctx, tx, userID); err != nil {
			return err
		}
		var packID, license, packRulesetID string
		var disabled bool
		err := tx.QueryRow(ctx, `SELECT id::text, license, ruleset_id::text, disabled_at IS NOT NULL FROM pack
			WHERE owner_user_id = $1 AND slug = $2`, userID, p.ID).Scan(&packID, &license, &packRulesetID, &disabled)
		switch {
		case err == nil:
			var why []engine.Problem
			if disabled {
				why = append(why, engine.Problem{Path: "id", Message: "this pack was taken down by an admin"})
			}
			if license != p.License {
				why = append(why, engine.Problem{Path: "license", Message: fmt.Sprintf("fixed at first import (%s); import under another id", license)})
			}
			if packRulesetID != rulesetID {
				why = append(why, engine.Problem{Path: "ruleset.id", Message: "fixed at first import; import under another id"})
			}
			if len(why) > 0 {
				return &ruleset.Refused{Problems: why, Warnings: warnings}
			}
		case errors.Is(err, pgx.ErrNoRows):
			var mine int
			if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM pack WHERE owner_user_id = $1`, userID).Scan(&mine); err != nil {
				return err
			}
			if mine >= MaxPacksPerUser {
				return refuse("(quota)", "at most %d packs", MaxPacksPerUser)
			}
			if err := tx.QueryRow(ctx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license, attribution)
				VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, userID, p.ID, rulesetID, p.License, p.Attribution).
				Scan(&packID); err != nil {
				return err
			}
		default:
			return err
		}
		// Importing again brings back a pack its owner had hidden; its attribution follows the latest file.
		if _, err := tx.Exec(ctx, `UPDATE pack SET hidden_at = NULL, attribution = $2 WHERE id = $1`, packID, p.Attribution); err != nil {
			return err
		}

		var prevID, prevHash string
		err = tx.QueryRow(ctx, `SELECT id::text, hash FROM pack_version WHERE pack_id = $1
			ORDER BY created_at DESC, id DESC LIMIT 1`, packID).Scan(&prevID, &prevHash)
		hasPrev := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		before := map[string]string{}
		if hasPrev {
			rows, err := tx.Query(ctx, `SELECT key, content_hash FROM pack_entry WHERE pack_version_id = $1`, prevID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var key, hash string
				if err := rows.Scan(&key, &hash); err != nil {
					rows.Close()
					return err
				}
				before[key] = hash
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
		}
		after := make(map[string]string, len(next.entries))
		for _, e := range next.entries {
			after[e.key] = e.contentHash
		}
		result := Imported{OK: true, PackID: packID, Slug: p.ID, Version: p.Version, Diff: engine.DiffHashes(before, after), Warnings: warnings}
		if hasPrev && prevHash == next.hash {
			// The order is outside the hash: the same entries in a new order keep the version and take the file's order.
			keys := make([]string, len(next.entries))
			for i, e := range next.entries {
				keys[i] = e.key
			}
			if _, err := tx.Exec(ctx, `UPDATE pack_entry SET ordinal = f.n - 1
				FROM unnest($2::text[]) WITH ORDINALITY AS f(key, n)
				WHERE pack_entry.pack_version_id = $1 AND pack_entry.key = f.key`, prevID, keys); err != nil {
				return err
			}
			result.VersionID, result.Unchanged = prevID, true
			out = &result
			return nil
		}

		if err := tx.QueryRow(ctx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
			packID, p.Version, next.hash, rulesetVersionID, p.Ruleset.Range, sources, len(p.Entries), next.bytes).
			Scan(&result.VersionID); err != nil {
			return err
		}
		for from := 0; from < len(next.entries); from += entryInsertChunk {
			if err := insertEntries(ctx, tx, result.VersionID, from, next.entries[from:min(from+entryInsertChunk, len(next.entries))]); err != nil {
				return err
			}
		}

		// Older versions no room has attached and no game module names are no longer needed: the new one is the diff
		// base from now on.
		if _, err := tx.Exec(ctx, `DELETE FROM pack_version WHERE pack_id = $1 AND id <> $2
			AND id NOT IN (SELECT pack_version_id FROM campaign_pack)
			AND id NOT IN (SELECT pack_version_id FROM game_module_pack)`, packID, result.VersionID); err != nil {
			return err
		}
		used, err := storageOf(ctx, tx, userID)
		if err != nil {
			return err
		}
		if used.Bytes > MaxPackBytesPerUser {
			return refuse("(quota)", "over %d MB of stored packs", MaxPackBytesPerUser/(1024*1024))
		}
		out = &result
		return nil
	}()
	return out, err
}

// insertEntries writes entries, the first at position from of the file: each keeps its place in the file as its
// ordinal, the book's order (house decision #201).
func insertEntries(ctx context.Context, tx pgx.Tx, versionID string, from int, entries []normalizedEntry) error {
	var sql strings.Builder
	sql.WriteString(`INSERT INTO pack_entry (pack_version_id, key, type, name, level, tags, visibility, cite, content_hash, body, effects, record, ordinal) VALUES `)
	args := make([]any, 0, len(entries)*13)
	for i, e := range entries {
		if i > 0 {
			sql.WriteByte(',')
		}
		n := len(args)
		fmt.Fprintf(&sql, "($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)", n+1, n+2, n+3, n+4, n+5, n+6, n+7, n+8, n+9, n+10, n+11, n+12, n+13)
		var level *int
		if v, ok := e.fields["level"].(float64); ok {
			l := int(v)
			level = &l
		}
		var cite *string
		if v, ok := e.fields["cite"].(string); ok {
			cite = &v
		}
		tags := []string{}
		for _, t := range e.fields["tags"].([]any) {
			tags = append(tags, t.(string))
		}
		body, err := json.Marshal(e.fields["body"])
		if err != nil {
			return err
		}
		effects, err := json.Marshal(e.fields["effects"])
		if err != nil {
			return err
		}
		// The record goes in as the text of its keys in order, into a json column, which keeps that text as it is.
		var record any
		if r, ok := e.fields["record"].(*schema.Obj); ok {
			text, err := schema.AppendJSON(nil, r)
			if err != nil {
				return err
			}
			record = string(text)
		}
		args = append(args, versionID, e.key, e.fields["type"], e.fields["name"], level, tags, e.fields["visibility"], cite, e.contentHash, body, effects, record, from+i)
	}
	_, err := tx.Exec(ctx, sql.String(), args...)
	return err
}

// Storage is what the owner has stored: packs (hidden ones included) and the bytes of every version.
type Storage struct {
	Packs int `json:"packs"`
	Bytes int `json:"bytes"`
}

func storageOf(ctx context.Context, conn core.Conn, userID string) (Storage, error) {
	var s Storage
	err := conn.QueryRow(ctx, `SELECT count(DISTINCT pack.id)::int, coalesce(sum(pack_version.bytes), 0)::int FROM pack
		LEFT JOIN pack_version ON pack_version.pack_id = pack.id WHERE pack.owner_user_id = $1`, userID).Scan(&s.Packs, &s.Bytes)
	return s, err
}

// ListedVersion is one version of a pack in the library.
type ListedVersion struct {
	ID         string `json:"id"`
	Version    string `json:"version"`
	EntryCount int    `json:"entryCount"`
	Bytes      int    `json:"bytes"`
	CreatedAt  string `json:"createdAt"`
}

// Listed is one pack in the library.
type Listed struct {
	ID          string          `json:"id"`
	Slug        string          `json:"slug"`
	License     string          `json:"license"`
	Attribution *string         `json:"attribution"`
	Disabled    bool            `json:"disabled"`
	RulesetSlug string          `json:"rulesetSlug"`
	CreatedAt   string          `json:"createdAt"`
	Versions    []ListedVersion `json:"versions"`
}

// Library is the owner's visible packs with their versions (newest first), and how much of the quota is used.
type Library struct {
	Packs []Listed `json:"packs"`
	Usage struct {
		Storage
		MaxPacks   int `json:"maxPacks"`
		MaxBytes   int `json:"maxBytes"`
		MaxEntries int `json:"maxEntries"`
	} `json:"usage"`
}

// ListMine is the owner's visible packs with their versions (newest first), and how much of the quota is used.
func ListMine(ctx context.Context, conn core.Conn, userID string) (*Library, error) {
	rows, err := conn.Query(ctx, `SELECT pack.id::text, pack.slug, pack.license, pack.attribution, pack.disabled_at IS NOT NULL,
			ruleset.slug, pack.created_at
		FROM pack JOIN ruleset ON ruleset.id = pack.ruleset_id
		WHERE pack.owner_user_id = $1 AND pack.hidden_at IS NULL ORDER BY pack.created_at DESC, pack.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	out := &Library{Packs: []Listed{}}
	at := map[string]int{}
	ids := []string{}
	for rows.Next() {
		var l Listed
		var created time.Time
		if err := rows.Scan(&l.ID, &l.Slug, &l.License, &l.Attribution, &l.Disabled, &l.RulesetSlug, &created); err != nil {
			rows.Close()
			return nil, err
		}
		l.CreatedAt, l.Versions = core.ISOTime(created), []ListedVersion{}
		at[l.ID] = len(out.Packs)
		ids = append(ids, l.ID)
		out.Packs = append(out.Packs, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		versions, err := conn.Query(ctx, `SELECT pack_id::text, id::text, version, entry_count, bytes, created_at FROM pack_version
			WHERE pack_id = ANY($1::uuid[]) ORDER BY created_at DESC, id DESC`, ids)
		if err != nil {
			return nil, err
		}
		defer versions.Close()
		for versions.Next() {
			var packID string
			var v ListedVersion
			var created time.Time
			if err := versions.Scan(&packID, &v.ID, &v.Version, &v.EntryCount, &v.Bytes, &created); err != nil {
				return nil, err
			}
			v.CreatedAt = core.ISOTime(created)
			out.Packs[at[packID]].Versions = append(out.Packs[at[packID]].Versions, v)
		}
		if err := versions.Err(); err != nil {
			return nil, err
		}
	}
	if out.Usage.Storage, err = storageOf(ctx, conn, userID); err != nil {
		return nil, err
	}
	out.Usage.MaxPacks, out.Usage.MaxBytes, out.Usage.MaxEntries = MaxPacksPerUser, MaxPackBytesPerUser, engine.MaxPackEntries
	return out, nil
}

type exportedEntry struct {
	Key        string         `json:"key"`
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Level      *int           `json:"level,omitempty"`
	Tags       []string       `json:"tags"`
	Cite       *string        `json:"cite,omitempty"`
	Visibility string         `json:"visibility"`
	Body       map[string]any `json:"body"`
	// Effects is left out when the entry has none, so an export of an old pack stays as it was.
	Effects json.RawMessage `json:"effects,omitempty"`
	// Record is the catalogue record as stored, keys in order (house decision #62); left out when the entry has none.
	Record json.RawMessage `json:"record,omitempty"`
}

type exportedPack struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Ruleset struct {
		ID    string `json:"id"`
		Range string `json:"range"`
	} `json:"ruleset"`
	License     string          `json:"license"`
	Attribution *string         `json:"attribution,omitempty"`
	Sources     json.RawMessage `json:"sources"`
	Entries     []exportedEntry `json:"entries"`
}

// ErrTakenDown says an export was refused because an admin took the pack down.
var ErrTakenDown = errors.New("pack taken down")

// Export is the owner's own pack as JSON, in the form Import takes (the latest version). Nil when it isn't theirs (the
// same answer as a pack that doesn't exist); ErrTakenDown after a takedown, which stops serving it to anyone.
func Export(ctx context.Context, conn core.Conn, userID, packID string) (*exportedPack, error) {
	var out exportedPack
	var disabled bool
	err := conn.QueryRow(ctx, `SELECT pack.slug, pack.license, pack.attribution, pack.disabled_at IS NOT NULL, ruleset.slug
		FROM pack JOIN ruleset ON ruleset.id = pack.ruleset_id WHERE pack.id = $1 AND pack.owner_user_id = $2`, packID, userID).
		Scan(&out.ID, &out.License, &out.Attribution, &disabled, &out.Ruleset.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if disabled {
		return nil, ErrTakenDown
	}
	var versionID string
	err = conn.QueryRow(ctx, `SELECT id::text, version, ruleset_range, sources FROM pack_version WHERE pack_id = $1
		ORDER BY created_at DESC, id DESC LIMIT 1`, packID).Scan(&versionID, &out.Version, &out.Ruleset.Range, &out.Sources)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, `SELECT key, type, name, level, tags, cite, visibility, body, effects, record FROM pack_entry
		WHERE pack_version_id = $1 ORDER BY ordinal, key`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out.Entries = []exportedEntry{}
	for rows.Next() {
		var e exportedEntry
		var level *int32
		var body, effects, record []byte
		if err := rows.Scan(&e.Key, &e.Type, &e.Name, &level, &e.Tags, &e.Cite, &e.Visibility, &body, &effects, &record); err != nil {
			return nil, err
		}
		e.Record = record
		if level != nil {
			l := int(*level)
			e.Level = &l
		}
		if err := json.Unmarshal(body, &e.Body); err != nil {
			return nil, err
		}
		if string(effects) != "[]" {
			e.Effects = effects
		}
		out.Entries = append(out.Entries, e)
	}
	return &out, rows.Err()
}

// Hidden is what hiding a pack answers: whether it was really removed.
type Hidden struct {
	Deleted bool `json:"deleted"`
}

// Hide is "delete" for the owner: the pack leaves their list at once, and is really removed when no room references
// any version of it (a referenced one stays so the room's table doesn't change). Nil when it isn't theirs.
func Hide(ctx context.Context, db *pgxpool.Pool, userID, packID string) (*Hidden, error) {
	var out *Hidden
	err := core.InTx(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE pack SET hidden_at = now() WHERE id = $1 AND owner_user_id = $2`, packID, userID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		var used int
		// A version a game module names stays too, as a room's does (its module keeps working).
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM pack_version WHERE pack_id = $1
			AND (id IN (SELECT pack_version_id FROM campaign_pack) OR id IN (SELECT pack_version_id FROM game_module_pack))`,
			packID).Scan(&used); err != nil {
			return err
		}
		if used > 0 {
			out = &Hidden{false}
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM pack WHERE id = $1`, packID); err != nil {
			return err
		}
		out = &Hidden{true}
		return nil
	})
	return out, err
}
