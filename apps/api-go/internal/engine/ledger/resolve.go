package ledger

import (
	"errors"
	"math"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/resolve.ts, step for step and in the same order: the order is part of the
// answer (ledger rows, pending choices, problems, effects, the keywords).

// Play is a character already in play: the campaign's Tier now and the XP it has earned. XPAtAscension is read by a
// server's eligibility check, not here; PackageWaived excuses the latest Ascension's package (a Milestone Ascension).
type Play struct {
	Tier          float64  `json:"tier"`
	XPEarned      float64  `json:"xpEarned"`
	XPAtAscension *float64 `json:"xpAtAscension,omitempty"`
	PackageWaived bool     `json:"packageWaived,omitempty"`
}

type index struct {
	archetypes, species, factions, subFactions, keywords, backgrounds map[string]*schema.Obj
	optionGroups, talents, packages, disciplines, powers, languages   map[string]*schema.Obj
}

// byKey is new Map(list.map(r => [r[key], r])): a repeated key keeps the last record.
func byKey(list []*schema.Obj, key string) map[string]*schema.Obj {
	out := make(map[string]*schema.Obj, len(list))
	for _, r := range list {
		out[str(r, key)] = r
	}
	return out
}

func indexOf(c Creation) index {
	return index{
		archetypes: byKey(c.Archetypes, "id"), species: byKey(c.Species, "id"), factions: byKey(c.Factions, "id"),
		subFactions: byKey(c.SubFactions, "id"), keywords: byKey(c.Keywords, "name"),
		backgrounds: byKey(c.Backgrounds, "id"), optionGroups: byKey(c.OptionGroups, "id"),
		talents: byKey(c.Talents, "id"), packages: byKey(c.Packages, "id"), disciplines: byKey(c.Disciplines, "id"),
		powers: byKey(c.Powers, "id"), languages: byKey(c.Languages, "id"),
	}
}

// ── the character as it is built up ──

type origin struct {
	path, step, cite string
	tiersAscended    float64
	granted          bool
}

func (o origin) at(path string) origin {
	o.path = path
	return o
}

type deferredReq struct {
	reqs     []*schema.Obj
	what     string
	origin   origin
	severity string
	tier     *float64
	choice   *string
}

type ability struct {
	name          string
	summary, page *string
}

type talentEntry struct {
	id, name string
	summary  *string
	page     string
	choices  []*string
}

type namedWeapon struct {
	name   string
	weapon *schema.Obj
}

type weaponEffectAt struct {
	effect       *schema.Obj
	source, path string
	cite, choice *string
}

type languageGrant struct {
	n     float64
	skill *string
}

type disciplineDiscount struct {
	id         any // a discipline id, or what a choice held (the TypeScript casts it)
	multiplier float64
}

type sheet struct {
	baseAttributes      map[string]float64
	baseSkills          map[string]float64
	keywords            []string
	abilities           []ability
	talents             []*talentEntry
	powers              []string // a Set
	disciplines         map[string]bool
	only                []string // a Set; nil when no limit holds
	mods                map[string]float64
	wealth, corruption  float64
	gear                []GearItem
	weapons             []namedWeapon
	weaponEffects       []weaponEffectAt
	languageGrants      []languageGrant
	influenceAttribute  string
	talentDiscounts     map[string]float64
	disciplineDiscounts []disciplineDiscount
	neverKeywords       []string // a Set
	optionAccess        map[string]bool
	subFactionIDs       []string
}

func (s *sheet) talent(id string) *talentEntry {
	for _, t := range s.talents {
		if t.id == id {
			return t
		}
	}
	return nil
}

type laterGrant struct {
	grant  *schema.Obj
	origin origin
}

type resolver struct {
	p              *Params
	cat            Catalogue
	ix             index
	build          *schema.Obj
	choicesIn      *schema.Obj
	boughtIn       *schema.Obj
	tier, nowTier  float64
	rank           float64
	ledger         []LedgerRow
	pending        []PendingChoice
	choices        []BuildChoicePrompt
	problems       []BuildProblem
	effects        []BuildEffect
	deferred       []deferredReq
	later          []laterGrant
	approved       map[string]bool
	copies         map[string]int
	s              sheet
	species, arch  *schema.Obj
	ascendedTo     *schema.Obj
	filled         []string // a Set
	packageNames   []string
	attributeNames map[string]string
}

func (r *resolver) problem(p BuildProblem) {
	if p.Severity == "gm" && p.Path != "" && r.approved[p.Path] {
		return
	}
	r.problems = append(r.problems, p)
}

// dated is the purchase history of an advancement row: a label and nothing else, so a build resolves identically with
// and without it. `~n` keeps two identical purchases apart.
func (r *resolver) dated(row LedgerRow, p Purchase) LedgerRow {
	base := PurchaseKey(p)
	r.copies[base]++
	row.Key = base
	if n := r.copies[base]; n > 1 {
		row.Key = base + "~" + num(float64(n))
	}
	if session, ok := get(r.boughtIn, row.Key).(float64); ok {
		s := Num(session)
		row.Session = &s
	}
	return row
}

func (r *resolver) allowed(rec *schema.Obj, step string) bool {
	if r.cat.Homebrew || r.p.isOfficial(str(rec, "source")) {
		return true
	}
	r.problem(BuildProblem{
		Step: step, Severity: "error",
		What: str(rec, "name") + " is homebrew (" + r.p.sourceName(str(rec, "source")) + "), and this campaign allows none",
		Cite: r.p.cite(rec),
	})
	return false
}

func (r *resolver) ownRules(rules []*schema.Obj) []*schema.Obj {
	var out []*schema.Obj
	for _, rule := range rules {
		if r.cat.Homebrew || !rule.Has("source") || r.p.isOfficial(str(rule, "source")) {
			out = append(out, rule)
		}
	}
	return out
}

func (r *resolver) addKeyword(k string) {
	if !contains(r.s.keywords, k) {
		r.s.keywords = append(r.s.keywords, k)
	}
}

func (r *resolver) addWeaponEffects(effects []*schema.Obj, source string, cite *string, path string, choice *string) {
	for _, e := range effects {
		r.s.weaponEffects = append(r.s.weaponEffects, weaponEffectAt{e, source, path, cite, choice})
	}
}

func (r *resolver) addMods(m *schema.Obj, o origin) {
	for _, k := range m.Keys() {
		r.s.mods[k] += r.scaled(get(m, k), o)
	}
}

func (r *resolver) scaled(v any, o origin) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case *schema.Obj:
		switch {
		case x.Has("perTier"):
			return number(x, "perTier") * o.tiersAscended
		case x.Has("timesTier"):
			return number(x, "timesTier") * r.nowTier
		case x.Has("perRank"):
			return number(x, "perRank")*r.rank + number(x, "plus")
		}
		return r.rank + number(x, "rankPlus")
	}
	return math.NaN()
}

func (r *resolver) addRule(rule *schema.Obj, o origin) {
	page := o.cite
	if truthy(get(rule, "page")) {
		if truthy(get(rule, "source")) {
			page = r.p.sourceCite(str(rule, "source"), number(rule, "page"))
		} else {
			before, _, _ := strings.Cut(o.cite, " p.")
			page = before + " p." + num(number(rule, "page"))
		}
	}
	r.s.abilities = append(r.s.abilities, ability{str(rule, "name"), optStr(rule, "summary"), &page})
	r.addMods(sub(rule, "mods"), o)
	at := o.path + "/" + norm(str(rule, "name"))
	r.addWeaponEffects(objs(rule, "weapons"), str(rule, "name"), &page, at, nil)
	for i, g := range objs(rule, "grants") {
		r.grant(g, o.at(at+"/"+num(float64(i))), false)
	}
}

func (r *resolver) choiceFor(path string) ([]any, bool) {
	v, ok := r.choicesIn.Get(path)
	list, _ := v.([]any)
	return list, ok
}

func (r *resolver) ask(c PendingChoice) {
	if c.Options == nil {
		c.Options = []string{}
	}
	r.pending = append(r.pending, c)
}

// choose is a choice answered in choices[path]: always listed for the builder, and pending until done.
func (r *resolver) choose(c PendingChoice, done bool) {
	if c.Options == nil {
		c.Options = []string{}
	}
	answer, _ := r.choiceFor(c.Path)
	if answer == nil {
		answer = []any{}
	}
	r.choices = append(r.choices, BuildChoicePrompt{c, answer})
	if !done {
		r.pending = append(r.pending, c)
	}
}

func of(s string) *string { return &s }

// price is the XP of a Talent, power or package at creation. "× the new Tier" is the campaign Tier.
func (r *resolver) price(x any, path, step, what string) float64 {
	n, isNum := x.(float64)
	if isNum {
		return n
	}
	o, _ := x.(*schema.Obj)
	switch {
	case o.Has("perTier"):
		return number(o, "perTier") * r.tier
	case o.Has("atCreation"):
		return number(o, "atCreation")
	case o.Has("base"):
		r.problem(BuildProblem{
			Step: step, Severity: "gm", Path: path + "/xp",
			What: what + " costs " + num(number(o, "base")) + " XP plus " + str(o, "plus") + ": the GM adds it",
		})
		return number(o, "base")
	}
	byChoice := objs(o, "byChoice")
	answer, _ := r.choiceFor(path + "/xp")
	var c *schema.Obj
	if len(answer) > 0 {
		if i, isIndex := answer[0].(float64); isIndex && i < float64(len(byChoice)) {
			c = byChoice[int(i)]
		}
	}
	options := make([]string, len(byChoice))
	for i, b := range byChoice {
		options[i] = num(number(b, "xp")) + " XP: " + str(b, "when")
	}
	r.choose(PendingChoice{
		Path: path + "/xp", Step: step, What: what + ": which price applies", Choose: 1, Options: options,
		Pick: &ChoicePick{Kind: "option"},
	}, c != nil)
	if c != nil {
		return number(c, "xp")
	}
	return number(byChoice[0], "xp")
}

// ratings are the ratings as they stand: granted, or bought up to.
func (r *resolver) ratings() (attributes, skills map[string]float64) {
	bought, boughtSkills := sub(r.build, "attributes"), sub(r.build, "skills")
	adv := sub(r.build, "advancement")
	later, laterSkills := sub(adv, "attributes"), sub(adv, "skills")
	attributes, skills = map[string]float64{}, map[string]float64{}
	for _, a := range r.p.vocab.attributes {
		attributes[a] = math.Max(r.s.baseAttributes[a], math.Max(number(bought, a), number(later, a)))
	}
	for _, k := range r.p.vocab.skills {
		if v := math.Max(r.s.baseSkills[k], math.Max(number(boughtSkills, k), number(laterSkills, k))); v > 0 {
			skills[k] = v
		}
	}
	return attributes, skills
}

