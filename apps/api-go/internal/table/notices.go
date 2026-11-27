package table

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// A ruleset's notice rules (house decision #79), read on the server around one action: a rule of the event the action
// runs on every actor of its types after it, a `crossed` rule on every actor that did not meet it before and does after.

// noticeEvent is the reset event the action runs and the one actor it runs on ("" for all), or "" for none.
func noticeEvent(a cs.Action) (event, only string) {
	switch a.Type() {
	case "session.start":
		return "sessionStart", ""
	case "session.end":
		return "sessionEnd", ""
	case "encounter.end":
		return "encounterEnd", ""
	case "actor.rest":
		return a.Str("event"), a.Str("actorId")
	}
	return "", ""
}

// noticeRead is what readNotices found before the action: the rules, and what each `crossed` rule saw.
type noticeRead struct {
	rules *engine.CompiledRuleset
	// before is, by rule id then actor id ("" for a group rule), what a `crossed` rule saw before the action.
	before map[string]map[string]seen
}

// seen is what a `crossed` rule read once: whether it was met, and its `rises` number (nil without one, or unreadable).
type seen struct {
	met   bool
	level *float64
}

// noticeWorld is the room's actors built, in load order, with each ledger actor's play (house decision #168).
type noticeWorld struct {
	rows  []actor.Rows
	built map[string]*actor.Built
	play  map[string][2]float64
}

