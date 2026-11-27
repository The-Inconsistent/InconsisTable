package engine

import (
	"fmt"
	"maps"
	"slices"
)

// Panels (manifest.ts Panel, house decision #114): what a phone shows its holder while each holds. The api only
// validates and compiles them, and cuts them from a seat's copy (view.compilable); the phone draws them.

type (
	// PanelLine is one of a panel's lines, shown while When holds.
	PanelLine struct {
		Text string  `json:"text"`
		When *string `json:"when"`
		Cite *string `json:"cite"`
	}
	// PanelFigure is a number a panel reads from its holder.
	PanelFigure struct {
		Label string  `json:"label"`
		Expr  string  `json:"expr"`
		Cite  *string `json:"cite"`
	}
	// PanelOptions lists the pack entries of type Entry, grouped by Group; Usable sinks the ones it does not hold for.
	PanelOptions struct {
		Entry  string  `json:"entry"`
		Group  *string `json:"group"`
		Usable *string `json:"usable"`
		Needs  *string `json:"needs"`
	}
	// Panel is manifest.ts Panel.
	Panel struct {
		ID       string    `json:"id"`
		Label    string    `json:"label"`
		Cite     *string   `json:"cite"`
		Entities *[]string `json:"entities"`
		// Foe is the actor type whose values ctx.foe reads, the acting foe's (house decision #180).
		Foe     *string `json:"foe"`
		When    *string `json:"when"`
		Holds   *string `json:"holds"`
		Unless  *string `json:"unless"`
		OpensOn *struct {
			Rises string `json:"rises"`
		} `json:"opensOn"`
		Lines   []PanelLine   `json:"lines"`
		Figures []PanelFigure `json:"figures"`
		Spends  []string      `json:"spends"`
		Options *PanelOptions `json:"options"`
	}
)

// panels is manifest.ts panelProblems.
func (p *problems) panels(r *Ruleset, actorTypes func(*[]string, string), needCite func(*string, string)) {
	p.duplicates("panels", idsOf(r.Panels, func(x Panel) string { return x.ID }))
	state := func(id string) bool {
		return slices.ContainsFunc(r.Health.States, func(s HealthState) bool { return s.ID == id })
	}
	for i, x := range r.Panels {
		path := fmt.Sprintf("panels[%d]", i)
		needCite(x.Cite, path)
		actorTypes(x.Entities, path+".entities")
		if x.Foe != nil {
			if foe := r.entity(*x.Foe); foe == nil {
				p.add(path+".foe", `unknown entity "%s"`, *x.Foe)
			} else if foe.Base != "actor" {
				p.add(path+".foe", `"%s" is not an actor entity`, *x.Foe)
			}
		}
		if x.Holds != nil && !state(*x.Holds) {
			p.add(path+".holds", `unknown state "%s"`, *x.Holds)
		}
		if x.Unless != nil && !state(*x.Unless) {
			p.add(path+".unless", `unknown state "%s"`, *x.Unless)
		}
		if x.OpensOn != nil {
			at := slices.IndexFunc(r.Resources, func(res Resource) bool { return res.ID == x.OpensOn.Rises })
			if at < 0 {
				p.add(path+".opensOn", `unknown resource "%s"`, x.OpensOn.Rises)
			} else if r.Resources[at].Scope != "entity" {
				p.add(path+".opensOn", `"%s" must be an entity-scoped resource`, x.OpensOn.Rises)
			}
		}
		for j, id := range x.Spends {
			if r.SpendOf(id) == nil {
				p.add(fmt.Sprintf("%s.spends[%d]", path, j), `unknown spend "%s"`, id)
			}
		}
		if o := x.Options; o != nil {
			if e := r.entity(o.Entry); e == nil {
				p.add(path+".options.entry", `unknown entity "%s"`, o.Entry)
			} else {
				if o.Group != nil {
					if _, has := e.Fields[*o.Group]; !has {
						p.add(path+".options.group", `"%s" is not a field of "%s"`, *o.Group, o.Entry)
					}
				}
				if o.Needs != nil {
					if f, has := e.Fields[*o.Needs]; !has || f.Type != "text" {
						p.add(path+".options.needs", `"%s" is not a text field of "%s"`, *o.Needs, o.Entry)
					}
				}
			}
		}
		if x.Lines == nil && x.Figures == nil && x.Spends == nil && x.Options == nil {
			p.add(path, "a panel shows nothing")
		}
	}
}

// panels is compile.ts Compiler.panels: when, each line's when and each figure over each actor type that shows the
// panel, with ctx.self and ctx.fight; the options' usable also reads entry, the listed type's fields.
func (c *compiler) panels(entities map[string]*CompiledEntity) {
	// The carried items' keys and tags by kind (house decision #180), which an option's usable reads.
	carried := map[string]ExprType{}
	if c.r.Items != nil {
		for _, k := range c.r.Items.Kinds {
			carried[k.ID] = ListType{textType}
		}
	}
	for i := range c.r.Panels {
		x := &c.r.Panels[i]
		path := fmt.Sprintf("panels[%d]", i)
		_, bases := c.actorsOf(x.Entities, entities)
		ctx := maps.Clone(spendCtx)
		// ctx.foe: the acting foe's scope, of the type the panel names (house decision #180).
		if x.Foe != nil {
			if foe, ok := entities[*x.Foe]; ok {
				ctx["foe"] = RecordType{foe.Scope}
			}
		}
		scopes := withScope(bases, "ctx", RecordType{ctx})
		if x.When != nil {
			c.expr(*x.When, scopes, boolType, path+".when")
		}
		for j, l := range x.Lines {
			if l.When != nil {
				c.expr(*l.When, scopes, boolType, fmt.Sprintf("%s.lines[%d].when", path, j))
			}
		}
		for j, f := range x.Figures {
			c.expr(f.Expr, scopes, intType, fmt.Sprintf("%s.figures[%d].expr", path, j))
		}
		if o := x.Options; o != nil && o.Usable != nil {
			if e := c.r.entity(o.Entry); e != nil {
				withCarried := maps.Clone(ctx)
				withCarried["carried"] = RecordType{carried}
				usable := withScope(withScope(bases, "ctx", RecordType{withCarried}), "entry", RecordType{fieldScope(e.Fields)})
				c.expr(*o.Usable, usable, boolType, path+".options.usable")
			}
		}
	}
}
