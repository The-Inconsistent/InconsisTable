package engine

import "slices"

// House decision #57: sides alternate, the side that is up chooses who acts, and a side may pay to act out of turn. The
// twin of packages/rules-engine/src/primitives/initiative-sides.ts.

type sideCost struct {
	pool   string
	amount float64
}

type barredParams struct {
	throughRound float64
	liftCost     map[string]sideCost
}

type sidesParams struct {
	sides     []string
	firstSide string
	roundEnd  string
	setup     bool
	hold      bool
	// outOfTurn is nil when the ruleset has no out-of-turn action.
	outOfTurn *map[string]sideCost
	barred    *barredParams
}

func readCosts(r *objectReader, key string) map[string]sideCost {
	out := map[string]sideCost{}
	holder := r.nested(key)
	for side, raw := range holder.fields {
		c, ok := readObject(raw)
		if !ok || !isID(side) {
			r.fail(key)
			continue
		}
		out[side] = sideCost{c.id("pool"), c.intIn("amount", 1, 20)}
		r.absorb(key, c)
	}
	return out
}

func parseSidesParams(raw any) (sidesParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return sidesParams{}, refuse("badParams", "not an object")
	}
	p := sidesParams{
		firstSide: r.enumOr("firstSide", []string{"fixed", "rotate"}, "fixed"),
		roundEnd:  r.enumOr("roundEnd", []string{"auto", "manual"}, "auto"),
		setup:     r.has("setup"),
		hold:      r.has("hold"),
	}
	for _, item := range r.list("sides", 2, 4) {
		side, ok := readObject(item)
		if !ok {
			r.fail("sides")
			continue
		}
		p.sides = append(p.sides, side.id("id"))
		r.absorb("sides", side)
	}
	if r.has("outOfTurn") {
		o := r.nested("outOfTurn")
		cost := readCosts(o, "cost")
		r.absorb("outOfTurn", o)
		p.outOfTurn = &cost
	}
	if r.has("barred") {
		b := r.nested("barred")
		p.barred = &barredParams{b.intOr("throughRound", 1, 10, 1), map[string]sideCost{}}
		if b.has("liftCost") {
			p.barred.liftCost = readCosts(b, "liftCost")
		}
		r.absorb("barred", b)
	}
	return p, r.refusal("badParams")
}

type pickInput struct {
	id    string
	force bool
}

func parsePick(raw any) (pickInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return pickInput{}, refuse("badInput", "not an object")
	}
	in := pickInput{r.str("id"), r.boolOr("force", false)}
	return in, r.refusal("badInput")
}

type flagInput struct {
	id   string
	flag bool
}

func parseFlag(key string) func(any) (flagInput, *Refusal) {
	return func(raw any) (flagInput, *Refusal) {
		r, ok := readObject(raw)
		if !ok {
			return flagInput{}, refuse("badInput", "not an object")
		}
		in := flagInput{id: r.str("id")}
		if flag, ok := r.fields[key].(bool); ok {
			in.flag = flag
		} else {
			r.fail(key)
		}
		return in, r.refusal("badInput")
	}
}

func sidesTargets(keys ...string) func(sidesParams) []TargetPattern {
	return func(sidesParams) []TargetPattern {
		out := make([]TargetPattern, len(keys))
		for i, k := range keys {
			out[i] = TargetPattern{"turn", k}
		}
		return out
	}
}

func withPool(f func(sidesParams) []TargetPattern) func(sidesParams) []TargetPattern {
	return func(p sidesParams) []TargetPattern { return append(f(p), TargetPattern{"pool", "*"}) }
}

var (
	sidesTurnKeys = []string{"done", "lastSide", "outOfTurnSide", "currentId"}
	sidesWrapKeys = []string{"round", "currentId", "lastSide", "outOfTurnSide", "done", "held", "barred"}
)

