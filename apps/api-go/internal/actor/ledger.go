package actor

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// CatalogueLoader is the room's ledger catalogue, as build.save resolves against it (pack.LedgerCatalogue).
type CatalogueLoader func(ctx context.Context, conn core.Conn, campaignID string, b *engine.CompiledBuild) (ledger.Catalogue, error)

// A build refusal's detail lists this many problems and as many choices still to make, and is cut to maxDetail UTF-16
// units: enough for a person to act on, short enough for a toast.
const (
	notReadyLines = 5
	maxDetail     = 1000
)

// SaveBuild is build.save (house decision #63): the server resolves the build against the room's catalogue itself, and
// only a ready build is saved. It writes the sheet's numbers and names as the actor's fields, trusted as a creation's
// values are, its starting resources on the first save, and the build and the sheet, all in this transaction.
func SaveBuild(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action, catalogue CatalogueLoader) (cs.Result, error) {
	cid, actorID := c.CampaignID, a.Str("actorId")
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	if rules.Build == nil {
		return cs.Result{}, cs.Fail("notLedgerBuilt")
	}
	var kind, entityType string
	var stored *string
	var fieldRows int
	err = tx.QueryRow(ctx, `SELECT actor.kind, actor.entity_type, actor_build.build::text,
			(SELECT count(*) FROM actor_field WHERE actor_field.actor_id = actor.id)
		FROM actor LEFT JOIN actor_build ON actor_build.actor_id = actor.id WHERE actor.id = $1 AND actor.campaign_id = $2`,
		actorID, cid).Scan(&kind, &entityType, &stored, &fieldRows)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("characterNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if entityType != "" && entityType != rules.Build.Actor {
		return cs.Result{}, cs.Fail("notLedgerBuilt")
	}
	if stored == nil && fieldRows > 0 {
		return cs.Result{}, cs.Fail("alreadyBuilt") // filled in another way
	}

	// The text as it came, decoded in its key order: the builder reads keys in order, and so does whoever reads it back.
	decoded, err := schema.DecodeJSON([]byte(a.Str("build")))
	build, isObject := decoded.(*schema.Obj)
	if err == nil && !isObject {
		err = errors.New("a build is a JSON object")
	}
	if err != nil {
		return cs.Result{}, cs.Fail("buildInvalid", cs.Params{"detail": cut(err.Error())})
	}
	campaign, err := LoadCampaign(ctx, tx, cid, rules)
	if err != nil {
		return cs.Result{}, err
	}
	if tier, isNumber := get(build, "tier").(float64); isNumber {
		if room, set := campaign[rules.Ruleset.Build.Tier].(float64); !set || room != tier {
			var gameTier any = "unset"
			if set {
				gameTier = room
			}
			return cs.Result{}, cs.Fail("buildTierMismatch", cs.Params{"tier": tier, "gameTier": gameTier})
		}
	} // a tier that is not a number is the builder's to refuse
	// The approvals and rulings are the GM's: anyone else's save keeps the stored ones, or none.
	if !view.ActorGmSide(c, kind) {
		gm := any(schema.NewObj())
		if stored != nil {
			was, err := schema.DecodeJSON([]byte(*stored))
			if err != nil {
				return cs.Result{}, err
			}
			if x, has := was.(*schema.Obj).Get("gm"); has {
				gm = x
			}
		}
		build.Set("gm", gm)
	}

	cat, err := catalogue(ctx, tx, cid, rules.Build)
	if err != nil {
		return cs.Result{}, err
	}
	resolved, err := ledger.Resolve(rules.Build.Params, cat, build, nil)
	if err != nil {
		return cs.Result{}, cs.Fail("buildInvalid", cs.Params{"detail": cut(err.Error())})
	}
	if !ledger.Ready(resolved) {
		return cs.Result{}, cs.Fail("buildNotReady", cs.Params{"detail": notReady(resolved)})
	}
	sheet, _ := resolved.Sheet.(*schema.Obj)

	if _, err := tx.Exec(ctx, `UPDATE actor SET entity_type = $1,
		ruleset_version_id = (SELECT ruleset_version_id FROM campaign WHERE id = $3) WHERE id = $2`,
		rules.Build.Actor, actorID, cid); err != nil {
		return cs.Result{}, err
	}
	// Play changes the resources after the first save, so only the first one starts them.
	target := StartTarget{ActorID: actorID, Fields: sheetFields(rules.Ruleset.Build, sheet), FieldsOnly: stored != nil}
	if stored == nil {
		target.Resources = map[string]float64{}
		for _, r := range []struct {
			id  *string
			key string
		}{{rules.Ruleset.Build.Sheet.Wealth, "wealth"}, {rules.Ruleset.Build.Sheet.Corruption, "corruption"}} {
			if r.id != nil {
				target.Resources[*r.id] = number(sheet, r.key)
			}
		}
	}
	id, err := WriteStart(ctx, tx, c, rules, []StartTarget{target})
	if err != nil {
		return cs.Result{}, err
	}
	buildText, err := schema.AppendJSON(nil, build)
	if err != nil {
		return cs.Result{}, err
	}
	sheetText, err := schema.AppendJSON(nil, sheet)
	if err != nil {
		return cs.Result{}, err
	}
	// ponytail: like actor_choice the documents are outside the delta log, so Undo takes the field rows back but not
	// the build, upgrade: the build document in the event log
	_, err = tx.Exec(ctx, `INSERT INTO actor_build (actor_id, build, sheet) VALUES ($1, $2, $3)
		ON CONFLICT (actor_id) DO UPDATE SET build = EXCLUDED.build, sheet = EXCLUDED.sheet, updated_at = now()`,
		actorID, string(buildText), string(sheetText))
	return cs.Done(id), err
}

