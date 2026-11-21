package engine

import (
	"fmt"
	"math"
)

// Random tables (packages/rules-engine/src/manifest.ts, `tables`; house decision #49): rolled on a die the entries'
// ranges tile exactly, rolled by weight, or dealt without replacement. A table with a die may be a lookup (house
// decision #87): a typed result, inputs and a modifier read one line, whose effects apply to a target.

// The most effects a line applies, inputs a lookup takes, and times one effect repeats (manifest.ts MAX_ROW_EFFECTS,
// MAX_LOOKUP_INPUTS, MAX_EFFECT_TIMES).
const (
	MaxRowEffects   = 8
	MaxLookupInputs = 6
	MaxEffectTimes  = 20
)

type (
	// TableEffect is one effect of a lookup line on its target: a hit (Wounds, Shock), a Condition, a Resource of the
	// target or a shared Pool changed By. When and Times read the inputs and the target.
	TableEffect struct {
		Kind      string  `json:"kind"`
		When      *string `json:"when"`
		Times     *string `json:"times"`
		Wounds    *string `json:"wounds"`
		Shock     *string `json:"shock"`
		Condition string  `json:"condition"`
		Resource  string  `json:"resource"`
		Pool      string  `json:"pool"`
		Held      string  `json:"held"`
		Entry     string  `json:"entry"`
		By        *string `json:"by"`
	}
	// TableInput is a value the GM sets before applying a lookup, read as ctx.<id>: bool or int.
	TableInput struct {
		ID    string  `json:"id"`
		Label string  `json:"label"`
		Type  string  `json:"type"`
		Min   *int    `json:"min"`
		Max   *int    `json:"max"`
		Cite  *string `json:"cite"`
	}
	// TableEntry is one line of a random table. A Range of one number is the open-ended last line.
	TableEntry struct {
		ID     string        `json:"id"`
		Label  string        `json:"label"`
		Range  []int         `json:"range"`
		Weight *int          `json:"weight"`
		Count  *int          `json:"count"`
		Apply  []TableEffect `json:"apply"`
		Note   *string       `json:"note"`
		Cite   *string       `json:"cite"`
		Next   *string       `json:"next"`
	}
	// RandomTable is a table of the manifest. Visibility is gm, party or owner.
	RandomTable struct {
		Title      string       `json:"title"`
		Die        *string      `json:"die"`
		Entries    []TableEntry `json:"entries"`
		Visibility string       `json:"visibility"`
		Cite       *string      `json:"cite"`
		TypedOnly  *bool        `json:"typedOnly"`
		Inputs     []TableInput `json:"inputs"`
		Modifier   *string      `json:"modifier"`
		Entities   *[]string    `json:"entities"`
	}
	// TableOutcomes is what a table die can roll.
	TableOutcomes struct {
		Min, Max int
		d66      bool
	}
)

// MaxTableOutcomes is core manifest.ts's MAX_TABLE_OUTCOMES: the tiling check walks each outcome of a die.
const MaxTableOutcomes = 10_000

// Has says whether the die can roll v.
func (o TableOutcomes) Has(v int) bool {
	if v < o.Min || v > o.Max {
		return false
	}
	return o.Shaped(v)
}

// Shaped says whether v looks like a roll of the die, whatever its size: a d66 number ends in 1 to 6.
func (o TableOutcomes) Shaped(v int) bool {
	return !o.d66 || (v%10 >= 1 && v%10 <= 6)
}

// TableDie is what a table die can roll: plain NdX (the sum, count..count*X) or a single d66 (11-66). False for anything
// else, or a die with more than MaxTableOutcomes outcomes.
func TableDie(notation string) (TableOutcomes, bool) {
	expr, err := ParseDice(notation)
	if err != nil || len(expr.Terms) != 1 {
		return TableOutcomes{}, false
	}
	t := expr.Terms[0]
	if t.IsConst || t.Die.Fudge || t.Keep != nil || t.Explode || t.SuccessAt != nil || t.Sign != 1 {
		return TableOutcomes{}, false
	}
	if t.Die.D66 {
		return TableOutcomes{Min: 11, Max: 66, d66: true}, t.Count == 1
	}
	out := TableOutcomes{Min: t.Count, Max: t.Count * t.Die.Sides}
	return out, out.Max-out.Min+1 <= MaxTableOutcomes
}

// IsLookup says whether a table declares anything of a lookup (manifest.ts isLookup).
func (t *RandomTable) IsLookup() bool {
	if t.TypedOnly != nil || t.Inputs != nil || t.Modifier != nil || t.Entities != nil {
		return true
	}
	for _, e := range t.Entries {
		if e.Apply != nil || e.Next != nil {
			return true
		}
	}
	return false
}

