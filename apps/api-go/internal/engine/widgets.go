package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// The screen widgets a ruleset's layout row may name (ADR 0010, decision 3; house decision #83). This is the twin of
// packages/rules-engine/src/widgets.ts: the same closed list, held equal by the vectors. The api only validates layouts;
// the web draws them.

// WidgetSlot is one named slot of a widget, which a layout row binds to one path or a list of paths.
type WidgetSlot struct {
	ID           string   `json:"id"`
	List         bool     `json:"list"`
	Required     bool     `json:"required"`
	Takes        string   `json:"takes"`
	SameLengthAs string   `json:"sameLengthAs,omitempty"`
	Variants     []string `json:"variants,omitempty"`
}

// WidgetSpec is one widget of the platform's list.
type WidgetSpec struct {
	ID       string       `json:"id"`
	Variants []string     `json:"variants"`
	Slots    []WidgetSlot `json:"slots"`
	Steps    bool         `json:"steps,omitempty"`
	Ledger   bool         `json:"ledger,omitempty"`
	// Held reads the records the actor holds (house decision #88) instead of bound values.
	Held bool `json:"held,omitempty"`
	// Strike names one of the ruleset's strike kinds in its variant (house decision #99) instead of one of Variants.
	Strike bool `json:"strike,omitempty"`
}

func oneSlot(id, takes string, required bool) WidgetSlot {
	return WidgetSlot{ID: id, Takes: takes, Required: required}
}

func listSlot(id, takes string, required bool) WidgetSlot {
	return WidgetSlot{ID: id, List: true, Takes: takes, Required: required}
}

// Widgets is WIDGETS, without the importer's descriptions (they live on the TypeScript side).
var Widgets = []WidgetSpec{
	{ID: "strip", Variants: []string{}, Slots: []WidgetSlot{oneSlot("title", "any", false), listSlot("values", "any", true)}},
	{ID: "grid", Variants: []string{"columns", "pairs"}, Slots: []WidgetSlot{
		listSlot("ratings", "number", true),
		{ID: "bonus", List: true, Takes: "number", SameLengthAs: "ratings", Variants: []string{"columns"}},
		{ID: "total", List: true, Takes: "number", SameLengthAs: "ratings"},
		{ID: "link", List: true, Takes: "any", SameLengthAs: "ratings", Variants: []string{"pairs"}},
	}},
	{ID: "frames", Variants: []string{}, Slots: []WidgetSlot{listSlot("values", "number", true)}},
	{ID: "sum", Variants: []string{}, Slots: []WidgetSlot{listSlot("parts", "number", true), oneSlot("total", "number", true)}},
	{ID: "track", Variants: []string{}, Slots: []WidgetSlot{oneSlot("value", "number", true), oneSlot("max", "number", false)}},
	{ID: "pips", Variants: []string{}, Slots: []WidgetSlot{oneSlot("value", "number", true)}, Steps: true},
	{ID: "cards", Variants: []string{"weapons", "armour", "gear", "powers"}, Slots: []WidgetSlot{}, Ledger: true},
	{ID: "folds", Variants: []string{"both", "talents", "abilities"}, Slots: []WidgetSlot{}, Ledger: true},
	{ID: "notes", Variants: []string{}, Slots: []WidgetSlot{listSlot("fields", "text", true)}},
	{ID: "held", Variants: []string{}, Slots: []WidgetSlot{}, Held: true},
	{ID: "strike", Variants: []string{}, Slots: []WidgetSlot{}, Strike: true},
}

// LayoutTargets is LAYOUT_TARGETS: the layout keys beyond the sheet's sections.
var LayoutTargets = []string{"phoneTurn", "trackerRow", "screen"}

// MaxPipSteps and MaxPipsPerStep bound a pips row's steps (MAX_PIP_STEPS, MAX_PIPS_PER_STEP).
const (
	MaxPipSteps    = 12
	MaxPipsPerStep = 20
)

func widgetSpec(id string) *WidgetSpec {
	for i := range Widgets {
		if Widgets[i].ID == id {
			return &Widgets[i]
		}
	}
	return nil
}