// sheetFields is the sheet's numbers and names by the actor field the manifest's build.sheet names for each. A Skill or
// mod the sheet does not list is 0.
func sheetFields(b *engine.LedgerBuild, sheet *schema.Obj) map[string]any {
	out := map[string]any{}
	for _, group := range []struct {
		key    string
		fields map[string]string
	}{{"attributes", b.Sheet.Attributes}, {"skills", b.Sheet.Skills}, {"mods", b.Sheet.Mods}} {
		values, _ := get(sheet, group.key).(*schema.Obj)
		for name, field := range group.fields {
			out[field] = number(values, name)
		}
	}
	armour, _ := get(sheet, "armour").(*schema.Obj)
	out[b.Sheet.ArmourRating] = number(armour, "ar")
	out[b.Sheet.Powered] = number(armour, "powered")
	out[b.Sheet.Speed] = number(sheet, "speed")
	out[b.Sheet.Species], _ = get(sheet, "species").(string)
	out[b.Sheet.Archetype], _ = get(sheet, "archetype").(string)
	keywords, _ := get(sheet, "keywords").([]any)
	out[b.Sheet.Keywords] = keywords
	return out
}

// notReady is a buildNotReady refusal's detail: the first problems (a GM's question marked as such), then the first
// choices still to make by path, and how many more there are.
func notReady(r *ledger.ResolvedBuild) string {
	lines := []string{}
	for _, p := range r.Problems[:min(len(r.Problems), notReadyLines)] {
		if p.Severity == "gm" {
			lines = append(lines, p.What+" (for the GM to approve)")
		} else {
			lines = append(lines, p.What)
		}
	}
	for _, p := range r.Pending[:min(len(r.Pending), notReadyLines)] {
		lines = append(lines, p.Path+": "+p.What)
	}
	if more := len(r.Problems) + len(r.Pending) - len(lines); more > 0 {
		lines = append(lines, fmt.Sprintf("and %d more", more))
	}
	return cut(strings.Join(lines, "\n"))
}

// cut shortens a detail to maxDetail UTF-16 units.
func cut(s string) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= maxDetail {
		return s
	}
	return string(utf16.Decode(units[:maxDetail-1])) + "…"
}

func get(o *schema.Obj, key string) any {
	v, _ := o.Get(key)
	return v
}

func number(o *schema.Obj, key string) float64 {
	n, _ := get(o, key).(float64)
	return n
}