// sideSnap is the part of the turn an ended turn changes.
type sideSnap struct {
	currentID     *string
	done          []string
	lastSide      *string
	outOfTurnSide *string
}

func snapOf(t *TurnState) sideSnap {
	return sideSnap{t.CurrentID, t.Done, t.LastSide, t.OutOfTurnSide}
}

func sideOfMember(t *TurnState, id string) (string, bool) {
	side, ok := t.SideOf[id]
	return side, ok
}

// sideFirstIndex is where the sides pick first this round: the first listed, or one place further each round under rotate.
func sideFirstIndex(p sidesParams, round float64) int {
	n := len(p.sides)
	if p.firstSide != "rotate" {
		return 0
	}
	return ((int(round)-1)%n + n) % n
}

func isBarred(p sidesParams, t *TurnState, id string) bool {
	return p.barred != nil && t.Round <= p.barred.throughRound && slices.Contains(t.Barred, id)
}

// sideEnded ends the turn of whoever acts: they are done, their side was the last to act, and an out-of-turn bar lifts.
func sideEnded(t *TurnState, s sideSnap) sideSnap {
	if s.currentID == nil {
		return s
	}
	cur := *s.currentID
	var side *string
	if v, ok := sideOfMember(t, cur); ok {
		side = &v
	}
	out := sideSnap{done: s.done, lastSide: side}
	if !slices.Contains(s.done, cur) {
		out.done = append(slices.Clone(s.done), cur)
	}
	if sameID(s.outOfTurnSide, side) {
		out.outOfTurnSide = s.outOfTurnSide
	}
	return out
}

// sideUp is the side that is up: the first with a pending member, from the side after the last to act (or the round's
// first). Empty when no side has one.
func sideUpOf(p sidesParams, t *TurnState, s sideSnap) (string, bool) {
	n := len(p.sides)
	last := -1
	if s.lastSide != nil {
		last = slices.Index(p.sides, *s.lastSide)
	}
	start := sideFirstIndex(p, t.Round)
	if last >= 0 {
		start = (last + 1) % n
	}
	pending := func(id string) bool {
		return !slices.Contains(s.done, id) && !slices.Contains(t.Unable, id) &&
			(s.currentID == nil || *s.currentID != id) && !isBarred(p, t, id)
	}
	for k := range n {
		side := p.sides[(start+k)%n]
		for _, id := range t.Order {
			if member, ok := sideOfMember(t, id); ok && member == side && pending(id) {
				return side, true
			}
		}
	}
	return "", false
}

func turnOrRefuse(state *RuleState) (*TurnState, *Refusal) {
	if state.Turn == nil {
		return nil, refuse("noEncounter", "no fight is running")
	}
	return state.Turn, nil
}

func isBegun(t *TurnState) bool { return t.Begun == nil || *t.Begun }

// running needs a fight that is running and, when the ruleset has a setup, begun.
func running(state *RuleState) (*TurnState, *Refusal) {
	t, refusal := turnOrRefuse(state)
	if refusal != nil {
		return nil, refusal
	}
	if !isBegun(t) {
		return nil, refuse("wrongState", "the fight has not begun")
	}
	return t, nil
}

// memberProblem says why this member cannot start a turn, whatever its side. s is the turn once the acting one ends.
func memberProblem(p sidesParams, t *TurnState, s sideSnap, id string) *Refusal {
	if !slices.Contains(t.Order, id) {
		return refuse("badInput", `"%s" is not in the order`, id)
	}
	if _, ok := sideOfMember(t, id); !ok {
		return refuse("badInput", `"%s" has no side`, id)
	}
	if t.CurrentID != nil && *t.CurrentID == id {
		return refuse("wrongState", `"%s" is already acting`, id)
	}
	if slices.Contains(t.Unable, id) {
		return refuse("wrongState", `"%s" cannot act`, id)
	}
	if slices.Contains(s.done, id) {
		return refuse("wrongState", `"%s" has already acted this round`, id)
	}
	if isBarred(p, t, id) {
		return refuse("wrongState", `"%s" takes no turn this round`, id)
	}
	return nil
}

