package view

import (
	"maps"
	"slices"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Everything one seat receives, after every rule about what it may see (CLAUDE.md, principles 4 and 6). The gateway
// only loads, asks and emits. A co-GM sees hidden parts only where a scope covers them (house decision #31).
//
// The snapshot is shared by every socket of a campaign, so nothing here writes into it: every slice or map a seat's copy
// changes is a new one.

// Snapshot is what the server holds of a campaign, whole: the raw snapshots no seat below the GM side receives.
type Snapshot struct {
	State cs.LiveState
	Codex cs.Codex
	// Drafts holds builder drafts by user, decoded JSON: each user gets their own in State.MyDraft.
	Drafts map[string]any
}

// SeatView is what one seat receives: the `state` and `codex` events.
// The manifest part of the TypeScript SeatView is SeatManifest, which the rules route reads.
type SeatView struct {
	State cs.LiveState
	Codex cs.Codex
}

var gmViewer = engine.Viewer{Role: "gm", CharacterIDs: []string{}}

var partyKinds = []string{"pc", "companion"}

// Of is what one seat receives of a campaign. A nil compiled ruleset sends no value at all (fail-closed).
func Of(snapshot Snapshot, compiled *engine.CompiledRuleset, c cs.Ctx) SeatView {
	sight := SightOf(c)
	var myDraft any
	if c.UserID != nil {
		myDraft = snapshot.Drafts[*c.UserID]
	}
	if sight.All {
		state := snapshot.State
		state.MyDraft = myDraft
		return SeatView{state, snapshot.Codex}
	}
	state := seatState(snapshot.State, compiled, c, sight)
	state.MyDraft = myDraft
	return SeatView{state, seatCodex(snapshot.Codex, c, sight)}
}

func toEngineView(a cs.Actor) engine.ActorView {
	return engine.ActorView{
		ID: a.ID, Entity: a.Entity, Fields: a.Fields, Resources: a.Resources, Derived: a.Derived, Conditions: a.Conditions,
	}
}

// Each actor's values as the seat may see them (docs/design.md §5.5): as a GM where the seat is on the GM side of that
// kind of actor, as a player (or the Screen) holding what it holds elsewhere.
func actorViews(actors []cs.Actor, compiled *engine.CompiledRuleset, c cs.Ctx) map[string]engine.ActorView {
	role := "player"
	if isScreen(c) {
		role = "screen"
	}
	seat := engine.Viewer{Role: role, CharacterIDs: HeldBy(c)}
	var gmSide, rest []engine.ActorView
	for _, a := range actors {
		if ActorGmSide(c, a.Kind) {
			gmSide = append(gmSide, toEngineView(a))
		} else {
			rest = append(rest, toEngineView(a))
		}
	}
	out := map[string]engine.ActorView{}
	for _, v := range append(compiled.ToViewerView(gmViewer, gmSide), compiled.ToViewerView(seat, rest)...) {
		out[v.ID] = v
	}
	return out
}

func seatState(state cs.LiveState, compiled *engine.CompiledRuleset, c cs.Ctx, sight Sight) cs.LiveState {
	held := HeldBy(c)
	views := map[string]engine.ActorView{}
	if compiled != nil {
		views = actorViews(state.Actors, compiled, c)
	}
	actors := []cs.Actor{}
	for _, a := range state.Actors {
		if !slices.Contains(partyKinds, a.Kind) && !holds(held, a.ID) && !sight.Combat {
			continue
		}
		out := a
		if !holds(held, a.ID) && !ActorGmSide(c, a.Kind) {
			out.OwnerUserID = nil
		}
		v, seen := views[a.ID]
		if seen {
			out.Entity, out.Fields, out.Resources, out.Derived = v.Entity, v.Fields, v.Resources, v.Derived
			out.Conditions = slices.Clone(v.Conditions)
		} else {
			out.Entity, out.Fields, out.Resources, out.Derived = "", map[string]any{}, map[string]float64{}, map[string]float64{}
			out.Conditions = []string{}
		}
		out.ConditionTimers = []cs.ConditionTimer{}
		for _, t := range a.ConditionTimers {
			if seen && slices.Contains(v.Conditions, t.ID) {
				out.ConditionTimers = append(out.ConditionTimers, t)
			}
		}
		actors = append(actors, out)
	}
	state.Actors = actors
	if state.Session != nil && !sight.Session {
		session := *state.Session
		session.Notes = ""
		state.Session = &session
	}
	state.Tests = seatTests(state.Tests, c, sight)
	if !sight.Session {
		state.TestDefs = []cs.TestDef{}
	}
	state.Encounter = seatEncounter(state.Encounter, views, sight)
	if !sight.Party {
		state.Access.Invites = []cs.Invite{}
	}
	return state
}

// The Encounter one seat receives. The combat side sees every Combatant. Anyone else gets no hidden Combatant at all,
// the turn passes over a hidden one without naming it, a bar Combatant carries its fraction and no numbers, and the GM's
// own marks (keep, conditions) stay home. Health numbers are sent only where the seat may see that actor's resource.
func seatEncounter(e *cs.Encounter, views map[string]engine.ActorView, sight Sight) *cs.Encounter {
	if e == nil {
		return nil
	}
	hpOf := func(cb cs.Combatant) *cs.HP {
		if e.Health == nil {
			return nil
		}
		if _, ok := views[cb.ActorID].Resources[e.Health.Resource]; !ok {
			return nil
		}
		return cb.HP
	}
	out := *e
	if sight.Combat {
		out.Combatants = make([]cs.Combatant, len(e.Combatants))
		for i, cb := range e.Combatants {
			cb.HP = hpOf(cb)
			conditions := []cs.CombatantCondition{}
			for _, x := range cb.Conditions {
				if slices.Contains(views[cb.ActorID].Conditions, x.ID) {
					conditions = append(conditions, x)
				}
			}
			cb.Conditions = conditions
			out.Combatants[i] = cb
		}
		return &out
	}
	seen := []cs.Combatant{}
	for _, cb := range e.Combatants {
		if cb.Visibility != "hidden" {
			seen = append(seen, cb)
		}
	}
	isSeen := func(id *string) bool {
		return id != nil && slices.ContainsFunc(seen, func(cb cs.Combatant) bool { return cb.ID == *id })
	}
	out.ConditionDefs = []cs.ConditionDef{}
	if !isSeen(e.CurrentID) {
		out.CurrentID = nil
	}
	if !isSeen(e.FirstID) {
		out.FirstID = nil
	}
	out.Done = []string{}
	for _, id := range e.Done {
		if isSeen(&id) {
			out.Done = append(out.Done, id)
		}
	}
	out.Combatants = make([]cs.Combatant, len(seen))
	for i, cb := range seen {
		cb.Ord = i // renumbered over what the seat sees, so a gap never shows where a hidden one sits
		cb.Keep = false
		cb.Conditions = []cs.CombatantCondition{}
		if cb.Visibility == "full" {
			cb.HP = hpOf(cb)
		} else {
			cb.HP = nil
		}
		out.Combatants[i] = cb
	}
	return &out
}

// The entries a seat sees: the codex and secrets sides read all of them; anyone else only what is revealed to them, and
// a reader never learns who else an entry was shown to.
func seatCodex(codex cs.Codex, c cs.Ctx, sight Sight) cs.Codex {
	held := HeldBy(c)
	entries := []cs.CodexEntry{}
	for _, e := range codex.Entries {
		shown := e.Visibility != "gm" && (e.AudienceMode == "all" || slices.ContainsFunc(e.Audience, func(a string) bool { return holds(held, a) }))
		if !sight.Secrets && !sight.Codex && !shown {
			continue
		}
		if !sight.Secrets {
			e.GMNotes = ""
		}
		if !sight.Secrets && !sight.Codex {
			audience := []string{}
			for _, a := range e.Audience {
				if holds(held, a) {
					audience = append(audience, a)
				}
			}
			e.Audience = audience
		}
		entries = append(entries, e)
	}
	return cs.Codex{Entries: entries}
}

// seatTests is the calls one seat receives. The session side sees them whole. The table screen sees that a Test is open
// and how far it is, never who or what. A player sees only the calls that name a character they hold, and in them: the
// target only if it is shown, their own result only as far as the call allows, and the other characters' results
// (outcome and die, never the modifier) only once the GM revealed them.
func seatTests(tests []cs.TestCall, c cs.Ctx, sight Sight) []cs.TestCall {
	if sight.Session {
		return tests
	}
	held := HeldBy(c)
	out := []cs.TestCall{}
	if isScreen(c) {
		for _, call := range tests {
			if call.Status != "open" {
				continue
			}
			call.SecretInputs = []string{}
			call.Inputs = map[string]any{}
			call.ShowTarget, call.ShowModifier, call.ShowOutcome, call.Revealed = false, false, false, false
			call.Targets = []cs.TestTargetState{}
			out = append(out, call)
		}
		return out
	}
	for _, call := range tests {
		var mine []cs.TestTargetState
		for _, t := range call.Targets {
			if holds(held, t.ActorID) {
				mine = append(mine, t)
			}
		}
		if len(mine) == 0 {
			continue
		}
		shown := mine
		if call.Revealed {
			shown = call.Targets
		}
		targets := make([]cs.TestTargetState, len(shown))
		for i, t := range shown {
			own := holds(held, t.ActorID)
			// A Dice pool's margin and shifts give the difficulty number away (score minus margin), so they follow the
			// number itself, or the GM revealing it; the flags leak nothing (house decision #30).
			knowsNumber := call.Revealed || (own && call.ShowTarget)
			seen := cs.TestTargetState{ActorID: t.ActorID}
			if own && call.ShowModifier {
				seen.Modifier, seen.Pool = t.Modifier, t.Pool
			}
			if own && call.ShowTarget {
				seen.Target = t.Target
			}
			if t.Report != nil {
				r := cs.TestResult{Natural: t.Report.Natural, Flags: t.Report.Flags}
				if own && call.ShowModifier {
					r.Total = t.Report.Total
				}
				if !own || call.ShowOutcome || call.Revealed {
					r.Outcome = t.Report.Outcome
				}
				if knowsNumber {
					r.Margin, r.Shifts = t.Report.Margin, t.Report.Shifts
				}
				seen.Report = &r
			}
			targets[i] = seen
		}
		inputs := map[string]any{}
		for k, v := range maps.All(call.Inputs) {
			if !slices.Contains(call.SecretInputs, k) {
				inputs[k] = v
			}
		}
		reported := 0
		for _, t := range mine {
			if t.Report != nil {
				reported++
			}
		}
		call.SecretInputs = []string{}
		call.Inputs = inputs
		call.Called = len(mine)
		call.Reported = reported
		call.Targets = targets
		out = append(out, call)
	}
	return out
}
