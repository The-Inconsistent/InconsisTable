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
	// The mode is the campaign row's, as loaded with this snapshot: a socket opened before the table changed mode must
	// not keep the sight it was handed.
	c.TableMode = snapshot.State.Campaign.TableMode
	sight := SightOf(c)
	var myDraft any
	if c.UserID != nil {
		myDraft = snapshot.Drafts[*c.UserID]
	}
	fielded := seatEntryFields(snapshot.Codex, compiled, sight.Secrets)
	if sight.All {
		state := snapshot.State
		state.MyDraft = myDraft
		state.Pools = seatPools(state.Pools, compiled, c)
		return SeatView{state, seatEntryLinks(fielded, compiled)}
	}
	state := seatState(snapshot.State, compiled, c, sight)
	state.MyDraft = myDraft
	codex := seatEntryLinks(seatCodex(fielded, c, sight), compiled)
	if !sight.Secrets && !sight.Codex {
		// The journal's recaps read like the codex's (house decision #136): a mention of an entry the seat cannot see is hidden.
		ids := map[string]bool{}
		for _, e := range codex.Entries {
			ids[e.ID] = true
		}
		for i := range state.Journal {
			state.Journal[i].Recap = hideMentions(state.Journal[i].Recap, func(id string) bool { return ids[id] })
		}
	}
	state.Clocks = seatClocks(state.Clocks, codex, sight)
	state.Pools = seatPools(state.Pools, compiled, c)
	state.Requests, state.RequestAnswers = seatRequests(state.Requests, state.RequestAnswers, c, sight, compiled, state.Pools)
	state.Rolls, state.Dealt = seatTables(state.Rolls, state.Dealt, c, sight)
	state.Whispers = seatWhispers(state.Whispers, c, sight)
	state.History = seatHistory(snapshot.State, state, codex, compiled, c, sight)
	state.Spotlight = seatSpotlight(state.Spotlight, codex, c, sight)
	return SeatView{state, codex}
}