// addTalent puts a Talent on the sheet, bought or granted, with its own mods and grants (once, however it arrives).
func (r *resolver) addTalent(talentID string, o origin, choice *string) {
	t := r.ix.talents[talentID]
	if t == nil {
		r.problem(BuildProblem{Step: o.step, Severity: "error", What: "Unknown talent " + talentID})
		return
	}
	id, name, cite := str(t, "id"), str(t, "name"), r.p.cite(t)
	repeatable := get(t, "repeatable")
	if have := r.s.talent(id); have != nil {
		if o.granted {
			return
		}
		if repeatable == false || (repeatable == "perChoice" && slices.ContainsFunc(have.choices, func(c *string) bool {
			return (c == nil) == (choice == nil) && (c == nil || *c == *choice)
		})) {
			r.problem(BuildProblem{Step: o.step, Severity: "error", What: name + " is already taken", Cite: cite})
			return
		}
		have.choices = append(have.choices, choice)
		return
	}
	options := strs(t, "options")
	hasOptions := t.Has("options")
	if hasOptions && o.granted && choice == nil {
		path := o.path + "/choice"
		choice = nil
		if answer, _ := r.choiceFor(path); len(answer) > 0 {
			if i, isIndex := answer[0].(float64); isIndex && i < float64(len(options)) {
				choice = of(options[int(i)])
			}
		}
		r.choose(PendingChoice{
			Path: path, Step: o.step, What: name + ": choose one", Choose: 1, Options: options, Cite: cite,
			Pick: &ChoicePick{Kind: "option"},
		}, choice != nil)
	}
	if (repeatable == "perChoice" || hasOptions) && choice == nil && !o.granted {
		r.problem(BuildProblem{Step: o.step, Severity: "error", What: name + ": choose what it applies to", Cite: cite})
	}
	if hasOptions && choice != nil && !slices.ContainsFunc(options, func(x string) bool {
		return lowerJS.String(x) == lowerJS.String(*choice)
	}) {
		r.problem(BuildProblem{
			Step: o.step, Severity: "error", What: name + ": choose one of " + strings.Join(options, ", "), Cite: cite,
		})
	}
	r.s.talents = append(r.s.talents, &talentEntry{id, name, optStr(t, "summary"), cite, []*string{choice}})
	to := o.at("talent/" + id)
	to.cite = cite
	// A granted Talent whose requirements aren't met is the GM's to tick, not a refusal (Auspex ruling §11.53).
	severity := "error"
	if o.granted {
		severity = "gm"
	}
	r.deferred = append(r.deferred, deferredReq{objs(t, "requires"), name, o, severity, nil, choice})
	r.addMods(sub(t, "mods"), to)
	source := name
	if choice != nil {
		source = name + " (" + *choice + ")"
	}
	r.addWeaponEffects(objs(t, "weapons"), source, &cite, to.path, choice)
	for i, g := range objs(t, "grants") {
		r.grant(g, to.at(to.path+"/"+num(float64(i))), false)
	}
}

func gearItem(item *schema.Obj, from string) GearItem {
	g := GearItem{Name: str(item, "name"), Qty: get(item, "qty"), WargearID: str(item, "wargearId"), From: from}
	if item.Has("upgrades") {
		g.Upgrades = strs(item, "upgrades")
	}
	if item.Has("traitIds") {
		g.TraitIDs = strs(item, "traitIds")
	}
	return g
}

func (r *resolver) addItem(item *schema.Obj, o origin) {
	r.s.gear = append(r.s.gear, gearItem(item, o.path))
}

// grant applies something a record gives. gated: a grant with its own requirements waits in later until the character
// is known, then comes back gated.
func (r *resolver) grant(g *schema.Obj, o origin, gated bool) {
	if !gated && g.Has("requires") && get(g, "requires") != nil {
		r.later = append(r.later, laterGrant{g, o})
		return
	}
	skillNames, attributes := r.p.vocab.skills, r.p.vocab.attributes
	switch {
	case g.Has("all"):
		for i, x := range objs(g, "all") {
			r.grant(x, o.at(o.path+"/"+num(float64(i))), false)
		}
		return
	case g.Has("choose") && g.Has("from"):
		n := r.scaled(get(g, "choose"), o)
		from := objs(g, "from")
		answered, asked := r.choiceFor(o.path)
		var answer []float64
		for _, x := range answered {
			if j, isIndex := x.(float64); isIndex && j < float64(len(from)) {
				answer = append(answer, j)
			}
		}
		what := "Choose " + num(n)
		if boolean(g, "optional") {
			what = "Choose up to " + num(n)
		}
		labels := make([]string, len(from))
		for i, x := range from {
			labels[i] = label(x)
		}
		r.choose(PendingChoice{
			Path: o.path, Step: o.step, What: what, Choose: Num(n), Options: labels, Cite: o.cite,
			Pick: &ChoicePick{Kind: "option"},
		}, float64(len(answer)) >= n || (boolean(g, "optional") && asked)) // an optional choice answered [] is declined
		if !boolean(g, "repeat") && len(dedupeNums(answer)) != len(answer) {
			r.problem(BuildProblem{Step: o.step, Severity: "error", What: "The same option was chosen twice", Cite: o.cite})
		}
		for k, j := range answer[:end(len(answer), n)] {
			r.grant(from[int(j)], o.at(o.path+"/"+num(float64(k))), false)
		}
		return
	case g.Has("choose") && g.Has("rating"):
		n, rating := number(g, "choose"), number(g, "rating")
		answered, _ := r.choiceFor(o.path)
		var picked []string
		for _, x := range answered {
			if k, isName := x.(string); isName && contains(skillNames, k) {
				picked = append(picked, k)
			}
		}
		offered := strs(g, "skills")
		var bad []string
		for _, k := range picked {
			if g.Has("skills") && !contains(offered, k) {
				bad = append(bad, k)
			}
		}
		if len(bad) > 0 {
			r.problem(BuildProblem{
				Step: o.step, Severity: "error", What: strings.Join(bad, ", ") + " is not one of the Skills offered",
				Cite: o.cite,
			})
		}
		from := skillNames
		if g.Has("skills") {
			from = offered
		}
		r.choose(PendingChoice{
			Path: o.path, Step: o.step, What: "Raise " + num(n) + " Skill" + plural(n > 1) + " to " + num(rating),
			Choose: Num(n), Of: of(strings.Join(from, ", ")), Cite: o.cite, Pick: &ChoicePick{Kind: "skill", From: from},
		}, float64(len(picked)) >= n)
		for _, k := range picked[:end(len(picked), n)] {
			r.s.baseSkills[k] = math.Max(r.s.baseSkills[k], rating)
		}
		return
	case g.Has("choose") && g.Has("fromDisciplines"):
		n := r.scaled(get(g, "choose"), o)
		disciplines := strs(g, "fromDisciplines")
		answered, _ := r.choiceFor(o.path)
		picked := asStrs(answered)
		for _, id := range picked[:end(len(picked), n)] {
			pw := r.ix.powers[id]
			if pw == nil || !slices.ContainsFunc(append([]string{str(pw, "disciplineId")}, strs(pw, "alsoIn")...),
				func(d string) bool { return contains(disciplines, d) }) {
				name := id
				if pw != nil {
					name = str(pw, "name")
				}
				r.problem(BuildProblem{
					Step: o.step, Severity: "error", What: name + " is not in " + strings.Join(disciplines, ", "), Cite: o.cite,
				})
			} else {
				r.addPower(str(pw, "id"))
			}
		}
		what := "Choose " + num(n) + " powers"
		if boolean(g, "random") {
			what = "Roll " + num(n) + " powers"
		}
		r.choose(PendingChoice{
			Path: o.path, Step: o.step, What: what, Choose: Num(n), Of: of("powers of " + strings.Join(disciplines, ", ")),
			Cite: o.cite, Pick: &ChoicePick{Kind: "power", Disciplines: disciplines},
		}, float64(len(picked)) >= n)
		return
	case g.Has("talent"):
		o.granted = true
		r.addTalent(str(g, "talent"), o, nil)
		return
	case g.Has("keyword"):
		r.addKeyword(str(g, "keyword"))
		return
	case g.Has("keywords"):
		for _, k := range strs(g, "keywords") {
			r.addKeyword(k)
		}
		return
	case g.Has("power"):
		r.addPower(str(g, "power"))
		return
	case g.Has("wargear"):
		r.addItem(sub(g, "wargear"), o)
		return
	case g.Has("bundle"):
		for _, x := range objs(g, "bundle") {
			r.addItem(x, o)
		}
		return
	case g.Has("pick"):
		n := r.scaled(get(g, "pick"), o)
		filter := sub(g, "wargearOf")
		answered, _ := r.choiceFor(o.path)
		picked := asStrs(answered)
		for _, id := range picked[:end(len(picked), n)] {
			w := r.cat.Wargear[id]
			if w == nil || !WargearMatches(w, filter, r.tier, r.tier, r.p) {
				name := id
				if w != nil {
					name = str(w, "name")
				}
				r.problem(BuildProblem{
					Step: o.step, Severity: "error", What: name + " doesn't qualify for this pick", Cite: o.cite,
				})
			} else {
				r.addItem(newObj("name", str(w, "name"), "qty", 1.0, "wargearId", str(w, "id"), "scope", "character"), o)
			}
		}
		if filter.Has("upgrade") || filter.Has("condition") {
			what := str(filter, "condition")
			if filter.Has("upgrade") {
				what = str(filter, "upgrade")
			}
			r.problem(BuildProblem{
				Step: o.step, Severity: "gm", Path: o.path + "/condition", What: "Wargear pick: " + what, Cite: o.cite,
			})
		}
		r.choose(PendingChoice{
			Path: o.path, Step: o.step, What: "Pick " + num(n) + " wargear", Choose: Num(n),
			Of: of(describeFilter(filter)), Cite: o.cite, Pick: &ChoicePick{Kind: "wargear", Filter: filter},
		}, float64(len(picked)) >= n)
		return
	case g.Has("weapon"):
		weapon := sub(g, "weapon")
		w := schema.NewObj()
		for _, k := range weapon.Keys() {
			if k != "name" && k != "range" {
				w.Set(k, get(weapon, k))
			}
		}
		w.Set("range", get(weapon, "range"))
		r.s.weapons = append(r.s.weapons, namedWeapon{str(weapon, "name"), w})
		return
	case g.Has("wealth"):
		if n, ok := numeric(get(g, "wealth")); ok {
			r.s.wealth += r.scaled(n, o)
		} else {
			r.effects = append(r.effects, BuildEffect{"Wealth " + amount(get(g, "wealth")), o.cite})
		}
		return
	case g.Has("influence"):
		r.s.mods["influence"] += r.scaled(get(g, "influence"), o)
		return
	case g.Has("mods"):
		mods, rest := sub(g, "mods"), schema.NewObj()
		for _, k := range mods.Keys() {
			if k == "armourRating" {
				r.s.mods["armourRating"] += r.scaled(get(mods, k), o)
			} else {
				rest.Set(k, get(mods, k))
			}
		}
		r.addMods(rest, o)
		return
	case g.Has("attribute"):
		var targets []string
		switch which := get(g, "attribute").(type) {
		case string:
			switch which {
			case "lowest":
				least := math.Inf(1)
				for _, a := range attributes {
					least = math.Min(least, r.s.baseAttributes[a])
				}
				for _, a := range attributes {
					if r.s.baseAttributes[a] == least {
						targets = []string{a}
						break
					}
				}
			case "any":
				targets = r.chooseAttribute(o, nil)
			default:
				targets = []string{which}
			}
		case []any:
			targets = r.chooseAttribute(o, asStrs(which))
		}
		for _, a := range targets {
			if g.Has("add") {
				r.s.baseAttributes[a] += number(g, "add")
			}
			if g.Has("to") {
				r.s.baseAttributes[a] = math.Max(r.s.baseAttributes[a], number(g, "to"))
			}
		}
		return
	case g.Has("skills") && g.Has("add"):
		for _, k := range strs(g, "skills") {
			r.s.baseSkills[k] += number(g, "add")
		}
		return
	case g.Has("languages"):
		if l := sub(g, "languages"); l != nil && l.Has("skill") {
			r.s.languageGrants = append(r.s.languageGrants, languageGrant{skill: of(str(l, "skill"))})
		} else {
			r.s.languageGrants = append(r.s.languageGrants, languageGrant{n: r.scaled(get(g, "languages"), o)})
		}
		if g.Has("xenos") {
			r.effects = append(r.effects, BuildEffect{"One of the granted languages is an alien one", o.cite})
		}
		return
	case g.Has("disciplineAccess"):
		for _, d := range strs(g, "disciplineAccess") {
			r.s.disciplines[d] = true
		}
		return
	}
	// falls through: the limit is still listed in effects
	if g.Has("onlyDisciplines") && (!truthy(get(g, "untilTier")) || r.nowTier < number(g, "untilTier")) {
		r.s.only = dedupe(strs(g, "onlyDisciplines"))
	}
	switch {
	case g.Has("chooseDisciplines"):
		n := number(g, "chooseDisciplines")
		var from []string
		hasFrom := g.Has("from")
		if hasFrom {
			from = strs(g, "from")
		}
		// Under onlyDisciplines the Species' choice is what's left of those; an archetype that grants its one discipline
		if r.s.only != nil {
			left := []string{}
			for _, d := range r.s.only {
				if !r.s.disciplines[d] && (!hasFrom || contains(from, d)) {
					left = append(left, d)
				}
			}
			if len(left) == 0 {
				return
			}
			from, hasFrom = left, true
		}
		answered, _ := r.choiceFor(o.path)
		var ok []string
		for _, x := range answered {
			if d, isID := x.(string); isID && r.ix.disciplines[d] != nil && (!hasFrom || contains(from, d)) {
				ok = append(ok, d)
			}
		}
		ok = ok[:end(len(ok), n)]
		for _, d := range ok {
			r.s.disciplines[d] = true
		}
		described, pick := "any Discipline you may learn", &ChoicePick{Kind: "discipline"}
		if hasFrom {
			described, pick.From = strings.Join(from, ", "), from
		}
		r.choose(PendingChoice{
			Path: o.path, Step: o.step, What: "Choose " + num(n) + " Discipline" + plural(n > 1), Choose: Num(n),
			Of: of(described), Cite: o.cite, Pick: pick,
		}, float64(len(ok)) >= n)
		return
	case g.Has("optionAccess"):
		r.s.optionAccess[str(g, "optionAccess")] = true
		return
	case g.Has("neverKeyword"):
		if k := str(g, "neverKeyword"); !contains(r.s.neverKeywords, k) {
			r.s.neverKeywords = append(r.s.neverKeywords, k)
		}
		return
	case g.Has("loseKeyword"):
		var k any = str(g, "loseKeyword")
		chosen := k == r.p.Keywords.Any
		if chosen {
			k = nil
			if answer, _ := r.choiceFor(o.path); len(answer) > 0 {
				k = answer[0] // what the choice holds, cast to a keyword as the TypeScript does
			}
			r.choose(PendingChoice{
				Path: o.path, Step: o.step, What: "Choose the Keyword you lose", Choose: 1, Of: of("one of your Keywords"),
				Cite: o.cite, Pick: &ChoicePick{Kind: "keyword"},
			}, truthy(k))
		}
		if truthy(k) {
			r.s.keywords = slices.DeleteFunc(r.s.keywords, func(x string) bool { return x == k })
		}
		return
	case g.Has("influenceAttribute"):
		r.s.influenceAttribute = str(g, "influenceAttribute")
		return
	case g.Has("xpDiscount"):
		d := sub(g, "xpDiscount")
		if d.Has("talent") {
			r.s.talentDiscounts[str(d, "talent")] = number(d, "xp")
			return
		}
		var disc any
		if d.Has("discipline") {
			disc = str(d, "discipline")
		} else if answer, _ := r.choiceFor(o.path); len(answer) > 0 {
			disc = answer[0]
		}
		if !d.Has("discipline") {
			r.choose(PendingChoice{
				Path: o.path, Step: o.step, What: "Choose the Discipline you learn cheaper", Choose: 1,
				Of: of("a Discipline"), Cite: o.cite, Pick: &ChoicePick{Kind: "discipline"},
			}, truthy(disc))
		}
		r.s.disciplineDiscounts = append(r.s.disciplineDiscounts, disciplineDiscount{disc, number(d, "multiplier")})
		return
	case g.Has("story"):
		r.problem(BuildProblem{Step: o.step, Severity: "gm", Path: o.path, What: str(g, "story"), Cite: o.cite})
		return
	}
	// Corruption the build gives is counted. A rolled amount is the table's to roll, and a loss the GM's to take, so both
	// stay listed.
	if g.Has("corruption") {
		if fixed, issues := schema.Parse(Scaled, get(g, "corruption")); len(issues) == 0 {
			if gained := r.scaled(fixed, o); gained > 0 {
				r.s.corruption += gained
				return
			}
		}
	}
	// Everything else happens in play, not on the sheet: list it so the builder shows it.
	r.effects = append(r.effects, BuildEffect{describeGrant(g), o.cite})
}

