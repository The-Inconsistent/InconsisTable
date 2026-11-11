package engine

import (
	"fmt"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// CreationChoice is a pick to store as actor_choice.
type CreationChoice struct {
	StepID    string `json:"stepId"`
	Ordinal   int    `json:"ordinal"`
	OptionKey string `json:"optionKey"`
}

// EntryLookup finds an entry a step may pick. The caller scopes it to what the seat may see (a gm entry is not for
// players), and returns nil when there is none.
type EntryLookup func(entityType, key string) *PackEntry

var (
	creationKeys   = schema.Array(schema.String().Min(1).Max(120)).Max(20)
	creationScores = schema.Record(fieldIDSchema, schema.Int())
	creationValues = schema.Record(fieldIDSchema, fieldValueInput)
)

func parsedObject(s schema.Schema, value any) (map[string]any, bool) {
	out, issues := schema.Parse(s, value)
	if len(issues) > 0 {
		return nil, false
	}
	return out.(map[string]any), true
}

type creationRun struct {
	problems problems
	entity   *EntityType
	fields   map[string]any
}

func (c *creationRun) put(field string, value any, path string) {
	def, ok := c.entity.Fields[field]
	if !ok {
		c.problems.add(path, "no such field")
	} else if why := CheckFieldValue(&def, value); why != "" {
		c.problems.add(path, "%s", why)
	}
	c.fields[field] = value
}

func joinNumbers(values []float64) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = esNumber(v)
	}
	return strings.Join(parts, ", ")
}

func (c *creationRun) choose(step *CreationStep, answer any, lookup EntryLookup) []CreationChoice {
	parsed, issues := schema.Parse(creationKeys, answer)
	if len(issues) > 0 {
		c.problems.add(step.ID, "expected a list of entry keys")
		return nil
	}
	keys := parsed.([]any)
	if float64(len(keys)) != step.Count {
		c.problems.add(step.ID, "pick %s, got %d", esNumber(step.Count), len(keys))
	}
	seen := map[string]bool{}
	for _, key := range keys {
		seen[key.(string)] = true
	}
	if len(seen) != len(keys) {
		c.problems.add(step.ID, "the same entry twice")
	}
	var choices []CreationChoice
	for ordinal, raw := range keys {
		key := raw.(string)
		entry := lookup(step.Pick, key)
		if entry == nil {
			c.problems.add(fmt.Sprintf("%s[%d]", step.ID, ordinal), `no %s "%s"`, step.Pick, key)
			continue
		}
		choices = append(choices, CreationChoice{step.ID, ordinal, key})
		for _, rule := range step.Copy {
			if value, ok := entry.Body[rule.From]; ok {
				c.put(rule.To, value, step.ID+"."+rule.To)
			}
		}
	}
	return choices
}

// Scores are read in the step's field order, then any other key sorted, because decoded JSON has lost the order they
// were sent in. TypeScript reads them as sent, which is the same for a client that sends them in the step's order (the
// builder does). Otherwise, with a repeated score in a table, it can blame a different field, on an answer refused
// either way.
func (c *creationRun) assign(step *CreationStep, answer any) {
	scores, ok := parsedObject(creationScores, answer)
	if !ok {
		c.problems.add(step.ID, "expected a score for each field")
		return
	}
	names := []string{}
	for _, f := range step.Fields {
		if _, has := scores[f]; !has {
			c.problems.add(step.ID+"."+f, "needs a score")
		} else if !slices.Contains(names, f) {
			names = append(names, f)
		}
	}
	for _, f := range sortedKeys(scores) {
		if !slices.Contains(names, f) {
			names = append(names, f)
		}
	}
	for _, f := range names {
		if !slices.Contains(step.Fields, f) {
			c.problems.add(step.ID+"."+f, "not a field of this step")
		}
	}
	m := step.Method
	if m.Kind == "table" {
		left := slices.Clone(m.Values)
		for _, f := range names {
			score := scores[f].(float64)
			if at := slices.Index(left, score); at < 0 {
				c.problems.add(step.ID+"."+f, "%s is not left in the table (%s)", esNumber(score), joinNumbers(m.Values))
			} else {
				left = slices.Delete(left, at, at+1)
			}
		}
	} else {
		spent := 0.0
		for _, f := range names {
			score := scores[f].(float64)
			cost, priced := m.Costs[esNumber(score)]
			if score < m.Min || score > m.Max || !priced {
				c.problems.add(step.ID+"."+f, "%s is outside %s to %s", esNumber(score), esNumber(m.Min), esNumber(m.Max))
			} else {
				spent += cost
			}
		}
		if spent > m.Budget {
			c.problems.add(step.ID, "%s points spent, over the budget of %s", esNumber(spent), esNumber(m.Budget))
		}
	}
	for _, f := range step.Fields {
		if score, has := scores[f]; has {
			c.put(f, score, step.ID+"."+f)
		}
	}
}

func (c *creationRun) freeFields(step *CreationStep, answer any) {
	values, ok := parsedObject(creationValues, answer)
	if !ok {
		c.problems.add(step.ID, "expected a value for each field")
		return
	}
	for _, f := range sortedKeys(values) {
		if !slices.Contains(step.Fields, f) {
			c.problems.add(step.ID+"."+f, "not a field of this step")
		}
	}
	for _, f := range step.Fields {
		if value, has := values[f]; has {
			c.put(f, value, step.ID+"."+f)
		} else {
			c.problems.add(step.ID+"."+f, "needs a value")
		}
	}
}

// RunCreation runs the ruleset's creation for one actor entity against a builder's answers, by step id. The server runs
// it again before it writes (the client's preview is only a preview). It returns the fields to write and the choices to
// store, or the problems, whose paths start at the step id.
func (r *Ruleset) RunCreation(actor string, answers map[string]any, lookup EntryLookup) (map[string]any, []CreationChoice, []Problem) {
	entity := r.entity(actor)
	if entity == nil || entity.Base != "actor" {
		return nil, nil, []Problem{{"(root)", fmt.Sprintf(`"%s" is not an actor entity`, actor)}}
	}
	run := &creationRun{entity: entity, fields: map[string]any{}}
	var steps []*CreationStep
	for i := range r.Creation {
		if r.Creation[i].Actor == actor {
			steps = append(steps, &r.Creation[i])
		}
	}
	for _, id := range sortedKeys(answers) {
		if !slices.ContainsFunc(steps, func(s *CreationStep) bool { return s.ID == id }) {
			run.problems.add(id, "no such step")
		}
	}
	choices := []CreationChoice{}
	for _, step := range steps {
		answer, answered := answers[step.ID]
		if !answered {
			if !step.Optional {
				run.problems.add(step.ID, "this step needs an answer")
			}
			continue
		}
		switch step.Kind {
		case "choose":
			choices = append(choices, run.choose(step, answer, lookup)...)
		case "assign":
			run.assign(step, answer)
		default:
			run.freeFields(step, answer)
		}
	}
	if len(run.problems) > 0 {
		return nil, nil, run.problems
	}
	return run.fields, choices, nil
}