type (
	// LayoutRow is a plain path (Path set) or a widget (Widget set).
	LayoutRow struct {
		Path   *string
		Widget *WidgetRow
	}
	// WidgetRow is a layout row that names a widget. Bind values are one path or a list, as the schema left them.
	WidgetRow struct {
		Widget  string                     `json:"widget"`
		Variant *string                    `json:"variant"`
		Bind    map[string]json.RawMessage `json:"bind"`
		Steps   *[]json.RawMessage         `json:"steps"`
	}
	// LayoutDef is one entity type's layout: the sheet's sections, then the other targets (nil when absent).
	LayoutDef struct {
		Sections []struct {
			Show []LayoutRow `json:"show"`
		} `json:"sections"`
		PhoneTurn  []LayoutRow `json:"phoneTurn"`
		TrackerRow []LayoutRow `json:"trackerRow"`
		Screen     []LayoutRow `json:"screen"`
	}
)

// UnmarshalJSON reads a row the schema has already parsed: a JSON string or a widget object.
func (r *LayoutRow) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		r.Path = &s
		return nil
	}
	r.Widget = &WidgetRow{}
	return json.Unmarshal(b, r.Widget)
}

func (l *LayoutDef) target(name string) []LayoutRow {
	switch name {
	case "phoneTurn":
		return l.PhoneTurn
	case "trackerRow":
		return l.TrackerRow
	default:
		return l.Screen
	}
}

// valueKind is what a layout path names on one entity type, read as the sheet reads it (apps/web lib/sheet rowFor):
// "number", "text", "other", or "" for nothing.
func (r *Ruleset) valueKind(e *EntityType, path string) string {
	derived := func(id string) string {
		for _, d := range e.Derived {
			if d.ID == id {
				return "number"
			}
		}
		return ""
	}
	resource := func(id string) string {
		for _, x := range r.Resources {
			if x.ID == id && x.Scope == "entity" && (x.Entities == nil || slices.Contains(*x.Entities, e.ID)) {
				return "number"
			}
		}
		return ""
	}
	if id, ok := strings.CutPrefix(path, "derived."); ok {
		return derived(id)
	}
	if id, ok := strings.CutPrefix(path, "res."); ok {
		return resource(id)
	}
	if f, ok := e.Fields[path]; ok {
		switch f.Type {
		case "int":
			return "number"
		case "text":
			return "text"
		}
		return "other"
	}
	if k := derived(path); k != "" {
		return k
	}
	return resource(path)
}