func (r *resolver) addPower(id string) {
	if !contains(r.s.powers, id) {
		r.s.powers = append(r.s.powers, id)
	}
}

// chooseAttribute asks for one Attribute, of `which` (nil: any), and answers what was picked.
func (r *resolver) chooseAttribute(o origin, which []string) []string {
	attributes := r.p.vocab.attributes
	answered, _ := r.choiceFor(o.path)
	var ok []string
	for _, x := range answered {
		if a, isID := x.(string); isID && contains(attributes, a) && (which == nil || contains(which, a)) {
			ok = append(ok, a)
		}
	}
	ok = ok[:min(len(ok), 1)]
	from, described := slices.Clone(attributes), "any Attribute"
	if which != nil {
		from, described = which, strings.Join(which, ", ")
	}
	r.choose(PendingChoice{
		Path: o.path, Step: o.step, What: "Choose an Attribute", Choose: 1, Of: of(described), Cite: o.cite,
		Pick: &ChoicePick{Kind: "attribute", From: from},
	}, len(ok) > 0)
	return ok
}

func dedupeNums(list []float64) []float64 {
	var out []float64
	for _, x := range list {
		if !contains(out, x) {
			out = append(out, x)
		}
	}
	return out
}

// numeric is a rolled amount's fixed part: a number or a Scaled, not a roll. A rolled one is played at the table.
func numeric(a any) (any, bool) {
	switch x := a.(type) {
	case float64:
		return x, true
	case *schema.Obj:
		if x.Has("roll") {
			return nil, false
		}
		for _, k := range x.Keys() {
			if _, isNum := get(x, k).(float64); !isNum {
				return nil, false
			}
		}
		return x, true
	}
	return nil, false
}

// Resolve resolves a build against a catalogue: the sheet it makes, what it costs (the ledger), what is still to choose
// (pending), what is wrong (problems, a gm one cleared by its path in gm.approved) and what the sheet has no field for
// (effects). Pure: it reads its arguments and nothing else.
//
// The build is the input as schema.DecodeJSON read it, so the key order the TypeScript reads is kept. Resolve answers an
// error where the TypeScript throws: when the build is not shaped right, or the sheet it writes is not.
//
// play: a character already in play; nil prices the build as at creation.
func Resolve(p *Params, catalogue Catalogue, input any, play *Play) (*ResolvedBuild, error) {
	s := p.schemas
	build, err := ParseRecord(s.CharacterBuild, input)
	if err != nil {
		return nil, err
	}
	tier := number(build, "tier") // the Tier the character was made at
	nowTier := tier
	if play != nil {
		nowTier = math.Max(tier, play.Tier)
	}
	// Rank 1 at creation, also after a Creation Ascension; then one more per xpPerRank XP earned.
	rank := 1.0
	if play != nil {
		rank = math.Min(p.Rank.Top, 1+math.Floor(play.XPEarned/p.Rank.XpPerRank))
	}
	advanced := sub(build, "advanced")
	// No Archetype Ability, so the Tier × 10 bonus (Auspex ruling §11.127) is part of the budget.
	budget := tier * p.StartingXp.PerTier
	if build.Has("budget") {
		budget = number(build, "budget")
	}
	if advanced != nil {
		budget += tier * p.Advanced.BonusXpPerTier
	}
	gm := sub(build, "gm")
	r := &resolver{
		p: p, cat: catalogue, ix: indexOf(catalogue.Creation), build: build, choicesIn: sub(build, "choices"),
		boughtIn: sub(sub(build, "advancement"), "boughtIn"), tier: tier, nowTier: nowTier, rank: rank,
		ledger: []LedgerRow{}, pending: []PendingChoice{}, choices: []BuildChoicePrompt{}, problems: []BuildProblem{},
		effects: []BuildEffect{}, approved: map[string]bool{}, copies: map[string]int{}, filled: []string{},
		attributeNames: p.vocab.attributeNames,
	}
	for _, a := range strs(gm, "approved") {
		r.approved[a] = true
	}
	r.s = sheet{
		baseAttributes: map[string]float64{}, baseSkills: map[string]float64{}, keywords: []string{},
		powers: []string{}, disciplines: map[string]bool{}, mods: map[string]float64{},
		wealth: tier * p.Wealth.StartingPerTier, talentDiscounts: map[string]float64{}, optionAccess: map[string]bool{},
	}
	for _, a := range p.vocab.attributes {
		r.s.baseAttributes[a] = 1
	}
	return r.resolve(play, budget)
}

