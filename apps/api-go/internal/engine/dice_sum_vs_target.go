package engine

import "slices"

var (
	tieRules       = []string{"meetOrBeat", "beat"}
	advantageModes = []string{"none", "advantage", "disadvantage"}
)

type sumVsTargetParams struct {
	dice      string
	ties      string
	critOn    []float64
	advantage bool
	degrees   *degreesParams
}

type degreesParams struct {
	step         float64
	naturalShift bool
}

func parseSumVsTargetParams(raw any) (sumVsTargetParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return sumVsTargetParams{}, refuse("badParams", "not an object")
	}
	p := sumVsTargetParams{
		dice:      r.str("dice"),
		ties:      r.enumOr("ties", tieRules, "meetOrBeat"),
		advantage: r.boolOr("advantage", false),
	}
	if r.has("critOn") {
		p.critOn = r.intList("critOn", 0, 20, 1, maxSafeInteger)
	}
	if r.has("degrees") {
		d := r.nested("degrees")
		p.degrees = &degreesParams{step: d.intIn("step", 1, 20), naturalShift: d.boolOr("naturalShift", false)}
		r.absorb("degrees", d)
	}
	return p, r.refusal("badParams")
}

// The roll is reported, because the dice stay physical (docs/house-decisions.md #1): either the faces, which the
// engine sums, or the final total, with the natural roll when a crit needs to be read.
type sumVsTargetInput struct {
	target, modifier float64
	advantage        string
	isFaces          bool
	faces            []float64
	total            float64
	natural          *float64
}

func parseSumVsTargetInput(raw any) (sumVsTargetInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return sumVsTargetInput{}, refuse("badInput", "not an object")
	}
	in := sumVsTargetInput{
		target:    r.intIn("target", -maxSafeInteger, maxSafeInteger),
		modifier:  r.intOr("modifier", -maxSafeInteger, maxSafeInteger, 0),
		advantage: r.enumOr("advantage", advantageModes, "none"),
	}
	roll := r.nested("roll")
	switch roll.fields["kind"] {
	case "faces":
		in.isFaces = true
		in.faces = roll.intList("faces", 1, 100, -maxSafeInteger, maxSafeInteger)
	case "total":
		in.total = roll.intIn("total", -maxSafeInteger, maxSafeInteger)
		in.natural = roll.optInt("natural", -maxSafeInteger, maxSafeInteger)
	default:
		roll.fail("kind")
	}
	r.absorb("roll", roll)
	return in, r.refusal("badInput")
}

func validateSumVsTarget(p sumVsTargetParams, _ *RuleState, in sumVsTargetInput) *Refusal {
	count, sides, ok := PlainDice(p.dice)
	if !ok {
		return refuse("badParams", `"%s" is not plain NdX dice`, p.dice)
	}
	if in.advantage != "none" && !p.advantage {
		return refuse("badInput", "this Test has no advantage")
	}
	// Advantage keeps the higher of two rolls of the single die, disadvantage the lower.
	want := 2
	if in.advantage == "none" {
		want = count
	}
	if in.isFaces {
		if len(in.faces) != want {
			return refuse("badInput", "expected %d face(s)", want)
		}
		for _, f := range in.faces {
			if f < 1 || f > float64(sides) {
				return refuse("badInput", "a d%d rolls 1–%d", sides, sides)
			}
		}
		return nil
	}
	if in.natural != nil {
		lo, hi := 1, sides
		if in.advantage == "none" {
			lo, hi = count, count*sides
		}
		if *in.natural < float64(lo) || *in.natural > float64(hi) {
			return refuse("badInput", "natural must be %d–%d", lo, hi)
		}
	}
	return nil
}

func applySumVsTarget(p sumVsTargetParams, _ *RuleState, in sumVsTargetInput) []Delta {
	var natural *float64
	total := in.total
	if in.isFaces {
		n := 0.0
		switch in.advantage {
		case "advantage":
			n = slices.Max(in.faces)
		case "disadvantage":
			n = slices.Min(in.faces)
		default:
			for _, f := range in.faces {
				n += f
			}
		}
		natural = &n
		total = n + in.modifier
	} else {
		natural = in.natural
	}
	beats := total > in.target
	if p.ties == "meetOrBeat" {
		beats = total >= in.target
	}
	outcome := "failure"
	if p.degrees != nil {
		outcome = degreeOf(p, in.target, natural, total, beats)
	} else if natural != nil && slices.Contains(p.critOn, *natural) {
		outcome = "critical"
	} else if beats {
		outcome = "success"
	}
	deltas := []Delta{setTest("outcome", outcome), setTest("total", total)}
	if natural != nil {
		deltas = append(deltas, setTest("natural", *natural))
	}
	return deltas
}

var degreeLevels = []string{"criticalFailure", "failure", "success", "criticalSuccess"}

// degreeOf is house decision #42 (dice-sum-vs-target.ts degreeOf): a step past the target is a level up, a step short a
// level down; a natural top or bottom face of the single die then moves one more, never past the ends.
func degreeOf(p sumVsTargetParams, target float64, natural *float64, total float64, beats bool) string {
	level := 1
	if beats {
		level = 2
	}
	if total >= target+p.degrees.step {
		level = 3
	} else if total <= target-p.degrees.step {
		level = 0
	}
	if _, sides, _ := PlainDice(p.dice); p.degrees.naturalShift && natural != nil {
		if *natural == float64(sides) {
			level++
		} else if *natural == 1 {
			level--
		}
	}
	return degreeLevels[min(3, max(0, level))]
}

var diceSumVsTarget = definePrimitive(parseSumVsTargetParams, map[string]primitiveOp{
	"resolve": defineOp("test:call", parseSumVsTargetInput,
		func(sumVsTargetParams) []TargetPattern {
			return []TargetPattern{{"test", "outcome"}, {"test", "total"}, {"test", "natural"}}
		},
		validateSumVsTarget, applySumVsTarget),
})
