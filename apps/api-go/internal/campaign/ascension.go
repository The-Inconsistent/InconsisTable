package campaign

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The ledger builder's play after creation (house decision #64; Auspex campaign.actions.ts session.end and
// campaign.ascend): XP at a session's end, the group's Ascension, and the Tier raised by hand. "The characters" are the
// player characters of the type the ledger builds.

// shortNames is how many of the characters short of the XP an ascensionShort refusal names before "and N more".
const shortNames = 5

// checkAward refuses a session's award the pinned ruleset does not give: none without an `xp` field and an `award`, and
// never more than its max. An award of 0 is always allowed.
func checkAward(ctx context.Context, tx core.Conn, cid string, award float64) error {
	if award == 0 {
		return nil
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return err
	}
	if rules == nil || rules.Ruleset.Build == nil || rules.Ruleset.Build.XP == nil || rules.Ruleset.Build.Award == nil {
		return cs.Fail("noAward")
	}
	if max := rules.Ruleset.Build.Award.Max; award > max {
		return cs.Fail("awardTooHigh", cs.Params{"max": max})
	}
	return nil
}

// characters are the room's player characters of the type the ledger builds, in load order.
func characters(rc *ruleset.Context, b *engine.LedgerBuild) []*actor.Built {
	out := []*actor.Built{}
	for _, id := range rc.Order {
		if built := rc.Built[id]; built.Row.Kind == "pc" && built.Entity == b.Actor {
			out = append(out, built)
		}
	}
	return out
}

// xpOf is a character's XP: its value of the field build.xp names, 0 when unset.
func xpOf(built *actor.Built, b *engine.LedgerBuild) float64 {
	n, _ := built.Fields[*b.XP].(float64)
	return n
}

// awardXP adds xp to every character's XP field, through the pipeline as a rule's own write (the seat's permission to
// run the event is the authority, not the field's editableBy).
func awardXP(ctx context.Context, rc *ruleset.Context, b *engine.LedgerBuild, xp float64) error {
	deltas := []engine.Delta{}
	for _, built := range characters(rc, b) {
		deltas = append(deltas, engine.Delta{Target: engine.DeltaTarget{ActorID: built.Row.ID, Field: *b.XP}, Kind: "set",
			Value: xpOf(built, b) + xp})
	}
	_, err := rc.ApplyRuled(ctx, deltas)
	return err
}

// sessionAward is session.end's award to every character, whatever its health (checkAward has passed).
func sessionAward(ctx context.Context, tx core.Conn, c cs.Ctx, award float64) error {
	if award == 0 {
		return nil
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return err
	}
	return awardXP(ctx, rc, rc.Compiled.Ruleset.Build, award)
}

// markAscension starts the next Tier's count: every character's xpAtAscension becomes the XP it has now, and
// packageWaived this Ascension's waive. A character with no actor_build row yet gets one with no documents.
func markAscension(ctx context.Context, tx core.Conn, cid string, b *engine.LedgerBuild, waive bool) error {
	xpField := ""
	if b.XP != nil {
		xpField = *b.XP
	}
	_, err := tx.Exec(ctx, `INSERT INTO actor_build (actor_id, xp_at_ascension, package_waived)
		SELECT a.id, coalesce((SELECT f.int_value FROM actor_field f WHERE f.actor_id = a.id AND f.field_id = $3 LIMIT 1), 0), $4
		FROM actor a WHERE a.campaign_id = $1 AND a.kind = 'pc' AND a.entity_type = $2
		ON CONFLICT (actor_id) DO UPDATE SET xp_at_ascension = EXCLUDED.xp_at_ascension,
			package_waived = EXCLUDED.package_waived, updated_at = now()`, cid, b.Actor, xpField, waive)
	return err
}

// Ascend is build.ascend: the group goes up one Tier together. `experience` once every character in the group has
// earned ascension.xp in this Tier; `milestone` at the GM's word, awarding that XP to every character. The group is the
// characters in none of the ruleset's `gone` health states; a state that cannot be evaluated does not count.
func Ascend(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rc, err := ruleset.OpenIfPinned(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	if rc == nil || rc.Compiled.Ruleset.Build == nil || rc.Compiled.Ruleset.Build.Ascension == nil || rc.Compiled.Ruleset.Build.XP == nil {
		return cs.Result{}, cs.Fail("noAscension")
	}
	b := rc.Compiled.Ruleset.Build
	before, err := actor.LoadCampaign(ctx, tx, c.CampaignID, rc.Compiled)
	if err != nil {
		return cs.Result{}, err
	}
	tier, _ := before[b.Tier].(float64)
	if tier >= b.Params.Tiers.Max {
		return cs.Result{}, cs.Fail("topTier", cs.Params{"tier": tier})
	}
	all := characters(rc, b)
	group := slices.DeleteFunc(slices.Clone(all), func(built *actor.Built) bool {
		if built.Scope == nil {
			return false
		}
		states, err := rc.Compiled.HealthStatesOf(built.Entity, built.Scope)
		return err == nil && slices.ContainsFunc(b.Gone, func(s string) bool { return slices.Contains(states, s) })
	})
	if len(group) == 0 {
		return cs.Result{}, cs.Fail("nobodyToAscend")
	}
	need := b.Ascension.XP
	if a.Str("kind") == "experience" {
		at, err := xpAtAscension(ctx, tx, c.CampaignID)
		if err != nil {
			return cs.Result{}, err
		}
		short := []string{}
		for _, built := range group {
			if xpOf(built, b)-at[built.Row.ID] < need {
				short = append(short, built.Row.Name)
			}
		}
		if len(short) > 0 {
			return cs.Result{}, cs.Fail("ascensionShort", cs.Params{"names": nameList(short), "xp": need, "tier": tier})
		}
	} else if err := awardXP(ctx, rc, b, need); err != nil {
		return cs.Result{}, err
	}
	if err := writeCampaignField(ctx, tx, c, rc.Compiled, b.Tier, before[b.Tier], tier+1); err != nil {
		return cs.Result{}, err
	}
	waive, _ := a["waivePackage"].(bool)
	return cs.Done(""), markAscension(ctx, tx, c.CampaignID, b, waive)
}

// xpAtAscension is each actor's stored count start, by id; an actor with no row starts at 0.
func xpAtAscension(ctx context.Context, tx core.Conn, cid string) (map[string]float64, error) {
	rows, err := tx.Query(ctx, `SELECT b.actor_id::text, b.xp_at_ascension FROM actor_build b JOIN actor ON actor.id = b.actor_id
		WHERE actor.campaign_id = $1`, cid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var xp int
		if err := rows.Scan(&id, &xp); err != nil {
			return nil, err
		}
		out[id] = float64(xp)
	}
	return out, rows.Err()
}

// nameList is "A, B and C", the first shortNames names and then "and N more", as Auspex lists them.
func nameList(names []string) string {
	if len(names) > shortNames {
		names = append(slices.Clone(names[:shortNames]), fmt.Sprintf("%d more", len(names)-shortNames))
	}
	if len(names) == 1 {
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}
