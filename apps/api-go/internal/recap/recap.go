// Package recap drafts a session's recap from its event log, for the GM to edit at the end of the session (docs/design.md
// §3.4, "Sau"). It is a pure function over the logged rows and what the table already sees: it names only what the whole
// table saw (house decision #47). It is a GM-side read of the table, never a seat view, so it has no TypeScript twin.
package recap

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// MaxLines is the longest draft.
const MaxLines = 40

// Event is one session_event row of the running session, oldest first. Undone deltas are skipped.
type Event struct {
	Type    string
	Payload map[string]any
	Undone  bool
}

// Input is the log and the names it needs. Every resolver answers only for what the table saw: a name or title it does
// not know leaves its line out.
type Input struct {
	Events []Event
	// ActorName names a character of the party (pc, companion); false for anyone else.
	ActorName func(id string) (string, bool)
	// ResourceLabel names a resource the whole table sees; false for an owner or gm one.
	ResourceLabel func(resourceID string) (string, bool)
	// OutcomeLabel is how the ruleset calls a Test's outcome.
	OutcomeLabel func(testID, outcome string) string
	Clocks       []cs.Clock // the room's clocks now; only `party` ones are told
	// EntryTitle is the title of an entry shown to the whole table; false for a gm or listed one.
	EntryTitle func(id string) (string, bool)
}

func upperFirst(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[n:]
}

func text(m map[string]any, key string) string { s, _ := m[key].(string); return s }

func number(v any) (float64, bool) { n, ok := v.(float64); return n, ok }

// Draft is the bullet lines of what happened, grouped by kind and oldest first within each: Tests, entries shown,
// encounters, clocks filled, resources at zero, games ended. At most MaxLines.
func Draft(in Input) string {
	groups := map[string][]string{}
	add := func(group, line string) { groups[group] = append(groups[group], line) }
	shown := map[string]bool{}
	gameOf := map[string]bool{}
	for _, e := range in.Events {
		if e.Type == "game.end" {
			gameOf[text(e.Payload, "encounterId")] = true
		}
	}
	for _, e := range in.Events {
		p := e.Payload
		switch e.Type {
		case "test.close":
			test := text(p, "testId")
			reports, _ := p["reports"].([]any)
			for _, r := range reports {
				row, _ := r.(map[string]any)
				name, ok := in.ActorName(text(row, "actorId"))
				if !ok || text(row, "outcome") == "" {
					continue
				}
				add("test", fmt.Sprintf("%s's %s: %s", name, upperFirst(test), upperFirst(in.OutcomeLabel(test, text(row, "outcome")))))
			}
		case "codex.reveal":
			id := text(p, "entryId")
			if title, ok := in.EntryTitle(id); ok && !shown[id] && text(p, "visibility") != "gm" && text(p, "audienceMode") == "all" {
				shown[id] = true
				add("reveal", "Revealed: "+title)
			}
		case "encounter.start":
			add("encounter", "Encounter started")
		case "encounter.end":
			if gameOf[text(p, "encounterId")] {
				continue // the game's own line tells it
			}
			if round, ok := number(p["round"]); ok {
				add("encounter", fmt.Sprintf("Encounter ended after %d rounds", int(round)))
			} else {
				add("encounter", "Encounter ended")
			}
		case "delta":
			if !e.Undone {
				delta(in, p, add)
			}
		case "game.end":
			add("game", gameLine(in, p))
		}
	}
	lines := []string{}
	for _, g := range []string{"test", "reveal", "encounter", "clock", "resource", "game"} {
		for _, l := range groups[g] {
			lines = append(lines, "- "+l)
		}
	}
	if len(lines) > MaxLines {
		lines = lines[:MaxLines]
	}
	return strings.Join(lines, "\n")
}

// A clock this delta filled to its last segment, or a party resource it dropped to zero.
func delta(in Input, p map[string]any, add func(group, line string)) {
	target, _ := p["target"].(map[string]any)
	before, hadBefore := number(p["before"])
	after, hasAfter := number(p["after"])
	if !hasAfter {
		return
	}
	if id := text(target, "clock"); id != "" {
		for _, k := range in.Clocks {
			if k.ID == id && k.Visibility == "party" && int(after) == k.Segments && (!hadBefore || before < after) {
				add("clock", "Clock filled: "+k.Name)
			}
		}
		return
	}
	resource := text(target, "resource")
	if resource == "" || after != 0 || !hadBefore || before <= 0 {
		return
	}
	name, isParty := in.ActorName(text(target, "actorId"))
	label, shown := in.ResourceLabel(resource)
	if isParty && shown {
		add("resource", fmt.Sprintf("%s is down to 0 %s", name, label))
	}
}

func gameLine(in Input, p map[string]any) string {
	results, _ := p["results"].([]any)
	parts := []string{}
	for _, r := range results {
		row, _ := r.(map[string]any)
		name, ok := in.ActorName(text(row, "actorId"))
		if !ok {
			continue
		}
		score, _ := number(row["score"])
		if place, hasPlace := number(row["place"]); hasPlace {
			parts = append(parts, fmt.Sprintf("%d. %s (%g)", int(place), name, score))
		} else if outcome := text(row, "outcome"); outcome != "" {
			parts = append(parts, name+": "+outcome)
		}
	}
	if len(parts) == 0 {
		return "Game ended"
	}
	return "Game ended: " + strings.Join(parts, ", ")
}