// list is a non-nil copy, so it reaches a client as [] and never null.
func list(ids []string) []string { return append([]string{}, ids...) }

func withoutID(ids []string, id string) []string {
	out := []string{}
	for _, x := range ids {
		if x != id {
			out = append(out, x)
		}
	}
	return out
}

func withID(ids []string, id string) []string {
	out := list(ids)
	if !slices.Contains(out, id) {
		out = append(out, id)
	}
	return out
}

// sidesWrap is what newRound writes, and what an automatic wrap writes.
func sidesWrap(p sidesParams, t *TurnState) []Delta {
	deltas := []Delta{
		setTurn("round", t.Round+1), setTurn("currentId", nil), setTurn("lastSide", nil),
		setTurn("outOfTurnSide", nil), setTurn("done", []string{}), setTurn("held", []string{}),
	}
	if p.barred != nil && t.Round >= p.barred.throughRound {
		deltas = append(deltas, setTurn("barred", []string{}))
	}
	return deltas
}

func sidesEndDeltas(s sideSnap) []Delta {
	return []Delta{
		setTurn("done", list(s.done)), setTurn("lastSide", optional(s.lastSide)),
		setTurn("outOfTurnSide", optional(s.outOfTurnSide)), setTurn("currentId", nil),
	}
}

// sidesEndTurn ends the turn of whoever acts, wrapping the round when auto finds nobody left.
func sidesEndTurn(p sidesParams, t *TurnState) (deltas []Delta, wrapped bool) {
	s := sideEnded(t, snapOf(t))
	if _, any := sideUpOf(p, t, s); p.roundEnd == "auto" && !any {
		return sidesWrap(p, t), true
	}
	return sidesEndDeltas(s), false
}

// sidesEnding is what ending the acting member's turn writes before another starts; currentId is the next delta's.
func sidesEnding(t *TurnState, s sideSnap) []Delta {
	if t.CurrentID == nil {
		return nil
	}
	return sidesEndDeltas(s)[:3]
}

func liftCostOf(p sidesParams, t *TurnState, id string) (sideCost, bool) {
	side, ok := sideOfMember(t, id)
	if !ok || p.barred == nil {
		return sideCost{}, false
	}
	cost, ok := p.barred.liftCost[side]
	return cost, ok
}

// seizeCheck is everything that makes seize refuse, in the order it is checked. A refused payment is the last.
func seizeCheck(p sidesParams, state *RuleState, id string) *Refusal {
	t, refusal := running(state)
	if refusal != nil {
		return refusal
	}
	s := sideEnded(t, snapOf(t))
	if refusal := memberProblem(p, t, s, id); refusal != nil {
		return refusal
	}
	side, _ := sideOfMember(t, id)
	var cost sideCost
	ok := false
	if p.outOfTurn != nil {
		cost, ok = (*p.outOfTurn)[side]
	}
	if !ok {
		return refuse("wrongState", "that side cannot act out of turn")
	}
	if up, any := sideUpOf(p, t, s); any && up == side {
		return refuse("wrongState", "that side is already up")
	}
	if s.outOfTurnSide != nil && *s.outOfTurnSide == side {
		return refuse("wrongState", "that side has already acted out of turn")
	}
	if s.lastSide == nil && p.sides[sideFirstIndex(p, t.Round)] == side {
		return refuse("wrongState", "that side picks first this round")
	}
	_, refusal = Charge(state, cost.pool, cost.amount)
	return refusal
}

