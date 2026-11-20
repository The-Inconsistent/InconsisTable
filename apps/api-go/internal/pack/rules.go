package pack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// The page of entries GET /api/campaigns/{id}/rules answers.
const (
	maxRulesPage     = 500
	defaultRulesPage = 200
)

var rulesQuery = schema.Object(
	schema.Opt("type", schema.String().Min(1).Max(64)),
	schema.Opt("q", schema.String().Min(1).Max(100)),
	// key finds the entry a codex ref field names (house decision #71).
	schema.Opt("key", schema.String().Min(1).Max(120)),
	schema.Def("limit", schema.Int().Min(1).Max(maxRulesPage), float64(defaultRulesPage)),
	schema.Def("offset", schema.Int().Min(0), float64(0)),
)

// RulesQuery is the filter and page of a rules read.
type RulesQuery struct {
	Type, Q, Key  string
	Limit, Offset int
}

// parseRulesQuery reads the query string the way z.coerce.number() did: a number written in text is a number.
func parseRulesQuery(r *http.Request) (RulesQuery, error) {
	raw := map[string]any{}
	q := r.URL.Query()
	for _, key := range []string{"type", "q", "key"} {
		if q.Has(key) {
			raw[key] = q.Get(key)
		}
	}
	for _, key := range []string{"limit", "offset"} {
		if !q.Has(key) {
			continue
		}
		text := strings.TrimSpace(q.Get(key))
		if n, err := strconv.ParseFloat(text, 64); err == nil || text == "" {
			raw[key] = n
		} else {
			raw[key] = q.Get(key)
		}
	}
	out, issues := schema.Parse(rulesQuery, raw)
	if len(issues) > 0 {
		return RulesQuery{}, core.Refuse(http.StatusBadRequest, "badRequest", cs.Params{"detail": schema.Prettify(issues)})
	}
	parsed := out.(map[string]any)
	result := RulesQuery{Limit: int(parsed["limit"].(float64)), Offset: int(parsed["offset"].(float64))}
	result.Type, _ = parsed["type"].(string)
	result.Q, _ = parsed["q"].(string)
	result.Key, _ = parsed["key"].(string)
	return result, nil
}

// likePattern: `%` and `_` in a search are text, not wildcards.
func likePattern(q string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}

type rulesPack struct {
	ID          string  `json:"id"`
	Slug        string  `json:"slug"`
	Version     string  `json:"version"`
	License     string  `json:"license"`
	Attribution *string `json:"attribution"`
}

type rulesEntry struct {
	Pack       string         `json:"pack"`
	Key        string         `json:"key"`
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Level      *int           `json:"level"`
	Tags       []string       `json:"tags"`
	Cite       *string        `json:"cite"`
	Visibility string         `json:"visibility"`
	Body       map[string]any `json:"body"`
	// Effects is what an actor that chose the entry gets in its numbers; [] when none.
	Effects json.RawMessage `json:"effects"`
	// Record is the ledger builder's catalogue record, keys in order (house decision #62); null when none.
	Record json.RawMessage `json:"record"`
}

type rulesRuleset struct {
	VersionID string         `json:"versionId"`
	Slug      string         `json:"slug"`
	Version   string         `json:"version"`
	Manifest  map[string]any `json:"manifest"`
}

// rulesWorld is the room's World as its seats read it (house decision #65): the theme as stored.
type rulesWorld struct {
	VersionID string          `json:"versionId"`
	Slug      string          `json:"slug"`
	Version   string          `json:"version"`
	Name      string          `json:"name"`
	Theme     json.RawMessage `json:"theme"`
}

// Rules is what a seat may read of the room's rules.
type Rules struct {
	Ruleset *rulesRuleset `json:"ruleset"`
	// World is the pinned World while it is served (actor.ServedWorld), else nil.
	World   *rulesWorld  `json:"world"`
	Packs   []rulesPack  `json:"packs"`
	Entries []rulesEntry `json:"entries"`
	Total   int          `json:"total"`
}