// readNotices is read before the action; nil when the ruleset has no rule this action could raise.
//
// ponytail: a ruleset with a `crossed` rule builds every actor before and after each action that touches the state;
// keep the actors the pipeline built if a large table feels it.
func readNotices(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (*noticeRead, error) {
	if !TouchesOf(a).State {
		return nil, nil
	}
	rules, err := compiled.Load(ctx, tx, c.CampaignID)
	if err != nil || rules == nil {
		return nil, err
	}
	event, _ := noticeEvent(a)
	crossed := slices.ContainsFunc(rules.Notices, func(n engine.CompiledNotice) bool { return n.When == "crossed" })
	if !crossed && !slices.ContainsFunc(rules.Notices, func(n engine.CompiledNotice) bool { return n.When == event }) {
		return nil, nil
	}
	r := &noticeRead{rules: rules, before: map[string]map[string]seen{}}
	if !crossed {
		return r, nil
	}
	w, err := buildWorld(ctx, tx, c.CampaignID, rules)
	if err != nil {
		return nil, err
	}
	for i := range rules.Notices {
		n := &rules.Notices[i]
		if n.When != "crossed" {
			continue
		}
		r.before[n.ID] = map[string]seen{}
		if n.Group != "" {
			r.before[n.ID][""] = seen{met: w.groupMeets(rules, n)}
			continue
		}
		for _, row := range w.rows {
			scope := w.scope(rules, w.built[row.Actor.ID])
			r.before[n.ID][row.Actor.ID] = seen{met: meets(n, w.built[row.Actor.ID], scope), level: levelOf(n, scope)}
		}
	}
	return r, nil
}

func buildWorld(ctx context.Context, tx core.Conn, campaignID string, rules *engine.CompiledRuleset) (*noticeWorld, error) {
	rows, err := actor.LoadRows(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	campaign, err := actor.LoadCampaign(ctx, tx, campaignID, rules)
	if err != nil {
		return nil, err
	}
	built, err := actor.Build(rules, rows, campaign)
	if err != nil {
		return nil, err
	}
	w := &noticeWorld{rows: rows, built: built, play: map[string][2]float64{}}
	if rules.Build == nil {
		return w, nil
	}
	play, err := tx.Query(ctx, `SELECT b.actor_id::text, b.xp_spent, b.xp_at_ascension FROM actor_build b
		JOIN actor ON actor.id = b.actor_id WHERE actor.campaign_id = $1`, campaignID)
	if err != nil {
		return nil, err
	}
	defer play.Close()
	for play.Next() {
		var id string
		var spent, at int32
		if err := play.Scan(&id, &spent, &at); err != nil {
			return nil, err
		}
		w.play[id] = [2]float64{float64(spent), float64(at)}
	}
	return w, play.Err()
}

// scope is what a notice reads on the actor: its scope, and a ledger actor's play as `build` (0 before a saved build).
func (w *noticeWorld) scope(rules *engine.CompiledRuleset, b *actor.Built) *engine.Record {
	if b == nil || b.Scope == nil || rules.Build == nil || b.Entity != rules.Build.Actor {
		if b == nil {
			return nil
		}
		return b.Scope
	}
	play := w.play[b.Row.ID]
	fields := maps.Clone(b.Scope.Fields)
	fields["build"] = &engine.Record{Fields: map[string]any{"xpSpent": play[0], "xpAtAscension": play[1]}}
	return &engine.Record{Fields: fields}
}

// members is the actors of the rule's types, in load order.
func (w *noticeWorld) members(n *engine.CompiledNotice) []*actor.Built {
	out := []*actor.Built{}
	for _, row := range w.rows {
		b := w.built[row.Actor.ID]
		if b != nil && b.Entity != "" && (n.Entities == nil || slices.Contains(*n.Entities, b.Entity)) {
			out = append(out, b)
		}
	}
	return out
}

// groupMeets says whether a group rule holds: every (or any) actor of its types meets `if`. A group of no one does not.
func (w *noticeWorld) groupMeets(rules *engine.CompiledRuleset, n *engine.CompiledNotice) bool {
	members := w.members(n)
	met := 0
	for _, b := range members {
		if meets(n, b, w.scope(rules, b)) {
			met++
		}
	}
	if n.Group == "every" {
		return len(members) > 0 && met == len(members)
	}
	return met > 0
}

// meets says whether the actor is of the rule's types and its `if` holds; an actor whose values can't be read does not.
func meets(n *engine.CompiledNotice, b *actor.Built, scope *engine.Record) bool {
	if b == nil || scope == nil || (n.Entities != nil && !slices.Contains(*n.Entities, b.Entity)) {
		return false
	}
	held, err := engine.EvaluateBool(n.If, scope)
	return err == nil && held
}

// levelOf is the rule's `rises` number on the actor, or nil without one or when it cannot be read.
func levelOf(n *engine.CompiledNotice, scope *engine.Record) *float64 {
	if n.Rises == nil || scope == nil {
		return nil
	}
	v, err := engine.EvaluateInt(n.Rises, scope)
	if err != nil {
		return nil
	}
	return &v
}

// mayRead says whether the seat may be told what the rule reads on this actor: the GM side of its kind, or the rule's
// visibility for that type, as a value of it would be shown.
func mayRead(c cs.Ctx, n *engine.CompiledNotice, b *actor.Built) bool {
	if view.ActorGmSide(c, b.Row.Kind) {
		return true
	}
	switch n.Visibility[b.Entity] {
	case "public", "party":
		return true
	case "owner":
		return slices.Contains(view.HeldBy(c), b.Row.ID)
	}
	return false
}

// words is the rule's text with the actor's name and each param's value filled in; false when a param can't be read.
// A rising rule's params also read how far it rose as ctx.rose (house decision #174).
func words(n *engine.CompiledNotice, name string, scope *engine.Record, rose *float64) (string, bool) {
	if rose != nil && scope != nil {
		with := &engine.Record{Fields: maps.Clone(scope.Fields)}
		with.Fields["ctx"] = &engine.Record{Fields: map[string]any{"rose": *rose}}
		scope = with
	}
	text := strings.ReplaceAll(n.Text, "{name}", name)
	for _, key := range slices.Sorted(maps.Keys(n.Params)) {
		v, err := engine.Evaluate(n.Params[key].AST, scope)
		if err != nil {
			return "", false
		}
		text = strings.ReplaceAll(text, "{"+key+"}", paramText(v))
	}
	return text, true
}

// paramText is a param's value as the line shows it: a number without trailing zeros, a list joined with commas.
func paramText(v any) string {
	switch x := v.(type) {
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = paramText(item)
		}
		return strings.Join(parts, ", ")
	}
	return fmt.Sprint(v)
}

// raise tells the sender, after the action, every rule it raised.
func (r *noticeRead) raise(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) error {
	w, err := buildWorld(ctx, tx, c.CampaignID, r.rules)
	if err != nil {
		return err
	}
	event, only := noticeEvent(a)
	for i := range r.rules.Notices {
		n := &r.rules.Notices[i]
		if n.When != "crossed" && n.When != event {
			continue
		}
		if n.Group != "" {
			// One line about the group, told only to a seat that may read the rule on every one of it.
			if was, known := r.before[n.ID][""]; (n.When == "crossed" && (!known || was.met)) || !w.groupMeets(r.rules, n) {
				continue
			}
			if slices.ContainsFunc(w.members(n), func(b *actor.Built) bool { return !mayRead(c, n, b) }) {
				continue
			}
			cs.Notify(ctx, cs.RuleNotice(n.ID, "", n.Text))
			continue
		}
		for _, row := range w.rows {
			b := w.built[row.Actor.ID]
			scope := w.scope(r.rules, b)
			var rose *float64
			if n.When == "crossed" {
				// An actor the action made did not cross anything: it was not there before.
				was, known := r.before[n.ID][row.Actor.ID]
				if !known {
					continue
				}
				if n.Rises != nil {
					now := levelOf(n, scope)
					if was.level == nil || now == nil || *now <= *was.level {
						continue
					}
					by := *now - *was.level
					rose = &by
				} else if was.met {
					continue
				}
			} else if only != "" && only != row.Actor.ID {
				continue
			}
			if !meets(n, b, scope) || !mayRead(c, n, b) {
				continue
			}
			if text, ok := words(n, b.Row.Name, scope, rose); ok {
				cs.Notify(ctx, cs.RuleNotice(n.ID, b.Row.Name, text))
			}
		}
	}
	return nil
}
