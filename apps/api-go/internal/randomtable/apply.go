package randomtable

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// Apply is table.apply (house decision #87): the GM's typed result, the inputs and the target pick a line, never the
// client, and the line's effects run in order through the ordinary writes: a hit through health.harm's hit op, a
// condition as condition.add writes it, a resource or pool by a clamped delta. Each step reads the target as the steps
// before it left it, and every write is logged under one action, so one Undo (or TURN BACK) takes the whole line back.
// A refusal of any step refuses the whole line; a condition the target is immune to is left out and the answer says so.
func Apply(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tableID := a.Str("tableId")
	t, err := tableOf(ctx, tx, c.CampaignID, tableID)
	if err != nil {
		return cs.Result{}, err
	}
	if !applies(t) {
		return cs.Result{}, cs.Fail("tableNoApply")
	}
	if err := checkGM(c, t); err != nil {
		return cs.Result{}, err
	}
	actorID := a.Str("actorId")
	rc, b, err := lookupTarget(ctx, tx, c, t, actorID)
	if err != nil {
		return cs.Result{}, err
	}
	name := b.Row.Name
	result, _ := a["result"].(float64)
	inputs, _ := a["inputs"].(map[string]any)
	read, steps, refused := rc.Compiled.PlanLookup(tableID, result, inputs, b.Scope, b.Entity)
	if refused != nil {
		return cs.Result{}, refusal(refused, name)
	}
	actionID, wrote := core.NewUUID(), false
	for _, s := range steps {
		deltas, err := stepDeltas(ctx, tx, rc, c.CampaignID, actorID, name, t.Title, s)
		if err != nil {
			return cs.Result{}, err
		}
		if len(deltas) == 0 {
			continue
		}
		// The table's own permission (encounter:run) authorises a pool change, as a Test offer's does.
		id, err := actor.ApplyDeltas(ctx, tx, actor.Apply{Ctx: c, Compiled: rc.Compiled, Built: rc.Built, Deltas: deltas,
			Pools: rc.Pools, Charged: true, ActionID: actionID})
		if err != nil {
			return cs.Result{}, err
		}
		if id != "" {
			wrote = true
			if rc, err = ruleset.Open(ctx, tx, c); err != nil { // the next step reads what this one wrote
				return cs.Result{}, err
			}
		}
	}
	r := cs.Result{OK: true}
	if wrote {
		r.ID = actionID
	}
	r.Roll = &cs.RollAnswer{EntryID: t.Entries[read.Entry].ID, Value: int(result), Total: read.Total}
	return r, nil
}

// grantDeltas is a grant step (house decision #88): the entry's key added to the end of the kind's list field, the
// write field.set makes, then each record it includes (house decision #165) that the room is served and the actor does
// not hold yet. Refused for an actor type the kind is not for, an entry the room is not served, one the actor holds
// already (the GM rolls again on that table, as the source app has it), or a kind its records would take past its max.
func grantDeltas(ctx context.Context, tx core.Conn, rc *ruleset.Context, campaignID, actorID, name string, s engine.LookupStep) ([]engine.Delta, error) {
	kind := rc.Compiled.Ruleset.Held[s.Held]
	b := rc.Built[actorID]
	if !slices.Contains(kind.Entities, b.Entity) {
		return nil, cs.Fail("heldNotFor", cs.Params{"name": name, "kind": kind.Label})
	}
	entry, served, err := actor.ServedEntryName(ctx, tx, campaignID, kind.Entry, s.Entry)
	if err != nil {
		return nil, err
	}
	if !served {
		return nil, cs.Fail("heldNoEntry", cs.Params{"entry": s.Entry})
	}
	keys := heldList(b.Fields[kind.Field])
	if slices.Contains(keys, s.Entry) {
		return nil, cs.Fail("heldAlready", cs.Params{"name": name, "entry": entry})
	}
	next := make([]any, 0, len(keys)+1)
	for _, k := range keys {
		next = append(next, k)
	}
	next = append(next, s.Entry)
	included, err := includedKeys(ctx, tx, campaignID, kind, s.Entry)
	if err != nil {
		return nil, err
	}
	for _, k := range included {
		if !slices.Contains(next, any(k)) {
			next = append(next, k)
		}
	}
	if len(next) > kind.MaxOrDefault() {
		return nil, cs.Fail("heldFull", cs.Params{"name": name, "kind": kind.Label})
	}
	return []engine.Delta{{Target: engine.DeltaTarget{ActorID: actorID, Field: kind.Field}, Kind: "set", Value: next}}, nil
}

