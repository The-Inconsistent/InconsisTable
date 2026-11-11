package engine

import (
	"slices"
)

type faceRange struct{ from, to float64 }

func (r faceRange) has(face float64) bool { return face >= r.from && face <= r.to }

type poolBand struct {
	faceRange
	id    string
	worth float64
}

type poolParams struct {
	ties         string
	die          float64
	bands        []poolBand
	specialCount float64
	flags        map[string]faceRange
	shift        *string
}

var poolFlags = []string{"critical", "complication"}

func parseFaceRange(raw any) (faceRange, bool) {
	r, ok := readObject(raw)
	if !ok {
		return faceRange{}, false
	}
	out := faceRange{r.intIn("from", 1, MaxSides), r.intIn("to", 1, MaxSides)}
	return out, r.bad == ""
}

func parsePoolParams(raw any) (poolParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return poolParams{}, refuse("badParams", "not an object")
	}
	p := poolParams{
		ties:  r.enumOr("ties", tieRules, "meetOrBeat"),
		die:   r.intIn("die", 2, MaxSides),
		flags: map[string]faceRange{},
		shift: r.optID("shift"),
	}
	for _, item := range r.list("bands", 1, 10) {
		band, ok := readObject(item)
		face, inRange := parseFaceRange(item)
		if !ok || !inRange {
			r.fail("bands")
			continue
		}
		p.bands = append(p.bands, poolBand{face, band.id("id"), band.intIn("worth", 1, 10)})
		r.absorb("bands", band)
	}
	if r.has("special") {
		special := r.nested("special")
		p.specialCount = special.intIn("count", 1, 10)
		if special.has("flags") {
			flags := special.nested("flags")
			for _, flag := range poolFlags {
				if flags.has(flag) {
					face, ok := parseFaceRange(flags.fields[flag])
					if !ok {
						flags.fail(flag)
					}
					p.flags[flag] = face
				}
			}
			special.absorb("flags", flags)
		}
		r.absorb("special", special)
	}
	return p, r.refusal("badParams")
}

// A Dice pool as reported (the dice stay physical): how many ordinary dice showed each band, and each special die's face.
type poolInput struct {
	target, pool float64
	counts       map[string]float64
	special      []float64
}

func parsePoolInput(raw any) (poolInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return poolInput{}, refuse("badInput", "not an object")
	}
	in := poolInput{
		target: r.intIn("target", -maxSafeInteger, maxSafeInteger),
		pool:   r.intIn("pool", 0, MaxDice),
		counts: map[string]float64{},
	}
	roll := r.nested("roll")
	if roll.fields["kind"] != "pool" {
		roll.fail("kind")
	}
	if roll.has("counts") {
		counts := roll.nested("counts")
		for id, n := range counts.fields {
			if len(stringToUnits(id)) > 64 || !isIntIn(n, -maxSafeInteger, maxSafeInteger) {
				counts.fail(id)
				continue
			}
			in.counts[id] = n.(float64)
		}
		roll.absorb("counts", counts)
	}
	if roll.has("special") {
		in.special = roll.intList("special", 0, 10, -maxSafeInteger, maxSafeInteger)
	}
	r.absorb("roll", roll)
	return in, r.refusal("badInput")
}

func validatePool(p poolParams, _ *RuleState, in poolInput) *Refusal {
	// Sorted, so the band a refusal names does not depend on Go's map order. With two unknown bands TypeScript names the
	// first one written, which decoded JSON no longer knows. Only the message differs.
	ids := make([]string, 0, len(in.counts))
	for id := range in.counts {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		if !slices.ContainsFunc(p.bands, func(b poolBand) bool { return b.id == id }) {
			return refuse("badInput", `no scoring band "%s"`, id)
		}
	}
	counted := float64(len(in.special))
	for _, n := range in.counts {
		if n < 0 {
			return refuse("badInput", "a count can't be negative")
		}
		counted += n
	}
	if want := min(p.specialCount, in.pool); float64(len(in.special)) != want {
		return refuse("badInput", "expected %s special die face(s)", esNumber(want))
	}
	for _, face := range in.special {
		if face < 1 || face > p.die {
			return refuse("badInput", "a d%s rolls 1–%s", esNumber(p.die), esNumber(p.die))
		}
	}
	if counted > in.pool {
		return refuse("badInput", "%s dice counted, but the pool is %s", esNumber(counted), esNumber(in.pool))
	}
	return nil
}

func applyPool(p poolParams, _ *RuleState, in poolInput) []Delta {
	score, shiftable, worth := 0.0, 0.0, 0.0
	shiftFound := false
	for _, band := range p.bands {
		// A special die scores like every other die of the pool (docs/house-decisions.md #29).
		n := in.counts[band.id]
		for _, face := range in.special {
			if band.has(face) {
				n++
			}
		}
		score += n * band.worth
		if p.shift != nil && band.id == *p.shift {
			shiftable = n
			if !shiftFound {
				worth, shiftFound = band.worth, true
			}
		}
	}
	passes := func(s float64) bool {
		if p.ties == "meetOrBeat" {
			return s >= in.target
		}
		return s > in.target
	}
	shifts := 0.0
	for worth > 0 && shifts < shiftable && passes(score-(shifts+1)*worth) {
		shifts++
	}
	flags := []string{}
	for _, flag := range poolFlags {
		if r, ok := p.flags[flag]; ok && slices.ContainsFunc(in.special, r.has) {
			flags = append(flags, flag)
		}
	}
	outcome := "failure"
	if passes(score) {
		outcome = "success"
	}
	return []Delta{
		setTest("outcome", outcome),
		setTest("total", score),
		setTest("margin", score-in.target),
		setTest("shifts", shifts),
		setTest("flags", flags),
	}
}

var dicePoolSuccesses = definePrimitive(parsePoolParams, map[string]primitiveOp{
	"resolve": defineOp("test:call", parsePoolInput,
		func(poolParams) []TargetPattern {
			out := make([]TargetPattern, 0, 5)
			for _, key := range []string{"outcome", "total", "margin", "shifts", "flags"} {
				out = append(out, TargetPattern{"test", key})
			}
			return out
		},
		validatePool, applyPool),
})
