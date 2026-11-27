// Package library is the character library (house decision #104): a user's own characters outside any room, kept as
// the ledger builder's document. It is owner-scoped REST, one of principle 6's writes outside the action path: a
// character goes into a room as an ordinary `build.save` draft, sent by the room's own builder, never from here.
package library

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Cap is how many characters a user keeps (the source app's LIBRARY_CAP).
const Cap = 20

// Version is a ruleset or pack version a character names.
type Version struct {
	Slug    string `json:"slug"`
	Version string `json:"version"`
	Title   string `json:"title,omitempty"`
}

// Card is a character as the list shows it.
type Card struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Done bool   `json:"done"`
	// Line is the card's line (house decision #187): the chosen archetype's or species' name of a finished character,
	// as its ruleset names; nil without one.
	Line      *string `json:"line"`
	Ruleset   Version `json:"ruleset"`
	Rev       int64   `json:"rev"`
	UpdatedAt string  `json:"updatedAt"`
}

// Entry is one character whole: its card, the build as the builder wrote it (text, keys in order), the packs its
// catalogue comes from, and whether its owner may edit it here (they own its ruleset and every pack).
type Entry struct {
	Card
	// UserID is its owner, the caller: the browser keeps each user's draft apart (house decision #188).
	UserID   string    `json:"userId"`
	Build    *string   `json:"build"`
	Packs    []Version `json:"packs"`
	Editable bool      `json:"editable"`
}

const cardSelect = `SELECT c.id::text, c.name, c.done, c.line, r.slug, v.version, r.title, c.rev, c.updated_at
	FROM library_character c JOIN ruleset_version v ON v.id = c.ruleset_version_id JOIN ruleset r ON r.id = v.ruleset_id`

func scanCard(row pgx.Row, extra ...any) (Card, error) {
	var c Card
	var updated time.Time
	err := row.Scan(append([]any{&c.ID, &c.Name, &c.Done, &c.Line, &c.Ruleset.Slug, &c.Ruleset.Version, &c.Ruleset.Title, &c.Rev, &updated}, extra...)...)
	c.UpdatedAt = core.ISOTime(updated)
	return c, err
}