// widgetRow checks one widget row (house decision #83): a known widget and variant, its slots, and paths the entity
// types hold. Mirrors widgetRowProblems in manifest.ts.
func (p *problems) widgetRow(r *Ruleset, row *WidgetRow, entities []*EntityType, path string) {
	spec := widgetSpec(row.Widget)
	if spec == nil {
		p.add(path+".widget", `unknown widget "%s"`, row.Widget)
		return
	}
	if spec.Strike {
		// A strike widget's variant names one of the ruleset's strike kinds (house decision #99).
		var s *Strike
		for i := range r.Strikes {
			if row.Variant != nil && r.Strikes[i].ID == *row.Variant {
				s = &r.Strikes[i]
				break
			}
		}
		switch {
		case row.Variant == nil:
			p.add(path+".variant", "a strike widget names a strike kind")
		case s == nil:
			p.add(path+".variant", `unknown strike "%s"`, *row.Variant)
		case s.Entities != nil && slices.ContainsFunc(entities, func(e *EntityType) bool { return !slices.Contains(*s.Entities, e.ID) }):
			p.add(path+".variant", `not every type here strikes with "%s"`, *row.Variant)
		}
	} else if row.Variant != nil && !slices.Contains(spec.Variants, *row.Variant) {
		p.add(path+".variant", `unknown variant "%s"`, *row.Variant)
	}
	variant := ""
	if row.Variant != nil {
		variant = *row.Variant
	} else if len(spec.Variants) > 0 {
		variant = spec.Variants[0]
	}
	if spec.Steps && row.Steps == nil {
		p.add(path+".steps", "this widget needs steps")
	}
	if !spec.Steps && row.Steps != nil {
		p.add(path+".steps", "this widget takes no steps")
	}
	if spec.Ledger && r.Build == nil {
		p.add(path+".widget", `"%s" reads the build's sheet, and the ruleset has no build`, spec.ID)
	}
	if spec.Held && !slices.ContainsFunc(entities, func(e *EntityType) bool {
		for _, k := range r.Held {
			if slices.Contains(k.Entities, e.ID) {
				return true
			}
		}
		return false
	}) {
		p.add(path+".widget", `"%s" lists held records, and no held kind is for this type`, spec.ID)
	}
	pathOk := func(v, takes, at string) {
		var kinds []string
		for _, e := range entities {
			if k := r.valueKind(e, v); k != "" {
				kinds = append(kinds, k)
			}
		}
		switch {
		case len(kinds) == 0:
			p.add(at, `unknown value "%s"`, v)
		case takes == "number" && !slices.Contains(kinds, "number"):
			p.add(at, `"%s" is not a number`, v)
		case takes == "text" && !slices.Contains(kinds, "text"):
			p.add(at, `"%s" is not a text field`, v)
		}
	}
	readsVariant := func(s *WidgetSlot) bool {
		return s.Variants == nil || variant == "" || slices.Contains(s.Variants, variant)
	}
	paths := func(raw json.RawMessage) (list []string, isList bool, one string) {
		if json.Unmarshal(raw, &list) == nil {
			return list, true, ""
		}
		_ = json.Unmarshal(raw, &one)
		return nil, false, one
	}
	for _, key := range sortedKeys(row.Bind) {
		at := path + ".bind." + key
		var slot *WidgetSlot
		for i := range spec.Slots {
			if spec.Slots[i].ID == key {
				slot = &spec.Slots[i]
			}
		}
		if slot == nil {
			p.add(at, `unknown slot "%s"`, key)
			continue
		}
		if !readsVariant(slot) {
			p.add(at, `variant "%s" does not read "%s"`, variant, key)
		}
		list, isList, one := paths(row.Bind[key])
		if slot.List != isList {
			if slot.List {
				p.add(at, "takes a list of paths")
			} else {
				p.add(at, "takes one path")
			}
			continue
		}
		if isList {
			for i, v := range list {
				pathOk(v, slot.Takes, fmt.Sprintf("%s[%d]", at, i))
			}
		} else {
			pathOk(one, slot.Takes, at)
		}
		if slot.SameLengthAs != "" && isList {
			if other, otherList, _ := paths(row.Bind[slot.SameLengthAs]); otherList && len(other) != len(list) {
				p.add(at, `has %d, "%s" has %d`, len(list), slot.SameLengthAs, len(other))
			}
		}
	}
	for i := range spec.Slots {
		s := &spec.Slots[i]
		if _, bound := row.Bind[s.ID]; s.Required && readsVariant(s) && !bound {
			p.add(path+".bind", `slot "%s" is missing`, s.ID)
		}
	}
}

// layout checks the widget rows of every layout (house decision #83) against the entity types the layout is for: its
// own, or for the shared `sheet` key every type without a layout of its own. Plain path rows stay unchecked.
func (p *problems) layout(r *Ruleset) {
	for _, key := range sortedKeys(r.Layout) {
		l := r.Layout[key]
		var entities []*EntityType
		if e := r.entity(key); e != nil {
			entities = []*EntityType{e}
		} else if key == "sheet" {
			for i := range r.Entities {
				if _, has := r.Layout[r.Entities[i].ID]; !has {
					entities = append(entities, &r.Entities[i])
				}
			}
		}
		rows := func(list []LayoutRow, path string) {
			for j := range list {
				if w := list[j].Widget; w != nil {
					p.widgetRow(r, w, entities, fmt.Sprintf("%s[%d]", path, j))
				}
			}
		}
		for i, s := range l.Sections {
			rows(s.Show, fmt.Sprintf("layout.%s.sections[%d].show", key, i))
		}
		for _, target := range LayoutTargets {
			if list := l.target(target); list != nil {
				rows(list, "layout."+key+"."+target)
			}
		}
	}
}
