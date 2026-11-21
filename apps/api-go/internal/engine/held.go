package engine

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Records an actor gains in play (packages/rules-engine/src/manifest.ts HeldKind; house decision #88): pack entries of
// one type an actor holds by key in a list field, whose effects feed its numbers as a chosen entry's do.

// MaxHeldKinds caps the kinds a ruleset declares, and HeldDefaultMax is a kind's `max` when it declares none.
const (
	MaxHeldKinds   = 10
	HeldDefaultMax = 20
)

// HeldKind is one kind of record: the Entry type it holds, the list Field that keeps the keys on each actor type of
// Entities, the word Unseen that seats other than the holder's and the GM side's read in its name's place, and Max.
type HeldKind struct {
	Label    string   `json:"label"`
	Entry    string   `json:"entry"`
	Field    string   `json:"field"`
	Entities []string `json:"entities"`
	Unseen   *string  `json:"unseen"`
	Max      *int     `json:"max"`
	Cite     *string  `json:"cite"`
}

// MaxOrDefault is how many of the kind an actor may hold.
func (k HeldKind) MaxOrDefault() int {
	if k.Max == nil {
		return HeldDefaultMax
	}
	return *k.Max
}

var packKeySchema = schema.String().Max(80).Regex(`^[a-z0-9]+([-_.][a-z0-9]+)*$`, "use lowercase letters, digits and - _ .")

var heldKindSchema = schema.Object(
	schema.Req("label", label(60)),
	schema.Req("entry", idSchema),
	schema.Req("field", fieldIDSchema),
	schema.Req("entities", schema.Array(idSchema).Min(1).Max(50)),
	schema.Opt("unseen", label(60)),
	schema.Opt("max", schema.Int().Min(1).Max(50)),
	schema.Opt("cite", citeSchema),
)

// held checks each kind (manifest.ts heldProblems): its entry type, its holders and their list field.
func (p *problems) held(r *Ruleset, needCite func(*string, string)) {
	for _, id := range sortedKeys(r.Held) {
		k := r.Held[id]
		path := "held." + id
		needCite(k.Cite, path)
		entry := entityByID(r, k.Entry)
		switch {
		case entry == nil:
			p.add(path+".entry", `unknown entity "%s"`, k.Entry)
		case entry.Base == "actor":
			p.add(path+".entry", `"%s" is an actor`, k.Entry)
		}
		for i, e := range k.Entities {
			holder := entityByID(r, e)
			if holder == nil || holder.Base != "actor" {
				p.add(fmt.Sprintf("%s.entities[%d]", path, i), `unknown actor type "%s"`, e)
				continue
			}
			def, has := holder.Fields[k.Field]
			switch {
			case !has:
				p.add(path+".field", `%s has no field "%s"`, e, k.Field)
			case def.Type != "list":
				p.add(path+".field", `"%s" is not a list field`, k.Field)
			case k.Unseen != nil && def.Visibility != "owner" && def.Visibility != "gm":
				p.add(path+".field", "a field holding unseen records is owner or gm")
			}
		}
	}
}

// holdsType says whether actor type actor holds entries of type typ as a held kind's records.
func holdsType(r *Ruleset, typ, actor string) bool {
	for _, k := range r.Held {
		if k.Entry == typ && slices.Contains(k.Entities, actor) {
			return true
		}
	}
	return false
}

func entityByID(r *Ruleset, id string) *EntityType {
	for i := range r.Entities {
		if r.Entities[i].ID == id {
			return &r.Entities[i]
		}
	}
	return nil
}

// withHeld is the scope with each held kind's list field read as empty where it is unset (lookups.ts withHeld): an
// actor that holds nothing yet counts 0 records.
func (c *CompiledRuleset) withHeld(scope *Record) *Record {
	out := scope
	for _, id := range sortedKeys(c.Ruleset.Held) {
		out = setIfAbsent(out, strings.Split(c.Ruleset.Held[id].Field, "."))
	}
	return out
}

func setIfAbsent(at *Record, path []string) *Record {
	had, has := at.Fields[path[0]]
	if len(path) == 1 {
		if has {
			return at
		}
		out := &Record{Fields: maps.Clone(at.Fields)}
		out.Fields[path[0]] = &List{Items: []any{}}
		return out
	}
	inner, isRecord := had.(*Record)
	if has && !isRecord {
		return at
	}
	if !has {
		inner = &Record{Fields: map[string]any{}}
	}
	out := &Record{Fields: maps.Clone(at.Fields)}
	out.Fields[path[0]] = setIfAbsent(inner, path[1:])
	return out
}

// HeldKeys is the keys of the records of a kind the actor holds, read from the kind's list field in its scope
// (lookups.ts heldKeys).
func (c *CompiledRuleset) HeldKeys(held string, scope *Record) []string {
	k, known := c.Ruleset.Held[held]
	if !known || scope == nil {
		return []string{}
	}
	var at any = scope
	for _, part := range strings.Split(k.Field, ".") {
		r, ok := at.(*Record)
		if !ok {
			return []string{}
		}
		at = r.Fields[part]
	}
	list, ok := at.(*List)
	if !ok {
		return []string{}
	}
	out := []string{}
	for _, item := range list.Items {
		if s, isText := item.(string); isText {
			out = append(out, s)
		}
	}
	return out
}
