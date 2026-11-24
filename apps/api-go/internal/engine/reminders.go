package engine

import (
	"errors"
	"slices"
)

// The reminder lines of a fight (house decision #81; rules-engine reminders.ts): the ruleset's own words, never an
// effect on a number. Pure: the api decides which moment it is and who is asked, and sends the lines to the side running
// the fight only.

// ReminderActor is the part of a combatant a reminder reads. Scope is nil for an actor whose values cannot be read.
type ReminderActor struct {
	Scope      *Record
	Conditions []string
	Held       bool
	Barred     bool
}

// ReminderLine is one line due: a reminder of `reminders` (Source "reminder") or a condition with `at` and `text`.
// ActorIDs are the combatants it holds for, in the order given; empty for a reminder with no `if`.
type ReminderLine struct {
	Source   string   `json:"source"`
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	Cite     *string  `json:"cite"`
	ActorIDs []string `json:"actorIds"`
}

// RemindersOf is the lines due at this moment, asked of the combatants in order (the one whose turn it is, or every
// combatant at the round's end): the declared reminders in manifest order, then the conditions with a line that one of
// them holds. A reminder with an `if` shows when it holds for at least one; a value it cannot read holds for nobody.
func (c *CompiledRuleset) RemindersOf(at string, actors map[string]ReminderActor, order []string, round float64) []ReminderLine {
	lines := []ReminderLine{}
	for i, r := range c.Ruleset.Reminders {
		if r.At != at {
			continue
		}
		line := ReminderLine{Source: "reminder", ID: r.ID, Text: r.Text, Cite: r.Cite, ActorIDs: []string{}}
		expr := c.Reminders[i]
		if expr == nil {
			lines = append(lines, line)
			continue
		}
		for _, id := range order {
			a, ok := actors[id]
			if !ok || a.Scope == nil {
				continue
			}
			scope := &Record{make(map[string]any, len(a.Scope.Fields)+3)}
			for k, v := range a.Scope.Fields {
				scope.Fields[k] = v
			}
			scope.Fields["round"], scope.Fields["held"], scope.Fields["barred"] = round, a.Held, a.Barred
			holds, err := evaluateBool(expr, scope)
			var exprErr ExprError
			if err != nil && !errors.As(err, &exprErr) {
				panic(err)
			}
			if holds {
				line.ActorIDs = append(line.ActorIDs, id)
			}
		}
		if len(line.ActorIDs) > 0 {
			lines = append(lines, line)
		}
	}
	for _, cond := range c.Ruleset.Conditions {
		if cond.At == nil || *cond.At != at || cond.Text == nil {
			continue
		}
		line := ReminderLine{Source: "condition", ID: cond.ID, Text: *cond.Text, Cite: cond.Cite, ActorIDs: []string{}}
		for _, id := range order {
			if a, ok := actors[id]; ok && slices.Contains(a.Conditions, cond.ID) {
				line.ActorIDs = append(line.ActorIDs, id)
			}
		}
		if len(line.ActorIDs) > 0 {
			lines = append(lines, line)
		}
	}
	return lines
}

// ImmuneTo is whether a condition's `immune` holds for an actor (house decision #81). A condition without one, an actor
// whose values cannot be read, or a value its expression cannot read: not immune.
func (c *CompiledRuleset) ImmuneTo(condition string, scope *Record) bool {
	expr, ok := c.Immune[condition]
	if !ok || scope == nil {
		return false
	}
	holds, err := evaluateBool(expr, scope)
	var exprErr ExprError
	if err != nil && !errors.As(err, &exprErr) {
		panic(err)
	}
	return holds
}

// ArmedTicks is the count a condition row starts with when added (house decision #81; rules-engine armedTicks): what
// the GM typed, else 2 for a condition armed `from: "nextOwnTurn"` added during its holder's own turn (that turn's end
// is one tick, the next turn's the last), else nil (one tick).
func ArmedTicks(def *Condition, holderActing bool, typed *float64) *float64 {
	if typed != nil {
		return typed
	}
	if def.From != nil && *def.From == "nextOwnTurn" && def.Duration == "ownTurnEnd" && holderActing {
		two := 2.0
		return &two
	}
	return nil
}