// ImportProblems is what an import refuses beyond what compiles: a table with no entry, which only a seat's copy of a
// table it may not read has (house decision #101; manifest.ts importProblems). Run on a ruleset that compiled.
func ImportProblems(r *Ruleset) []Problem {
	var out []Problem
	for _, id := range sortedKeys(r.Tables) {
		if len(r.Tables[id].Entries) == 0 {
			out = append(out, Problem{Path: "tables." + id + ".entries", Message: "a table needs an entry"})
		}
	}
	return out
}

// A die's ranges tile its outcomes exactly: no gap, no overlap, nothing outside; no die means weights, no ranges. The
// last line may be open-ended, and a table with a modifier may have lines above the die, shaped like it.
func (p *problems) table(r *Ruleset, id string, t *RandomTable) {
	path := "tables." + id
	// A seat's copy of a table it may not read has no entry and still compiles (house decision #101); an import refuses
	// one (ImportProblems).
	if len(t.Entries) == 0 {
		return
	}
	p.duplicates(path+".entries", idsOf(t.Entries, func(e TableEntry) string { return e.ID }))
	p.lookup(r, id, t)
	if t.Die == nil {
		for i, e := range t.Entries {
			if e.Range != nil {
				p.add(fmt.Sprintf("%s.entries[%d].range", path, i), "a table without a die has no ranges")
			}
		}
		return
	}
	die, ok := TableDie(*t.Die)
	if !ok {
		p.add(path+".die", "a table die is plain NdX or d66, with at most 10000 outcomes")
		return
	}
	above := t.Modifier != nil // lines past the die are reached only by a modified total
	last := len(t.Entries) - 1
	top := die.Max
	if above {
		for _, e := range t.Entries {
			if len(e.Range) > 0 {
				top = max(top, e.Range[len(e.Range)-1])
			}
		}
	}
	counts := func(v int) bool { return v >= die.Min && v <= top && die.Shaped(v) }
	owner := map[int]int{} // outcome -> the first entry that has it
	for i, e := range t.Entries {
		at := fmt.Sprintf("%s.entries[%d]", path, i)
		if e.Weight != nil {
			p.add(at+".weight", "a table with a die has no weights")
		}
		if e.Range == nil {
			p.add(at+".range", "an entry of a table with a die needs a range")
			continue
		}
		lo := e.Range[0]
		if len(e.Range) == 1 && i != last {
			p.add(at+".range", "only the last entry may leave its upper bound out")
			continue
		}
		hi := top
		if len(e.Range) == 2 {
			hi = e.Range[1]
		}
		switch {
		case hi < lo:
			p.add(at+".range", "to is below from")
		case lo < die.Min || (!above && hi > die.Max):
			p.add(at+".range", "outside the die (%d to %d)", die.Min, die.Max)
		default:
			clash := -1
			for v := lo; v <= hi; v++ {
				if !counts(v) {
					continue
				}
				if prev, taken := owner[v]; !taken {
					owner[v] = i
				} else if clash < 0 {
					clash = prev
				}
			}
			if clash >= 0 {
				p.add(at+".range", "overlaps entries[%d]", clash)
			}
		}
	}
	for v := die.Min; v <= top; v++ {
		if _, taken := owner[v]; counts(v) && !taken {
			p.add(path+".entries", "no entry for %d", v)
			break
		}
	}
}

