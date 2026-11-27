package engine

import (
	"fmt"
	"math"
	"slices"
)

// build checks the ledger builder's block against what the manifest declares (house decision #62): an actor type, one
// catalogue entity per kind, a field of the fitting type for every Attribute, Skill and mod of its vocabulary, and a
// campaign Tier within its tiers. The twin of buildProblems in packages/rules-engine/src/manifest.ts.
func (p *problems) build(r *Ruleset) {
	b := r.Build
	if b == nil {
		return
	}
	actor := r.entity(b.Actor)
	if actor == nil || actor.Base != "actor" {
		p.add("build.actor", `"%s" is not an actor entity`, b.Actor)
	}
	holds := map[string]string{} // entity id → the kind it holds
	for _, kind := range LedgerKinds {
		id := b.Kinds[kind]
		path := "build.kinds." + kind
		if e := r.entity(id); e == nil {
			p.add(path, `unknown entity "%s"`, id)
		} else if e.Base == "actor" {
			p.add(path, `"%s" is an actor entity, not a catalogue`, id)
		}
		if other, taken := holds[id]; taken {
			p.add(path, `"%s" already holds the %s`, id, other)
		} else {
			holds[id] = kind
		}
	}
	if b.First != nil && *b.First == "steps" && !slices.ContainsFunc(r.Creation, func(s CreationStep) bool { return s.Actor == b.Actor }) {
		p.add("build.first", "no creation step makes the %s", b.Actor)
	}
	tiers := b.Params.Tiers
	if tier, ok := r.CampaignFields[b.Tier]; !ok {
		p.add("build.tier", `unknown campaign field "%s"`, b.Tier)
	} else if tier.Type != "int" {
		p.add("build.tier", `"%s" is %s, not int`, b.Tier, tier.Type)
	} else if tier.Min < tiers.Min || tier.Max > tiers.Max {
		p.add("build.tier", `"%s" runs %s to %s, outside the tiers %s to %s`,
			b.Tier, esNumber(tier.Min), esNumber(tier.Max), esNumber(tiers.Min), esNumber(tiers.Max))
	}
	// The amounts offered at a session's end are within the max, ascending (house decision #64).
	if b.Award != nil {
		for i, n := range b.Award.Suggested {
			path := fmt.Sprintf("build.award.suggested[%d]", i)
			if n > b.Award.Max {
				p.add(path, "%s is more than the max %s", esNumber(n), esNumber(b.Award.Max))
			} else if i > 0 && n <= b.Award.Suggested[i-1] {
				p.add(path, "%s does not come after %s", esNumber(n), esNumber(b.Award.Suggested[i-1]))
			}
		}
	}
	if actor == nil || actor.Base != "actor" {
		return
	}

	named := map[string]string{} // field id → the path that first names it
	field := func(id, path, typ string) {
		if def, ok := actor.Fields[id]; !ok {
			p.add(path, `%s has no field "%s"`, actor.ID, id)
		} else if def.Type != typ {
			p.add(path, `"%s" is %s, not %s`, id, def.Type, typ)
		}
		if prev, taken := named[id]; taken {
			p.add(path, `"%s" is already named at %s`, id, prev)
		} else {
			named[id] = path
		}
	}
	v := b.Params.Vocabulary
	attributes := make([]string, len(v.Attributes))
	for i, a := range v.Attributes {
		attributes[i] = a.ID
	}
	skills := make([]string, len(v.Skills))
	for i, s := range v.Skills {
		skills[i] = s.Name
	}
	mods := make([]string, len(v.Mods))
	for i, m := range v.Mods {
		mods[i] = m.Key
	}
	for _, g := range []struct {
		group  string
		names  []string
		record map[string]string
	}{
		{"attributes", attributes, b.Sheet.Attributes},
		{"skills", skills, b.Sheet.Skills},
		{"mods", mods, b.Sheet.Mods},
	} {
		for _, name := range g.names {
			if _, ok := g.record[name]; !ok {
				p.add("build.sheet."+g.group, `no field for "%s"`, name)
			}
		}
		for _, key := range sortedKeys(g.record) {
			path := fmt.Sprintf("build.sheet.%s.%s", g.group, key)
			if !slices.Contains(g.names, key) {
				p.add(path, `"%s" is not in the vocabulary`, key)
			} else {
				field(g.record[key], path, "int")
			}
		}
	}
	field(b.Sheet.ArmourRating, "build.sheet.armourRating", "int")
	field(b.Sheet.Powered, "build.sheet.powered", "int")
	field(b.Sheet.Speed, "build.sheet.speed", "int")
	field(b.Sheet.Species, "build.sheet.species", "text")
	field(b.Sheet.Archetype, "build.sheet.archetype", "text")
	field(b.Sheet.Keywords, "build.sheet.keywords", "list")
	for _, res := range []struct {
		key string
		id  *string
	}{{"wealth", b.Sheet.Wealth}, {"corruption", b.Sheet.Corruption}} {
		if res.id == nil {
			continue
		}
		// The last declaration wins, as in TypeScript's Map built from the list.
		var found *Resource
		for i := range r.Resources {
			if r.Resources[i].ID == *res.id {
				found = &r.Resources[i]
			}
		}
		if found == nil || found.Scope != "entity" || (found.Entities != nil && !slices.Contains(*found.Entities, actor.ID)) {
			p.add("build.sheet."+res.key, `"%s" is not an entity resource the %s carries`, *res.id, actor.ID)
		}
	}
	if b.XP != nil {
		field(*b.XP, "build.xp", "int")
	}
	// A gone state is one the actor type can be in (house decision #64).
	for i, id := range b.Gone {
		if !slices.ContainsFunc(r.Health.States, func(s HealthState) bool {
			return s.ID == id && (s.Entities == nil || slices.Contains(*s.Entities, actor.ID))
		}) {
			p.add(fmt.Sprintf("build.gone[%d]", i), `unknown health state "%s"`, id)
		}
	}
	// What a build over a hand-made sheet keeps is the actor's own (house decision #96).
	if k := b.Keep; k != nil {
		for i, id := range k.Fields {
			if _, has := actor.Fields[id]; !has {
				p.add(fmt.Sprintf("build.keep.fields[%d]", i), `%s has no field "%s"`, actor.ID, id)
			}
		}
		kept := map[string]bool{}
		for _, id := range k.Fields {
			kept[id] = true
		}
		for _, g := range []struct {
			how, typ string
			ids      []string
		}{{"greater", "int", k.Greater}, {"merge", "list", k.Merge}} {
			for i, id := range g.ids {
				path := fmt.Sprintf("build.keep.%s[%d]", g.how, i)
				if f, has := actor.Fields[id]; !has || f.Type != g.typ {
					p.add(path, `%s has no %s field "%s"`, actor.ID, g.typ, id)
				} else if kept[id] {
					p.add(path, `"%s" is kept already`, id)
				}
				kept[id] = true
			}
		}
		for i, id := range k.Resources {
			var found *Resource
			for j := range r.Resources {
				if r.Resources[j].ID == id {
					found = &r.Resources[j]
				}
			}
			if found == nil || found.Scope != "entity" || (found.Entities != nil && !slices.Contains(*found.Entities, actor.ID)) {
				p.add(fmt.Sprintf("build.keep.resources[%d]", i), `"%s" is not an entity resource the %s carries`, id, actor.ID)
			}
		}
	}
}

// KeptValue is manifest.ts keptValue (house decision #199): a kept field of a build saved over a hand-made sheet, the
// greater of two numbers, or the build's list with each hand-made item past the copies it has, at most max.
func KeptValue(how string, hand, built any, max int) any {
	if how == "greater" {
		h, isNumber := hand.(float64)
		if !isNumber {
			return built
		}
		if b, ok := built.(float64); ok {
			return math.Max(h, b)
		}
		return h
	}
	out := []any{}
	if b, ok := built.([]any); ok {
		out = append(out, b...)
	}
	seen := map[any]int{}
	h, _ := hand.([]any)
	for _, x := range h {
		seen[x]++
		n := 0
		for _, y := range out {
			if y == x {
				n++
			}
		}
		if n < seen[x] {
			out = append(out, x)
		}
	}
	return out[:min(len(out), max)]
}
