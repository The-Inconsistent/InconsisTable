package ledger

import (
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/labels.ts: labels for what a choice or an effect line shows, and small
// lookups on the records.

// amount labels an Amount or a Scaled.
func amount(a any) string {
	switch x := a.(type) {
	case float64, string:
		return text(x)
	case *schema.Obj:
		switch {
		case x.Has("perTier"):
			return text(get(x, "perTier")) + " per Tier Ascended"
		case x.Has("timesTier"):
			return text(get(x, "timesTier")) + " × Tier"
		case x.Has("perRank"):
			plus := ""
			if x.Has("plus") && truthy(get(x, "plus")) {
				plus = " + " + text(get(x, "plus"))
			}
			return text(get(x, "perRank")) + " × Rank" + plus
		case x.Has("rankPlus"):
			return "Rank + " + text(get(x, "rankPlus"))
		case x.Has("roll") && x.Has("times"):
			return text(get(x, "roll")) + " × " + amount(get(x, "times"))
		}
	}
	return "?"
}

func describeFilter(f *schema.Obj) string {
	var bits []string
	add := func(ok bool, s func() string) {
		if ok {
			if b := s(); b != "" {
				bits = append(bits, b)
			}
		}
	}
	rarity := sub(f, "rarity")
	add(rarity != nil, func() string {
		atMost, atLeast := str(rarity, "atMost"), str(rarity, "atLeast")
		if atMost == atLeast {
			return atMost
		}
		var parts []string
		if atLeast != "" {
			parts = append(parts, atLeast+"+")
		}
		if atMost != "" {
			parts = append(parts, "up to "+atMost)
		}
		return strings.Join(parts, " ")
	})
	add(f.Has("weapon"), func() string { return str(f, "weapon") + " weapon" })
	add(f.Has("kinds"), func() string { return strings.Join(strs(f, "kinds"), " or ") })
	add(f.Has("categories"), func() string { return strings.Join(strs(f, "categories"), " or ") })
	add(f.Has("nameIncludes"), func() string { return `"` + str(f, "nameIncludes") + `"` })
	add(f.Has("wargearKeywords"), func() string { return "with " + strings.Join(strs(f, "wargearKeywords"), " or ") })
	add(f.Has("allKeywords"), func() string { return "with " + strings.Join(strs(f, "allKeywords"), " and ") })
	add(f.Has("weaponTraits"), func() string {
		return "with the " + strings.Join(strs(f, "weaponTraits"), " or ") + " Trait"
	})
	add(f.Has("notWeaponTraits"), func() string {
		return "without the " + strings.Join(strs(f, "notWeaponTraits"), " or ") + " Trait"
	})
	add(f.Has("maxValue"), func() string {
		switch m := get(f, "maxValue").(type) {
		case float64:
			return "Value ≤ " + num(m)
		case *schema.Obj:
			if m.Has("tierPlus") {
				return "Value ≤ Tier + " + num(number(m, "tierPlus"))
			}
			return "Value ≤ new Tier + " + num(number(m, "newTierPlus"))
		}
		return ""
	})
	if len(bits) == 0 {
		return "any wargear"
	}
	return strings.Join(bits, ", ")
}

// label is a short label for one option of a choice.
func label(g *schema.Obj) string {
	switch {
	case g.Has("all"):
		var parts []string
		for _, x := range objs(g, "all") {
			parts = append(parts, label(x))
		}
		return strings.Join(parts, " + ")
	case g.Has("choose") && g.Has("from"):
		var parts []string
		for _, x := range objs(g, "from") {
			parts = append(parts, label(x))
		}
		return amount(get(g, "choose")) + " of " + strings.Join(parts, " / ")
	case g.Has("choose") && g.Has("rating"):
		n := number(g, "choose")
		return num(n) + " Skill" + plural(n > 1) + " to " + num(number(g, "rating"))
	case g.Has("talent"):
		return "Talent: " + str(g, "talent")
	case g.Has("keyword"):
		return str(g, "keyword")
	case g.Has("keywords"):
		return strings.Join(strs(g, "keywords"), " and ")
	case g.Has("power"):
		return "Power: " + str(g, "power")
	case g.Has("wargear"):
		w := sub(g, "wargear")
		if q, isNum := get(w, "qty").(float64); isNum && q == 1 {
			return str(w, "name")
		}
		return str(w, "name") + " ×" + text(get(w, "qty"))
	case g.Has("bundle"):
		var names []string
		for _, w := range objs(g, "bundle") {
			names = append(names, str(w, "name"))
		}
		return strings.Join(names, " and ")
	case g.Has("pick"):
		return amount(get(g, "pick")) + " of " + describeFilter(sub(g, "wargearOf"))
	}
	return describeGrant(g)
}

func plural(many bool) string {
	if many {
		return "s"
	}
	return ""
}

// keywordsOnly: a grant whose only content is Keywords, one or several, or a choice between such options.
func keywordsOnly(g *schema.Obj) bool {
	every := func(list []*schema.Obj) bool {
		for _, x := range list {
			if !keywordsOnly(x) {
				return false
			}
		}
		return true
	}
	return g.Has("keyword") || g.Has("keywords") ||
		(g.Has("all") && every(objs(g, "all"))) ||
		(g.Has("choose") && g.Has("from") && every(objs(g, "from")))
}

func describeGrant(g *schema.Obj) string {
	switch {
	case g.Has("weaponTrait"):
		return "A weapon gains " + str(g, "weaponTrait")
	case g.Has("trinkets"):
		return amount(get(g, "trinkets")) + " Trinkets"
	case g.Has("corruption"):
		return "Corruption " + amount(get(g, "corruption"))
	case g.Has("faith"):
		return "Faith " + amount(get(g, "faith"))
	case g.Has("memorableInjuries"):
		return amount(get(g, "memorableInjuries")) + " Memorable Injuries"
	case g.Has("traumaticInjuries"):
		return amount(get(g, "traumaticInjuries")) + " Traumatic Injuries"
	case g.Has("mutations"):
		return amount(get(g, "mutations")) + " Mutations"
	case g.Has("wrathPerSession"):
		return "+" + amount(get(g, "wrathPerSession")) + " Wrath each session"
	case g.Has("wealthPerSession"):
		return "+" + amount(get(g, "wealthPerSession")) + " Wealth each session"
	case g.Has("ammoPer"):
		return text(get(g, "ammo")) + " Ammo each " + str(g, "ammoPer")
	case g.Has("never"):
		return "Never gains " + capital(str(g, "never"))
	case g.Has("gmRuin"):
		return "The GM's Ruin: " + amount(get(g, "gmRuin"))
	case g.Has("talentAccess"):
		return "May take " + str(g, "talentAccess") + " talents"
	case g.Has("onlyDisciplines"):
		until := ""
		if truthy(get(g, "untilTier")) {
			until = " until Tier " + text(get(g, "untilTier"))
		}
		return "Only " + strings.Join(strs(g, "onlyDisciplines"), ", ") + " powers" + until
	case g.Has("noArmour"):
		return "May not wear armour"
	case g.Has("followers"):
		threat := ""
		if truthy(get(g, "threatId")) {
			threat = " (" + str(g, "threatId") + ")"
		}
		return amount(get(g, "followers")) + " " + str(g, "kind") + threat
	case g.Has("bonusDice"):
		return "+" + amount(get(g, "bonusDice")) + " bonus dice " + str(g, "when")
	case g.Has("chosenTrait"):
		return "+" + amount(get(g, "chosenTrait")) + " to the chosen Trait"
	case g.Has("story"):
		return str(g, "story")
	}
	return cut(stringify(g, false), 120)
}

// ownerReqs is who a table or option group belongs to, as requirements on the character.
func ownerReqs(o *schema.Obj) []*schema.Obj {
	switch {
	case o.Has("speciesId"):
		return []*schema.Obj{newObj("kind", "species", "anyOf", []any{get(o, "speciesId")})}
	case o.Has("speciesIds"):
		return []*schema.Obj{newObj("kind", "species", "anyOf", list(o, "speciesIds"))}
	case o.Has("subFactionId"):
		return []*schema.Obj{newObj("kind", "subFaction", "anyOf", []any{get(o, "subFactionId")})}
	}
	return nil // a faction's table: the archetype's faction, checked by the builder's choice of table
}

// successors are a Successor's founders, so it matches their requirements too.
func successors(sf *schema.Obj, all map[string]*schema.Obj) []string {
	var out []string
	for p := str(sf, "successorOf"); p != "" && !contains(out, p); p = str(all[p], "successorOf") {
		out = append(out, p)
	}
	return out
}

func contains[T comparable](list []T, x T) bool {
	for _, y := range list {
		if y == x {
			return true
		}
	}
	return false
}
