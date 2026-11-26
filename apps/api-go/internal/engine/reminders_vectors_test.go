package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Reminder lines and a condition's starting count (house decision #81), against what TypeScript answered.
type reminderVectorFile struct {
	Manifests []any `json:"reminderManifests"`
	Reminders []struct {
		Manifest int    `json:"manifest"`
		At       string `json:"at"`
		Actors   map[string]struct {
			Fields     map[string]any `json:"fields"`
			Entity     string         `json:"entity"`
			Conditions []string       `json:"conditions"`
			Held       bool           `json:"held"`
			Barred     bool           `json:"barred"`
		} `json:"actors"`
		Order []string `json:"order"`
		Round float64  `json:"round"`
		Lines any      `json:"lines"`
	} `json:"reminders"`
	Armed []struct {
		Duration     string   `json:"duration"`
		From         *string  `json:"from"`
		HolderActing bool     `json:"holderActing"`
		Typed        *float64 `json:"typed"`
		Ticks        *float64 `json:"ticks"`
	} `json:"armed"`
}

func TestRemindersMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v reminderVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Reminders) == 0 || len(v.Armed) == 0 {
		t.Fatal("no reminder vectors, so this test would prove nothing")
	}
	compiled := make([]*CompiledRuleset, len(v.Manifests))
	for i, m := range v.Manifests {
		compiled[i] = mustCompile(t, m)
	}
	f := &failures{t: t}
	shown := 0
	for i, x := range v.Reminders {
		actors := map[string]ReminderActor{}
		for id, a := range x.Actors {
			b := ReminderActor{Entity: a.Entity, Conditions: a.Conditions, Held: a.Held, Barred: a.Barred}
			if a.Fields != nil {
				b.Scope = ActorScope(a.Fields, nil, nil, 0, nil)
			}
			actors[id] = b
		}
		lines := compiled[x.Manifest].RemindersOf(x.At, actors, x.Order, x.Round)
		shown += len(lines)
		if got := viaJSON(t, lines); !reflect.DeepEqual(got, x.Lines) {
			f.add("case %d: want %v, got %v", i, x.Lines, got)
		}
	}
	if shown == 0 {
		t.Fatal("no vector shows a line")
	}
	for i, x := range v.Armed {
		got := ArmedTicks(&Condition{Duration: x.Duration, From: x.From}, x.HolderActing, x.Typed)
		if (got == nil) != (x.Ticks == nil) || (got != nil && *got != *x.Ticks) {
			f.add("armed %d: want %v, got %v", i, x.Ticks, got)
		}
	}
	f.done(len(v.Reminders) + len(v.Armed))
}
