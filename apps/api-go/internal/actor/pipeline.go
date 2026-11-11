package actor

import (
	"context"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// CheckEditable is the refusal when the seat may not write delta to a value declared editableBy, else nil
// (docs/design.md §5.3, step 6; apps/api/src/actor/actor.edit.ts). The GM side of the actor's kind writes any value; a
// co-GM outside it only the values everyone sees, the hidden ones needing the scope that shows them (house decision
// #31). `owner` writes only a character the seat holds; `ownerSpendOnly` only a negative delta on one it holds.
// Fail-closed: an undeclared value is `gm`.
func CheckEditable(c cs.Ctx, editableBy, actorID, kind, visibility string, delta engine.Delta, what string) *cs.Error {
	if view.ActorWriteSide(c, kind, visibility) {
		return nil
	}
	if !slices.Contains(view.HeldBy(c), actorID) {
		return cs.Fail("notYourCharacter")
	}
	dec, inc := engine.StepsFor(editableBy, false)
	if !dec && !inc {
		return cs.Fail("gmOnly")
	}
	if inc {
		return nil
	}
	if n, isNumber := delta.Value.(float64); delta.Kind == "add" && isNumber && n < 0 {
		return nil
	}
	return cs.Fail("onlySpend", cs.Params{"what": what})
}

// InferFieldType is the type of a field the ruleset doesn't declare (the engine's own bookkeeping), read off the
// values written.
func InferFieldType(samples ...any) string {
	for _, v := range samples {
		switch v.(type) {
		case nil:
			continue
		case []any, []string:
			return "list"
		case bool:
			return "bool"
		case float64:
			return "int"
		}
		return "text"
	}
	return "text"
}

// FieldDefOf is a field the actor's entity declares, or nil.
func FieldDefOf(compiled *engine.CompiledRuleset, b *Built, field string) *engine.FieldDef {
	ce, ok := compiled.Entities[b.Entity]
	if !ok {
		return nil
	}
	def, ok := ce.Def.Fields[field]
	if !ok {
		return nil
	}
	return &def
}

// FieldTypeOf is a field's declared type, or the best guess from the values seen.
func FieldTypeOf(compiled *engine.CompiledRuleset, b *Built, field string, samples ...any) string {
	if def := FieldDefOf(compiled, b, field); def != nil {
		return def.Type
	}
	return InferFieldType(samples...)
}

// Apply is what ApplyDeltas writes: deltas against the actors as built. Trusted skips editableBy, for the values the
// engine's own creation or a pack entry decided (the types still apply).
type Apply struct {
	Ctx      cs.Ctx
	Compiled *engine.CompiledRuleset
	Built    map[string]*Built
	Deltas   []engine.Delta
	Trusted  bool
}

// ApplyDeltas is pipeline steps 6-7 of docs/design.md §5.3: every delta is checked against what this seat may write
// (editableBy, the declared type and range), written through WriteDelta, and the whole action is logged under one id,
// which it returns ("" when nothing changed). The caller has already run can(perm) and the op. Any refusal is a
// *coreschema.Error, so the transaction writes nothing.
func ApplyDeltas(ctx context.Context, tx core.Conn, a Apply) (string, error) {
	written := []eventlog.Written{}
	for _, delta := range a.Deltas {
		delta.Value = JSONValue(delta.Value)
		t := delta.Target
		write := Write{CampaignID: a.Ctx.CampaignID, Delta: delta}
		if t.ActorID == "" {
			w, err := WriteDelta(ctx, tx, write)
			if err != nil {
				return "", err
			}
			written = append(written, w)
			continue
		}
		b, ok := a.Built[t.ActorID]
		if !ok {
			return "", cs.Fail("characterNotFound")
		}
		editableBy, visibility, what := "gm", "gm", "that" // undeclared is `gm`, fail-closed
		switch {
		case t.Resource != "":
			res, known := a.Compiled.Resources[t.Resource]
			bounds, bounded := b.Bounds[t.Resource]
			if !known || !bounded {
				return "", cs.Fail("noResourceHere", cs.Params{"resource": t.Resource})
			}
			editableBy, visibility, what = res.Def.EditableBy, res.Def.Visibility, res.Def.Label
			write.Bounds = &bounds
		case t.Field != "":
			def := FieldDefOf(a.Compiled, b, t.Field)
			write.FieldType = InferFieldType(delta.Value)
			if def != nil {
				// Unsetting a field is always allowed; any other value must fit the declaration.
				if delta.Value != nil {
					if bad := engine.CheckFieldValue(def, delta.Value); bad != "" {
						return "", cs.Fail("fieldInvalid", cs.Params{"label": def.Label, "detail": bad})
					}
				}
				editableBy, visibility, what = def.EditableBy, def.Visibility, def.Label
				write.FieldType = def.Type
			}
		default:
			what = "the " + t.Condition + " condition"
			if cond, known := a.Compiled.Conditions[t.Condition]; known {
				visibility = cond.Visibility
			}
		}
		if !a.Trusted {
			if refused := CheckEditable(a.Ctx, editableBy, t.ActorID, b.Row.Kind, visibility, delta, what); refused != nil {
				return "", refused
			}
		}
		w, err := WriteDelta(ctx, tx, write)
		if err != nil {
			return "", err
		}
		written = append(written, w)
	}
	actionID := core.NewUUID()
	logged, err := eventlog.Record(ctx, tx, a.Ctx, actionID, written)
	if err != nil || !logged {
		return "", err
	}
	return actionID, nil
}
