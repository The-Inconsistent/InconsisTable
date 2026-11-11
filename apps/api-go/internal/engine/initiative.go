package engine

import (
	"cmp"
	"slices"
)

func parseOrderID(raw any) (string, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return "", refuse("badInput", "not an object")
	}
	id := r.str("id")
	return id, r.refusal("badInput")
}

func validateInOrder(state *RuleState, none, id string) *Refusal {
	if state.Turn == nil {
		return refuse("noEncounter", "%s", none)
	}
	if !slices.Contains(state.Turn.Order, id) {
		return refuse("badInput", `"%s" is not in the order`, id)
	}
	return nil
}

func without(order []string, id string) []string {
	out := make([]string, 0, len(order))
	for _, other := range order {
		if other != id {
			out = append(out, other)
		}
	}
	return out
}

type rankedParams struct {
	tiebreaks       int
	rerollEachRound bool
}

func parseRankedParams(raw any) (rankedParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return rankedParams{}, refuse("badParams", "not an object")
	}
	p := rankedParams{rerollEachRound: r.boolOr("rerollEachRound", false)}
	if r.has("tiebreak") {
		p.tiebreaks = len(r.list("tiebreak", 0, 5))
	}
	return p, r.refusal("badParams")
}

type rankedCombatant struct {
	id        string
	score     float64
	tiebreaks []float64
}

type rankedStart struct {
	combatants []rankedCombatant
	round      float64
}

func parseRankedStart(raw any) (rankedStart, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return rankedStart{}, refuse("badInput", "not an object")
	}
	in := rankedStart{round: r.intOr("round", 1, maxSafeInteger, 1)}
	for _, item := range r.list("combatants", 1, 200) {
		c, ok := readObject(item)
		if !ok {
			r.fail("combatants")
			continue
		}
		combatant := rankedCombatant{id: c.str("id"), score: c.intIn("score", -maxSafeInteger, maxSafeInteger)}
		if c.has("tiebreaks") {
			combatant.tiebreaks = c.intList("tiebreaks", 0, 5, -maxSafeInteger, maxSafeInteger)
		}
		r.absorb("combatants", c)
		in.combatants = append(in.combatants, combatant)
	}
	return in, r.refusal("badInput")
}

// Highest score first, then each tiebreak highest first. A tie left after that is broken by id, so every server and
// phone gets the same order.
func rankOrder(combatants []rankedCombatant) []string {
	sorted := slices.Clone(combatants)
	slices.SortStableFunc(sorted, func(a, b rankedCombatant) int {
		if a.score != b.score {
			return cmp.Compare(b.score, a.score)
		}
		for i := range max(len(a.tiebreaks), len(b.tiebreaks)) {
			var x, y float64
			if i < len(a.tiebreaks) {
				x = a.tiebreaks[i]
			}
			if i < len(b.tiebreaks) {
				y = b.tiebreaks[i]
			}
			if x != y {
				return cmp.Compare(y, x)
			}
		}
		return compareUnits(a.id, b.id)
	})
	out := make([]string, len(sorted))
	for i, c := range sorted {
		out[i] = c.id
	}
	return out
}

func rankedTargets(rankedParams) []TargetPattern {
	return []TargetPattern{{"turn", "round"}, {"turn", "order"}, {"turn", "currentId"}}
}

const noRankedOrder = "no initiative order is running"

// The deltas that start the next round: same order, or an empty one to re-rank when the manifest rerolls.
func rankedWrap(p rankedParams, round float64, order []string) []Delta {
	deltas := []Delta{setTurn("round", round+1)}
	if p.rerollEachRound || len(order) == 0 {
		return append(deltas, setTurn("order", []string{}), setTurn("currentId", nil))
	}
	return append(deltas, setTurn("currentId", order[0]))
}