var initiativeSides = definePrimitive(parseSidesParams, map[string]primitiveOp{
	"begin": defineOp("encounter:run", parseEmpty("badInput"),
		sidesTargets("begun", "done", "held", "currentId", "lastSide", "outOfTurnSide"),
		func(p sidesParams, state *RuleState, _ struct{}) *Refusal {
			t, refusal := turnOrRefuse(state)
			if refusal != nil {
				return refusal
			}
			if !p.setup {
				return refuse("wrongState", "this ruleset has no setup")
			}
			if isBegun(t) {
				return refuse("wrongState", "the fight has already begun")
			}
			return nil
		},
		func(sidesParams, *RuleState, struct{}) []Delta {
			return []Delta{
				setTurn("begun", true), setTurn("done", []string{}), setTurn("held", []string{}),
				setTurn("currentId", nil), setTurn("lastSide", nil), setTurn("outOfTurnSide", nil),
			}
		}),
	"pick": defineOp("encounter:run", parsePick, sidesTargets(sidesTurnKeys...),
		func(p sidesParams, state *RuleState, in pickInput) *Refusal {
			t, refusal := running(state)
			if refusal != nil {
				return refusal
			}
			s := sideEnded(t, snapOf(t))
			if refusal := memberProblem(p, t, s, in.id); refusal != nil {
				return refusal
			}
			side, _ := sideOfMember(t, in.id)
			if up, any := sideUpOf(p, t, s); !in.force && !(any && up == side) {
				return refuse("wrongState", "it is not that side's turn")
			}
			return nil
		},
		func(_ sidesParams, state *RuleState, in pickInput) []Delta {
			t := state.Turn
			return append(sidesEnding(t, sideEnded(t, snapOf(t))), setTurn("currentId", in.id))
		}),
	"seize": defineOp("encounter:run", parseOrderID, withPool(sidesTargets(sidesTurnKeys...)),
		func(p sidesParams, state *RuleState, id string) *Refusal { return seizeCheck(p, state, id) },
		func(p sidesParams, state *RuleState, id string) []Delta {
			t := state.Turn
			side, _ := sideOfMember(t, id)
			cost := (*p.outOfTurn)[side]
			paid, _ := Charge(state, cost.pool, cost.amount)
			deltas := []Delta{paid}
			for _, d := range sidesEnding(t, sideEnded(t, snapOf(t))) {
				if d.Target.Turn != "outOfTurnSide" {
					deltas = append(deltas, d)
				}
			}
			return append(deltas, setTurn("outOfTurnSide", side), setTurn("currentId", id))
		}),
	"next": defineOp("encounter:run", parseEmpty("badInput"), sidesTargets(sidesWrapKeys...),
		func(_ sidesParams, state *RuleState, _ struct{}) *Refusal {
			t, refusal := running(state)
			if refusal != nil {
				return refusal
			}
			if t.CurrentID == nil {
				return refuse("wrongState", "nobody is acting")
			}
			return nil
		},
		func(p sidesParams, state *RuleState, _ struct{}) []Delta {
			deltas, _ := sidesEndTurn(p, state.Turn)
			return deltas
		}),
	"hold": defineOp("encounter:run", parseEmpty("badInput"), sidesTargets(sidesWrapKeys...),
		func(p sidesParams, state *RuleState, _ struct{}) *Refusal {
			t, refusal := running(state)
			if refusal != nil {
				return refusal
			}
			if !p.hold {
				return refuse("wrongState", "this ruleset has no holding")
			}
			if t.CurrentID == nil {
				return refuse("wrongState", "nobody is acting")
			}
			return nil
		},
		func(p sidesParams, state *RuleState, _ struct{}) []Delta {
			t := state.Turn
			deltas, wrapped := sidesEndTurn(p, t)
			if wrapped {
				return deltas
			}
			return append(deltas, setTurn("held", withID(t.Held, *t.CurrentID)))
		}),
	"interrupt": defineOp("encounter:run", parseOrderID, sidesTargets("held"),
		func(_ sidesParams, state *RuleState, id string) *Refusal {
			t, refusal := running(state)
			if refusal != nil {
				return refusal
			}
			if !slices.Contains(t.Held, id) {
				return refuse("wrongState", `"%s" is not holding`, id)
			}
			return nil
		},
		func(_ sidesParams, state *RuleState, id string) []Delta {
			return []Delta{setTurn("held", withoutID(state.Turn.Held, id))}
		}),
	"mark": defineOp("encounter:run", parseFlag("done"), sidesTargets("done", "held"),
		func(_ sidesParams, state *RuleState, in flagInput) *Refusal {
			t, refusal := turnOrRefuse(state)
			if refusal != nil {
				return refusal
			}
			if !slices.Contains(t.Order, in.id) {
				return refuse("badInput", `"%s" is not in the order`, in.id)
			}
			if t.CurrentID != nil && *t.CurrentID == in.id {
				return refuse("wrongState", `"%s" is acting`, in.id)
			}
			return nil
		},
		func(_ sidesParams, state *RuleState, in flagInput) []Delta {
			t := state.Turn
			if in.flag {
				return []Delta{setTurn("done", withID(t.Done, in.id))}
			}
			deltas := []Delta{setTurn("done", withoutID(t.Done, in.id))}
			if slices.Contains(t.Held, in.id) {
				deltas = append(deltas, setTurn("held", withoutID(t.Held, in.id)))
			}
			return deltas
		}),
	"bar": defineOp("encounter:run", parseFlag("barred"), sidesTargets("barred"),
		func(p sidesParams, state *RuleState, in flagInput) *Refusal {
			t, refusal := turnOrRefuse(state)
			if refusal != nil {
				return refusal
			}
			if p.barred == nil {
				return refuse("wrongState", "this ruleset has no barring")
			}
			if t.Round > p.barred.throughRound {
				return refuse("wrongState", "barring is over")
			}
			if !slices.Contains(t.Order, in.id) {
				return refuse("badInput", `"%s" is not in the order`, in.id)
			}
			if !in.flag {
				return nil
			}
			if slices.Contains(t.Done, in.id) {
				return refuse("wrongState", `"%s" has already acted`, in.id)
			}
			if t.CurrentID != nil && *t.CurrentID == in.id {
				return refuse("wrongState", `"%s" is acting`, in.id)
			}
			return nil
		},
		func(_ sidesParams, state *RuleState, in flagInput) []Delta {
			if in.flag {
				return []Delta{setTurn("barred", withID(state.Turn.Barred, in.id))}
			}
			return []Delta{setTurn("barred", withoutID(state.Turn.Barred, in.id))}
		}),
	"lift": defineOp("encounter:run", parseOrderID, withPool(sidesTargets("barred")),
		func(p sidesParams, state *RuleState, id string) *Refusal {
			t, refusal := turnOrRefuse(state)
			if refusal != nil {
				return refusal
			}
			if p.barred == nil {
				return refuse("wrongState", "this ruleset has no barring")
			}
			if !slices.Contains(t.Barred, id) {
				return refuse("wrongState", `"%s" is not barred`, id)
			}
			cost, ok := liftCostOf(p, t, id)
			if !ok {
				return refuse("wrongState", `"%s" cannot be freed`, id)
			}
			_, refusal = Charge(state, cost.pool, cost.amount)
			return refusal
		},
		func(p sidesParams, state *RuleState, id string) []Delta {
			t := state.Turn
			cost, _ := liftCostOf(p, t, id)
			paid, _ := Charge(state, cost.pool, cost.amount)
			return []Delta{paid, setTurn("barred", withoutID(t.Barred, id))}
		}),
	"newRound": defineOp("encounter:run", parseEmpty("badInput"), sidesTargets(sidesWrapKeys...),
		func(_ sidesParams, state *RuleState, _ struct{}) *Refusal {
			_, refusal := running(state)
			return refusal
		},
		func(p sidesParams, state *RuleState, _ struct{}) []Delta { return sidesWrap(p, state.Turn) }),
})