// List is the user's characters, the last edited first.
func List(ctx context.Context, conn core.Conn, userID string) ([]Card, error) {
	rows, err := conn.Query(ctx, cardSelect+` WHERE c.owner_user_id = $1 ORDER BY c.updated_at DESC, c.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Card, error) { return scanCard(r) })
	if out == nil {
		out = []Card{}
	}
	return out, err
}

// Get is one of the user's characters (libraryNotFound for anyone else's, as for none).
func Get(ctx context.Context, conn core.Conn, userID, id string) (*Entry, error) {
	r, err := load(ctx, conn, userID, id)
	if err != nil {
		return nil, err
	}
	return &r.Entry, nil
}

var errNotFound = cs.Fail("libraryNotFound")

// row is one of the user's characters with what an edit needs.
type row struct {
	Entry
	rulesetVersionID string
	packIDs          []string
}

func load(ctx context.Context, conn core.Conn, userID, id string) (*row, error) {
	var r row
	var rulesetOwner string
	card, err := scanCard(conn.QueryRow(ctx, `SELECT c.id::text, c.name, c.done, c.line, r.slug, v.version, r.title, c.rev, c.updated_at,
			c.build::text, r.owner_user_id, c.ruleset_version_id::text, c.pack_version_ids::text[]
		FROM library_character c JOIN ruleset_version v ON v.id = c.ruleset_version_id JOIN ruleset r ON r.id = v.ruleset_id
		WHERE c.owner_user_id = $1 AND c.id = $2`, userID, id), &r.Build, &rulesetOwner, &r.rulesetVersionID, &r.packIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Card, r.UserID = card, userID
	rows, err := conn.Query(ctx, `SELECT p.slug, v.version, p.owner_user_id = $2 AND p.disabled_at IS NULL FROM pack_version v
		JOIN pack p ON p.id = v.pack_id WHERE v.id = ANY($1::uuid[]) ORDER BY p.slug`, r.packIDs, userID)
	if err != nil {
		return nil, err
	}
	r.Packs = []Version{}
	owned := rulesetOwner == userID
	var slug, version string
	var mine bool
	if _, err := pgx.ForEachRow(rows, []any{&slug, &version, &mine}, func() error {
		r.Packs = append(r.Packs, Version{Slug: slug, Version: version})
		owned = owned && mine
		return nil
	}); err != nil {
		return nil, err
	}
	// A pack version gone since (a row the array still names) leaves the catalogue short: not editable here.
	r.Editable = owned && len(r.Packs) == len(r.packIDs)
	return &r, nil
}

// Rules is what the builder outside a room reads for an editable character: the ruleset's manifest and the catalogue of
// its packs, both the owner's own.
func Rules(ctx context.Context, conn core.Conn, userID, id string) (map[string]any, error) {
	r, err := load(ctx, conn, userID, id)
	if err != nil {
		return nil, err
	}
	if !r.Editable {
		return nil, cs.Fail("libraryNotEditable")
	}
	rules, err := compiled.LoadVersion(ctx, conn, r.rulesetVersionID)
	if err != nil || rules == nil || rules.Build == nil {
		return nil, cmpErr(err, cs.Fail("notLedgerBuilt"))
	}
	c, err := pack.LoadOwnCatalogue(ctx, conn, userID, r.packIDs, rules.Build)
	if err != nil {
		return nil, err
	}
	return map[string]any{"manifest": rules.Ruleset.Normalized, "kinds": c.Kinds, "wargear": c.Wargear}, nil
}

func cmpErr(err, otherwise error) error {
	if err != nil {
		return err
	}
	return otherwise
}

// buildOf reads a build's text in its key order, as build.save does: not JSON, or not an object, is buildInvalid.
func buildOf(text string) (*schema.Obj, error) {
	decoded, err := schema.DecodeJSON([]byte(text))
	build, isObject := decoded.(*schema.Obj)
	if err == nil && !isObject {
		err = errors.New("a build is a JSON object")
	}
	if err != nil {
		return nil, cs.Fail("buildInvalid", cs.Params{"detail": err.Error()})
	}
	return build, nil
}

// ready resolves a build against the character's own catalogue, as a first build.save does (no play), and refuses one
// with problems or choices left. It answers the card's line from the resolved sheet.
func ready(ctx context.Context, conn core.Conn, userID string, r *row, build *schema.Obj) (*string, error) {
	rules, err := compiled.LoadVersion(ctx, conn, r.rulesetVersionID)
	if err != nil || rules == nil || rules.Build == nil {
		return nil, cmpErr(err, cs.Fail("notLedgerBuilt"))
	}
	c, err := pack.LoadOwnCatalogue(ctx, conn, userID, r.packIDs, rules.Build)
	if err != nil {
		return nil, err
	}
	cat, err := c.Ledger(rules.Build.Params)
	if err != nil {
		return nil, err
	}
	resolved, err := ledger.Resolve(rules.Build.Params, cat, build, nil)
	if err != nil {
		return nil, cs.Fail("buildInvalid", cs.Params{"detail": err.Error()})
	}
	if !ledger.Ready(resolved) {
		return nil, cs.Fail("buildNotReady", cs.Params{"detail": actor.NotReady(resolved)})
	}
	sheet, _ := resolved.Sheet.(*schema.Obj)
	key, _ := lineKey(rules.Ruleset.Build)
	if sheet == nil || key == "" {
		return nil, nil
	}
	name, _ := sheet.Get(key)
	return lineOf(name), nil
}

// lineKey is the resolved sheet's key the ruleset's libraryLine names (house decision #187) and the actor field the
// sheet lands it in; "" for none.
func lineKey(b *engine.LedgerBuild) (key, field string) {
	switch {
	case b == nil || b.LibraryLine == nil:
		return "", ""
	case *b.LibraryLine == "archetypes":
		return "archetype", b.Sheet.Archetype
	}
	return "species", b.Sheet.Species
}

// lineOf is a name as a card's line: nil when it is not a name, cut to the column's 100 characters.
func lineOf(v any) *string {
	name, _ := v.(string)
	if name == "" {
		return nil
	}
	return new(string(([]rune(name))[:min(len([]rune(name)), 100)]))
}

// Patch is a save: at the revision the caller read, a new name, and a new build that is a draft unless done says it is
// ready. A build is written only for a character editable here; a rename always may be.
type Patch struct {
	Rev   int64
	Name  *string
	Build *string
	Done  bool
}

// Save applies a patch and answers the card at its new revision. A revision other than the stored one is refused
// (libraryChanged): another tab saved since.
func Save(ctx context.Context, db core.Conn, userID, id string, p Patch) (Card, error) {
	r, err := load(ctx, db, userID, id)
	if err != nil {
		return Card{}, err
	}
	if r.Rev != p.Rev {
		return Card{}, cs.Fail("libraryChanged")
	}
	build, done, line := r.Build, r.Done, r.Line
	if p.Build != nil {
		line = nil // a draft has no line (house decision #187)
		if !r.Editable {
			return Card{}, cs.Fail("libraryNotEditable")
		}
		doc, err := buildOf(*p.Build)
		if err != nil {
			return Card{}, err
		}
		if p.Done {
			if line, err = ready(ctx, db, userID, r, doc); err != nil {
				return Card{}, err
			}
		}
		text, err := schema.AppendJSON(nil, doc)
		if err != nil {
			return Card{}, err
		}
		s := string(text)
		build, done = &s, p.Done
	}
	name := r.Name
	if p.Name != nil {
		name = *p.Name
	}
	card, err := scanCard(db.QueryRow(ctx, `WITH saved AS (UPDATE library_character SET name = $4, build = $5::json, done = $6,
			line = $7, rev = rev + 1, updated_at = now() WHERE owner_user_id = $1 AND id = $2 AND rev = $3 RETURNING *)
		SELECT c.id::text, c.name, c.done, c.line, r.slug, v.version, r.title, c.rev, c.updated_at
		FROM saved c JOIN ruleset_version v ON v.id = c.ruleset_version_id JOIN ruleset r ON r.id = v.ruleset_id`,
		userID, id, p.Rev, name, build, done, line))
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, cs.Fail("libraryChanged")
	}
	return card, err
}

// create inserts a character within the cap: the user's row is locked first, so two creations at once count each other.
func create(ctx context.Context, tx pgx.Tx, userID, name, rulesetVersionID string, packIDs []string, build *string, done bool,
	line *string) (Card, error) {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM app_user WHERE id = $1 FOR UPDATE`, userID); err != nil {
		return Card{}, err
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM library_character WHERE owner_user_id = $1`, userID).Scan(&n); err != nil {
		return Card{}, err
	}
	if n >= Cap {
		return Card{}, cs.Fail("libraryFull", cs.Params{"cap": Cap})
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO library_character (owner_user_id, name, ruleset_version_id, pack_version_ids, build, done, line)
		VALUES ($1, $2, $3, $4::uuid[], $5::json, $6, $7) RETURNING id::text`, userID, name, rulesetVersionID, packIDs, build, done,
		line).Scan(&id); err != nil {
		return Card{}, err
	}
	return scanCard(tx.QueryRow(ctx, cardSelect+` WHERE c.id = $1`, id))
}

