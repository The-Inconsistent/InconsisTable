package engine

import (
	"maps"
	"slices"
)

// House decision #92: what spawning a pack entry carries (spawn.ts). PlanSpawn says which options the actor keeps and
// what the adjustments add, fixed at spawn; BudgetOf reads the encounter budget's lines. Both read the manifest's own
// text; CompileRuleset has type-checked every expression.

// SpawnRoom is what a spawn reads of the room: campaign, party.characters and party.seated.
type SpawnRoom struct {
	Campaign   map[string]any `json:"campaign"`
	Characters float64        `json:"characters"`
	Seated     float64        `json:"seated"`
}

// SpawnPlan is planSpawn's answer.
type SpawnPlan struct {
	Options   []string           `json:"options"`
	Fields    map[string]any     `json:"fields"`
	Resources map[string]float64 `json:"resources"`
}

// spawnRead is an expression's value, or nil when it cannot be read.
func spawnRead(source string, scope *Record) any {
	node, err := ParseExpr(source)
	if err != nil {
		return nil
	}
	v, err := Evaluate(node, scope)
	if err != nil {
		return nil
	}
	return v
}

func (room SpawnRoom) record() map[string]any {
	out := map[string]any{"party": &Record{map[string]any{"characters": room.Characters, "seated": room.Seated}}}
	if room.Campaign != nil {
		out["campaign"] = &Record{room.Campaign}
	}
	return out
}

// SpawnScope is spawn.ts spawnScope: one entry's values, the room, and ctx.
func SpawnScope(values map[string]any, room SpawnRoom, ctx map[string]any) *Record {
	scope := NestFields(values)
	maps.Copy(scope.Fields, room.record())
	scope.Fields["ctx"] = &Record{ctx}
	return scope
}

// PlanSpawn is spawn.ts planSpawn. The refusals are noSuchOption and optionNotHere.
func PlanSpawn(r *Ruleset, entity string, values map[string]any, options []string, room SpawnRoom, mob bool) (*SpawnPlan, *Refusal) {
	scope := SpawnScope(values, room, map[string]any{"mob": mob})
	var declared []SpawnOption
	var adjust []SpawnAdjust
	if r.Spawn != nil {
		declared, adjust = r.Spawn.Options, r.Spawn.Adjust
	}
	for _, id := range options {
		at := slices.IndexFunc(declared, func(o SpawnOption) bool { return o.ID == id })
		if at < 0 {
			return nil, refuse("noSuchOption", `no spawn option "%s"`, id)
		}
		o := declared[at]
		if (o.Entities != nil && !slices.Contains(*o.Entities, entity)) || (o.When != nil && spawnRead(*o.When, scope) != true) {
			return nil, refuse("optionNotHere", `"%s" is not for this entry`, o.Label)
		}
	}
	def := r.entity(entity)
	fields := maps.Clone(values)
	if fields == nil {
		fields = map[string]any{}
	}
	resources := map[string]float64{}
	for _, a := range adjust {
		if (a.Option != nil && !slices.Contains(options, *a.Option)) || (a.Entities != nil && !slices.Contains(*a.Entities, entity)) {
			continue
		}
		if a.When != nil && spawnRead(*a.When, scope) != true {
			continue
		}
		for _, key := range sortedKeys(a.Add) {
			n, isNumber := spawnRead(a.Add[key], scope).(float64)
			if !isNumber {
				continue
			}
			if f, ok := def.fieldDef(key); ok && f.Type == "int" {
				if had, set := fields[key].(float64); set {
					fields[key] = had + n
				}
			} else if slices.ContainsFunc(r.Resources, func(x Resource) bool { return x.ID == key }) {
				resources[key] += n
			}
		}
	}
	return &SpawnPlan{Options: append([]string{}, options...), Fields: fields, Resources: resources}, nil
}

// fieldDef is the entity's field by id; false for none, or no entity.
func (e *EntityType) fieldDef(id string) (FieldDef, bool) {
	if e == nil {
		return FieldDef{}, false
	}
	f, ok := e.Fields[id]
	return f, ok
}

// BudgetPick is one group of creatures a budget line counts.
type BudgetPick struct {
	Values map[string]any `json:"values"`
	Count  float64        `json:"count"`
	Mob    bool           `json:"mob"`
}

// BudgetLine is one budget line read; Budget is nil where it cannot be read.
type BudgetLine struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	Used   float64  `json:"used"`
	Budget *float64 `json:"budget"`
}

// BudgetOf is spawn.ts budgetOf: a reading aid, refusing and storing nothing.
func BudgetOf(r *Ruleset, picks []BudgetPick, room SpawnRoom, switches []string) []BudgetLine {
	if r.Spawn == nil || r.Spawn.Budget == nil {
		return []BudgetLine{}
	}
	b := r.Spawn.Budget
	out := []BudgetLine{}
	for _, l := range b.Lines {
		used := 0.0
		for _, p := range picks {
			if v, ok := spawnRead(l.Cost, SpawnScope(p.Values, room, map[string]any{"count": p.Count, "mob": p.Mob})).(float64); ok {
				used += v
			}
		}
		budget := spawnRead(l.Budget, &Record{room.record()})
		for _, w := range b.Switches {
			if _, isNumber := budget.(float64); !isNumber || !slices.Contains(switches, w.ID) {
				continue
			}
			scope := room.record()
			scope["ctx"] = &Record{map[string]any{"budget": budget}}
			budget = spawnRead(w.By, &Record{scope})
		}
		line := BudgetLine{ID: l.ID, Label: l.Label, Used: used}
		if n, ok := budget.(float64); ok {
			line.Budget = &n
		}
		out = append(out, line)
	}
	return out
}