func (r *resolver) resolve(play *Play, budget float64) (*ResolvedBuild, error) {
	p, build, ix, cat := r.p, r.build, r.ix, r.cat
	tier, nowTier := r.tier, r.nowTier
	attributes, skillNames := p.vocab.attributes, p.vocab.skills
	advanced := sub(build, "advanced")
	gm := sub(build, "gm")
	advancementIn := sub(build, "advancement")

	// ── species and archetype (or Advanced Creation: a species and no archetype) ──
	archetypeID, hasArchetype := get(build, "archetypeId").(string)
	if hasArchetype {
		r.arch = ix.archetypes[archetypeID]
	}
	arch := r.arch
	if advanced == nil && arch == nil {
		r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "Unknown archetype " + text(get(build, "archetypeId"))})
		sheet, err := ParseRecord(p.schemas.CharacterStats, schema.NewObj())
		if err != nil {
			return nil, err
		}
		var id *string
		if hasArchetype {
			id = &archetypeID
		}
		return &ResolvedBuild{
			Sheet: sheet, Budget: Num(budget), Ledger: r.ledger, Pending: r.pending, Choices: r.choices,
			Problems: r.problems, Effects: r.effects, Who: Who{ArchetypeID: id, Keywords: []string{}, Buyable: []string{}},
		}, nil
	}
	originOf := func(a *schema.Obj) origin {
		return origin{path: "archetype/" + str(a, "id"), step: "archetype", cite: p.cite(a), granted: true}
	}
	if arch != nil {
		r.allowed(arch, "archetype")
		if number(arch, "tier") > tier {
			r.problem(BuildProblem{
				Step: "archetype", Severity: "error",
				What: str(arch, "name") + " is Tier " + num(number(arch, "tier")) + ", above the campaign's Tier " + num(tier),
				Cite: p.Cites.ArchetypeTier,
			})
		}
		r.ledger = append(r.ledger, LedgerRow{
			What: str(arch, "name") + " (archetype, with its species)", XP: Num(number(arch, "xp")), Cite: p.cite(arch),
			Step: "archetype",
		})
	}

	speciesID := ""
	switch {
	case gm.Has("species"):
		speciesID = str(gm, "species")
	case build.Has("speciesId"):
		speciesID = str(build, "speciesId")
	case arch != nil && len(strs(arch, "speciesIds")) == 1:
		speciesID = strs(arch, "speciesIds")[0]
	}
	if speciesID == "" {
		c := PendingChoice{Path: "advanced/species", Step: "archetype", What: "Choose a species", Choose: 1,
			Cite: p.Cites.AdvancedCreation}
		if arch != nil {
			c.Path, c.Cite = "archetype/"+str(arch, "id")+"/species", ""
			for _, x := range strs(arch, "speciesIds") {
				name := x
				if sp := ix.species[x]; sp != nil {
					name = str(sp, "name")
				}
				c.Options = append(c.Options, name)
			}
		} else {
			for _, x := range cat.Creation.Species {
				if cat.Homebrew || p.isOfficial(str(x, "source")) {
					c.Options = append(c.Options, str(x, "name"))
				}
			}
		}
		r.ask(c)
	} else if arch != nil && !gm.Has("species") && !contains(strs(arch, "speciesIds"), speciesID) {
		name := speciesID
		if sp := ix.species[speciesID]; sp != nil {
			name = str(sp, "name")
		}
		r.problem(BuildProblem{
			Step: "archetype", Severity: "error", What: str(arch, "name") + " is not open to " + name, Cite: p.cite(arch),
		})
	}
	if speciesID != "" {
		r.species = ix.species[speciesID]
	}
	species := r.species
	if speciesID != "" && species == nil {
		r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "Unknown species " + speciesID})
	}
	// Advanced Creation pays the species' own XP; an archetype's cost has it inside.
	if advanced != nil && species != nil {
		r.ledger = append(r.ledger, LedgerRow{
			What: str(species, "name") + " (species)", XP: Num(number(species, "xp")),
			Cite: p.cite(species) + ", " + p.Cites.AdvancedCreation, Step: "archetype",
		})
	}

	// The archetype's printed ratings already include the species'; what it doesn't print, the species gives.
	// Advanced Creation starts every Attribute at 1 and every Skill at 0, and the species' own ratings stand.
	for _, a := range attributes {
		r.s.baseAttributes[a] = 1
		if v, ok := get(sub(arch, "attributes"), a).(float64); ok {
			r.s.baseAttributes[a] = v
		} else if v, ok := get(sub(species, "attributes"), a).(float64); ok {
			r.s.baseAttributes[a] = v
		}
	}
	for _, k := range skillNames {
		v, ok := get(sub(arch, "skills"), k).(float64)
		if !ok {
			v = number(sub(species, "skills"), k)
		}
		if v != 0 {
			r.s.baseSkills[k] = v
		}
	}
	if species != nil {
		r.allowed(species, "archetype")
		so := origin{path: "species/" + str(species, "id"), step: "archetype", cite: p.cite(species), granted: true}
		for _, rule := range r.ownRules(objs(species, "abilities")) {
			r.addRule(rule, so)
		}
		// Species Keywords are Advanced Creation's (Auspex ruling §11.141): an archetype prints its own, so its species'
		// keyword grants are skipped for it. The fixed ones stand beside a Faction, and the choices are asked only
		// without one (§11.142).
		if advanced != nil {
			for _, k := range strs(species, "keywords") {
				r.addKeyword(k)
			}
		}
		asksKeywords := advanced != nil && !advanced.Has("factionId")
		for i, g := range objs(species, "grants") {
			if keywordsOnly(g) && !asksKeywords {
				continue // i stays the grant's index, so answers keep their paths
			}
			r.grant(g, so.at(so.path+"/"+num(float64(i))), false)
		}
	}
	if arch != nil {
		o := originOf(arch)
		for _, k := range strs(arch, "keywords") {
			r.addKeyword(k)
		}
		for _, rule := range r.ownRules(objs(arch, "abilities")) {
			r.addRule(rule, o)
		}
		for i, g := range objs(arch, "grants") {
			r.grant(g, o.at(o.path+"/"+num(float64(i))), false)
		}
		for i, g := range objs(arch, "wargear") {
			r.grant(g, o.at(o.path+"/wargear/"+num(float64(i))), false)
		}
		if truthy(get(arch, "influence")) {
			r.s.mods["influence"] += number(arch, "influence")
		}
		r.deferred = append(r.deferred, deferredReq{reqs: objs(arch, "requires"), what: str(arch, "name"), origin: o,
			severity: "error"})
	}
	if advanced != nil {
		ao := origin{path: "advanced", step: "archetype", cite: p.Cites.AdvancedCreation, granted: true}
		// The optional Faction: the Keywords its record names; its Background tables and option groups are the FACTION
		// step's, offered by factionId as an archetype's are by its own (§11.140).
		if advanced.Has("factionId") {
			id := str(advanced, "factionId")
			if faction := ix.factions[id]; faction == nil {
				r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "Unknown faction " + id, Cite: ao.cite})
			} else if r.allowed(faction, "archetype") {
				keywords := strs(faction, "keywords")
				for _, k := range keywords {
					r.addKeyword(k)
				}
				what := str(faction, "name") + " Faction"
				if len(keywords) > 0 {
					what += ": " + strings.Join(keywords, ", ")
				}
				r.effects = append(r.effects, BuildEffect{what, p.cite(faction)})
			}
		}
		// A bought Archetype Ability brings the ability alone: no Keywords, kit or Influence (§11.131). The GM must agree.
		if advanced.Has("abilityOf") {
			id := str(advanced, "abilityOf")
			if from := ix.archetypes[id]; from == nil {
				r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "Unknown archetype " + id, Cite: ao.cite})
			} else if r.allowed(from, "archetype") {
				path := "advanced/ability/" + str(from, "id")
				r.ledger = append(r.ledger, LedgerRow{
					What: str(from, "name") + " Archetype Ability", XP: Num(number(from, "tier") * p.Advanced.AbilityXpPerTier),
					Cite: p.Cites.AdvancedCreation + ", " + p.cite(from), Step: "archetype",
				})
				r.problem(BuildProblem{
					Step: "archetype", Severity: "gm", Path: path,
					What: "Archetype Ability of " + str(from, "name") + ": the GM agrees", Cite: p.Cites.AdvancedCreation,
				})
				for _, rule := range r.ownRules(objs(from, "abilities")) {
					o := ao.at(path)
					o.cite = p.cite(from)
					r.addRule(rule, o)
				}
			}
		}
		// The kit that replaces an Archetype's. Common clothing and a trinket come with it, and the sheet has no line
		// for either.
		var kit []*schema.Obj
		for _, id := range strs(advanced, "wargear") {
			w := cat.Wargear[id]
			switch {
			case w == nil:
				r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "Unknown wargear " + id,
					Cite: p.Cites.AdvancedWargear})
			// An upgrade is fitted to a weapon or armour, not carried as a piece of the kit.
			case str(w, "kind") == "upgrade":
				r.problem(BuildProblem{Step: "archetype", Severity: "error", What: str(w, "name") + " is an upgrade, not Wargear",
					Cite: p.Cites.AdvancedWargear})
			case r.allowed(w, "archetype"):
				r.addItem(newObj("name", str(w, "name"), "qty", 1.0, "wargearId", str(w, "id"), "scope", "character"),
					ao.at("advanced/wargear/"+str(w, "id")))
			}
			if w != nil {
				kit = append(kit, w)
			}
		}
		for _, wp := range advancedWargearProblems(p, kit, tier) {
			problem := BuildProblem{Step: "archetype", Severity: "error", What: wp.what, Cite: p.Cites.AdvancedWargear}
			if wp.gm {
				problem.Severity, problem.Path = "gm", cut("advanced/wargear/"+norm(wp.what), 200)
			}
			r.problem(problem)
		}
		r.effects = append(r.effects, BuildEffect{"Common clothing and one trinket from the Trinkets Table",
			p.Cites.AdvancedWargear})
	}

	// ── packages: one Creation Ascension Package when the archetype's Tier is below the campaign's, and any
	// Advancement Packages bought at creation. An Advanced character has no Archetype Tier to ascend from: an Ascension
	// Package bought at creation is the GM's to allow (Auspex ruling §11.132), one at most. ──
	tiersAscended := 0.0
	if arch != nil {
		tiersAscended = math.Max(0, tier-number(arch, "tier"))
	}
	packages := strs(build, "packages")
	ascensions := 0
	for _, id := range packages {
		if str(ix.packages[id], "kind") == "ascension" {
			ascensions++
		}
	}
	if arch != nil && tiersAscended > 0 && ascensions == 0 {
		r.ask(PendingChoice{
			Path: "ascension", Step: "ascension",
			What:   "Buy one Ascension Package (Tier " + num(number(arch, "tier")) + " → " + num(tier) + ")",
			Choose: 1, Of: of("Ascension Packages"), Cite: p.Cites.CreationAscension,
		})
	}
	allowedAscensions := 0
	if tiersAscended > 0 || advanced != nil {
		allowedAscensions = 1
	}
	if ascensions > allowedAscensions {
		what := "Advanced Creation takes one Ascension Package"
		switch {
		case tiersAscended != 0:
			what = "Creation Ascension takes one Ascension Package"
		case arch != nil:
			what = str(arch, "name") + " is already Tier " + num(tier) + ": no Creation Ascension"
		}
		cite := p.Cites.CreationAscension
		if advanced != nil {
			cite = p.Cites.AdvancedCreation
		}
		r.problem(BuildProblem{Step: "ascension", Severity: "error", What: what, Cite: cite})
	}
	for _, id := range packages {
		pk := ix.packages[id]
		if pk == nil {
			r.problem(BuildProblem{Step: "customise", Severity: "error", What: "Unknown package " + id})
			continue
		}
		ascension := str(pk, "kind") == "ascension"
		step := "customise"
		if ascension {
			step = "ascension"
		}
		if !r.allowed(pk, step) {
			continue
		}
		po := origin{path: "package/" + str(pk, "id"), step: step, cite: p.cite(pk), granted: true}
		// An Advanced build's Ascension Package counts as one Tier Ascended for its "per Tier" grants (§11.132).
		if ascension {
			po.tiersAscended = tiersAscended
			if advanced != nil {
				po.tiersAscended = 1
			}
		}
		if advanced != nil && ascension {
			r.problem(BuildProblem{
				Step: step, Severity: "gm", Path: "advanced/" + po.path,
				What: str(pk, "name") + ": the GM agrees to an Ascension Package at Advanced Creation",
				Cite: p.Cites.AdvancedCreation,
			})
		}
		r.ledger = append(r.ledger, LedgerRow{
			What: str(pk, "name") + " (" + str(pk, "kind") + " package)",
			XP:   Num(r.price(get(pk, "xp"), po.path, step, str(pk, "name"))), Cite: p.cite(pk), Step: step,
		})
		r.packageNames = append(r.packageNames, str(pk, "name"))
		r.s.mods["influence"] += packageInfluence(pk, po.tiersAscended)
		for i, g := range objs(pk, "grants") {
			r.grant(g, po.at(po.path+"/"+num(float64(i))), false)
		}
		cite := p.cite(pk)
		r.addWeaponEffects(objs(pk, "weapons"), str(pk, "name"), &cite, po.path, nil)
		// Checked after the grants: atCreationWith turns on the kindred chosen (Auspex ruling §11.61).
		with := str(pk, "atCreationWith")
		if boolean(pk, "notAtCreation") && !(with != "" && contains(r.s.keywords, with)) {
			what := str(pk, "name") + " can't be taken at creation"
			if with != "" {
				what += ", except to gain " + with
			}
			r.problem(BuildProblem{Step: step, Severity: "error", What: what, Cite: p.cite(pk)})
		}
		// An Ascension Package's requirements are met before Ascending, at the archetype's Tier (Auspex ruling §11.54).
		at := tier
		if ascension && arch != nil {
			at = number(arch, "tier")
		}
		r.deferred = append(r.deferred, deferredReq{reqs: objs(pk, "requires"), what: str(pk, "name"), origin: po,
			severity: "error", tier: &at})
		r.becomes(pk)
	}

	// ── packages bought in play: Advancement Packages, and a single Ascension Package each time the group Ascends
	// (Auspex ruling §11.55), the packages filling the Ascensions in the order they were bought, each priced and checked
	// at its own step. An Archetype Ascension takes the step to its own Tier, so the packages skip that one. ──
	ascendedTiers := nowTier - tier // the Ascensions since creation; 0 when the group hasn't Ascended
	var archTo *schema.Obj
	if a := sub(advancementIn, "archetypeAscension"); a != nil {
		archTo = ix.archetypes[str(a, "archetypeId")]
	}
	archStep := 0.0
	if archTo != nil && number(archTo, "tier") > tier && number(archTo, "tier") <= nowTier {
		archStep = number(archTo, "tier") - tier
	}
	// The Ascensions a package can take, oldest first: step n goes from Tier tier + n - 1 to tier + n.
	var packageSteps []float64
	for n := 1.0; n <= ascendedTiers; n++ {
		if n != archStep {
			packageSteps = append(packageSteps, n)
		}
	}
	ascensionsTaken := 0 // Ascension Packages bought in play, one per Ascension
	for _, id := range strs(advancementIn, "packages") {
		pk := ix.packages[id]
		if pk == nil {
			r.problem(BuildProblem{Step: "advance", Severity: "error", What: "Unknown package " + id})
			continue
		}
		ascension := str(pk, "kind") == "ascension"
		step := "advance"
		if ascension {
			step = "ascension"
		}
		if !r.allowed(pk, step) {
			continue
		}
		// The Tier this package's Ascension reached; an Advancement Package's "new Tier" is the Tier now.
		reached := nowTier
		if ascension {
			taken := ascensionsTaken
			ascensionsTaken++
			switch {
			case ascendedTiers == 0:
				r.problem(BuildProblem{
					Step: "ascension", Severity: "error",
					What: str(pk, "name") + ": the group is still Tier " + num(nowTier) + ", so there has been no Ascension",
					Cite: p.Cites.CreationAscension,
				})
			case taken >= len(packageSteps):
				times := "s"
				if ascendedTiers == 1 {
					times = ""
				}
				r.problem(BuildProblem{
					Step: "ascension", Severity: "error",
					What: str(pk, "name") + ": each Ascension takes one Ascension Package or an Archetype Ascension, and the group has Ascended " +
						num(ascendedTiers) + " time" + times + " since Tier " + num(tier),
					Cite: p.Cites.AscensionSteps,
				})
			default:
				reached = tier + packageSteps[taken]
			}
		}
		po := origin{path: "advance/package/" + str(pk, "id"), step: step, cite: p.cite(pk), granted: true}
		if ascension {
			po.tiersAscended = 1
		}
		// "× the new Tier" is the Tier its Ascension reached, so a package bought earlier keeps its price.
		var xp float64
		if cost, isObj := get(pk, "xp").(*schema.Obj); isObj && cost.Has("perTier") {
			xp = number(cost, "perTier") * reached
		} else {
			xp = r.price(get(pk, "xp"), po.path, "advance", str(pk, "name"))
		}
		r.ledger = append(r.ledger, r.dated(LedgerRow{
			What: str(pk, "name") + " (" + str(pk, "kind") + " package)", XP: Num(xp), Cite: p.cite(pk), Step: "advance",
			Pool: "advancement",
		}, Purchase{Kind: "package", ID: str(pk, "id")}))
		r.packageNames = append(r.packageNames, str(pk, "name"))
		r.s.mods["influence"] += packageInfluence(pk, po.tiersAscended)
		for i, g := range objs(pk, "grants") {
			r.grant(g, po.at(po.path+"/"+num(float64(i))), false)
		}
		cite := p.cite(pk)
		r.addWeaponEffects(objs(pk, "weapons"), str(pk, "name"), &cite, po.path, nil)
		// An Ascension Package's requirements are met before Ascending, at the Tier the character leaves (§11.54).
		at := nowTier
		if ascension {
			at = reached - 1
		}
		r.deferred = append(r.deferred, deferredReq{reqs: objs(pk, "requires"), what: str(pk, "name"), origin: po,
			severity: "error", tier: &at})
		r.becomes(pk)
	}

	// ── Archetype Ascension (Auspex ruling §11.67): at an Ascension, in place of an Ascension Package, the character
	// takes an Archetype of their own Faction at the Tier Ascended to. It grants that Archetype's abilities, Keywords,
	// Wargear and Influence, and none of its Attribute or Skill ratings, which XP has to buy (below). ──
	if a := sub(advancementIn, "archetypeAscension"); a != nil {
		id := str(a, "archetypeId")
		if to := ix.archetypes[id]; to == nil {
			r.problem(BuildProblem{Step: "ascension", Severity: "error", What: "Unknown archetype " + id})
		} else if r.allowed(to, "ascension") {
			r.archetypeAscension(to, play, ascendedTiers, archStep, speciesID)
			r.packageNames = append(r.packageNames, str(to, "name")) // the sheet names both
		}
	}

	// Each Ascension's second step: an Ascension Package or an Archetype Ascension, unless the GM waived it on a
	// Milestone Ascension (step 2), which is always the latest one.
	if ascensionsTaken < len(packageSteps) {
		open := packageSteps[ascensionsTaken]
		if !(play != nil && play.PackageWaived && open == ascendedTiers) {
			r.ask(PendingChoice{
				Path: "advance/ascension", Step: "ascension",
				What:   "Buy one Ascension Package (Tier " + num(tier+open-1) + " → " + num(tier+open) + ")",
				Choose: 1, Of: of("Ascension Packages"), Cite: p.Cites.CreationAscension,
			})
		}
	}

	r.background()
	r.options()
	r.fills()

	// ── GM rulings on this character ──
	for _, k := range strs(gm, "keywords") {
		r.addKeyword(k)
	}
	if gm.Has("species") {
		name := str(gm, "species")
		if species != nil {
			name = str(species, "name")
		}
		r.effects = append(r.effects, BuildEffect{What: "Species " + name + " by the GM's ruling"})
	}
	gear := sub(gm, "gear")
	var removals []string
	for _, x := range strs(gear, "remove") {
		removals = append(removals, norm(x))
	}
	r.s.gear = slices.DeleteFunc(r.s.gear, func(g GearItem) bool { return contains(removals, norm(g.Name)) })
	for _, item := range objs(gear, "add") {
		r.addItem(item, origin{path: "gm", step: "archetype", cite: p.Cites.GM, granted: true})
	}

	// ── talents bought: at creation, then with the XP earned in play ──
	type pool struct {
		step, pool string
		talents    []*schema.Obj
		powerIDs   []string
	}
	pools := []pool{
		{step: "customise", talents: objs(build, "talents"), powerIDs: strs(build, "powers")},
		{step: "advance", pool: "advancement", talents: objs(advancementIn, "talents"), powerIDs: strs(advancementIn, "powers")},
	}
	for _, pl := range pools {
		for _, t := range pl.talents {
			rec := ix.talents[str(t, "id")]
			if rec == nil {
				r.problem(BuildProblem{Step: pl.step, Severity: "error", What: "Unknown talent " + str(t, "id")})
				continue
			}
			if !r.allowed(rec, pl.step) {
				continue
			}
			id, name := str(rec, "id"), str(rec, "name")
			path := "talent/" + id
			if pl.pool != "" {
				path = "advance/" + path
			}
			if r.s.talent(id) != nil && get(rec, "repeatable") == false {
				r.problem(BuildProblem{Step: pl.step, Severity: "error", What: name + " is already taken", Cite: p.cite(rec)})
				continue
			}
			choice := optStr(t, "choice")
			what := name
			if choice != nil {
				what += " (" + *choice + ")"
			}
			xp, discounted := r.s.talentDiscounts[id]
			if !discounted {
				xp = r.price(get(rec, "xp"), path, pl.step, name)
			}
			row := LedgerRow{What: what, XP: Num(xp), Cite: p.cite(rec), Step: pl.step, Pool: pl.pool}
			if pl.pool != "" {
				purchase := Purchase{Kind: "talent", ID: id}
				if choice != nil {
					purchase.Choice = *choice
				}
				row = r.dated(row, purchase)
			}
			r.ledger = append(r.ledger, row)
			r.addTalent(id, origin{path: path, step: pl.step, cite: p.cite(rec)}, choice)
		}
	}

	// Keyword grants run until nothing new arrives.
	seen := map[string]bool{}
	for changed := true; changed; {
		changed = false
		for _, k := range slices.Clone(r.s.keywords) {
			kw := ix.keywords[k]
			if kw == nil || seen[k] {
				continue
			}
			seen[k] = true
			changed = true
			for i, g := range objs(kw, "grants") {
				r.grant(g, origin{path: "keyword/" + str(kw, "id") + "/" + num(float64(i)), step: "customise",
					cite: p.cite(kw), granted: true}, false)
			}
		}
	}
	for _, k := range r.s.neverKeywords {
		if contains(r.s.keywords, k) {
			r.problem(BuildProblem{Step: "archetype", Severity: "error", What: "This character can never have " + k})
		}
	}

	// Grants gated on requirements, now the rest is known. The list grows while it runs (a gated grant's own grants), and
	// what it gains is applied too.
	for i := 0; i < len(r.later); i++ {
		l := r.later[i]
		c := r.ctx()
		met := true
		for _, req := range objs(l.grant, "requires") {
			if !Meets(req, c).Met {
				met = false
				break
			}
		}
		if met {
			r.grant(l.grant, l.origin, true)
		}
	}

	// ── powers bought: from a discipline the character may learn, at creation, then in play ──
	for _, pl := range pools {
		for _, id := range pl.powerIDs {
			pw := ix.powers[id]
			if pw == nil {
				r.problem(BuildProblem{Step: pl.step, Severity: "error", What: "Unknown power " + id})
				continue
			}
			if !r.allowed(pw, pl.step) {
				continue
			}
			pid, name, cite := str(pw, "id"), str(pw, "name"), p.cite(pw)
			if contains(r.s.powers, pid) {
				r.problem(BuildProblem{Step: pl.step, Severity: "error", What: name + " is already known", Cite: cite})
				continue
			}
			discs := append([]string{str(pw, "disciplineId")}, strs(pw, "alsoIn")...)
			known := ""
			for _, d := range discs {
				if r.s.disciplines[d] && (r.s.only == nil || contains(r.s.only, d)) {
					known = d
					break
				}
			}
			if known == "" {
				r.problem(BuildProblem{
					Step: pl.step, Severity: "error",
					What: name + " is from a Discipline you can't learn (" + strings.Join(discs, ", ") + ")", Cite: cite,
				})
				known = str(pw, "disciplineId")
			}
			disc := ix.disciplines[known]
			discount := 1.0
			for _, d := range r.s.disciplineDiscounts {
				if id, isID := d.id.(string); isID && id != "" && contains(discs, id) {
					discount = d.multiplier
					break
				}
			}
			var xp float64
			if cost, isObj := get(pw, "xp").(*schema.Obj); pl.pool != "" && isObj && cost.Has("later") {
				xp = number(cost, "later")
			} else {
				xp = r.price(get(pw, "xp"), "power/"+pid, pl.step, name)
			}
			row := LedgerRow{What: name + " (power)", XP: Num(math.Ceil(xp * discount)), Cite: cite, Step: pl.step, Pool: pl.pool}
			if pl.pool != "" {
				row = r.dated(row, Purchase{Kind: "power", ID: pid})
			}
			r.ledger = append(r.ledger, row)
			r.addPower(pid)
			po := origin{path: "power/" + pid, step: pl.step, cite: cite}
			r.deferred = append(r.deferred, deferredReq{reqs: append(objs(disc, "requires"), objs(pw, "requires")...),
				what: name, origin: po, severity: "error"})
		}
	}

	// ── ratings bought with XP ──
	finalAttributes := maps(r.s.baseAttributes)
	skills := maps(r.s.baseSkills)
	bought := sub(build, "attributes")
	for _, a := range bought.Keys() {
		to, from := number(bought, a), r.s.baseAttributes[a]
		if to <= from {
			continue
		}
		finalAttributes[a] = to
		r.ledger = append(r.ledger, LedgerRow{
			What: r.attributeNames[a] + " " + num(from) + " → " + num(to),
			XP:   Num(at(p.AttributeXp.Table, to) - at(p.AttributeXp.Table, from)), Cite: p.AttributeXp.Cite, Step: "customise",
		})
	}
	boughtSkills := sub(build, "skills")
	for _, k := range boughtSkills.Keys() {
		to, from := number(boughtSkills, k), r.s.baseSkills[k]
		if to <= from {
			continue
		}
		skills[k] = to
		r.ledger = append(r.ledger, LedgerRow{
			What: k + " " + num(from) + " → " + num(to),
			XP:   Num(at(p.SkillXp.Table, to) - at(p.SkillXp.Table, from)), Cite: p.SkillXp.Cite, Step: "customise",
		})
	}
	// In play: ratings raised from where creation left them, one row per rating point, which is how they are bought and
	// what the history is keyed by (§11.69). The XP is unchanged: the tables are cumulative.
	later := sub(advancementIn, "attributes")
	for _, a := range later.Keys() {
		to, from := number(later, a), finalAttributes[a]
		if to <= from {
			continue
		}
		finalAttributes[a] = to
		for n := from + 1; n <= to; n++ {
			r.ledger = append(r.ledger, r.dated(LedgerRow{
				What: r.attributeNames[a] + " " + num(n-1) + " → " + num(n),
				XP:   Num(at(p.AttributeXp.Table, n) - at(p.AttributeXp.Table, n-1)), Cite: p.AttributeXp.Cite, Step: "advance",
				Pool: "advancement",
			}, Purchase{Kind: "attribute", Attribute: a, Rating: n}))
		}
	}
	created := maps(skills)
	laterSkills := sub(advancementIn, "skills")
	for _, k := range laterSkills.Keys() {
		to, from := number(laterSkills, k), skills[k]
		if to <= from {
			continue
		}
		skills[k] = to
		for n := from + 1; n <= to; n++ {
			r.ledger = append(r.ledger, r.dated(LedgerRow{
				What: k + " " + num(n-1) + " → " + num(n),
				XP:   Num(at(p.SkillXp.Table, n) - at(p.SkillXp.Table, n-1)), Cite: p.SkillXp.Cite, Step: "advance",
				Pool: "advancement",
			}, Purchase{Kind: "skill", Skill: k, Rating: n}))
		}
	}
	// Species maximums, for every rating however it was reached.
	for _, a := range attributes {
		if most, capped := get(sub(species, "max"), a).(float64); capped && finalAttributes[a] > most {
			r.problem(BuildProblem{
				Step: "customise", Severity: "error",
				What: r.attributeNames[a] + " " + num(finalAttributes[a]) + " is over the " + str(species, "name") +
					" maximum of " + num(most),
				Cite: p.Cites.SpeciesMax,
			})
		}
	}
	// The Tree of Learning, only for Skills raised with XP (Auspex ruling §11.52).
	treeOfLearning := func(skill string, to float64) bool {
		if !p.TreeOfLearning.Enabled {
			return true
		}
		with := 0.0
		for k, v := range skills {
			if k == skill {
				v = to
			}
			if v > 0 {
				with++
			}
		}
		if _, has := skills[skill]; !has && to > 0 {
			with++
		}
		return with >= to
	}
	for _, k := range boughtSkills.Keys() {
		if to := number(boughtSkills, k); to > r.s.baseSkills[k] && !treeOfLearning(k, to) {
			r.problem(BuildProblem{
				Step: "customise", Severity: "error",
				What: k + " " + num(to) + " needs " + num(to) + " Skills with points (the Tree of Learning)",
				Cite: p.TreeOfLearning.Cite,
			})
		}
	}
	for _, k := range laterSkills.Keys() {
		if to := number(laterSkills, k); to > created[k] && !treeOfLearning(k, to) {
			r.problem(BuildProblem{
				Step: "advance", Severity: "error",
				What: k + " " + num(to) + " needs " + num(to) + " Skills with points (the Tree of Learning)",
				Cite: p.TreeOfLearning.Cite,
			})
		}
	}

	// Archetype Ascension: XP is spent until the Attributes and Skills equal or exceed the new Archetype's.
	if want := r.ascendedTo; want != nil {
		var short []string
		for _, a := range attributes {
			if v := number(sub(want, "attributes"), a); finalAttributes[a] < v {
				short = append(short, r.attributeNames[a]+" "+num(finalAttributes[a])+" of "+num(v))
			}
		}
		wantSkills := sub(want, "skills")
		for _, k := range wantSkills.Keys() {
			if v := number(wantSkills, k); skills[k] < v {
				short = append(short, k+" "+num(skills[k])+" of "+num(v))
			}
		}
		if len(short) > 0 {
			r.problem(BuildProblem{
				Step: "ascension", Severity: "error", What: str(want, "name") + " needs " + strings.Join(short, ", "),
				Cite: p.Cites.ArchetypeAscension,
			})
		}
	}

	r.languages(skills)

	// ── Wealth bought (§11.51) ──
	if wealth := number(build, "wealth"); wealth != 0 {
		r.ledger = append(r.ledger, LedgerRow{What: "Wealth +" + num(wealth), XP: Num(wealth * p.Wealth.Xp),
			Cite: p.Wealth.Cite, Step: "detail"})
	}
	r.s.wealth += number(build, "wealth")

	// ── requirements, against the finished character ──
	final := r.ctx()
	for _, d := range r.deferred {
		for _, req := range d.reqs {
			c := final
			c.Tier, c.Chosen = nowTier, d.choice
			if d.tier != nil {
				c.Tier = *d.tier
			}
			why := Meets(req, c)
			if why.Met {
				continue
			}
			key := str(req, "id")
			if str(req, "kind") != "gm" {
				key = norm(stringify(req, true))
			}
			severity, what := "error", d.what
			if d.severity == "gm" {
				severity = "gm"
				what += " (granted)"
			}
			if why.GM != nil {
				severity, what = "gm", d.what+": "+*why.GM
			} else {
				what += ": " + why.Reason
			}
			r.problem(BuildProblem{
				Step: d.origin.step, Severity: severity, Path: cut(d.origin.path+"/requires/"+key, 200), What: what,
				Cite: d.origin.cite,
			})
		}
	}

	return r.finish(play, budget, finalAttributes, skills, final)
}

