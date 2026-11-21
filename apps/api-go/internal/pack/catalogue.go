package pack

import (
	"context"
	"net/http"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Catalogue is what the ledger builder reads at this table (house decision #63): every record of the packs the room is
// served (house decision #61's rule, principle 4), grouped by kind through the ruleset's `build.kinds`, wargear apart.
// The first record per (kind, id) wins, by pack slug; records keep their pack's order and their stored key order, each
// a *schema.Obj. build.save resolves against it and GET /catalogue answers it, so both read one catalogue.
type Catalogue struct {
	// Kinds has every creation kind (engine.LedgerKinds but wargear), [] when the packs hold none.
	Kinds   map[string][]any `json:"kinds"`
	Wargear []any            `json:"wargear"`
}

// LoadCatalogue reads the room's catalogue for the ruleset's build block. Every record is GM-free (pack validation
// refuses a `gm` one), so there is one catalogue for every seat.
func LoadCatalogue(ctx context.Context, conn core.Conn, campaignID string, b *engine.CompiledBuild) (*Catalogue, error) {
	return loadCatalogue(ctx, conn, b, `JOIN campaign_pack ON campaign_pack.pack_version_id = pack_entry.pack_version_id
		WHERE `+actor.ServedPacks("$1"), campaignID)
}

// LoadOwnCatalogue is the catalogue of these pack versions, of the ones the user owns and an admin has not taken down:
// what a library character outside any room is built against (house decision #104). Nothing from another user's pack
// reaches anyone without a seat (principle 4).
func LoadOwnCatalogue(ctx context.Context, conn core.Conn, userID string, versionIDs []string, b *engine.CompiledBuild) (*Catalogue, error) {
	return loadCatalogue(ctx, conn, b, `WHERE pack.owner_user_id = $1 AND pack.disabled_at IS NULL
		AND pack_entry.pack_version_id = ANY($3::uuid[])`, userID, versionIDs)
}

// loadCatalogue reads the records of the pack entries `where` picks ($1 and from $3 on are the args; $2 is the types).
func loadCatalogue(ctx context.Context, conn core.Conn, b *engine.CompiledBuild, where string, args ...any) (*Catalogue, error) {
	kindOf := map[string]string{} // entity type → its kind
	types := []string{}
	out := &Catalogue{Kinds: map[string][]any{}, Wargear: []any{}}
	for _, kind := range engine.LedgerKinds {
		kindOf[b.Kinds[kind]] = kind
		types = append(types, b.Kinds[kind])
		if kind != "wargear" {
			out.Kinds[kind] = []any{}
		}
	}
	params := append([]any{args[0], types}, args[1:]...)
	// pack_entry.id is uuidv7, written in the pack's order at import, so it orders a pack's entries as its file does.
	rows, err := conn.Query(ctx, `SELECT pack_entry.type, pack_entry.record::text FROM pack_entry
		JOIN pack_version ON pack_version.id = pack_entry.pack_version_id
		JOIN pack ON pack.id = pack_version.pack_id
		`+where+` AND pack_entry.record IS NOT NULL AND pack_entry.type = ANY($2)
		ORDER BY pack.slug ASC, pack_entry.id ASC`, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var typ, text string
		if err := rows.Scan(&typ, &text); err != nil {
			return nil, err
		}
		record, err := schema.DecodeJSON([]byte(text))
		if err != nil {
			return nil, err
		}
		id, _ := record.(*schema.Obj).Get("id")
		kind := kindOf[typ]
		key, _ := id.(string)
		key = kind + "\x00" + key
		if seen[key] {
			continue
		}
		seen[key] = true
		if kind == "wargear" {
			out.Wargear = append(out.Wargear, record)
		} else {
			out.Kinds[kind] = append(out.Kinds[kind], record)
		}
	}
	return out, rows.Err()
}

// Ledger is the catalogue as the builder takes it, each record parsed by its kind's schema.
//
// ponytail: every served record is allowed, upgrade: a campaign setting for official sources only
func (c *Catalogue) Ledger(p *ledger.Params) (ledger.Catalogue, error) {
	in := schema.NewObj()
	for _, kind := range engine.LedgerKinds {
		if kind != "wargear" {
			in.Set(kind, c.Kinds[kind])
		}
	}
	creation, err := ledger.ParseCreation(p, in)
	if err != nil {
		return ledger.Catalogue{}, err
	}
	wargear, err := ledger.ParseWargear(p, c.Wargear)
	if err != nil {
		return ledger.Catalogue{}, err
	}
	return ledger.Catalogue{Creation: creation, Wargear: wargear, Homebrew: true}, nil
}

// LedgerCatalogue is the room's catalogue as build.save resolves against it: an actor.CatalogueLoader.
func LedgerCatalogue(ctx context.Context, conn core.Conn, campaignID string, b *engine.CompiledBuild) (ledger.Catalogue, error) {
	c, err := LoadCatalogue(ctx, conn, campaignID, b)
	if err != nil {
		return ledger.Catalogue{}, err
	}
	return c.Ledger(b.Params)
}

// catalogueReply is GET /catalogue: the builder's params as the manifest has them, and the room's catalogue.
type catalogueReply struct {
	Params any `json:"params"`
	*Catalogue
}

// Catalogue is GET /api/campaigns/{id}/catalogue: what a seat's builder reads, for any seat of the room. Refused when
// the pinned ruleset has no ledger builder.
//
// ponytail: read again on every request, upgrade: cache it by the room's served pack versions and ruleset version
func (s *Service) Catalogue(_ http.ResponseWriter, r *http.Request) (any, error) {
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
	rules, err := compiled.Load(r.Context(), s.DB, resolved.Ctx.CampaignID)
	if err != nil {
		return nil, err
	}
	if rules == nil {
		return nil, core.Refuse(http.StatusNotFound, "noRuleset")
	}
	if rules.Build == nil {
		return nil, core.Refuse(http.StatusNotFound, "notLedgerBuilt")
	}
	c, err := LoadCatalogue(r.Context(), s.DB, resolved.Ctx.CampaignID, rules.Build)
	if err != nil {
		return nil, err
	}
	build, _ := rules.Ruleset.Normalized["build"].(map[string]any)
	return catalogueReply{build["params"], c}, nil
}
