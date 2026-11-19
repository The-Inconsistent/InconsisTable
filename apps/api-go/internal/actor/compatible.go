package actor

import (
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Incompatible lists what in rows the new version cannot hold as it stands, each line "<actor name>: <what>" (house
// decision #51). Nothing is rewritten, so a stored value has to be one the new version would accept. A resource's value
// is not checked against its bounds (house decision #8). The lines are sorted.
func Incompatible(old, next *engine.CompiledRuleset, rows []Rows) []string {
	var out []string
	for _, r := range rows {
		entity := r.Actor.EntityType
		if entity == "" {
			continue
		}
		add := func(format string, args ...any) { out = append(out, r.Actor.Name+": "+fmt.Sprintf(format, args...)) }
		oe, ne := old.Entities[entity], next.Entities[entity]
		if ne == nil {
			add(`no "%s" type`, entity)
			continue
		}
		byField := map[string][]FieldRow{}
		for _, f := range r.Fields {
			byField[f.FieldID] = append(byField[f.FieldID], f)
		}
		for id, fs := range byField {
			var oldDef *engine.FieldDef
			if oe != nil {
				if d, ok := oe.Def.Fields[id]; ok {
					oldDef = &d
				}
			}
			newDef, inNew := ne.Def.Fields[id]
			switch {
			case oldDef == nil && !inNew: // engine-owned in both versions: left alone
			case !inNew:
				add(`field "%s" is gone`, id)
			case oldDef != nil && oldDef.Type != newDef.Type:
				add(`field "%s" changed type`, id)
			default:
				if v := fieldValue(&newDef, fs); v != nil {
					if why := engine.CheckFieldValue(&newDef, v); why != "" {
						add(`field "%s": %s`, id, why)
					}
				}
			}
		}
		for _, x := range r.Resources {
			_, inOld := old.Resources[x.ResourceID]
			if inOld && (next.Resources[x.ResourceID] == nil || !slices.Contains(ne.Resources, x.ResourceID)) {
				add(`resource "%s" is gone`, x.ResourceID)
			}
		}
		for _, c := range r.Conditions {
			if _, ok := next.Conditions[c.ConditionID]; !ok {
				add(`condition "%s" is gone`, c.ConditionID)
			}
		}
	}
	slices.Sort(out)
	return out
}
