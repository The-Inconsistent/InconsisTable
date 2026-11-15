package recap

import (
	"fmt"
	"strings"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func input(events ...Event) Input {
	return Input{
		Events: events,
		ActorName: func(id string) (string, bool) {
			return map[string]string{"ada": "Ada", "bo": "Bo"}[id], id == "ada" || id == "bo"
		},
		ResourceLabel: func(id string) (string, bool) { return "HP", id == "hp" },
		OutcomeLabel: func(_, outcome string) string {
			if outcome == "partial" {
				return "partial hit"
			}
			return outcome
		},
		Clocks: []cs.Clock{
			{ID: "k1", Name: "Doom", Segments: 4, Visibility: "party"},
			{ID: "k2", Name: "Secret plot", Segments: 4, Visibility: "gm"},
		},
		EntryTitle: func(id string) (string, bool) {
			return "Title of " + id, id != "hidden" && id != "listed"
		},
	}
}

func ev(kind string, payload map[string]any) Event { return Event{Type: kind, Payload: payload} }

func change(target map[string]any, before, after float64) Event {
	return ev("delta", map[string]any{"target": target, "before": before, "after": after})
}

func TestDraftTellsEachKindInOrder(t *testing.T) {
	got := Draft(input(
		ev("encounter.start", map[string]any{"encounterId": "e1"}),
		change(map[string]any{"clock": "k1"}, 3, 4),
		ev("codex.reveal", map[string]any{"entryId": "map", "visibility": "party", "audienceMode": "all"}),
		ev("test.close", map[string]any{"testId": "check", "reports": []any{
			map[string]any{"actorId": "ada", "outcome": "partial", "total": 9.0},
			map[string]any{"actorId": "ogre", "outcome": "success"},
		}}),
		change(map[string]any{"actorId": "bo", "resource": "hp"}, 3, 0),
		ev("encounter.end", map[string]any{"encounterId": "e1", "round": 3.0}),
	))
	want := strings.Join([]string{
		"- Ada's Check: Partial hit",
		"- Revealed: Title of map",
		"- Encounter started",
		"- Encounter ended after 3 rounds",
		"- Clock filled: Doom",
		"- Bo is down to 0 HP",
	}, "\n")
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestDraftLeavesOutWhatTheTableDidNotSee(t *testing.T) {
	got := Draft(input(
		ev("codex.reveal", map[string]any{"entryId": "hidden", "visibility": "party", "audienceMode": "all"}),
		ev("codex.reveal", map[string]any{"entryId": "listed", "visibility": "party", "audienceMode": "listed"}),
		ev("codex.reveal", map[string]any{"entryId": "map", "visibility": "gm", "audienceMode": "all"}),
		change(map[string]any{"clock": "k2"}, 3, 4),
		change(map[string]any{"clock": "k1"}, 2, 3), // not full
		change(map[string]any{"actorId": "ogre", "resource": "hp"}, 3, 0),
		change(map[string]any{"actorId": "ada", "resource": "mana"}, 3, 0), // a resource the table does not see
		Event{Type: "delta", Undone: true, Payload: map[string]any{"target": map[string]any{"clock": "k1"}, "before": 3.0, "after": 4.0}},
	))
	if got != "" {
		t.Fatalf("expected nothing, got:\n%s", got)
	}
}

func TestDraftEndedGameIsToldOnceWithItsRanking(t *testing.T) {
	got := Draft(input(
		ev("encounter.end", map[string]any{"encounterId": "g1", "round": 5.0}),
		ev("game.end", map[string]any{"encounterId": "g1", "results": []any{
			map[string]any{"actorId": "bo", "score": 12.0, "place": 1.0},
			map[string]any{"actorId": "ada", "score": 9.0, "place": 2.0},
			map[string]any{"actorId": "bot", "score": 20.0, "place": 3.0},
		}}),
	))
	if want := "- Game ended: 1. Bo (12), 2. Ada (9)"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDraftStopsAtTheCap(t *testing.T) {
	events := []Event{}
	for i := range 60 {
		events = append(events, ev("test.close", map[string]any{"testId": "check", "reports": []any{
			map[string]any{"actorId": "ada", "outcome": fmt.Sprintf("o%d", i)},
		}}))
	}
	lines := strings.Split(Draft(input(events...)), "\n")
	if len(lines) != MaxLines || lines[0] != "- Ada's Check: O0" {
		t.Fatalf("%d lines, first %q", len(lines), lines[0])
	}
}