// seatHistory is HISTORY as one seat receives it (house decision #133, vectors/reference/view.seat.ts seatHistory):
// the side that may undo (the combat side, as Undo is encounter:run), and of each action only the writes of values the
// seat sees: an actor's field, resource or condition by the ruleset's visibility as that seat sees that actor; a pool, a
// clock or a codex entry it is sent; the turn; a Test's value to the session side or a table without a GM. An item row
// and anything else stay home (fail-closed). A condition row is sent without its source, which may hold the GM's words.
// An action left with no write and no strike is dropped.
func seatHistory(whole, seat cs.LiveState, codex cs.Codex, compiled *engine.CompiledRuleset, c cs.Ctx, sight Sight) []cs.HistoryLine {
	if !sight.Combat || len(whole.History) == 0 {
		return nil
	}
	sees := writeSeer(whole, seat, codex, compiled, c, sight)
	out := []cs.HistoryLine{}
	for _, line := range whole.History {
		cut := line
		cut.Writes = []cs.FightLogWrite{}
		for _, w := range line.Writes {
			if sees(w) {
				if w.Target["condition"] != "" {
					w.Before, w.After = conditionShown(w.Before), conditionShown(w.After)
				}
				cut.Writes = append(cut.Writes, w)
			}
		}
		if len(cut.Writes) > 0 || cut.Strike != nil {
			out = append(out, cut)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// A condition row as a seat off the GM side reads it: what it is, how many and when it ends; not its source.
func conditionShown(v any) any {
	row, isRow := v.(map[string]any)
	if !isRow {
		return v
	}
	out := map[string]any{}
	for _, k := range []string{"conditionId", "stacks", "expiresOn", "expiresAfter"} {
		if x, ok := row[k]; ok {
			out[k] = x
		}
	}
	return out
}

// SeesWrite says whether the seat sees the value a logged write changed, by the cut HISTORY makes: an undo's refusal
// about that write is cut by it too (house decision #131). The GM side sees every one.
func SeesWrite(snapshot Snapshot, compiled *engine.CompiledRuleset, c cs.Ctx, w cs.FightLogWrite) bool {
	c.TableMode = snapshot.State.Campaign.TableMode
	sight := SightOf(c)
	if sight.All {
		return true
	}
	seat := Of(snapshot, compiled, c)
	return writeSeer(snapshot.State, seat.State, seat.Codex, compiled, c, sight)(w)
}

// writeSeer is the test of one logged write against what the seat sees: whole is the snapshot's state, seat and codex
// what the seat receives of them.
func writeSeer(whole, seat cs.LiveState, codex cs.Codex, compiled *engine.CompiledRuleset, c cs.Ctx, sight Sight) func(cs.FightLogWrite) bool {
	actors := map[string]cs.Actor{}
	for _, a := range whole.Actors {
		actors[a.ID] = a
	}
	role := "player"
	if isScreen(c) {
		role = "screen"
	}
	seatViewer := engine.Viewer{Role: role, CharacterIDs: HeldBy(c)}
	return func(w cs.FightLogWrite) bool {
		t := w.Target
		switch {
		case t["actorId"] != "":
			a, ok := actors[t["actorId"]]
			if !ok || compiled == nil {
				return false
			}
			viewer := seatViewer
			if ActorGmSide(c, a.Kind) {
				viewer = gmViewer
			}
			// The write as one value of the actor, through the one filter every actor value goes through.
			probe := engine.ActorView{ID: a.ID, Entity: a.Entity, Fields: map[string]any{}, Resources: map[string]float64{},
				Derived: map[string]float64{}, Conditions: []string{}}
			switch {
			case t["resource"] != "":
				probe.Resources[t["resource"]] = 0
			case t["field"] != "":
				probe.Fields[t["field"]] = nil
			case t["condition"] != "":
				for _, v := range []any{w.After, w.Before} {
					if row, isRow := v.(map[string]any); isRow {
						if id, isID := row["conditionId"].(string); isID {
							probe.Conditions = []string{id}
							break
						}
					}
				}
			default:
				return false
			}
			seen := compiled.ToViewerView(viewer, []engine.ActorView{probe})[0]
			return len(seen.Resources)+len(seen.Fields)+len(seen.Conditions) > 0
		case t["pool"] != "":
			return slices.ContainsFunc(seat.Pools, func(p cs.PoolState) bool { return p.ID == t["pool"] })
		case t["clock"] != "":
			return slices.ContainsFunc(seat.Clocks, func(k cs.Clock) bool { return k.ID == t["clock"] })
		case t["entry"] != "":
			return slices.ContainsFunc(codex.Entries, func(e cs.CodexEntry) bool { return e.ID == t["entry"] })
		case t["turn"] != "":
			return true
		case t["test"] != "":
			return sight.Session || sight.TableRun
		}
		return false
	}
}

// The spotlight a seat receives (view.seat.ts seatSpotlight, house decision #139): the codex and secrets sides get it
// whole, and so, without a GM, does a seat that may reveal (it sends SHOW, so it needs the bar and CLEAR). Anyone else
// gets none for an entry its codex lacks, and of a listed audience only the characters it holds, none when that leaves
// none: no phone learns who else was named, and the screen gets only one shown to everyone.
func seatSpotlight(s *cs.Spotlight, codex cs.Codex, c cs.Ctx, sight Sight) *cs.Spotlight {
	if s == nil || sight.Secrets || sight.Codex || (!c.HasGM() && cs.CanInCampaign(c, "codex:reveal", "")) {
		return s
	}
	if !slices.ContainsFunc(codex.Entries, func(e cs.CodexEntry) bool { return e.ID == s.EntryID }) {
		return nil
	}
	if len(s.Audience) == 0 {
		return s
	}
	held := HeldBy(c)
	mine := []string{}
	for _, id := range s.Audience {
		if holds(held, id) {
			mine = append(mine, id)
		}
	}
	if len(mine) == 0 {
		return nil
	}
	return &cs.Spotlight{EntryID: s.EntryID, Audience: mine, At: s.At}
}

// The whispers a seat receives (view.seat.ts seatWhispers, house decision #93): the side that runs the session with a
// GM (the one that sends them) gets every one. Anyone else gets only whispers to a character it holds, with only those
// readers: never another reader's reply, name or existence. The screen holds none, so it gets none.
func seatWhispers(whispers []cs.Whisper, c cs.Ctx, sight Sight) []cs.Whisper {
	if sight.Tables {
		return whispers
	}
	held := HeldBy(c)
	out := []cs.Whisper{}
	for _, w := range whispers {
		mine := []cs.WhisperReader{}
		for _, r := range w.Readers {
			if holds(held, r.ActorID) {
				mine = append(mine, r)
			}
		}
		if len(mine) > 0 {
			w.Readers = mine
			out = append(out, w)
		}
	}
	return out
}

// The pools a seat receives (house decision #59). The GM side (a room with a GM, a seat that runs the table; the same
// notion as CheckPoolEditable) gets every pool. Anyone else gets `public` ones, `party` ones, and `owner` ones only for a
// `party`-scope pool and a seat holding a character (never the screen); `gm` and every other `owner` pool reach nobody.
// A pool the seat may not see is dropped whole. Without a ruleset in the view, none.
func seatPools(pools []cs.PoolState, compiled *engine.CompiledRuleset, c cs.Ctx) []cs.PoolState {
	out := []cs.PoolState{}
	if compiled == nil {
		return out
	}
	gmSide := c.HasGM() && SightOf(c).Tables
	holder := !isScreen(c) && len(HeldBy(c)) > 0
	for _, p := range pools {
		if gmSide || p.Visibility == "public" || p.Visibility == "party" || (p.Visibility == "owner" && p.Scope == "party" && holder) {
			out = append(out, p)
		}
	}
	return out
}

// The rolls and dealt cards a seat receives (house decision #49): the side that runs the table with a GM sees them all.
// Anyone else sees what the table's visibility shows: `party` to every seat, `owner` to the seat that holds the card's
// character. A `gm` one, and every card without a GM, reaches nobody else.
func seatTables(rolls []cs.RollRow, dealt []cs.DealtRow, c cs.Ctx, sight Sight) ([]cs.RollRow, []cs.DealtRow) {
	held := HeldBy(c)
	outRolls, outDealt := []cs.RollRow{}, []cs.DealtRow{}
	for _, r := range rolls {
		if sight.Tables || r.Visibility == "party" {
			outRolls = append(outRolls, r)
		}
	}
	for _, d := range dealt {
		if sight.Tables || d.Visibility == "party" || (d.Visibility == "owner" && holds(held, d.ActorID)) {
			outDealt = append(outDealt, d)
		}
	}
	return outRolls, outDealt
}

// The spend requests a seat receives (view.seat.ts seatRequests): the side that answers them sees every pending request,
// a player their own and their own answers (that side sees every answer). An ask for a spend that costs pools also
// reaches every seat that receives each of those pools (house decision #84); one that costs no pool stays with the
// asker and that side.
func seatRequests(requests []cs.SpendRequest, answers []cs.RequestAnswer, c cs.Ctx, sight Sight,
	compiled *engine.CompiledRuleset, pools []cs.PoolState) ([]cs.SpendRequest, []cs.RequestAnswer) {
	if sight.Requests {
		return requests, answers
	}
	mine := func(userID string) bool { return c.UserID != nil && userID == *c.UserID }
	onSeenPools := func(q cs.SpendRequest) bool {
		if q.SpendID == nil || compiled == nil {
			return false
		}
		spend := compiled.Ruleset.SpendOf(*q.SpendID)
		if spend == nil {
			return false
		}
		charged := 0
		for _, cost := range spend.Cost {
			if cost.Pool == nil {
				continue
			}
			charged++
			if !slices.ContainsFunc(pools, func(p cs.PoolState) bool { return p.ID == *cost.Pool }) {
				return false
			}
		}
		return charged > 0
	}
	outRequests, outAnswers := []cs.SpendRequest{}, []cs.RequestAnswer{}
	for _, q := range requests {
		if mine(q.UserID) || onSeenPools(q) {
			outRequests = append(outRequests, q)
		}
	}
	for _, r := range answers {
		if mine(r.UserID) {
			outAnswers = append(outAnswers, r)
		}
	}
	return outRequests, outAnswers
}

// The clocks a seat receives: the clock side sees every clock, anyone else the `party` ones. A clock's entry id is sent
// only when the seat can read that entry, so a hidden entry's id never leaks.
func seatClocks(clocks []cs.Clock, codex cs.Codex, sight Sight) []cs.Clock {
	out := []cs.Clock{}
	for _, k := range clocks {
		if !sight.Clocks && k.Visibility != "party" {
			continue
		}
		if k.EntryID != nil && !slices.ContainsFunc(codex.Entries, func(e cs.CodexEntry) bool { return e.ID == *k.EntryID }) {
			k.EntryID = nil
		}
		out = append(out, k)
	}
	return out
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
	// House decision #117: a combatant the GM shows in full reaches every seat, cut to what the seat may read.
	shown := map[string]bool{}
	if state.Encounter != nil {
		for _, cb := range state.Encounter.Combatants {
			if cb.Visibility == "full" {
				shown[cb.ActorID] = true
			}
		}
	}
	actors := []cs.Actor{}
	for _, a := range state.Actors {
		if !slices.Contains(partyKinds, a.Kind) && !holds(held, a.ID) && !sight.Combat && !shown[a.ID] {
			continue
		}
		out := a
		if !holds(held, a.ID) && !ActorGmSide(c, a.Kind) {
			out.OwnerUserID = nil
			// The saved build, sheet and play figures: the GM side and the seat holding the character (house decisions #63, #64).
			out.Ledger = nil
			// The spawn options it was spawned with: the GM side and a seat holding it (house decision #92).
			out.SpawnOptions = nil
			// The items it holds, as its saved build's lines (house decision #95).
			out.Items = []cs.ActorItem{}
		}
		if out.Items == nil {
			out.Items = []cs.ActorItem{}
		}
		v, seen := views[a.ID]
		if seen {
			out.Entity, out.Fields, out.Resources, out.Derived = v.Entity, v.Fields, v.Resources, v.Derived
			out.Conditions = slices.Clone(v.Conditions)
		} else {
			out.Entity, out.Fields, out.Resources, out.Derived = "", map[string]any{}, map[string]float64{}, map[string]float64{}
			out.Conditions = []string{}
		}
		out.Held = seatHeld(a, compiled, seen, holds(held, a.ID) || ActorGmSide(c, a.Kind), out.Fields)
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
	if !sight.Session && !sight.TableRun {
		state.TestDefs = []cs.TestDef{}
	}
	state.Journal = seatJournal(state.Journal, sight)
	state.Encounter = seatEncounter(state.Encounter, views, sight)
	if !sight.Party && !cs.CanInCampaign(c, "member:invite", "") {
		state.Access.Invites = []cs.Invite{}
	}
	return state
}

// seatJournal is the GM's journal as one seat receives it (house decision #85): the seats that run the room, as the
// Test definitions go; the notes only to the session side, so a room without a GM runs it with no notes in it.
func seatJournal(journal []cs.JournalSession, sight Sight) []cs.JournalSession {
	if !sight.Session && !sight.TableRun {
		return []cs.JournalSession{}
	}
	out := append([]cs.JournalSession{}, journal...)
	if !sight.Session {
		for i := range out {
			out[i].Notes = ""
		}
	}
	return out
}

// seatHeld is the records an actor holds as one seat receives them (house decision #88): none where the seat does not
// see the actor's values; whole for the seat holding it and the GM side; otherwise a kind with an unseen word shows
// that word and the effects, never the entry's name, key or cite. A kind the ruleset no longer has is left out, and so
// is a record of a kind without an unseen word whose list field the seat may not read (house decision #117: a creature
// shown in full reaches every seat). fields is the actor's fields as the seat reads them.
func seatHeld(a cs.Actor, compiled *engine.CompiledRuleset, seen, named bool, fields map[string]any) []cs.HeldRecord {
	out := []cs.HeldRecord{}
	if !seen || compiled == nil {
		return out
	}
	for _, r := range a.Held {
		kind, known := compiled.Ruleset.Held[r.Kind]
		_, readable := fields[kind.Field]
		switch {
		case !known:
			continue
		case kind.Unseen != nil && !named:
			out = append(out, cs.HeldRecord{Kind: r.Kind, Name: *kind.Unseen, Effects: r.Effects})
		case !named && !readable:
			continue
		default:
			out = append(out, r)
		}
	}
	return out
}

// The Encounter one seat receives. The combat side sees every Combatant. Anyone else gets no hidden Combatant at all,
// the turn passes over a hidden one without naming it, a bar Combatant carries its fraction and no numbers, and the GM's
// own mark (keep) stays home. Health numbers are sent only where the seat may see that actor's resource, and a
// Combatant's conditions are the ones the ruleset lets the seat see on that actor (house decision #67).
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
	conditionsOf := func(cb cs.Combatant) []cs.CombatantCondition {
		conditions := []cs.CombatantCondition{}
		for _, x := range cb.Conditions {
			if slices.Contains(views[cb.ActorID].Conditions, x.ID) {
				conditions = append(conditions, x)
			}
		}
		return conditions
	}
	out := *e
	if sight.Combat {
		out.Combatants = make([]cs.Combatant, len(e.Combatants))
		for i, cb := range e.Combatants {
			cb.HP = hpOf(cb)
			cb.Conditions = conditionsOf(cb)
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
	out.Reminders = nil // a line may name a hidden combatant (house decision #81)
	out.TurnBack = nil  // the GM's tracker only, and it may name a hidden combatant (house decision #82)
	out.Log = nil       // the GM's tracker only: it names hidden combatants (house decision #100)
	if !isSeen(e.CurrentID) {
		out.CurrentID = nil
		// Someone the seat is not sent holds the turn: said, never named (house decision #68).
		out.Unseen = e.CurrentID != nil
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
		cb.Conditions = conditionsOf(cb)
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
	seen := []cs.CodexEntry{}
	ids := map[string]bool{}
	for _, e := range codex.Entries {
		shown := e.Visibility != "gm" && (e.AudienceMode == "all" || slices.ContainsFunc(e.Audience, func(a string) bool { return holds(held, a) }))
		if sight.Secrets || sight.Codex || shown {
			seen = append(seen, e)
			ids[e.ID] = true
		}
	}
	entries := []cs.CodexEntry{}
	for _, e := range seen {
		if !sight.Secrets {
			e.GMNotes = ""
		}
		if !sight.Secrets && !sight.Codex {
			e.Body = hideMentions(e.Body, func(id string) bool { return ids[id] })
		}
		// A link or a parent reaches a seat only when both its ends do: an id never reveals a hidden entry.
		if e.ParentID != nil && !ids[*e.ParentID] {
			e.ParentID = nil
		}
		links := []string{}
		for _, l := range e.Links {
			if ids[l] {
				links = append(links, l)
			}
		}
		e.Links = links
		// A scene's plan, its prepared lines and where it stands reach the codex and secrets sides only (house decision
		// #73): those read every entry, so an exit or a reveal never names one a seat cannot read.
		if !sight.Secrets && !sight.Codex {
			e.PlannedTests = []string{}
			// A picture reaches the table only once it is shown to it (house decision #70).
			if !e.ImageRevealed {
				e.ImageID = nil
			}
			e.ImageRevealed = e.ImageID != nil
			e.Prep = nil
			e.Source = nil // the pack entry it was made from (house decision #97)
			if e.Kind == "scene" {
				e.Status = nil
			}
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
	out := cs.Codex{Entries: entries, Recaps: codex.Recaps}
	if !sight.Secrets && !sight.Codex {
		// A recap's mentions are hidden like an entry body's (house decision #136).
		out.Recaps = make([]cs.SessionRecap, len(codex.Recaps))
		for i, r := range codex.Recaps {
			r.Recap = hideMentions(r.Recap, func(id string) bool { return ids[id] })
			out.Recaps[i] = r
		}
	}
	if sight.Secrets || sight.Codex {
		out.LatestBegin = codex.LatestBegin // the sides that see a scene's status (house decision #105)
	}
	return out
}

// ShowsPicture says whether a seat outside the codex side receives the picture's id: the picture route serves it only
// then, so the route and the view never disagree.
func ShowsPicture(codex cs.Codex, c cs.Ctx, imageID string) bool {
	return slices.ContainsFunc(seatCodex(codex, c, SightOf(c)).Entries, func(e cs.CodexEntry) bool {
		return e.ImageID != nil && *e.ImageID == imageID
	})
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
	// Without a GM every call is the whole table's: the targets are public, so each character counts as the seat's own.
	mineOf := func(id string) bool { return sight.TableRun || holds(held, id) }
	// Without a GM a seat that may call Tests is the table's GM side for offers (house decision #170).
	offering := sight.TableRun && cs.CanInCampaign(c, "test:call", "")
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
			call.Acquire = nil // what a seat asks to acquire is not the room's screen's (house decision #102)
			out = append(out, call)
		}
		return out
	}
	for _, call := range tests {
		var mine []cs.TestTargetState
		for _, t := range call.Targets {
			if mineOf(t.ActorID) {
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
			own := mineOf(t.ActorID)
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
			// The state keeps a gmless room's offers only where the call shows what they read (house decision #170).
			if offering {
				seen.Offers = t.Offers
			}
			if t.Report != nil {
				r := cs.TestResult{Natural: t.Report.Natural, Flags: t.Report.Flags}
				// A choice moves the number to beat (house decision #170), so it is told as the total is.
				if own && call.ShowModifier {
					r.Total, r.Choices = t.Report.Total, t.Report.Choices
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
