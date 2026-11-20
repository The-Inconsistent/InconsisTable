package table

import (
	"context"
	"slices"
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

// noticeRead is what readNotices found before the action: the rules, and which actor met which `crossed` rule.
type noticeRead struct {
	rules  *engine.CompiledRuleset
	before map[string]map[string]bool
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
	r := &noticeRead{rules: rules, before: map[string]map[string]bool{}}
	if !crossed {
		return r, nil
	}
	rows, built, err := buildActors(ctx, tx, c.CampaignID, rules)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		met := map[string]bool{}
		for _, n := range rules.Notices {
			if n.When == "crossed" {
				met[n.ID] = meets(n, built[row.Actor.ID])
			}
		}
		r.before[row.Actor.ID] = met
	}
	return r, nil
}

func buildActors(ctx context.Context, tx core.Conn, campaignID string, rules *engine.CompiledRuleset) ([]actor.Rows, map[string]*actor.Built, error) {
	rows, err := actor.LoadRows(ctx, tx, campaignID)
	if err != nil {
		return nil, nil, err
	}
	campaign, err := actor.LoadCampaign(ctx, tx, campaignID, rules)
	if err != nil {
		return nil, nil, err
	}
	built, err := actor.Build(rules, rows, campaign)
	return rows, built, err
}

// meets says whether the actor is of the rule's types and its `if` holds; an actor whose values can't be read does not.
func meets(n engine.CompiledNotice, b *actor.Built) bool {
	if b == nil || b.Scope == nil || (n.Entities != nil && !slices.Contains(*n.Entities, b.Entity)) {
		return false
	}
	held, err := engine.EvaluateBool(n.If, b.Scope)
	return err == nil && held
}

// mayRead says whether the seat may be told what the rule reads on this actor: the GM side of its kind, or the rule's
// visibility for that type, as a value of it would be shown.
func mayRead(c cs.Ctx, n engine.CompiledNotice, b *actor.Built) bool {
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

// raise tells the sender, after the action, every rule it raised.
func (r *noticeRead) raise(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) error {
	rows, built, err := buildActors(ctx, tx, c.CampaignID, r.rules)
	if err != nil {
		return err
	}
	event, only := noticeEvent(a)
	for _, row := range rows {
		b := built[row.Actor.ID]
		for _, n := range r.rules.Notices {
			switch {
			case n.When == "crossed":
				// An actor the action made did not cross anything: it was not there before.
				was, known := r.before[row.Actor.ID][n.ID]
				if !known || was {
					continue
				}
			case n.When != event || (only != "" && only != row.Actor.ID):
				continue
			}
			if meets(n, b) && mayRead(c, n, b) {
				cs.Notify(ctx, cs.RuleNotice(n.ID, b.Row.Name, strings.ReplaceAll(n.Text, "{name}", b.Row.Name)))
			}
		}
	}
	return nil
}
