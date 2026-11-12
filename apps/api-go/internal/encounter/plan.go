package encounter

import (
	"cmp"
	"slices"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// What a turn change writes, with no database (apps/api/src/encounter/encounter.plan.ts): the engine's ops run against
// the state they are handed, so the order of a turn change (docs/house-decisions.md #15, #27) and the round arithmetic
// are unit tested. Each plan takes the ops' state and the turn it carries (state.Turn is &t.TurnState), since the
// phase and who is done live beside the engine's TurnState.

func setTurn(key string, value any) engine.Delta {
	return engine.Delta{Target: engine.DeltaTarget{Turn: key}, Kind: "set", Value: value}
}

// idValue is a possibly absent id as a delta value: nil, never a typed nil pointer.
func idValue(id *string) any {
	if id == nil {
		return nil
	}
	return *id
}

func head(ids []string) *string {
	if len(ids) == 0 {
		return nil
	}
	return &ids[0]
}

func sameID(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

func isTurn(d engine.Delta, key string) bool { return d.Target.Turn == key }

// The round's sequence: from the first player for a seated order, the order as ranked otherwise.
func sequenceOf(r *engine.Ruleset, t *turn.Turn) []string {
	if r.Initiative.Strategy == "seated" {
		return engine.Sequence(t.Order, t.FirstID)
	}
	return slices.Clone(t.Order)
}

// The deltas that open a phase: its id, nobody done, and the first player up unless everyone plays at once.
func enter(phase engine.Phase, lead *string) []engine.Delta {
	current := idValue(lead)
	if phase.Mode != "turns" {
		current = nil
	}
	return []engine.Delta{setTurn(turn.PhaseID, phase.ID), setTurn(turn.Done, []string{}), setTurn(turn.CurrentID, current)}
}

// The deltas that begin the next round from a simultaneous last phase, where no initiative `next` ran, and who leads
// it: the round counts up, and a seated order moves its first player as `initiative.seated` does.
func roundWrap(r *engine.Ruleset, t *turn.Turn) ([]engine.Delta, *string) {
	round := setTurn(turn.Round, t.Round+1)
	if r.Initiative.Strategy != "seated" {
		return []engine.Delta{round}, head(t.Order)
	}
	lead := engine.NextFirst(r.Initiative.FirstPlayer, t.Order, engine.FirstOf(t.Order, t.FirstID))
	return []engine.Delta{round, setTurn(turn.FirstID, idValue(lead))}, lead
}

func phaseAt(r *engine.Ruleset, t *turn.Turn) int {
	return slices.IndexFunc(r.Phases, func(p engine.Phase) bool { return t.PhaseID != nil && p.ID == *t.PhaseID })
}

// PlanNext is the deltas of `turn.next`, in the order house decision #15 fixes: `initiative.<strategy>.next`, then
// `conditions.expire.turnEnd` for the actor whose turn just ended, then `roundEnd` when the round wrapped.
func PlanNext(r *engine.Ruleset, state *engine.RuleState, t *turn.Turn) ([]engine.Delta, error) {
	if r.Initiative == nil {
		return nil, cs.Fail("noTurnOrder")
	}
	if t == nil {
		return nil, cs.Fail("noEncounterRunning")
	}
	// ponytail: a ruleset that re-rolls initiative each round needs the GM to type new scores mid-wrap; refused until then
	if r.Initiative.Strategy == "ranked" && r.Initiative.RerollEachRound {
		return nil, cs.Fail("rerollUnsupported")
	}
	ended := t.CurrentID
	run := func(primitive, op string, input map[string]any) ([]engine.Delta, error) {
		return ruleset.RunPrimitive(r, state, primitive, op, input)
	}
	roundEnd := func() ([]engine.Delta, error) { return run("conditions.expire", "roundEnd", map[string]any{}) }
	phases := r.Phases
	at := max(phaseAt(r, t), 0)

	// House decision #37: a simultaneous phase has no turn to end, so `next` moves on at once, without a turnEnd.
	if len(phases) > 0 && phases[at].Mode == "simultaneous" {
		if at+1 < len(phases) {
			return enter(phases[at+1], head(sequenceOf(r, t))), nil
		}
		wrap, lead := roundWrap(r, t)
		end, err := roundEnd()
		if err != nil {
			return nil, err
		}
		return slices.Concat(wrap, enter(phases[0], lead), end), nil
	}

	next, err := run("initiative."+r.Initiative.Strategy, "next", map[string]any{})
	if err != nil {
		return nil, err
	}
	wrapped := slices.ContainsFunc(next, func(d engine.Delta) bool { return isTurn(d, turn.Round) })
	turnEnd := []engine.Delta{}
	if ended != nil {
		if turnEnd, err = run("conditions.expire", "turnEnd", map[string]any{"actorId": *ended}); err != nil {
			return nil, err
		}
	}
	end := []engine.Delta{}
	if wrapped {
		if end, err = roundEnd(); err != nil {
			return nil, err
		}
	}
	if len(phases) == 0 || !wrapped {
		return slices.Concat(next, turnEnd, end), nil
	}
	// The phase ran out of turns but the round did not: the next phase starts again from the first player.
	if at+1 < len(phases) {
		return slices.Concat(enter(phases[at+1], head(sequenceOf(r, t))), turnEnd), nil
	}
	// The last phase wrapped: keep the initiative's round deltas, but the new round opens in the first phase.
	var lead *string
	kept, seen := []engine.Delta{}, false
	for _, d := range next {
		if !isTurn(d, turn.CurrentID) {
			kept = append(kept, d)
			continue
		}
		if id, isText := d.Value.(string); isText && !seen {
			lead = &id
		}
		seen = true
	}
	return slices.Concat(kept, enter(phases[0], lead), turnEnd, end), nil
}

// PlanDone is the deltas of `phase.done`: the actor joins `done`; when every combatant of the order is done the phase
// moves on in the same step, as `turn.next` would.
func PlanDone(r *engine.Ruleset, state *engine.RuleState, t *turn.Turn, actorID string) ([]engine.Delta, error) {
	if t == nil {
		return nil, cs.Fail("noEncounterRunning")
	}
	if at := phaseAt(r, t); at < 0 || r.Phases[at].Mode != "simultaneous" {
		return nil, cs.Fail("notSimultaneous")
	}
	if !slices.Contains(t.Order, actorID) {
		return nil, cs.Fail("notInFight")
	}
	if slices.Contains(t.Done, actorID) {
		return nil, cs.Fail("alreadyDone")
	}
	done := append(slices.Clone(t.Done), actorID)
	mark := setTurn(turn.Done, done)
	for _, id := range t.Order {
		if !slices.Contains(done, id) {
			return []engine.Delta{mark}, nil
		}
	}
	after := *t
	after.Done = done
	moved := *state
	moved.Turn = &after.TurnState
	next, err := PlanNext(r, &moved, &after)
	if err != nil {
		return nil, err
	}
	return append([]engine.Delta{mark}, next...), nil
}

// PlanPrev is the deltas of `turn.prev`: the marker steps back one place, and back into the previous round from the top
// of the order. It only moves the marker; expiries already ticked come back by Undo, which takes the whole step back.
func PlanPrev(r *engine.Ruleset, t *turn.Turn) ([]engine.Delta, error) {
	if r.Initiative == nil {
		return nil, cs.Fail("noTurnOrder")
	}
	if t == nil {
		return nil, cs.Fail("noEncounterRunning")
	}
	// House decision #37: a phase is entered by Undo-able steps only; back stops at its first turn.
	if at := phaseAt(r, t); at >= 0 {
		if r.Phases[at].Mode == "simultaneous" || sameFirst(t.CurrentID, sequenceOf(r, t)) {
			return nil, cs.Fail("phaseStart")
		}
	}
	if r.Initiative.Strategy == "seated" {
		return planPrevSeated(t, r.Initiative.FirstPlayer == "rotate")
	}
	return stepBack(t.Order, t)
}

func sameFirst(current *string, seq []string) bool {
	return current != nil && len(seq) > 0 && *current == seq[0]
}

// One place back along seq, or the refusal when nobody acted or this is the first turn. nil, nil: into the previous
// round, which the caller writes.
func stepBack(seq []string, t *turn.Turn) ([]engine.Delta, error) {
	at := -1
	if t.CurrentID != nil {
		at = slices.Index(seq, *t.CurrentID)
	}
	if at < 0 {
		return nil, cs.Fail("nobodyActed")
	}
	if at > 0 {
		return []engine.Delta{setTurn(turn.CurrentID, seq[at-1])}, nil
	}
	if t.Round <= 1 {
		return nil, cs.Fail("firstTurn")
	}
	return []engine.Delta{setTurn(turn.Round, t.Round-1), setTurn(turn.CurrentID, idValue(lastOf(seq)))}, nil
}

func lastOf(ids []string) *string {
	if len(ids) == 0 {
		return nil
	}
	return &ids[len(ids)-1]
}

// Back through the round's sequence; before its first player, into the previous round (whose first player `rotate` had
// moved on).
func planPrevSeated(t *turn.Turn, rotate bool) ([]engine.Delta, error) {
	order := t.Order
	seq := engine.Sequence(order, t.FirstID)
	deltas, err := stepBack(seq, t)
	if err != nil || len(deltas) == 1 {
		return deltas, err
	}
	first := engine.FirstOf(order, t.FirstID)
	prevFirst := first
	if rotate {
		at := slices.Index(order, *first) // seq is not empty, so neither is the order
		prevFirst = &order[(at-1+len(order))%len(order)]
	}
	out := []engine.Delta{setTurn(turn.Round, t.Round-1)}
	if !sameID(prevFirst, t.FirstID) {
		out = append(out, setTurn(turn.FirstID, idValue(prevFirst)))
	}
	return append(out, setTurn(turn.CurrentID, idValue(lastOf(engine.Sequence(order, prevFirst))))), nil
}

func compareScores(a, b *int) int {
	switch {
	case a == nil && b == nil:
		return 0
	case a == nil:
		return 1
	case b == nil:
		return -1
	}
	return cmp.Compare(*b, *a)
}

// RankIDs is highest initiative first, those without one last; a tie keeps the place the GM gave it (`ord`).
func RankIDs(rows []Ranked) []string {
	sorted := slices.Clone(rows)
	slices.SortStableFunc(sorted, func(a, b Ranked) int {
		if c := compareScores(a.InitiativeScore, b.InitiativeScore); c != 0 {
			return c
		}
		return cmp.Or(cmp.Compare(a.Ord, b.Ord), cmp.Compare(a.ID, b.ID))
	})
	ids := make([]string, len(sorted))
	for i, r := range sorted {
		ids[i] = r.ID
	}
	return ids
}

// MovedIDs is the order after moving one combatant a place, which is allowed only past one with the same initiative (a
// tie).
func MovedIDs(rows []Ranked, id, direction string) ([]string, error) {
	ids := RankIDs(rows)
	at := slices.Index(ids, id)
	to := at + 1
	if direction == "up" {
		to = at - 1
	}
	if at < 0 {
		return nil, cs.Fail("combatantNotInFight")
	}
	if to < 0 || to >= len(ids) {
		if direction == "up" {
			return nil, cs.Fail("alreadyFirst")
		}
		return nil, cs.Fail("alreadyLast")
	}
	me := rows[slices.IndexFunc(rows, func(r Ranked) bool { return r.ID == id })]
	other := rows[slices.IndexFunc(rows, func(r Ranked) bool { return r.ID == ids[to] })]
	if compareScores(me.InitiativeScore, other.InitiativeScore) != 0 {
		return nil, cs.Fail("sameInitiativeOnly")
	}
	ids[at], ids[to] = other.ID, me.ID
	return ids, nil
}