func maps(m map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func packageInfluence(pk *schema.Obj, tiersAscended float64) float64 {
	if n, isNum := get(pk, "influence").(float64); isNum {
		return n
	}
	return number(sub(pk, "influence"), "perTier") * tiersAscended
}

func (r *resolver) becomes(pk *schema.Obj) {
	if !pk.Has("becomesArchetypeId") {
		return
	}
	id := str(pk, "becomesArchetypeId")
	name := id
	if a := r.ix.archetypes[id]; a != nil {
		name = str(a, "name")
	}
	r.effects = append(r.effects, BuildEffect{"Becomes " + name, r.p.cite(pk)})
}

func (r *resolver) archetypeAscension(to *schema.Obj, play *Play, ascendedTiers, archStep float64, speciesID string) {
	p, arch, nowTier, tier := r.p, r.arch, r.nowTier, r.tier
	name := str(to, "name")
	path := "advance/archetype/" + str(to, "id")
	if ascendedTiers == 0 {
		r.problem(BuildProblem{
			Step: "ascension", Severity: "error",
			What: name + ": the group is still Tier " + num(nowTier) + ", so there has been no Ascension",
			Cite: p.Cites.CreationAscension,
		})
	}
	if r.rank < p.ArchetypeAscension.MinRank {
		earned := 0.0
		if play != nil {
			earned = play.XPEarned
		}
		r.problem(BuildProblem{
			Step: "ascension", Severity: "error",
			What: "Archetype Ascension needs Rank " + num(p.ArchetypeAscension.MinRank) + "; " + num(earned) +
				" XP earned is Rank " + num(r.rank),
			Cite: p.Cites.ArchetypeAscensionRank,
		})
	}
	// An Advanced character has no Archetype, so no Faction to stay in (§11.133).
	if arch == nil || str(to, "factionId") != str(arch, "factionId") {
		what := name + ": an Advanced character has no Archetype to ascend from"
		if arch != nil {
			what = name + " is not an Archetype of " + str(arch, "name") + "'s Faction"
		}
		r.problem(BuildProblem{Step: "ascension", Severity: "error", What: what, Cite: p.Cites.ArchetypeAscension})
	}
	// The Tier of one of the group's Ascensions since creation, which is the one this takes.
	if ascendedTiers > 0 && archStep == 0 {
		r.problem(BuildProblem{
			Step: "ascension", Severity: "error",
			What: name + " is Tier " + num(number(to, "tier")) + ", not a Tier the group Ascended to (" + num(tier+1) + "–" +
				num(nowTier) + ")",
			Cite: p.Cites.ArchetypeAscension,
		})
	}
	gm := sub(r.build, "gm")
	if speciesID != "" && !gm.Has("species") && !contains(strs(to, "speciesIds"), speciesID) {
		named := speciesID
		if r.species != nil {
			named = str(r.species, "name")
		}
		r.problem(BuildProblem{Step: "ascension", Severity: "error", What: name + " is not open to " + named, Cite: p.cite(to)})
	}
	// The new Archetype is for a story reason, with the GM's agreement (§11.67).
	r.problem(BuildProblem{
		Step: "ascension", Severity: "gm", Path: path, What: "Archetype Ascension to " + name + ": the GM agrees",
		Cite: p.Cites.ArchetypeAscension,
	})
	// 0 XP of its own: what it costs is the Ascension slot it takes and the ratings bought to match. It is on the ledger
	// so the history can date it and ADVANCE says what the Ascension went on (§11.69).
	r.ledger = append(r.ledger, r.dated(LedgerRow{
		What: name + " (Archetype Ascension)", XP: 0, Cite: p.Cites.ArchetypeAscension, Step: "ascension", Pool: "advancement",
	}, Purchase{Kind: "ascension", ArchetypeID: str(to, "id")}))
	ao := origin{path: path, step: "ascension", cite: p.cite(to), tiersAscended: 1, granted: true}
	for _, k := range strs(to, "keywords") {
		r.addKeyword(k)
	}
	for _, rule := range r.ownRules(objs(to, "abilities")) {
		r.addRule(rule, ao)
	}
	for i, g := range objs(to, "grants") {
		r.grant(g, ao.at(ao.path+"/"+num(float64(i))), false)
	}
	for i, g := range objs(to, "wargear") {
		r.grant(g, ao.at(ao.path+"/wargear/"+num(float64(i))), false)
	}
	if truthy(get(to, "influence")) {
		r.s.mods["influence"] += number(to, "influence")
	}
	at := number(to, "tier")
	r.deferred = append(r.deferred, deferredReq{reqs: objs(to, "requires"), what: name, origin: ao, severity: "error", tier: &at})
	r.ascendedTo = to
}

// background: three rows, one bonus (Auspex ruling §11.22).
func (r *resolver) background() {
	p := r.p
	bg := sub(r.build, "background")
	if bg == nil {
		r.ask(PendingChoice{
			Path: "background", Step: "faction", What: "Choose a Background table", Choose: 1,
			Of: of("your faction's, species' or sub-faction's"), Cite: p.Cites.Background,
		})
		return
	}
	table := r.ix.backgrounds[str(bg, "tableId")]
	if table == nil {
		r.problem(BuildProblem{Step: "faction", Severity: "error", What: "Unknown background table " + str(bg, "tableId")})
		return
	}
	if !r.allowed(table, "faction") {
		return
	}
	to := origin{path: "background/" + str(table, "id"), step: "faction", cite: r.p.cite(table), granted: true}
	rowsOf := func(row string) []*schema.Obj { return objs(table, row) }
	find := func(row, name string) *schema.Obj {
		for _, x := range rowsOf(row) {
			if str(x, "name") == name {
				return x
			}
		}
		return nil
	}
	bonus := str(bg, "bonus")
	var chosen []string
	for _, row := range p.Vocabulary.BackgroundRows {
		if len(rowsOf(row)) == 0 {
			continue
		}
		name, named := get(bg, row).(string)
		named = named && name != ""
		var entry *schema.Obj
		if named {
			entry = find(row, name)
		}
		switch {
		case !named:
			article := ""
			if row == "origin" || row == "accomplishment" {
				article = "n"
			}
			var options []string
			for _, x := range rowsOf(row) {
				options = append(options, str(x, "name"))
			}
			r.ask(PendingChoice{
				Path: to.path + "/" + row, Step: "faction", What: "Choose a" + article + " " + capital(row), Choose: 1,
				Options: options, Cite: to.cite,
			})
		case entry == nil:
			r.problem(BuildProblem{
				Step: "faction", Severity: "error", What: str(table, "name") + " has no " + capital(row) + ` "` + name + `"`,
				Cite: to.cite,
			})
		default:
			chosen = append(chosen, capital(row)+" "+str(entry, "name"))
			if entry.Has("requires") {
				r.deferred = append(r.deferred, deferredReq{reqs: objs(entry, "requires"),
					what: capital(row) + " " + str(entry, "name"), origin: to, severity: "error"})
			}
			if bonus == row {
				switch b := str(entry, "bonus"); b {
				case "wealth":
					r.s.wealth += p.Background.BonusAmount
				case "corruption":
					r.s.corruption += p.Background.BonusAmount
				case "":
				default:
					r.s.mods[b] += p.Background.BonusAmount
				}
				for i, g := range objs(entry, "grants") {
					r.grant(g, to.at(to.path+"/"+row+"/"+num(float64(i))), false)
				}
			}
		}
	}
	if bonus == "" {
		r.ask(PendingChoice{
			Path: to.path + "/bonus", Step: "faction", What: "Choose which one Background bonus applies", Choose: 1,
			Options: slices.Clone(p.Vocabulary.BackgroundRows), Cite: p.Cites.BackgroundBonus,
		})
	}
	if len(chosen) > 0 {
		summary := strings.Join(chosen, "; ") + "."
		if bonus != "" {
			if b := find(bonus, str(bg, bonus)); b != nil && truthy(get(b, "bonus")) {
				summary += " Bonus: +" + num(p.Background.BonusAmount) + " " + r.bonusName(str(b, "bonus")) + " (" +
					capital(bonus) + ")."
			}
		}
		page := to.cite
		r.s.abilities = append(r.s.abilities, ability{"Background", &summary, &page})
	}
	r.deferred = append(r.deferred, deferredReq{reqs: ownerReqs(sub(table, "owner")), what: str(table, "name"), origin: to,
		severity: "error"})
}

func (r *resolver) bonusName(b string) string {
	for _, m := range r.p.Vocabulary.Mods {
		if m.Key == b {
			if m.Label != nil {
				return *m.Label
			}
			break
		}
	}
	return capital(b)
}

func (r *resolver) options() {
	p, tier := r.p, r.tier
	taken := map[string]int{}
	for i, pick := range objs(r.build, "options") {
		group := r.ix.optionGroups[str(pick, "groupId")]
		var opt *schema.Obj
		for _, x := range objs(group, "options") {
			if str(x, "name") == str(pick, "name") {
				opt = x
				break
			}
		}
		if group == nil || opt == nil {
			r.problem(BuildProblem{Step: "faction", Severity: "error",
				What: "Unknown option " + str(pick, "groupId") + ": " + str(pick, "name")})
			continue
		}
		if !r.allowed(group, "faction") {
			continue
		}
		id := str(group, "id")
		n := taken[id]
		taken[id] = n + 1
		go_ := origin{path: "option/" + id + "/" + num(float64(i)), step: "faction", cite: p.cite(group), granted: true}
		most := math.Inf(1)
		switch x := get(group, "pick").(type) {
		case float64:
			most = x
		case string:
			if x == "tier" {
				most = tier
			}
		}
		if float64(n+1) > most {
			r.problem(BuildProblem{Step: "faction", Severity: "error", What: str(group, "name") + ": at most " + num(most),
				Cite: go_.cite})
		}
		if boolean(opt, "notAtCreation") {
			r.problem(BuildProblem{Step: "faction", Severity: "error", What: str(opt, "name") + " can't be taken at creation",
				Cite: go_.cite})
		}
		xp := list(group, "xp")
		price, _ := xp[min(n, len(xp)-1)].(float64)
		r.ledger = append(r.ledger, LedgerRow{What: str(opt, "name") + " (" + str(group, "name") + ")", XP: Num(price),
			Cite: go_.cite, Step: "faction"})
		if !r.s.optionAccess[id] {
			r.deferred = append(r.deferred, deferredReq{reqs: ownerReqs(sub(group, "owner")), what: str(group, "name"),
				origin: go_, severity: "error"})
		}
		r.deferred = append(r.deferred, deferredReq{reqs: objs(opt, "requires"), what: str(opt, "name"), origin: go_,
			severity: "error"})
		r.addRule(opt, go_)
	}
}

// fills: what fills each [PLACEHOLDER], once every keyword is known.
func (r *resolver) fills() {
	p, ix, cat := r.p, r.ix, r.cat
	fills := sub(r.build, "fills")
	skipsGeneSeed := func() bool { return contains(r.s.keywords, p.Keywords.GeneSeedSkip) }
	for _, k := range slices.Clone(r.s.keywords) {
		if !strings.HasPrefix(k, p.Keywords.PlaceholderMarker) {
			continue
		}
		kw := ix.keywords[k]
		fill := sub(fills, k)
		fo := origin{path: "fill/" + norm(k), step: "faction", cite: p.Keywords.PlaceholderCite, granted: true}
		if kw != nil {
			fo.cite = p.cite(kw)
		}
		placeholder, hasPlaceholder := get(kw, "placeholder").(string)
		replace := func(to string) {
			// "Any 2 Keywords" are two different ones (§11.133); a repeat would be listed once.
			if k == p.Keywords.AnyTwo && contains(r.s.keywords, to) {
				r.problem(BuildProblem{Step: "faction", Severity: "error", What: k + " repeats " + to + ": the two Keywords differ",
					Cite: p.Cites.AdvancedCreation})
			}
			if !contains(r.filled, k) {
				r.filled = append(r.filled, k)
			}
			for i, x := range r.s.keywords {
				if x == k {
					r.s.keywords[i] = to
				}
			}
		}
		switch {
		case fill == nil:
			var names []string
			for _, x := range cat.Creation.SubFactions {
				if hasPlaceholder && str(x, "type") == placeholder && (cat.Homebrew || p.isOfficial(str(x, "source"))) {
					names = append(names, str(x, "name"))
				}
			}
			described := strings.Join(names, ", ")
			if boolean(kw, "writeIn") {
				described += ", or your own"
			}
			r.ask(PendingChoice{Path: fo.path, Step: "faction", What: "Choose your " + k, Choose: 1, Of: of(described),
				Cite: fo.cite})
		case fill.Has("writeIn"):
			if !boolean(kw, "writeIn") {
				r.problem(BuildProblem{Step: "faction", Severity: "gm", Path: fo.path,
					What: k + " can't be written in; choose one the books print", Cite: p.Cites.WriteInKeyword})
			}
			replace(str(fill, "writeIn"))
		default:
			sf := ix.subFactions[str(fill, "id")]
			if sf == nil || !hasPlaceholder || str(sf, "type") != placeholder {
				name := str(fill, "id")
				if sf != nil {
					name = str(sf, "name")
				}
				r.problem(BuildProblem{Step: "faction", Severity: "error", What: name + " doesn't fill " + k, Cite: fo.cite})
				continue
			}
			if !r.allowed(sf, "faction") {
				continue
			}
			replace(str(sf, "keyword"))
			r.s.subFactionIDs = append(append(r.s.subFactionIDs, str(sf, "id")), successors(sf, ix.subFactions)...)
			r.deferred = append(r.deferred, deferredReq{reqs: objs(sf, "requires"), what: str(sf, "name"), origin: fo,
				severity: "error"})
			so := fo.at("subfaction/" + str(sf, "id"))
			so.cite = p.cite(sf)
			var founder *schema.Obj
			if len(list(sf, "traits")) == 0 && sf.Has("successorOf") {
				founder = ix.subFactions[str(sf, "successorOf")]
			}
			traits := objs(sf, "traits")
			if founder != nil {
				traits = objs(founder, "traits")
			}
			for _, t := range r.ownRules(traits) {
				if boolean(t, "geneSeed") && skipsGeneSeed() && founder == nil {
					continue
				}
				o := so
				if founder != nil {
					o.cite = p.cite(founder)
				}
				r.addRule(t, o)
			}
		}
	}
}

// languages (Auspex ruling §11.48).
func (r *resolver) languages(skills map[string]float64) {
	p, ix := r.p, r.ix
	var qualifying []*schema.Obj
	for _, l := range r.cat.Creation.Languages {
		if slices.ContainsFunc(strs(l, "keywords"), func(k string) bool { return contains(r.s.keywords, k) }) {
			qualifying = append(qualifying, l)
		}
	}
	granted := 0.0 // summed apart and then added, as the TypeScript adds
	for _, g := range r.s.languageGrants {
		if g.skill != nil {
			granted += skills[*g.skill]
		} else {
			granted += g.n
		}
	}
	allowance := granted
	if len(qualifying) > 0 {
		allowance = p.Languages.FreeFromKeywords + granted
	}
	langs := sub(r.build, "languages")
	picks, bought := strs(langs, "picks"), strs(langs, "bought")
	if float64(len(picks)) > allowance {
		r.problem(BuildProblem{Step: "detail", Severity: "error",
			What: num(float64(len(picks))) + " free languages; you have " + num(allowance), Cite: p.Languages.Cite})
	}
	var names []string
	for _, l := range qualifying {
		names = append(names, str(l, "name"))
	}
	if len(qualifying) > 0 && len(picks) > 0 && !slices.ContainsFunc(picks, func(pick string) bool {
		return slices.ContainsFunc(qualifying, func(l *schema.Obj) bool { return str(l, "id") == pick })
	}) && len(r.s.languageGrants) == 0 {
		r.problem(BuildProblem{Step: "detail", Severity: "error",
			What: "Your free language comes from your Keywords: " + strings.Join(names, " or "), Cite: p.Languages.Cite})
	}
	if left := allowance - float64(len(picks)); left > 0 {
		described := strings.Join(names, ", ")
		if described == "" {
			described = "any language"
		}
		r.ask(PendingChoice{Path: "languages", Step: "detail", What: "Choose " + num(left) + " free language" + plural(left > 1),
			Choose: Num(left), Of: of(described), Cite: p.Languages.Cite})
	}
	learned := strs(sub(r.build, "advancement"), "languages")
	all := slices.Concat(picks, bought, learned)
	for _, l := range all {
		if ix.languages[l] == nil {
			r.problem(BuildProblem{Step: "detail", Severity: "gm", Path: "language/" + norm(l),
				What: "A language the table doesn't list: " + l, Cite: p.Cites.WriteInLanguage})
		}
	}
	nameOf := func(l string) string {
		if x := ix.languages[l]; x != nil {
			return str(x, "name")
		}
		return l
	}
	for _, l := range bought {
		r.ledger = append(r.ledger, LedgerRow{What: nameOf(l) + " (language)", XP: Num(p.Languages.Xp),
			Cite: p.Languages.Cite, Step: "detail"})
	}
	for _, l := range learned {
		r.ledger = append(r.ledger, r.dated(LedgerRow{What: nameOf(l) + " (language)", XP: Num(p.Languages.Xp),
			Cite: p.Languages.Cite, Step: "advance", Pool: "advancement"}, Purchase{Kind: "language", Name: l}))
	}
	var dupes []string
	for i, l := range all {
		if slices.Index(all, l) != i {
			dupes = append(dupes, l)
		}
	}
	if len(dupes) > 0 {
		r.problem(BuildProblem{Step: "detail", Severity: "error", What: strings.Join(dupes, ", ") + " taken twice"})
	}
}

// ctx is the character as it stands, for its requirements.
func (r *resolver) ctx() Ctx {
	p := r.p
	attributes, skills := r.ratings()
	keywords := map[string]bool{}
	for _, k := range slices.Concat(r.s.keywords, r.filled) {
		keywords[k] = true
	}
	var species []string
	if r.species != nil {
		species = append([]string{str(r.species, "id")}, strs(r.species, "countsAs")...)
	} else {
		species = []string{}
	}
	var archetypeID *string
	if a := r.ascendedTo; a != nil {
		archetypeID = of(str(a, "id"))
	} else if r.arch != nil {
		archetypeID = of(str(r.arch, "id"))
	}
	subFactions, talents := map[string]bool{}, map[string]bool{}
	for _, id := range r.s.subFactionIDs {
		subFactions[id] = true
	}
	categories := []string{}
	for _, t := range r.s.talents {
		talents[t.id] = true
		category := "talent"
		if rec := r.ix.talents[t.id]; rec != nil {
			category = str(rec, "category")
		}
		categories = append(categories, category)
	}
	powers := []Power{}
	for _, id := range r.s.powers {
		if pw := r.ix.powers[id]; pw != nil {
			powers = append(powers, Power{str(pw, "id"), str(pw, "disciplineId")})
		}
	}
	options := []Option{}
	for _, o := range objs(r.build, "options") {
		options = append(options, Option{str(o, "groupId"), str(o, "name")})
	}
	link := p.Links.Influence
	if r.s.influenceAttribute != "" {
		link = r.s.influenceAttribute
	}
	return Ctx{
		Params: p, Attributes: attributes, Skills: skills, Keywords: keywords, Species: species,
		ArchetypeID: archetypeID, SubFactionIDs: subFactions, Talents: talents, TalentCategories: categories,
		Powers: powers, Gear: r.s.gear, Wargear: r.cat.Wargear, Options: options,
		Influence: rated(attributes, link) - 1 + r.s.mods["influence"], Rank: r.rank, Tier: r.nowTier,
	}
}

// keywordOrder is a Set's order: [...s.keywords, ...filled] without repeats.
func keywordOrder(keywords, filled []string) []string {
	return dedupe(slices.Concat(keywords, filled))
}

// finish writes the sheet: what is spent, what is worn and carried, and the sheet through its schema.
func (r *resolver) finish(play *Play, budget float64, attributes, skills map[string]float64, final Ctx) (*ResolvedBuild, error) {
	p, ix, cat := r.p, r.ix, r.cat
	spent, advanceSpent := 0.0, 0.0
	for _, row := range r.ledger {
		if row.Pool == "" {
			spent += float64(row.XP)
		}
	}
	for _, row := range r.ledger {
		if row.Pool != "" {
			advanceSpent += float64(row.XP)
		}
	}
	earned := 0.0
	if play != nil {
		earned = play.XPEarned
	}
	if advanceSpent > earned {
		r.problem(BuildProblem{Step: "advance", Severity: "error",
			What: num(advanceSpent-earned) + " XP more than the " + num(earned) + " earned in play", Cite: p.Cites.AdvancementXp})
	}
	if spent > budget {
		r.problem(BuildProblem{Step: "customise", Severity: "error",
			What: num(spent-budget) + " XP over the budget of " + num(budget), Cite: p.StartingXp.Cite})
	}

	type held struct {
		g GearItem
		w *schema.Obj
	}
	items := make([]held, len(r.s.gear))
	for i, g := range r.s.gear {
		items[i].g = g
		if g.WargearID != "" {
			items[i].w = cat.Wargear[g.WargearID]
		}
	}
	// Worn armour: the best AR the character owns; only one suit counts at a time (the first of the best).
	worn := -1
	for i, x := range items {
		if a := sub(x.w, "armour"); a != nil && (worn < 0 || number(a, "ar") > number(sub(items[worn].w, "armour"), "ar")) {
			worn = i
		}
	}
	var armour *schema.Obj
	if worn >= 0 {
		x := items[worn]
		a := sub(x.w, "armour")
		armour = newObj("name", x.g.Name)
		for _, k := range a.Keys() {
			armour.Set(k, get(a, k))
		}
		// As printed, with the build's upgrade ids beside it: whoever shows the sheet applies them (§11.65).
		armour.Set("ar", number(a, "ar")+r.s.mods["armourRating"]).Set("wargearId", str(x.w, "id"))
		if len(x.g.Upgrades) > 0 {
			armour.Set("upgrades", anyList(x.g.Upgrades))
		}
	} else {
		armour = newObj("name", "", "ar", r.s.mods["armourRating"], "invulnerable", false, "powered", 0.0, "traits", []any{})
	}
	strength := attributes[p.Links.PoweredArmour] + number(armour, "powered")
	weapons := []any{}
	for _, w := range r.s.weapons {
		weapons = append(weapons, sheetWeapon(p, w.name, w.weapon, strength))
	}
	for _, x := range items {
		weapon := sub(x.w, "weapon")
		if weapon == nil {
			continue
		}
		// The profile is stored as printed, with the upgrade ids beside it; the reader applies them on the way out.
		w := sheetWeapon(p, x.g.Name, weapon, strength)
		if qty, isNum := x.g.Qty.(float64); isNum && qty > 1 {
			w.Set("count", qty)
		}
		w.Set("traits", append(slices.Clone(list(w, "traits")), anyList(x.g.TraitIDs)...)).Set("wargearId", str(x.w, "id"))
		if len(x.g.Upgrades) > 0 {
			w.Set("upgrades", anyList(x.g.Upgrades))
		}
		weapons = append(weapons, w)
	}
	// The weapon effects as the sheet keeps them: a Talent's chosen weapon becomes its name, a record's granted weapon
	// its catalogue ids. One whose weapon isn't there (the GM swapped it out) reaches nothing, so it isn't kept.
	var weaponEffects []any
	for _, e := range r.s.weaponEffects {
		fits := sub(e.effect, "fits")
		// ponytail: no sheet line for unarmed strikes, so an unarmed effect stays in its Talent's text; a line if one appears
		if fits.Has("unarmed") {
			continue
		}
		chosen := fits.Has("chosen")
		if chosen && e.choice == nil {
			continue
		}
		out := schema.NewObj()
		for _, k := range fits.Keys() {
			if k != "chosen" && k != "granted" && k != "unarmed" {
				out.Set(k, get(fits, k))
			}
		}
		if chosen {
			out.Set("names", []any{*e.choice})
		}
		if fits.Has("granted") {
			ids := []any{}
			for _, x := range items {
				if sub(x.w, "weapon") != nil && (x.g.From == e.path || strings.HasPrefix(x.g.From, e.path+"/")) {
					ids = append(ids, str(x.w, "id"))
				}
			}
			if len(ids) == 0 {
				continue
			}
			out.Set("wargearIds", ids)
		}
		effect := newObj("source", cut(e.source, 100))
		if e.cite != nil {
			effect.Set("cite", cut(*e.cite, 40))
		}
		weaponEffects = append(weaponEffects, effect.Set("fits", out).Set("mods", get(e.effect, "mods")))
	}
	gear := []any{}
	for i, x := range items {
		if sub(x.w, "weapon") != nil || i == worn {
			continue
		}
		qty := ""
		if q, isNum := x.g.Qty.(float64); !isNum || q != 1 {
			qty = " ×" + text(x.g.Qty)
		}
		line := x.g.Name + qty
		if x.w != nil {
			line = gearLine(p, x.w) + qty
		}
		gear = append(gear, line)
	}
	mods := schema.NewObj()
	for _, k := range p.vocab.modKeys {
		if v := r.s.mods[k]; truthy(v) {
			mods.Set(k, v)
		}
	}
	addMod := func(k string, v float64) { mods.Set(k, number(mods, k)+v) }
	if a := r.s.influenceAttribute; a != "" {
		addMod("influence", attributes[a]-attributes[p.Links.Influence])
	}
	if m := r.movement(armour); truthy(m) {
		addMod("speed", m)
	}
	gmMods := sub(sub(r.build, "gm"), "mods")
	for _, k := range gmMods.Keys() {
		if v := number(gmMods, k); truthy(v) {
			addMod(k, v)
		}
	}
	var powers []*schema.Obj
	for _, id := range r.s.powers {
		if pw := ix.powers[id]; pw != nil {
			powers = append(powers, pw)
		}
	}
	for _, pw := range powers {
		page := p.cite(pw)
		r.s.abilities = append(r.s.abilities, ability{str(pw, "name"), optStr(pw, "summary"), &page})
	}

	clip := func(a ability) *schema.Obj {
		o := newObj("name", cut(a.name, 100))
		if a.summary != nil {
			o.Set("summary", cut(*a.summary, 300))
		}
		if a.page != nil {
			o.Set("page", cut(*a.page, 40))
		}
		return o
	}
	abilities := []any{}
	for _, a := range r.s.abilities[:min(len(r.s.abilities), 30)] {
		abilities = append(abilities, clip(a))
	}
	var taken []ability
	for _, t := range r.s.talents {
		for _, c := range t.choices {
			name := t.name
			if c != nil {
				name = t.name + " (" + *c + ")"
			}
			page := t.page
			taken = append(taken, ability{name, t.summary, &page})
		}
	}
	talents := []any{}
	for _, t := range taken[:min(len(taken), 30)] {
		talents = append(talents, clip(t))
	}

	speciesName, speed := "", p.DefaultSpeed
	if r.species != nil {
		speciesName, speed = str(r.species, "name"), number(r.species, "speed")
	}
	archetype := "Advanced"
	if r.arch != nil {
		archetype = str(r.arch, "name")
	}
	sheetSkills := schema.NewObj()
	for _, k := range p.vocab.skills {
		if v, ok := skills[k]; ok && v > 0 {
			sheetSkills.Set(k, v)
		}
	}
	sheetAttributes := schema.NewObj()
	for _, a := range p.vocab.attributes {
		sheetAttributes.Set(a, attributes[a])
	}
	keywords := r.s.keywords[:min(len(r.s.keywords), 20)]
	input := newObj(
		"species", speciesName,
		"archetype", cut(strings.Join(append([]string{archetype}, r.packageNames...), " + "), 100),
		"keywords", anyList(keywords),
		"attributes", sheetAttributes,
		"skills", sheetSkills,
		"armour", armour,
		"speed", speed,
		"mods", mods,
		"abilities", abilities,
		"talents", talents,
		"weapons", weapons[:min(len(weapons), 20)],
	)
	lines := []any{}
	for _, g := range gear[:min(len(gear), 60)] {
		lines = append(lines, cut(g.(string), 200))
	}
	input.Set("gear", lines)
	if len(weaponEffects) > 0 {
		input.Set("weaponEffects", weaponEffects[:min(len(weaponEffects), 60)])
	}
	if len(powers) > 0 {
		var list []any
		for _, pw := range powers[:min(len(powers), 30)] {
			o := newObj("name", cut(str(pw, "name"), 100), "page", cut(p.cite(pw), 40))
			if dn, isNum := get(pw, "dn").(float64); isNum {
				o.Set("dn", dn)
			} else {
				o.Set("dn", cut(str(pw, "dn"), 60))
			}
			o.Set("activation", cut(str(pw, "activation"), 60)).Set("duration", cut(str(pw, "duration"), 60)).
				Set("range", cut(str(pw, "range"), 60))
			if s := optStr(pw, "summary"); s != nil {
				o.Set("summary", cut(*s, 300))
			}
			list = append(list, o)
		}
		input.Set("powers", list)
	}
	input.Set("wealth", r.s.wealth).Set("corruption", r.s.corruption)
	sheet, err := ParseRecord(p.schemas.CharacterStats, input)
	if err != nil {
		return nil, errors.New("ledger: the sheet is refused: " + err.Error())
	}

	var advancement *Advancement
	if play != nil {
		advancement = &Advancement{Num(earned), Num(advanceSpent), Num(r.rank), Num(r.nowTier)}
	}
	self := Self{ArchetypeID: final.ArchetypeID, Keywords: keywordOrder(r.s.keywords, r.filled)}
	if r.species != nil {
		self.Species = final.Species
	}
	var records []*schema.Obj
	for _, x := range slices.Concat(cat.Creation.Talents, cat.Creation.Packages) {
		if cat.Homebrew || p.isOfficial(str(x, "source")) {
			records = append(records, x)
		}
	}
	return &ResolvedBuild{
		Sheet: sheet, Budget: Num(budget), Spent: Num(spent), Ledger: r.ledger, Pending: r.pending, Choices: r.choices,
		Problems: r.problems, Effects: r.effects, Advancement: advancement,
		Who: Who{Species: self.Species, ArchetypeID: self.ArchetypeID, Keywords: self.Keywords,
			Buyable: buyableKeywords(records, self, p)},
	}, nil
}

// movement is the Speed an armour's "+N Pace" trait adds: Number of the first non-empty capture.
func (r *resolver) movement(armour *schema.Obj) float64 {
	for _, t := range strs(armour, "traits") {
		m := r.p.movement.FindStringSubmatchIndex(t)
		if m == nil || len(m) < 4 || m[2] < 0 || m[3] == m[2] {
			continue
		}
		return toNumber(t[m[2]:m[3]])
	}
	return 0
}