// heldList is a list field's value as keys.
func heldList(v any) []string {
	items, _ := v.([]any)
	out := []string{}
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// applies says whether any line of the table has effects to apply.
func applies(t *engine.RandomTable) bool {
	for _, e := range t.Entries {
		if len(e.Apply) > 0 {
			return true
		}
	}
	return false
}

// stepDeltas are the writes one step makes, through the operation it stands for. A condition the target is immune to
// (now, after the steps before it) is nothing, with a notice; so is the shock of a hit its target never takes, the
// rest of the hit landing (house decision #163).
func stepDeltas(ctx context.Context, tx core.Conn, rc *ruleset.Context, campaignID, actorID, name, source string, s engine.LookupStep) ([]engine.Delta, error) {
	switch s.Kind {
	case "harm":
		hit := func(shock int) ([]engine.Delta, error) {
			return rc.Run(ctx, ruleset.Run{Primitive: "health.harm", Op: "hit",
				Input: map[string]any{"actorId": actorID, "wounds": float64(s.Wounds), "shock": float64(shock)}})
		}
		deltas, err := hit(s.Shock)
		var refused *cs.Error
		if s.Shock == 0 || !errors.As(err, &refused) || refused.Code != "neverShocked" {
			return deltas, err
		}
		label := "shock"
		if harm := rc.Compiled.Ruleset.Health.Harm; harm != nil && harm.Shock != nil {
			label = *harm.Shock
			if i := slices.IndexFunc(rc.Compiled.Ruleset.Resources, func(r engine.Resource) bool { return r.ID == label }); i >= 0 {
				label = rc.Compiled.Ruleset.Resources[i].Label
			}
		}
		cs.Notify(ctx, cs.ShockSkipped(name, label))
		if s.Wounds == 0 {
			return nil, nil
		}
		return hit(0)
	case "condition":
		label := s.Condition
		if def := rc.Compiled.Conditions[s.Condition]; def != nil {
			label = def.Label
		}
		if s.Immune {
			cs.Notify(ctx, cs.ConditionSkipped(name, label))
			return nil, nil
		}
		delta, err := rc.ConditionDelta(ctx, actorID, s.Condition, source, nil)
		var refused *cs.Error
		if errors.As(err, &refused) && refused.Code == "conditionImmune" {
			cs.Notify(ctx, cs.ConditionSkipped(name, label))
			return nil, nil
		}
		if err != nil || delta == nil {
			return nil, err
		}
		return []engine.Delta{*delta}, nil
	case "resource":
		return []engine.Delta{{Target: engine.DeltaTarget{ActorID: actorID, Resource: s.Resource}, Kind: "add", Value: float64(s.By)}}, nil
	case "grant":
		return grantDeltas(ctx, tx, rc, campaignID, actorID, name, s)
	}
	return []engine.Delta{{Target: engine.DeltaTarget{Pool: s.Pool}, Kind: "add", Value: float64(s.By)}}, nil
}

// includedKeys is the records a served entry brings with it (house decision #165): the keys its kind's `includes` list
// field names that the room is served, in the entry's order. None for a kind without `includes`.
func includedKeys(ctx context.Context, tx core.Conn, campaignID string, kind engine.HeldKind, key string) ([]string, error) {
	if kind.Includes == nil {
		return nil, nil
	}
	var body []byte
	err := tx.QueryRow(ctx, `SELECT e.body FROM campaign_pack
		JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id
		JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE campaign_pack.campaign_id = $1 AND e.type = $2 AND e.key = $3 AND `+actor.ServedPacks("$1")+`
		ORDER BY pack.slug LIMIT 1`, campaignID, kind.Entry, key).Scan(&body)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	if json.Unmarshal(body, &fields) != nil {
		return nil, nil
	}
	out := []string{}
	for _, k := range heldList(fields[*kind.Includes]) {
		_, served, err := actor.ServedEntryName(ctx, tx, campaignID, kind.Entry, k)
		if err != nil {
			return nil, err
		}
		if served && k != key {
			out = append(out, k)
		}
	}
	return out, nil
}
