package engine

import (
	"fmt"
	"slices"
)

// SumVsTarget holds the params of the dice.sumVsTarget primitive that resolving reads.
//
// ponytail: this file trusts input already parsed the way zod's SumVsTarget and ResolveInput parse it, and Go has no such
// parser yet, so a raw decode resolves bad rolls; add one with refusal vectors before a handler decodes into these structs.
type SumVsTarget struct {
	Dice      string `json:"dice"`
	Ties      string `json:"ties"`
	CritOn    []int  `json:"critOn"`
	Advantage bool   `json:"advantage"`
}

// SumVsTargetRoll is reported, because the dice stay physical (docs/house-decisions.md #1): either the faces, which the
// engine sums, or the final total, with the natural roll when a crit needs to be read.
type SumVsTargetRoll struct {
	Kind    string `json:"kind"`
	Faces   []int  `json:"faces"`
	Total   int    `json:"total"`
	Natural *int   `json:"natural"`
}

// ResolveInput is the resolve op's input. Target is evaluated by the server, so a hidden DN never leaves it.
type ResolveInput struct {
	Target    int             `json:"target"`
	Modifier  int             `json:"modifier"`
	Advantage string          `json:"advantage"`
	Roll      SumVsTargetRoll `json:"roll"`
}

// Refusal says why an op does not apply.
type Refusal struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// TestTarget names a slot of the Test being resolved.
type TestTarget struct {
	Test string `json:"test"`
}

// Delta is one change an op makes.
type Delta struct {
	Target TestTarget `json:"target"`
	Kind   string     `json:"kind"`
	Value  any        `json:"value"`
}

// ValidateSumVsTarget returns nil when the reported roll fits the Test.
func ValidateSumVsTarget(params SumVsTarget, input ResolveInput) *Refusal {
	count, sides, ok := PlainDice(params.Dice)
	if !ok {
		return &Refusal{"badParams", fmt.Sprintf(`"%s" is not plain NdX dice`, params.Dice)}
	}
	if input.Advantage != "none" && !params.Advantage {
		return &Refusal{"badInput", "this Test has no advantage"}
	}
	// Advantage keeps the higher of two rolls of the single die, disadvantage the lower.
	want := 2
	if input.Advantage == "none" {
		want = count
	}
	if input.Roll.Kind == "faces" {
		if len(input.Roll.Faces) != want {
			return &Refusal{"badInput", fmt.Sprintf("expected %d face(s)", want)}
		}
		for _, f := range input.Roll.Faces {
			if f < 1 || f > sides {
				return &Refusal{"badInput", fmt.Sprintf("a d%d rolls 1–%d", sides, sides)}
			}
		}
		return nil
	}
	if input.Roll.Natural != nil {
		lo, hi := 1, sides
		if input.Advantage == "none" {
			lo, hi = count, count*sides
		}
		if *input.Roll.Natural < lo || *input.Roll.Natural > hi {
			return &Refusal{"badInput", fmt.Sprintf("natural must be %d–%d", lo, hi)}
		}
	}
	return nil
}

// ApplySumVsTarget resolves a roll that ValidateSumVsTarget accepted.
func ApplySumVsTarget(params SumVsTarget, input ResolveInput) []Delta {
	var natural *int
	var total int
	if input.Roll.Kind == "faces" {
		n := 0
		switch input.Advantage {
		case "advantage":
			n = slices.Max(input.Roll.Faces)
		case "disadvantage":
			n = slices.Min(input.Roll.Faces)
		default:
			for _, f := range input.Roll.Faces {
				n += f
			}
		}
		natural = &n
		total = n + input.Modifier
	} else {
		natural = input.Roll.Natural
		total = input.Roll.Total
	}
	beats := total > input.Target
	if params.Ties == "meetOrBeat" {
		beats = total >= input.Target
	}
	outcome := "failure"
	if natural != nil && slices.Contains(params.CritOn, *natural) {
		outcome = "critical"
	} else if beats {
		outcome = "success"
	}
	deltas := []Delta{
		{TestTarget{"outcome"}, "set", outcome},
		{TestTarget{"total"}, "set", total},
	}
	if natural != nil {
		deltas = append(deltas, Delta{TestTarget{"natural"}, "set", *natural})
	}
	return deltas
}
