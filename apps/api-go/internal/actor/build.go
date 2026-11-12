package actor

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Lookups loads what a creation's `choose` steps pick from at this table, as gm or not (house decisions #18, #31):
// pack/pack.lookup.ts's entryLookup over loadServedEntries.
type Lookups func(ctx context.Context, conn core.Conn, campaignID string, types []string, gm bool) (engine.EntryLookup, error)

// ProblemLines is the detail of a build refusal: one `path: message` line per problem.
func ProblemLines(problems []engine.Problem) string {
	lines := make([]string, len(problems))
	for i, p := range problems {
		lines[i] = p.Path + ": " + p.Message
	}
	return strings.Join(lines, "\n")
}

// BuildEntity is the entity a character is built as: the one it already has, else the only one the ruleset's creation
// builds.
func BuildEntity(compiled *engine.CompiledRuleset, entityType string) (string, *cs.Error) {
	if entityType != "" {
		return entityType, nil
	}
	types := []string{}
	for _, s := range compiled.Ruleset.Creation {
		if !slices.Contains(types, s.Actor) {
			types = append(types, s.Actor)
		}
	}
	if len(types) != 1 {
		return "", cs.Fail("needTypeFirst")
	}
	return types[0], nil
}

// The name a creation wrote, trimmed and cut to 100 UTF-16 units, or "".
func builtName(fields map[string]any) string {
	name, isText := fields["name"].(string)
	if !isText {
		return ""
	}
	units := utf16.Encode([]rune(schema.TrimJS(name)))
	if len(units) > 100 {
		units = units[:100]
	}
	return string(utf16.Decode(units))
}

// BuildActor is actor.build: the server runs the ruleset's creation against the answers (the client's preview is only
// a preview), then writes the fields, the choices and the starting resources, and drops the caller's draft, all in
// this transaction.
func BuildActor(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action, lookups Lookups) (string, error) {
	cid := c.CampaignID
	compiled, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return "", err
	}
	if compiled == nil {
		return "", cs.Fail("noRuleset")
	}
	actorID := a.Str("actorId")
	var entityType string
	err = tx.QueryRow(ctx, `SELECT entity_type FROM actor WHERE id = $1 AND campaign_id = $2`, actorID, cid).Scan(&entityType)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", cs.Fail("characterNotFound")
	}
	if err != nil {
		return "", err
	}
	entity, refused := BuildEntity(compiled, entityType)
	if refused != nil {
		return "", refused
	}
	if !slices.ContainsFunc(compiled.Ruleset.Creation, func(s engine.CreationStep) bool { return s.Actor == entity }) {
		return "", cs.Fail("nothingToBuild")
	}
	var values int
	if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM actor_field WHERE actor_id = $1)
		+ (SELECT count(*) FROM actor_choice WHERE actor_id = $1)`, actorID).Scan(&values); err != nil {
		return "", err
	}
	if values > 0 {
		return "", cs.Fail("alreadyBuilt")
	}

	// A player picks from what a player may see; the combat side from everything attached (house decisions #18, #31).
	types := []string{}
	for _, s := range compiled.Ruleset.Creation {
		if s.Kind == "choose" && !slices.Contains(types, s.Pick) {
			types = append(types, s.Pick)
		}
	}
	lookup, err := lookups(ctx, tx, cid, types, view.ReadsGM(c))
	if err != nil {
		return "", err
	}
	answers, _ := a["answers"].(map[string]any)
	fields, choices, problems := compiled.Ruleset.RunCreation(entity, answers, lookup)
	if len(problems) > 0 {
		return "", cs.Fail("buildProblems", cs.Params{"detail": ProblemLines(problems)})
	}

	name := builtName(fields)
	if _, err := tx.Exec(ctx, `UPDATE actor SET entity_type = $1,
		ruleset_version_id = (SELECT ruleset_version_id FROM campaign WHERE id = $3),
		name = CASE WHEN $4 = '' THEN name ELSE $4 END WHERE id = $2`, entity, actorID, cid, name); err != nil {
		return "", err
	}
	// ponytail: choices are plain rows, not deltas (DeltaTarget has no choice target), so undo does not remove them
	for _, ch := range choices {
		if _, err := tx.Exec(ctx, `INSERT INTO actor_choice (actor_id, step_id, ordinal, option_key) VALUES ($1, $2, $3, $4)`,
			actorID, ch.StepID, ch.Ordinal, ch.OptionKey); err != nil {
			return "", err
		}
	}
	id, err := WriteStart(ctx, tx, c, compiled, []StartTarget{{actorID, fields}})
	if err != nil {
		return "", err
	}
	if c.UserID != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM builder_draft WHERE user_id = $1 AND campaign_id = $2`, *c.UserID, cid); err != nil {
			return "", err
		}
	}
	return id, nil
}
