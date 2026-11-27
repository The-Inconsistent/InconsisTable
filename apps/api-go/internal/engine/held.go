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
	// Includes is a list field of the entry type naming the records a record brings with it (house decision #165).
	Includes *string `json:"includes"`
	// ExtraRolls is an int field of the entry type: a grant of a record above 0 there tells the GM to roll that many
	// more (house decision #191).
	ExtraRolls *string `json:"extraRolls"`
	// Gear names a list field of the entry type holding entries of the item kind Kind, given with the record (#191).
	Gear *HeldGear `json:"gear"`
	Cite *string   `json:"cite"`
}

// HeldGear is a held kind's gear (manifest.ts HeldKind.gear): the entry's list Field of item entries of Kind.
type HeldGear struct {
	Field string `json:"field"`
	Kind  string `json:"kind"`
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
	schema.Req("label", text(60)),
	schema.Req("entry", idSchema),
	schema.Req("field", fieldIDSchema),
	schema.Req("entities", schema.Array(idSchema).Min(1).Max(50)),
	schema.Opt("unseen", label(60)),
	schema.Opt("max", schema.Int().Min(1).Max(50)),
	schema.Opt("includes", fieldIDSchema),
	schema.Opt("extraRolls", fieldIDSchema),
	schema.Opt("gear", schema.Object(schema.Req("field", fieldIDSchema), schema.Req("kind", idSchema))),
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
		case k.Includes != nil && entry.Fields[*k.Includes].Type != "list":
			p.add(path+".includes", `"%s" has no list field "%s"`, k.Entry, *k.Includes)
		}
		if entry != nil && entry.Base != "actor" {
			if k.ExtraRolls != nil && entry.Fields[*k.ExtraRolls].Type != "int" {
				p.add(path+".extraRolls", `"%s" has no int field "%s"`, k.Entry, *k.ExtraRolls)
			}
			if k.Gear != nil && entry.Fields[k.Gear.Field].Type != "list" {
				p.add(path+".gear.field", `"%s" has no list field "%s"`, k.Entry, k.Gear.Field)
			}
		}
		if k.Gear != nil {
			var kind *ItemKind
			if r.Items != nil {
				kind = r.Items.Kind(k.Gear.Kind)
			}
			if kind == nil {
				p.add(path+".gear.kind", `unknown item kind "%s"`, k.Gear.Kind)
			} else {
				for _, e := range k.Entities {
					if !slices.Contains(kind.Entities, e) {
						p.add(path+".gear.kind", `%s holds no "%s"`, e, k.Gear.Kind)
					}
				}
			}
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

// withLists is the scope with every list field an actor type declares read as empty where it is unset (lookups.ts
// withLists; house decisions #88, #91), as the derived pass reads its own type's: an actor that holds nothing yet counts
// 0 records.
func (c *CompiledRuleset) withLists(scope *Record) *Record {
	out := scope
	for _, e := range c.Ruleset.Entities {
		if e.Base != "actor" {
			continue
		}
		for _, id := range sortedKeys(e.Fields) {
			if e.Fields[id].Type == "list" {
				out = setIfAbsent(out, strings.Split(id, "."))
			}
		}
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