// New starts a character with one of the user's own ledger rulesets, built against the newest version of each of
// their own packs for that ruleset that an admin has not taken down: what they may edit outside a room.
func New(ctx context.Context, tx pgx.Tx, userID, name, rulesetVersionID string) (Card, error) {
	var slug string
	err := tx.QueryRow(ctx, `SELECT r.slug FROM ruleset_version v JOIN ruleset r ON r.id = v.ruleset_id
		WHERE v.id = $1 AND r.owner_user_id = $2`, rulesetVersionID, userID).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, cs.Fail("rulesetNotFound")
	}
	if err != nil {
		return Card{}, err
	}
	rules, err := compiled.LoadVersion(ctx, tx, rulesetVersionID)
	if err != nil {
		return Card{}, err
	}
	if rules == nil || rules.Build == nil {
		return Card{}, cs.Fail("notLedgerBuilt")
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT ON (p.id) v.id::text FROM pack p JOIN pack_version v ON v.pack_id = p.id
		JOIN ruleset r ON r.id = p.ruleset_id
		WHERE p.owner_user_id = $1 AND r.slug = $2 AND p.hidden_at IS NULL AND p.disabled_at IS NULL
		ORDER BY p.id, v.created_at DESC, v.id DESC`, userID, slug)
	if err != nil {
		return Card{}, err
	}
	packs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return Card{}, err
	}
	return create(ctx, tx, userID, name, rulesetVersionID, packs, nil, false, nil)
}

// FromRoom copies a character the caller's seat holds out of a room, saved build and all, as a done character of the
// ruleset version it was built with and the packs the room is served. The GM's part of the build stays in the room.
func FromRoom(ctx context.Context, tx pgx.Tx, userID string, c cs.Ctx, actorID string) (Card, error) {
	if c.Seat.Kind != cs.SeatMember || c.UserID == nil || *c.UserID != userID || !slices.Contains(c.Seat.CharacterIDs, actorID) {
		return Card{}, cs.Fail("libraryNotYours")
	}
	return fromRoom(ctx, tx, userID, c.CampaignID, actorID)
}

func fromRoom(ctx context.Context, tx pgx.Tx, userID, campaignID, actorID string) (Card, error) {
	var name string
	var build *string
	var version *string
	err := tx.QueryRow(ctx, `SELECT a.name, b.build::text, coalesce(a.ruleset_version_id, c.ruleset_version_id)::text
		FROM actor a JOIN campaign c ON c.id = a.campaign_id LEFT JOIN actor_build b ON b.actor_id = a.id
		WHERE a.id = $1 AND a.campaign_id = $2`, actorID, campaignID).Scan(&name, &build, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return Card{}, cs.Fail("characterNotFound")
	}
	if err != nil {
		return Card{}, err
	}
	if build == nil || version == nil {
		return Card{}, cs.Fail("libraryNotBuilt")
	}
	doc, err := buildOf(*build)
	if err != nil {
		return Card{}, err
	}
	mine := schema.NewObj()
	for _, key := range doc.Keys() {
		if key != "gm" {
			v, _ := doc.Get(key)
			mine.Set(key, v)
		}
	}
	text, err := schema.AppendJSON(nil, mine)
	if err != nil {
		return Card{}, err
	}
	rows, err := tx.Query(ctx, `SELECT campaign_pack.pack_version_id::text FROM campaign_pack
		JOIN pack_version ON pack_version.id = campaign_pack.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE `+actor.ServedPacks("$1")+` ORDER BY pack.slug`, campaignID)
	if err != nil {
		return Card{}, err
	}
	packs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return Card{}, err
	}
	// The card's line is what the room's sheet already shows of that kind (house decision #187): no catalogue read here.
	var line *string
	rules, err := compiled.LoadVersion(ctx, tx, *version)
	if err != nil {
		return Card{}, err
	}
	field := ""
	if rules != nil {
		_, field = lineKey(rules.Ruleset.Build)
	}
	if field != "" {
		var chosen *string
		if err := tx.QueryRow(ctx, `SELECT text_value FROM actor_field WHERE actor_id = $1 AND field_id = $2 ORDER BY ordinal LIMIT 1`,
			actorID, field).Scan(&chosen); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Card{}, err
		}
		if chosen != nil {
			line = lineOf(*chosen)
		}
	}
	s := string(text)
	return create(ctx, tx, userID, name, *version, packs, &s, true, line)
}

// Delete removes one of the user's characters.
func Delete(ctx context.Context, conn core.Conn, userID, id string) error {
	tag, err := conn.Exec(ctx, `DELETE FROM library_character WHERE owner_user_id = $1 AND id = $2`, userID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return errNotFound
	}
	return err
}