var initiativeRanked = definePrimitive(parseRankedParams, map[string]primitiveOp{
	"start": defineOp("encounter:run", parseRankedStart, rankedTargets,
		func(p rankedParams, _ *RuleState, in rankedStart) *Refusal {
			seen := map[string]bool{}
			for _, c := range in.combatants {
				seen[c.id] = true
			}
			if len(seen) != len(in.combatants) {
				return refuse("badInput", "a combatant is listed twice")
			}
			for _, c := range in.combatants {
				if len(c.tiebreaks) != p.tiebreaks {
					return refuse("badInput", "each combatant needs %d tiebreak value(s)", p.tiebreaks)
				}
			}
			return nil
		},
		func(_ rankedParams, _ *RuleState, in rankedStart) []Delta {
			order := rankOrder(in.combatants)
			return []Delta{
				setTurn("order", order),
				setTurn("round", in.round),
				setTurn("currentId", optional(firstID(order))),
			}
		}),
	"next": defineOp("encounter:run", parseEmpty("badInput"), rankedTargets,
		func(_ rankedParams, state *RuleState, _ struct{}) *Refusal {
			if state.Turn == nil {
				return refuse("noEncounter", noRankedOrder)
			}
			if len(state.Turn.Order) == 0 {
				return refuse("wrongState", "the order is empty: start the round first")
			}
			return nil
		},
		func(p rankedParams, state *RuleState, _ struct{}) []Delta {
			t := state.Turn
			at := -1
			if t.CurrentID != nil {
				at = slices.Index(t.Order, *t.CurrentID)
			}
			// Nobody acting yet (a fresh re-rank) or a stale id: the round starts at the top.
			if at < 0 {
				return []Delta{setTurn("currentId", t.Order[0])}
			}
			if at+1 < len(t.Order) {
				return []Delta{setTurn("currentId", t.Order[at+1])}
			}
			return rankedWrap(p, t.Round, t.Order)
		}),
	"remove": defineOp("encounter:run", parseOrderID, rankedTargets,
		func(_ rankedParams, state *RuleState, id string) *Refusal {
			return validateInOrder(state, noRankedOrder, id)
		},
		func(p rankedParams, state *RuleState, id string) []Delta {
			t := state.Turn
			left := without(t.Order, id)
			deltas := []Delta{setTurn("order", left)}
			if t.CurrentID == nil || id != *t.CurrentID {
				return deltas
			}
			// The one acting left: the turn passes to whoever came after them, or the round ends.
			if at := slices.Index(t.Order, id); at+1 < len(t.Order) {
				return append(deltas, setTurn("currentId", t.Order[at+1]))
			}
			if len(left) == 0 {
				return append(deltas, setTurn("currentId", nil))
			}
			// A re-ranking wrap clears the order itself; otherwise the trimmed order carries into the next round.
			if p.rerollEachRound {
				return rankedWrap(p, t.Round, left)
			}
			return append(deltas, rankedWrap(p, t.Round, left)...)
		}),
})

// House decision #36: the order is the seat order, kept as given; only the first player of each round moves.
type seatedParams struct{ firstPlayer string }

func parseSeatedParams(raw any) (seatedParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return seatedParams{}, refuse("badParams", "not an object")
	}
	p := seatedParams{r.enum("firstPlayer", []string{"fixed", "rotate", "manual"})}
	return p, r.refusal("badParams")
}

func parseSeatedStart(raw any) ([]string, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return nil, refuse("badInput", "not an object")
	}
	var ids []string
	for _, item := range r.list("ids", 1, 200) {
		id, ok := item.(string)
		if !ok || id == "" {
			r.fail("ids")
		}
		ids = append(ids, id)
	}
	return ids, r.refusal("badInput")
}

func seatedTargets(seatedParams) []TargetPattern {
	return []TargetPattern{{"turn", "round"}, {"turn", "order"}, {"turn", "currentId"}, {"turn", "firstId"}}
}

const noSeatOrder = "no seat order is running"

// FirstOf is where the round starts: firstId if it sits in the order, else the top seat (initiative-seated.ts firstOf).
func FirstOf(order []string, first *string) *string {
	if first != nil && slices.Contains(order, *first) {
		return first
	}
	return firstID(order)
}

// Sequence is the order read round the table from the first player (initiative-seated.ts sequence).
func Sequence(order []string, first *string) []string {
	at := -1
	if lead := FirstOf(order, first); lead != nil {
		at = slices.Index(order, *lead)
	}
	if at <= 0 {
		return slices.Clone(order)
	}
	return append(slices.Clone(order[at:]), order[:at]...)
}

// The seat after id along the order, wrapping. An id not in the order reads as before the top seat.
func seatAfter(order []string, id string) *string {
	if len(order) == 0 {
		return nil
	}
	return &order[(slices.Index(order, id)+1)%len(order)]
}

