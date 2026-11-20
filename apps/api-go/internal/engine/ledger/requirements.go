package ledger

import (
	"math"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/requirements.ts.

// Ctx is the character a requirement is checked against.
type Ctx struct {
	Params           *Params
	Attributes       map[string]float64
	Skills           map[string]float64
	Keywords         map[string]bool
	Species          []string // the species and what it counts as
	ArchetypeID      *string  // nil: Advanced Creation, no Archetype
	SubFactionIDs    map[string]bool
	Talents          map[string]bool
	TalentCategories []string
	Powers           []Power
	Gear             []GearItem
	Wargear          map[string]*schema.Obj
	Options          []Option
	Influence        float64
	Rank             float64
	Tier             float64
	Chosen           *string // a bracketed Talent's pick, for chosenAttribute and chosenSkill
}

// Power is a power the character knows.
type Power struct {
	ID           string `json:"id"`
	DisciplineID string `json:"disciplineId"`
}

// Option is an option taken from a group.
type Option struct {
	GroupID string `json:"groupId"`
	Name    string `json:"name"`
}

// Why is what Meets answers: Met, or why not (Reason), or a condition only the GM can judge (GM, its label).
type Why struct {
	Met    bool
	Reason string
	GM     *string
}

func reason(ok bool, why string) Why {
	if ok {
		return Why{Met: true}
	}
	return Why{Reason: why}
}

// rated reads a rating that may be missing: undefined compares as NaN, false either way.
func rated(m map[string]float64, k string) float64 {
	if v, ok := m[k]; ok {
		return v
	}
	return math.NaN()
}

func anyOf(r *schema.Obj, has func(string) bool) bool {
	return slices.ContainsFunc(strs(r, "anyOf"), has)
}

func or(r *schema.Obj) string { return strings.Join(strs(r, "anyOf"), " or ") }

// Meets is meets: whether the requirement r holds for the character c.
func Meets(r *schema.Obj, c Ctx) Why {
	vocab := c.Params.vocab
	min := number(r, "min")
	in := func(list []string) func(string) bool { return func(x string) bool { return contains(list, x) } }
	set := func(m map[string]bool) func(string) bool { return func(x string) bool { return m[x] } }
	switch str(r, "kind") {
	case "attribute":
		a := str(r, "attribute")
		return reason(rated(c.Attributes, a) >= min, "needs "+vocab.attributeNames[a]+" "+num(min))
	case "skill":
		return reason(c.Skills[str(r, "skill")] >= min, "needs "+str(r, "skill")+" "+num(min))
	case "chosenAttribute":
		i := slices.IndexFunc(vocab.attributes, func(x string) bool {
			if c.Chosen == nil {
				return false
			}
			name, named := vocab.attributeNames[x]
			return x == *c.Chosen || (named && name == *c.Chosen)
		})
		return reason(i >= 0 && rated(c.Attributes, vocab.attributes[i]) >= min, "needs the chosen Attribute at "+num(min))
	case "chosenSkill":
		ok := c.Chosen != nil && contains(vocab.skills, *c.Chosen) && c.Skills[*c.Chosen] >= min
		return reason(ok, "needs the chosen Skill at "+num(min))
	case "influence":
		return reason(c.Influence >= min, "needs Influence "+num(min))
	case "keyword":
		return reason(anyOf(r, set(c.Keywords)), "needs "+or(r))
	case "notKeyword":
		return reason(!anyOf(r, set(c.Keywords)), "not for "+or(r))
	case "species":
		return reason(anyOf(r, in(c.Species)), "needs species "+or(r))
	case "notSpecies":
		return reason(!anyOf(r, in(c.Species)), "not for species "+or(r))
	case "archetype":
		return reason(c.ArchetypeID != nil && contains(strs(r, "anyOf"), *c.ArchetypeID), "needs archetype "+or(r))
	case "notArchetype":
		return reason(c.ArchetypeID == nil || !contains(strs(r, "anyOf"), *c.ArchetypeID), "not for archetype "+or(r))
	case "memorableInjuries":
		// No Memorable Injury is taken at creation yet (optional): the builder counts none.
		if !r.Has("min") || min <= 0 {
			return Why{Met: true}
		}
		word := "ies"
		if min == 1 {
			word = "y"
		}
		return Why{Reason: "needs " + num(min) + " Memorable Injur" + word}
	case "subFaction":
		return reason(anyOf(r, set(c.SubFactionIDs)), "needs "+or(r))
	case "talent":
		return reason(anyOf(r, set(c.Talents)), "needs talent "+or(r))
	case "notTalent":
		return reason(!anyOf(r, set(c.Talents)), "can't be taken with "+or(r))
	case "talentCategory":
		category, n := str(r, "category"), 0.0
		for _, x := range c.TalentCategories {
			if x == category {
				n++
			}
		}
		return reason(n >= min, "needs "+num(min)+" "+category+" talent"+plural(min > 1))
	case "option":
		group, names := str(r, "groupId"), strs(r, "anyOf")
		ok := slices.ContainsFunc(c.Options, func(o Option) bool { return o.GroupID == group && contains(names, o.Name) })
		return reason(ok, "needs "+or(r))
	case "power":
		return reason(anyOf(r, func(x string) bool {
			return slices.ContainsFunc(c.Powers, func(p Power) bool { return p.ID == x })
		}), "needs power "+or(r))
	case "powerCount":
		n := float64(len(c.Powers))
		same := boolean(r, "sameDiscipline")
		if same {
			per, most := map[string]float64{}, 0.0
			for _, p := range c.Powers {
				per[p.DisciplineID]++
				most = math.Max(most, per[p.DisciplineID])
			}
			n = most
		}
		from := ""
		if same {
			from = " from one Discipline"
		}
		return reason(n >= min, "needs "+num(min)+" psychic powers"+from)
	case "wargear":
		return reason(anyOf(r, func(n string) bool {
			return slices.ContainsFunc(c.Gear, func(g GearItem) bool { return norm(g.Name) == norm(n) })
		}), "needs "+or(r))
	case "wargearKeyword":
		names := strs(r, "anyOf")
		ok := slices.ContainsFunc(c.Gear, func(g GearItem) bool {
			if g.WargearID == "" {
				return false
			}
			return slices.ContainsFunc(strs(c.Wargear[g.WargearID], "keywords"), in(names))
		})
		return reason(ok, "needs wargear with "+or(r))
	case "wargearCount":
		of, n := sub(r, "of"), 0.0
		for _, g := range c.Gear {
			if w := c.Wargear[g.WargearID]; g.WargearID != "" && w != nil && WargearMatches(w, of, c.Tier, c.Tier, c.Params) {
				n++
			}
		}
		return reason(n >= min, "needs "+num(min)+" of "+describeFilter(of))
	case "rank":
		later := ""
		if min > 1 {
			later = ", not at creation"
		}
		return reason(c.Rank >= min, "needs Rank "+num(min)+later)
	case "tier":
		lo, hi := c.Params.Tiers.Min, c.Params.Tiers.Max
		ok := true
		if r.Has("min") {
			lo = number(r, "min")
			ok = c.Tier >= lo
		}
		if r.Has("max") {
			hi = number(r, "max")
			ok = ok && c.Tier <= hi
		}
		return reason(ok, "needs Tier "+num(lo)+"–"+num(hi))
	case "gm":
		label := str(r, "label")
		return Why{GM: &label}
	case "all":
		for _, x := range objs(r, "of") {
			if why := Meets(x, c); !why.Met {
				return why
			}
		}
		return Why{Met: true}
	case "either":
		var whys []Why
		for _, x := range objs(r, "of") {
			whys = append(whys, Meets(x, c))
		}
		var reasons []string
		for _, w := range whys {
			if w.Met {
				return w
			}
		}
		for _, w := range whys {
			if w.GM != nil {
				return w
			}
		}
		for _, w := range whys {
			reasons = append(reasons, w.Reason)
		}
		return Why{Reason: strings.Join(reasons, ", or ")}
	}
	return Why{}
}

// Self is Who without the buyable keywords.
type Self struct {
	Species     []string
	ArchetypeID *string
	Keywords    []string
}

// buyableKeywords are the keywords a Talent or Package this character can take would give, however deep in its
// choices, run until nothing new turns up. A placeholder names no keyword yet, so it opens nothing.
func buyableKeywords(records []*schema.Obj, self Self, p *Params) []string {
	found := []string{}
	add := func(k any) {
		if s, ok := k.(string); ok && !strings.HasPrefix(s, p.Keywords.PlaceholderMarker) && !contains(found, s) {
			found = append(found, s)
		}
	}
	var walk func(x any)
	walk = func(x any) {
		if items, isList := x.([]any); isList {
			for _, item := range items {
				walk(item)
			}
			return
		}
		o, isObj := x.(*schema.Obj)
		if !isObj {
			return
		}
		// Catalogue data, parsed at load: a `requires` anywhere in it is a Requirement list.
		if reqs, has := o.Get("requires"); has && reqs != nil {
			who := Who{Species: self.Species, ArchetypeID: self.ArchetypeID, Keywords: self.Keywords, Buyable: slices.Clone(found)}
			if OutOfReach(asObjs(asList(reqs)), who) {
				return
			}
		}
		for _, k := range o.Keys() {
			v := get(o, k)
			switch {
			case k == "keyword":
				add(v)
			case k == "keywords":
				for _, item := range asList(v) {
					add(item)
				}
			case k != "requires":
				walk(v)
			}
		}
	}
	wrapped := make([]any, len(records))
	for i, r := range records {
		w := schema.NewObj().Set("requires", get(r, "requires")).Set("grants", get(r, "grants"))
		wrapped[i] = w
	}
	for size := -1; size != len(found); {
		size = len(found)
		walk(wrapped)
	}
	return found
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}

// OutOfReach is true when a requirement no purchase can meet fails: the species, the archetype, a keyword nothing
// buyable gives. Before a species is picked, species requirements hide nothing.
func OutOfReach(reqs []*schema.Obj, who Who) bool {
	species := who.Species
	var out func(r *schema.Obj) bool
	out = func(r *schema.Obj) bool {
		switch str(r, "kind") {
		case "species":
			return species != nil && !anyOf(r, func(x string) bool { return contains(species, x) })
		case "notSpecies":
			return species != nil && anyOf(r, func(x string) bool { return contains(species, x) })
		case "archetype":
			return who.ArchetypeID == nil || !contains(strs(r, "anyOf"), *who.ArchetypeID)
		case "notArchetype":
			return who.ArchetypeID != nil && contains(strs(r, "anyOf"), *who.ArchetypeID)
		case "keyword":
			return !anyOf(r, func(k string) bool { return contains(who.Keywords, k) || contains(who.Buyable, k) })
		case "notKeyword":
			return anyOf(r, func(k string) bool { return contains(who.Keywords, k) })
		case "all":
			return slices.ContainsFunc(objs(r, "of"), out)
		case "either":
			return !slices.ContainsFunc(objs(r, "of"), func(x *schema.Obj) bool { return !out(x) })
		}
		return false
	}
	return slices.ContainsFunc(reqs, out)
}

// WargearMatches is whether the item w passes the filter f, at the Tier and the new Tier. A throwable hand weapon
// counts as ranged here, as the TypeScript has it (a known fault, kept equal until the TypeScript changes).
func WargearMatches(w, f *schema.Obj, tier, newTier float64, p *Params) bool {
	rarities := p.Rarity.Order
	if f.Has("kinds") && !contains(strs(f, "kinds"), str(w, "kind")) {
		return false
	}
	if f.Has("weapon") {
		weapon := sub(w, "weapon")
		if weapon == nil {
			return false
		}
		melee := len(list(weapon, "range")) == 1 && !weapon.Has("thrown") // melee weapons print one reach
		if (str(f, "weapon") == "melee") != melee {
			return false
		}
	}
	if f.Has("categories") && !contains(strs(f, "categories"), str(w, "category")) {
		return false
	}
	if f.Has("nameIncludes") && !strings.Contains(norm(str(w, "name")), norm(str(f, "nameIncludes"))) {
		return false
	}
	keywords := strs(w, "keywords")
	if f.Has("wargearKeywords") && !slices.ContainsFunc(keywords, func(k string) bool {
		return contains(strs(f, "wargearKeywords"), k)
	}) {
		return false
	}
	if f.Has("allKeywords") && slices.ContainsFunc(strs(f, "allKeywords"), func(k string) bool {
		return !contains(keywords, k)
	}) {
		return false
	}
	if f.Has("weaponTraits") || f.Has("notWeaponTraits") {
		// Traits are printed with their rating ("Heavy (3)"); the filter names the Trait alone, or the whole printed
		// Trait when the bracket is the point.
		printed := append(strs(sub(w, "weapon"), "traits"), strs(sub(w, "armour"), "traits")...)
		has := func(t string) bool {
			return slices.ContainsFunc(printed, func(p string) bool {
				if strings.Contains(t, "(") {
					return norm(p) == norm(t)
				}
				name, _, _ := strings.Cut(p, "(")
				return norm(name) == norm(t)
			})
		}
		if f.Has("weaponTraits") && !slices.ContainsFunc(strs(f, "weaponTraits"), has) {
			return false
		}
		if slices.ContainsFunc(strs(f, "notWeaponTraits"), has) {
			return false
		}
	}
	if f.Has("maxValue") {
		var most float64
		switch m := get(f, "maxValue").(type) {
		case float64:
			most = m
		case *schema.Obj:
			if m.Has("tierPlus") {
				most = tier + number(m, "tierPlus")
			} else {
				most = newTier + number(m, "newTierPlus")
			}
		}
		value, priced := get(w, "value").(float64)
		if !priced || value > most {
			return false
		}
	}
	if rarity := sub(f, "rarity"); rarity != nil {
		r := str(w, "rarity")
		if r == "" {
			return false
		}
		at := slices.Index(rarities, r)
		if rarity.Has("atMost") && at > slices.Index(rarities, str(rarity, "atMost")) {
			return false
		}
		if rarity.Has("atLeast") && at < slices.Index(rarities, str(rarity, "atLeast")) {
			return false
		}
	}
	return true
}
