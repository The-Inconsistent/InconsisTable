package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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
	var stored, storedDraft *string
	var hasRow, packageWaived bool
	var fieldRows, xpAtAscension int
	var xpEarned *int32
	xpField := ""
	if rules.Ruleset.Build.XP != nil {
		xpField = *rules.Ruleset.Build.XP
	}
	err = tx.QueryRow(ctx, `SELECT actor.kind, actor.entity_type, actor_build.build::text, actor_build.draft::text,
			actor_build.actor_id IS NOT NULL, (SELECT count(*) FROM actor_field WHERE actor_field.actor_id = actor.id),
			coalesce(actor_build.xp_at_ascension, 0), coalesce(actor_build.package_waived, false),
			(SELECT int_value FROM actor_field WHERE actor_field.actor_id = actor.id AND field_id = $3 LIMIT 1)
		FROM actor LEFT JOIN actor_build ON actor_build.actor_id = actor.id WHERE actor.id = $1 AND actor.campaign_id = $2`,
		actorID, cid, xpField).Scan(&kind, &entityType, &stored, &storedDraft, &hasRow, &fieldRows, &xpAtAscension, &packageWaived, &xpEarned)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Result{}, cs.Fail("characterNotFound")
	}
	if err != nil {
		return cs.Result{}, err
	}
	if entityType != "" && entityType != rules.Build.Actor {
		return cs.Result{}, cs.Fail("notLedgerBuilt")
	}
	// Filled in another way (a draft alone claims the actor for the ledger): refused, unless the GM side saves a ready
	// build over it that keeps what the ruleset marks (house decision #96; the source app's keepSheet).
	handMade := !hasRow && fieldRows > 0
	if handMade {
		keepSheet, _ := a["keepSheet"].(bool)
		draft, _ := a["draft"].(bool)
		if !keepSheet || draft || rules.Ruleset.Build.Keep == nil {
			return cs.Result{}, cs.Fail("alreadyBuilt")
		}
		if !view.ActorGmSide(c, kind) {
			return cs.Result{}, cs.Fail("keepSheetGm")
		}
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
	roomTier, tierSet := campaign[rules.Ruleset.Build.Tier].(float64)
	// A made character (one with a stored build; a draft makes none) keeps its Tier, and only the GM side changes its
	// creation choices (house decision #64). A draft is held to the same, so a player cannot park a changed creation.
	var made *schema.Obj
	if stored != nil {
		doc, err := schema.DecodeJSON([]byte(*stored))
		if err != nil {
			return cs.Result{}, err
		}
		made = doc.(*schema.Obj)
		was, _ := get(made, "tier").(float64)
		if tier, isNumber := get(build, "tier").(float64); !isNumber || tier != was {
			return cs.Result{}, cs.Fail("buildMadeAtTier", cs.Params{"tier": was})
		}
		if !view.ActorGmSide(c, kind) {
			changed, err := creationChanged(rules.Build.Params, made, build)
			if err != nil {
				return cs.Result{}, cs.Fail("buildInvalid", cs.Params{"detail": cut(err.Error())})
			}
			if changed {
				return cs.Result{}, cs.Fail("creationLocked")
			}
		}
	} else if tier, isNumber := get(build, "tier").(float64); isNumber {
		if !tierSet || roomTier != tier {
			var gameTier any = "unset"
			if tierSet {
				gameTier = roomTier
			}
			return cs.Result{}, cs.Fail("buildTierMismatch", cs.Params{"tier": tier, "gameTier": gameTier})
		}
	} // a tier that is not a number is the builder's to refuse
	// The approvals and rulings are the GM's: anyone else's save keeps the stored ones (the draft's, which is newer, else
	// the build's), or none.
	if !view.ActorGmSide(c, kind) {
		gm := any(schema.NewObj())
		for _, was := range []*string{stored, storedDraft} {
			if was == nil {
				continue
			}
			doc, err := schema.DecodeJSON([]byte(*was))
			if err != nil {
				return cs.Result{}, err
			}
			if x, has := doc.(*schema.Obj).Get("gm"); has {
				gm = x
			}
		}
		build.Set("gm", gm)
	}
	// A draft is kept as it is, unresolved: the GM opens it to approve their part, and nothing of the actor changes.
	if draft, _ := a["draft"].(bool); draft {
		buildText, err := schema.AppendJSON(nil, build)
		if err != nil {
			return cs.Result{}, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO actor_build (actor_id, draft) VALUES ($1, $2)
			ON CONFLICT (actor_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()`, actorID, string(buildText))
		return cs.Done(""), err
	}

	// A made character is in play: priced against the XP it has earned at the room's Tier now, its purchase history the
	// one the server stamped, never the client's (house decision #64).
	var play *ledger.Play
	var history *schema.Obj
	if made != nil {
		history, _ = get(advancementOf(made), "boughtIn").(*schema.Obj)
		if history == nil {
			history = schema.NewObj()
		}
		setHistory(build, history)
		play = &ledger.Play{Tier: get(made, "tier").(float64), XPAtAscension: new(float64(xpAtAscension)), PackageWaived: packageWaived}
		if tierSet {
			play.Tier = roomTier
		}
		if xpEarned != nil {
			play.XPEarned = float64(*xpEarned)
		}
	}
	cat, err := catalogue(ctx, tx, cid, rules.Build)
	if err != nil {
		return cs.Result{}, err
	}
	resolved, err := ledger.Resolve(rules.Build.Params, cat, build, play)
	if err != nil {
		return cs.Result{}, cs.Fail("buildInvalid", cs.Params{"detail": cut(err.Error())})
	}
	if !ledger.Ready(resolved) {
		return cs.Result{}, cs.Fail("buildNotReady", cs.Params{"detail": notReady(resolved)})
	}
	sheet, _ := resolved.Sheet.(*schema.Obj)
	xpSpent := 0
	if resolved.Advancement != nil {
		xpSpent = int(resolved.Advancement.Spent)
	}
	if made != nil {
		stamped, err := stampHistory(ctx, tx, cid, resolved, history)
		if err != nil {
			return cs.Result{}, err
		}
		setHistory(build, stamped)
	}
	buildText, err := schema.AppendJSON(nil, build)
	if err != nil {
		return cs.Result{}, err
	}

	if _, err := tx.Exec(ctx, `UPDATE actor SET entity_type = $1,
		ruleset_version_id = (SELECT ruleset_version_id FROM campaign WHERE id = $3) WHERE id = $2`,
		rules.Build.Actor, actorID, cid); err != nil {
		return cs.Result{}, err
	}
	// Play changes the resources after the first save, so only the first one starts them.
	target := StartTarget{ActorID: actorID, Fields: sheetFields(rules.Ruleset.Build, sheet), FieldsOnly: stored != nil}
	if handMade {
		for _, f := range rules.Ruleset.Build.Keep.Fields {
			delete(target.Fields, f)
		}
		target.KeepResources = rules.Ruleset.Build.Keep.Resources
	}
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
	sheetText, err := schema.AppendJSON(nil, sheet)
	if err != nil {
		return cs.Result{}, err
	}
	// A fitting on a line the new sheet no longer gives goes with it, as the source app drops a fitted upgrade with the
	// weapon a rebuild takes away (its build.ts 2402-2411); one the sheet still gives stays fitted (house decision #102).
	if target.Extra, err = droppedFittings(ctx, tx, actorID, LinesOf(sheetText)); err != nil {
		return cs.Result{}, err
	}
	id, err := WriteStart(ctx, tx, c, rules, []StartTarget{target})
	if err != nil {
		return cs.Result{}, err
	}
	// ponytail: like actor_choice the documents are outside the delta log, so Undo takes the field rows back but not
	// the build, upgrade: the build document in the event log
	// ponytail: nothing gained in play lives on the sheet document yet, so it is replaced whole, upgrade: keep what play
	// added (Auspex keepPlay) when requisition and upgrades are ported
	_, err = tx.Exec(ctx, `INSERT INTO actor_build (actor_id, build, sheet, xp_spent) VALUES ($1, $2, $3, $4)
		ON CONFLICT (actor_id) DO UPDATE SET build = EXCLUDED.build, sheet = EXCLUDED.sheet, xp_spent = EXCLUDED.xp_spent,
			draft = NULL, updated_at = now()`,
		actorID, string(buildText), string(sheetText), xpSpent)
	return cs.Done(id), err
}

// creationChanged says whether next changes the creation part of the made build (creationKey): what only the GM side
// changes once a character is made. Both are parsed by the build's schema first, as the TypeScript compares them.
func creationChanged(p *ledger.Params, made, next *schema.Obj) (bool, error) {
	was, err := ledger.ParseRecord(p.Schemas().CharacterBuild, made)
	if err != nil {
		return false, err
	}
	now, err := ledger.ParseRecord(p.Schemas().CharacterBuild, next)
	if err != nil {
		return false, err
	}
	return ledger.CreationKey(was) != ledger.CreationKey(now), nil
}

func advancementOf(build *schema.Obj) *schema.Obj {
	adv, _ := get(build, "advancement").(*schema.Obj)
	return adv
}

// setHistory puts the purchase history in the build's advancement, in the place the client's had, keeping the build's
// key order. A build without an advancement buys nothing in play, and one that sent no history and has none gains no key.
func setHistory(build, history *schema.Obj) {
	if adv := advancementOf(build); adv != nil && (adv.Has("boughtIn") || history.Len() > 0) {
		adv.Set("boughtIn", history)
	}
}

// stampHistory is the purchase history after a save (Auspex stampHistory, house decision #64): the stored stamp of every
// advancement purchase the resolved ledger still names, in the stored order, then each new one stamped with the room's
// highest session number (the open session, else the last one); with no session yet a new one stays unstamped. A
// purchase taken back loses its stamp. Only a save that bought something new asks for the session.
func stampHistory(ctx context.Context, tx core.Conn, campaignID string, r *ledger.ResolvedBuild, stored *schema.Obj) (*schema.Obj, error) {
	keys := []string{}
	for _, row := range r.Ledger {
		if row.Pool == "advancement" && row.Key != "" && !slices.Contains(keys, row.Key) {
			keys = append(keys, row.Key)
		}
	}
	out := schema.NewObj()
	for _, k := range stored.Keys() {
		if slices.Contains(keys, k) {
			v, _ := stored.Get(k)
			out.Set(k, v)
		}
	}
	fresh := slices.DeleteFunc(slices.Clone(keys), out.Has)
	if len(fresh) == 0 {
		return out, nil
	}
	var latest *int32
	if err := tx.QueryRow(ctx, `SELECT max(number) FROM session WHERE campaign_id = $1`, campaignID).Scan(&latest); err != nil {
		return nil, err
	}
	if latest != nil {
		for _, k := range fresh {
			out.Set(k, float64(*latest))
		}
	}
	return out, nil
}

// LoadLedgers is the room's saved ledger builds, sheets and drafts by actor, as stored text, with their play figures
// (house decision #64; the Seat view decides who reads them).
func LoadLedgers(ctx context.Context, conn core.Conn, campaignID string) (map[string]*cs.ActorLedger, error) {
	rows, err := conn.Query(ctx, `SELECT b.actor_id::text, b.build::text, b.sheet::text, b.draft::text, b.xp_spent,
			b.xp_at_ascension, b.package_waived
		FROM actor_build b JOIN actor ON actor.id = b.actor_id WHERE actor.campaign_id = $1`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*cs.ActorLedger{}
	for rows.Next() {
		var id string
		var build, sheet, draft *string
		var l cs.ActorLedger
		if err := rows.Scan(&id, &build, &sheet, &draft, &l.XPSpent, &l.XPAtAscension, &l.PackageWaived); err != nil {
			return nil, err
		}
		l.Build, l.Sheet, l.Draft = raw(build), raw(sheet), raw(draft)
		out[id] = &l
	}
	return out, rows.Err()
}

// raw is stored JSON text sent on as it is; nil (sent as null) when the column is NULL.
func raw(text *string) json.RawMessage {
	if text == nil {
		return nil
	}
	return json.RawMessage(*text)
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

// NotReady is a buildNotReady refusal's detail, for a build resolved outside a room (the character library).
func NotReady(r *ledger.ResolvedBuild) string { return notReady(r) }

// BuildWrites is the actor fields a saved build writes: what a room document leaves to the build (house decision #103).
func BuildWrites(b *engine.LedgerBuild) map[string]bool {
	out := map[string]bool{}
	for field := range sheetFields(b, schema.NewObj()) {
		out[field] = true
	}
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