// ReadRules is the pinned ruleset's manifest and the entries of the attached packs, both filtered for the seat. The only
// door to pack content (CLAUDE.md, principle 4):
//   - the caller is a seat of this room (resolved by the route; this takes its Ctx);
//   - a `gm` entry goes to the combat side only (the Seat view module), `party` and `public` to every seat;
//   - a pack taken down by an admin is served to nobody;
//   - a `private` pack is served only while its owner is a GM of this room;
//   - the pinned World only while it is not taken down and its owner runs this room (actor.ServedWorld).
func ReadRules(ctx context.Context, conn core.Conn, c cs.Ctx, query RulesQuery) (*Rules, error) {
	out := &Rules{Packs: []rulesPack{}, Entries: []rulesEntry{}}
	var versionID, slug, version string
	var manifestRaw []byte
	err := conn.QueryRow(ctx, `SELECT ruleset_version.id::text, ruleset.slug, ruleset_version.version, ruleset_version.manifest
		FROM campaign JOIN ruleset_version ON ruleset_version.id = campaign.ruleset_version_id
		JOIN ruleset ON ruleset.id = ruleset_version.ruleset_id WHERE campaign.id = $1`, c.CampaignID).
		Scan(&versionID, &slug, &version, &manifestRaw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		var doc any
		if err := json.Unmarshal(manifestRaw, &doc); err != nil {
			return nil, err
		}
		manifest, problems := engine.ValidateRuleset(doc)
		if len(problems) > 0 {
			return nil, fmt.Errorf("pinned ruleset %s no longer validates", versionID)
		}
		out.Ruleset = &rulesRuleset{versionID, slug, version, view.SeatManifest(manifest.Normalized, c)}
	}

	// Every seat of the room reads the World alike, the table screen included: it holds only a look.
	var w rulesWorld
	err = conn.QueryRow(ctx, `SELECT world_version.id::text, world.slug, world_version.version, world_version.document->>'name',
			world_version.document->'theme'
		FROM campaign JOIN world_version ON world_version.id = campaign.world_version_id
		JOIN world ON world.id = world_version.world_id WHERE campaign.id = $1 AND `+actor.ServedWorld("$1"), c.CampaignID).
		Scan(&w.VersionID, &w.Slug, &w.Version, &w.Name, &w.Theme)
	switch {
	case err == nil:
		out.World = &w
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}

	rows, err := conn.Query(ctx, `SELECT pack_version.id::text, pack.slug, pack_version.version, pack.license, pack.attribution
		FROM campaign_pack JOIN pack_version ON pack_version.id = campaign_pack.pack_version_id
		JOIN pack ON pack.id = pack_version.pack_id WHERE `+actor.ServedPacks("$1")+` ORDER BY pack.slug ASC`, c.CampaignID)
	if err != nil {
		return nil, err
	}
	versionIDs := []string{}
	slugOf := map[string]string{}
	for rows.Next() {
		var p rulesPack
		if err := rows.Scan(&p.ID, &p.Slug, &p.Version, &p.License, &p.Attribution); err != nil {
			rows.Close()
			return nil, err
		}
		versionIDs = append(versionIDs, p.ID)
		slugOf[p.ID] = p.Slug
		out.Packs = append(out.Packs, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(versionIDs) == 0 {
		return out, nil
	}

	where := `pack_entry.pack_version_id = ANY($1::uuid[]) AND pack_entry.visibility = ANY($2)`
	args := []any{versionIDs, view.ReadableEntryVisibilities(c)}
	if query.Type != "" {
		args = append(args, query.Type)
		where += fmt.Sprintf(" AND pack_entry.type = $%d", len(args))
	}
	if query.Q != "" {
		args = append(args, likePattern(query.Q))
		where += fmt.Sprintf(" AND pack_entry.name ILIKE $%d", len(args))
	}
	if query.Key != "" {
		args = append(args, query.Key)
		where += fmt.Sprintf(" AND pack_entry.key = $%d", len(args))
	}
	if err := conn.QueryRow(ctx, `SELECT count(*)::int FROM pack_entry WHERE `+where, args...).Scan(&out.Total); err != nil {
		return nil, err
	}
	args = append(args, query.Limit, query.Offset)
	entries, err := conn.Query(ctx, `SELECT pack_version_id::text, key, type, name, level, tags, cite, visibility, body, effects, record FROM pack_entry
		WHERE `+where+fmt.Sprintf(` ORDER BY type ASC, name ASC, key ASC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer entries.Close()
	for entries.Next() {
		var e rulesEntry
		var packVersion string
		var level *int32
		var body, record []byte
		if err := entries.Scan(&packVersion, &e.Key, &e.Type, &e.Name, &level, &e.Tags, &e.Cite, &e.Visibility, &body, &e.Effects, &record); err != nil {
			return nil, err
		}
		e.Pack = slugOf[packVersion]
		if level != nil {
			l := int(*level)
			e.Level = &l
		}
		if err := json.Unmarshal(body, &e.Body); err != nil {
			return nil, err
		}
		e.Record = record
		out.Entries = append(out.Entries, e)
	}
	return out, entries.Err()
}

// Rules is GET /api/campaigns/{id}/rules: the room's pinned ruleset and attached pack entries, filtered for the
// caller's seat. No seat, no rules.
func (s *Service) Rules(_ http.ResponseWriter, r *http.Request) (any, error) {
	id, err := core.Parse(cs.CampaignID, r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	resolved, err := s.Auth.ResolveCtx(r.Context(), id.(string), core.CookieHeader(r))
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	query, err := parseRulesQuery(r)
	if err != nil {
		return nil, err
	}
	return ReadRules(r.Context(), s.DB, resolved.Ctx, query)
}