// NextFirst is who leads the round after first: `rotate` moves one place along the order (initiative-seated.ts
// nextFirst).
func NextFirst(firstPlayer string, order []string, first *string) *string {
	if firstPlayer == "rotate" && first != nil {
		return seatAfter(order, *first)
	}
	return first
}

func seatedWrap(p seatedParams, round float64, order []string, first *string) []Delta {
	lead := NextFirst(p.firstPlayer, order, first)
	return []Delta{setTurn("round", round+1), setTurn("firstId", optional(lead)), setTurn("currentId", optional(lead))}
}

var initiativeSeated = definePrimitive(parseSeatedParams, map[string]primitiveOp{
	"start": defineOp("encounter:run", parseSeatedStart, seatedTargets,
		func(_ seatedParams, _ *RuleState, ids []string) *Refusal {
			seen := map[string]bool{}
			for _, id := range ids {
				seen[id] = true
			}
			if len(seen) != len(ids) {
				return refuse("badInput", "a seat is listed twice")
			}
			return nil
		},
		func(_ seatedParams, _ *RuleState, ids []string) []Delta {
			return []Delta{
				setTurn("order", ids), setTurn("round", 1.0), setTurn("firstId", ids[0]), setTurn("currentId", ids[0]),
			}
		}),
	"next": defineOp("encounter:run", parseEmpty("badInput"), seatedTargets,
		func(_ seatedParams, state *RuleState, _ struct{}) *Refusal {
			if state.Turn == nil {
				return refuse("noEncounter", noSeatOrder)
			}
			if len(state.Turn.Order) == 0 {
				return refuse("wrongState", "the order is empty: start the game first")
			}
			return nil
		},
		func(p seatedParams, state *RuleState, _ struct{}) []Delta {
			t := state.Turn
			seq := Sequence(t.Order, t.FirstID)
			at := -1
			if t.CurrentID != nil {
				at = slices.Index(seq, *t.CurrentID)
			}
			// Nobody acting yet or a stale id: the round starts at the first player.
			if at < 0 {
				var deltas []Delta
				if !sameID(&seq[0], t.FirstID) {
					deltas = append(deltas, setTurn("firstId", seq[0]))
				}
				return append(deltas, setTurn("currentId", seq[0]))
			}
			if at+1 < len(seq) {
				return []Delta{setTurn("currentId", seq[at+1])}
			}
			return seatedWrap(p, t.Round, t.Order, FirstOf(t.Order, t.FirstID))
		}),
	"remove": defineOp("encounter:run", parseOrderID, seatedTargets,
		func(_ seatedParams, state *RuleState, id string) *Refusal {
			return validateInOrder(state, noSeatOrder, id)
		},
		func(p seatedParams, state *RuleState, id string) []Delta {
			t := state.Turn
			seq := Sequence(t.Order, t.FirstID)
			left := without(t.Order, id)
			order := setTurn("order", left)
			if len(left) == 0 {
				return []Delta{order, setTurn("firstId", nil), setTurn("currentId", nil)}
			}
			// The first player left: first passes to the one after them in the order.
			first := FirstOf(t.Order, t.FirstID)
			newFirst := first
			if *first == id {
				newFirst = seatAfter(t.Order, id)
			}
			firstMoved := !sameID(newFirst, t.FirstID)
			deltas := []Delta{order}
			if firstMoved {
				deltas = append(deltas, setTurn("firstId", optional(newFirst)))
			}
			if t.CurrentID == nil || id != *t.CurrentID {
				return deltas
			}
			// The one acting left: the turn passes along the round's sequence, or the round wraps as next does.
			if at := slices.Index(seq, id); at+1 < len(seq) {
				return append(deltas, setTurn("currentId", seq[at+1]))
			}
			return append([]Delta{order}, seatedWrap(p, t.Round, left, newFirst)...)
		}),
	"first": defineOp("encounter:run", parseOrderID,
		func(seatedParams) []TargetPattern { return []TargetPattern{{"turn", "firstId"}} },
		func(p seatedParams, state *RuleState, id string) *Refusal {
			if state.Turn == nil {
				return refuse("noEncounter", noSeatOrder)
			}
			if p.firstPlayer != "manual" {
				return refuse("wrongState", "this ruleset does not set the first player by hand")
			}
			return validateInOrder(state, noSeatOrder, id)
		},
		func(_ seatedParams, _ *RuleState, id string) []Delta {
			return []Delta{setTurn("firstId", id)}
		}),
})
