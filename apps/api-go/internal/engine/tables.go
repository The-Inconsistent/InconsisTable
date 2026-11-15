package engine

import "fmt"

// Random tables (packages/rules-engine/src/manifest.ts, `tables`; house decision #49): rolled on a die the entries'
// ranges tile exactly, rolled by weight, or dealt without replacement.

type (
	// TableEntry is one line of a random table.
	TableEntry struct {
		ID     string `json:"id"`
		Label  string `json:"label"`
		Range  []int  `json:"range"`
		Weight *int   `json:"weight"`
		Count  *int   `json:"count"`
	}
	// RandomTable is a table of the manifest. Visibility is gm, party or owner.
	RandomTable struct {
		Title      string       `json:"title"`
		Die        *string      `json:"die"`
		Entries    []TableEntry `json:"entries"`
		Visibility string       `json:"visibility"`
		Cite       *string      `json:"cite"`
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

// A die's ranges tile its outcomes exactly: no gap, no overlap, nothing outside; no die means weights, no ranges.
func (p *problems) table(id string, t *RandomTable) {
	path := "tables." + id
	if len(t.Entries) == 0 {
		p.add(path+".entries", "a table needs an entry")
		return
	}
	p.duplicates(path+".entries", idsOf(t.Entries, func(e TableEntry) string { return e.ID }))
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
		lo, hi := e.Range[0], e.Range[1]
		switch {
		case hi < lo:
			p.add(at+".range", "to is below from")
		case lo < die.Min || hi > die.Max:
			p.add(at+".range", "outside the die (%d to %d)", die.Min, die.Max)
		default:
			clash := -1
			for v := lo; v <= hi; v++ {
				if !die.Has(v) {
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
	for v := die.Min; v <= die.Max; v++ {
		if _, taken := owner[v]; die.Has(v) && !taken {
			p.add(path+".entries", "no entry for %d", v)
			break
		}
	}
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
		for i, e := range t.Entries {
			if len(e.Range) == 2 && roll.Total >= e.Range[0] && roll.Total <= e.Range[1] {
				return i, roll.Total, nil
			}
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
