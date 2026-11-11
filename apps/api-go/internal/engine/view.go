package engine

import "slices"

// Viewer is a seat looking at the table.
type Viewer struct {
	Role string `json:"role"`
	// CharacterIDs holds the actors this seat holds (one seat, several characters: the view is their union).
	CharacterIDs []string `json:"characterIds"`
}

// ActorView is one actor as a snapshot carries it, and as a viewer receives it with hidden entries dropped.
type ActorView struct {
	ID string `json:"id"`
	// Entity is the entity type id from the manifest.
	Entity     string             `json:"entity"`
	Fields     map[string]any     `json:"fields"`
	Resources  map[string]float64 `json:"resources"`
	Derived    map[string]float64 `json:"derived"`
	Conditions []string           `json:"conditions"`
}

// CanSee says whether a viewer may see a value of the given visibility on the given actor.
func CanSee(visibility string, viewer Viewer, actorID string) bool {
	// Who counts as a gm for which actor is the seat view's call; it hands a co-GM the role it earns.
	if viewer.Role == "gm" {
		return true
	}
	switch visibility {
	case "public":
		return true
	case "party":
		return viewer.Role == "player" || viewer.Role == "screen"
	case "owner":
		return viewer.Role == "player" && slices.Contains(viewer.CharacterIDs, actorID)
	}
	return false
}

func keepVisible[T any](values map[string]T, visibilityOf func(string) string, viewer Viewer, actorID string) map[string]T {
	out := make(map[string]T, len(values))
	for id, value := range values {
		if CanSee(visibilityOf(id), viewer, actorID) {
			out[id] = value
		}
	}
	return out
}

// ToViewerView filters actors for one viewer by declared visibility. Fail-closed: anything the manifest does not
// declare (a field, a resource, an unknown entity type) is gm.
func (c *CompiledRuleset) ToViewerView(viewer Viewer, actors []ActorView) []ActorView {
	out := make([]ActorView, len(actors))
	for i, actor := range actors {
		entity := c.Entities[actor.Entity]
		fieldVisibility := func(id string) string {
			if entity != nil {
				if def, ok := entity.Def.Fields[id]; ok {
					return def.Visibility
				}
			}
			return "gm"
		}
		resourceVisibility := func(id string) string {
			if r, ok := c.Resources[id]; ok {
				return r.Def.Visibility
			}
			return "gm"
		}
		derivedVisibility := func(id string) string {
			if entity != nil {
				for _, d := range entity.Derived {
					if d.ID == id {
						return d.Visibility
					}
				}
			}
			return "gm"
		}
		conditions := []string{}
		for _, id := range actor.Conditions {
			visibility := "gm"
			if cond, ok := c.Conditions[id]; ok {
				visibility = cond.Visibility
			}
			if CanSee(visibility, viewer, actor.ID) {
				conditions = append(conditions, id)
			}
		}
		out[i] = ActorView{
			ID:         actor.ID,
			Entity:     actor.Entity,
			Fields:     keepVisible(actor.Fields, fieldVisibility, viewer, actor.ID),
			Resources:  keepVisible(actor.Resources, resourceVisibility, viewer, actor.ID),
			Derived:    keepVisible(actor.Derived, derivedVisibility, viewer, actor.ID),
			Conditions: conditions,
		}
	}
	return out
}