// A lookup's parts name what the ruleset has, and only a rolled table with a die is one (manifest.ts lookupProblems).
func (p *problems) lookup(r *Ruleset, id string, t *RandomTable) {
	path := "tables." + id
	if !t.IsLookup() {
		return
	}
	if t.Die == nil {
		p.add(path+".die", "a lookup needs a die")
	}
	if t.Visibility == "owner" {
		p.add(path+".visibility", "a dealt table is not a lookup")
	}
	p.duplicates(path+".inputs", idsOf(t.Inputs, func(x TableInput) string { return x.ID }))
	for i, x := range t.Inputs {
		at := fmt.Sprintf("%s.inputs[%d]", path, i)
		if x.Type == "bool" && (x.Min != nil || x.Max != nil) {
			p.add(at, "a switch has no bounds")
		}
		if x.Min != nil && x.Max != nil && *x.Max < *x.Min {
			p.add(at+".max", "max is below min")
		}
	}
	actors := map[string]bool{}
	for _, e := range r.Entities {
		if e.Base == "actor" {
			actors[e.ID] = true
		}
	}
	if t.Entities != nil {
		for i, e := range *t.Entities {
			if !actors[e] {
				p.add(fmt.Sprintf("%s.entities[%d]", path, i), `unknown actor type "%s"`, e)
			}
		}
	}
	harm := r.Health.Harm
	hitOnly := map[string]bool{}
	for _, x := range r.Health.Tracks {
		hitOnly[x.Resource] = true
	}
	if harm != nil {
		hitOnly[harm.Wounds] = true
		if harm.Shock != nil {
			hitOnly[*harm.Shock] = true
		}
		if harm.Mob != nil {
			hitOnly[harm.Mob.Members] = true
		}
	}
	for i, e := range t.Entries {
		at := fmt.Sprintf("%s.entries[%d]", path, i)
		if e.Next != nil {
			if _, known := r.Tables[*e.Next]; !known {
				p.add(at+".next", `unknown table "%s"`, *e.Next)
			}
		}
		for j, x := range e.Apply {
			where := fmt.Sprintf("%s.apply[%d]", at, j)
			switch x.Kind {
			case "harm":
				if harm == nil {
					p.add(where, "a hit needs health.harm")
				}
				if x.Wounds == nil && x.Shock == nil {
					p.add(where, "a hit takes wounds or shock")
				}
				if x.Shock != nil && harm != nil && harm.Shock == nil {
					p.add(where+".shock", "this ruleset has no shock")
				}
			case "condition":
				if !hasCondition(r, x.Condition) {
					p.add(where+".condition", `unknown condition "%s"`, x.Condition)
				}
			case "resource":
				res := resourceByID(r, x.Resource)
				if res == nil || res.Scope != "entity" {
					p.add(where+".resource", `"%s" is not a resource an actor carries`, x.Resource)
				} else if hitOnly[x.Resource] {
					p.add(where+".resource", `only a hit moves "%s"`, x.Resource)
				}
			case "pool":
				if res := resourceByID(r, x.Pool); res == nil || res.Scope == "entity" {
					p.add(where+".pool", `"%s" is not a shared pool`, x.Pool)
				}
			default:
				if _, known := r.Held[x.Held]; !known {
					p.add(where+".held", `unknown held kind "%s"`, x.Held)
				}
			}
		}
	}
}

func hasCondition(r *Ruleset, id string) bool {
	for _, c := range r.Conditions {
		if c.ID == id {
			return true
		}
	}
	return false
}

func resourceByID(r *Ruleset, id string) *Resource {
	for i := range r.Resources {
		if r.Resources[i].ID == id {
			return &r.Resources[i]
		}
	}
	return nil
}

// RowOf is the line a total reads (lookups.ts rowOf): the one whose range holds it, else the one with the highest start
// at or below it, else the lowest; -1 for a table without ranged lines.
func RowOf(entries []TableEntry, total int) int {
	start := func(i int) int { return entries[i].Range[0] }
	holds, below, lowest := -1, -1, -1
	for i, e := range entries {
		if len(e.Range) == 0 {
			continue
		}
		lo, hi := e.Range[0], math.MaxInt
		if len(e.Range) == 2 {
			hi = e.Range[1]
		}
		if holds < 0 && total >= lo && total <= hi {
			holds = i
		}
		if lo <= total && (below < 0 || lo > start(below)) {
			below = i
		}
		if lowest < 0 || lo < start(lowest) {
			lowest = i
		}
	}
	switch {
	case holds >= 0:
		return holds
	case below >= 0:
		return below
	}
	return lowest
}

// Roll draws one entry: the die's sum or, without a die, a weighted draw. It returns the entry's index and the value
// rolled (the weighted draw is 1..total weight). A nil rng is CryptoRng.
func (t *RandomTable) Roll(rng Rng) (index, value int, err error) {
	if rng == nil {
		rng = CryptoRng
	}
	if t.Die != nil {
		roll, err := RollDice(*t.Die, rng)
		if err != nil {
			return 0, 0, err
		}
		if i := RowOf(t.Entries, roll.Total); i >= 0 {
			return i, roll.Total, nil
		}
		return 0, 0, fmt.Errorf("no entry for %d", roll.Total) // the validator tiled the die, so this is a bug
	}
	total := 0
	for _, e := range t.Entries {
		total += e.WeightOrOne()
	}
	value = rng(total)
	left := value
	for i, e := range t.Entries {
		left -= e.WeightOrOne()
		if left <= 0 {
			return i, value, nil
		}
	}
	return 0, 0, fmt.Errorf("draw %d is past the weights", value)
}

// WeightOrOne is the entry's weight, 1 when it declares none.
func (e TableEntry) WeightOrOne() int {
	if e.Weight == nil {
		return 1
	}
	return *e.Weight
}

// Copies is how many of the entry a deck holds, 1 when it declares none.
func (e TableEntry) Copies() int {
	if e.Count == nil {
		return 1
	}
	return *e.Count
}
