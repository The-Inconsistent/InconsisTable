package codex

import (
	"context"
	"encoding/json"
	"maps"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// Generate is codex.generate (house decision #98): a run the GM confirmed in the browser, checked against the
// generator the room's ruleset declares (every roll a line of its table and of each line's `next`, every pick a served
// entry of its type this seat reads that meets its filter, every value within its bounds, as many rounds as `each.times`
// reads), then made: the root and, per round, one entry under it, each through codex.save and codex.move (from a pick
// through its kind's `from`, house decision #97), as one logged action Undo takes back. Answers the ids, root first.
func Generate(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	rules, err := compiled.Load(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	var g *engine.Generator
	if rules != nil {
		for i := range rules.Ruleset.Generators {
			if rules.Ruleset.Generators[i].ID == a.Str("generatorId") {
				g = &rules.Ruleset.Generators[i]
			}
		}
	}
	if g == nil {
		return cs.Result{}, cs.Fail("noSuchGenerator")
	}
	var run engine.GeneratorRun
	raw, err := json.Marshal(map[string]any{"values": a["values"], "each": a["each"]})
	if err != nil {
		return cs.Result{}, err
	}
	if err := json.Unmarshal(raw, &run); err != nil {
		return cs.Result{}, err
	}
	// The served entries of every type a step picks, as this seat reads them.
	served := map[string][]pack.StoredEntry{}
	steps := slices.Clone(g.Steps)
	if g.Each != nil {
		steps = append(steps, g.Each.Steps...)
	}
	for _, s := range steps {
		if _, loaded := served[s.Entity]; s.Kind == "pick" && !loaded {
			if served[s.Entity], err = servedEntries(ctx, tx, c, s.Entity); err != nil {
				return cs.Result{}, err
			}
		}
	}
	find := func(entity, key string) *pack.StoredEntry {
		i := slices.IndexFunc(served[entity], func(e pack.StoredEntry) bool { return e.Key == key })
		if i < 0 {
			return nil
		}
		return &served[entity][i]
	}
	lookup := func(entity, key string) *engine.ServedEntry {
		if e := find(entity, key); e != nil {
			return &engine.ServedEntry{Key: e.Key, Name: e.Name, Body: e.Body}
		}
		return nil
	}
	campaign, err := actor.LoadCampaign(ctx, tx, c.CampaignID, rules)
	if err != nil {
		return cs.Result{}, err
	}
	root, each, refused := engine.CheckRun(rules.Ruleset, g, run, lookup, campaign)
	if refused != nil {
		return cs.Result{}, cs.Fail(refused.Code, refused.Params)
	}
	kind := g.Make.Kind
	ids := []string{}
	planned := each
	if root != nil {
		planned = append([]engine.PlannedEntry{*root}, each...)
	}
	// A run with no entry of its own puts each round's entry under the one the GM names, or loose (house decision #202).
	under, _ := a["parentId"].(string)
	for i, p := range planned {
		save := cs.Action{"type": "codex.save", "kind": kind}
		if p.From != nil {
			if save, err = saveFrom(ctx, tx, c, rules, kind, prefill(rules, kind, p.From.Entity), *find(p.From.Entity, p.From.Key)); err != nil {
				return cs.Result{}, err
			}
		}
		save["title"] = p.Title
		fields, _ := save["fields"].(map[string]any)
		if fields == nil {
			fields = map[string]any{}
		}
		secrets := cs.CanInCampaign(c, "codex:read_secret", "")
		for id, v := range p.Fields {
			if def := rules.Ruleset.Codex.Kinds[kind].Fields[id]; secrets || def.Visibility == "party" {
				fields[id] = v
			}
		}
		if len(fields) > 0 {
			save["fields"] = fields
		}
		parent := ""
		if root == nil {
			parent = under
		} else if i > 0 {
			parent = ids[0]
		}
		id, err := makeUnder(ctx, tx, c, save, parent)
		if err != nil {
			return cs.Result{}, err
		}
		ids = append(ids, id)
	}
	if root == nil {
		if len(ids) == 0 {
			return cs.Result{}, nil // no rounds: nothing made, nothing to take back
		}
		a = maps.Clone(a)
		delete(a, "parentId") // each round's entry is under it already
	}
	return logMade(ctx, tx, c, a, ids)
}
