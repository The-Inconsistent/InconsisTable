package engine

import (
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Items actors hold in play (packages/rules-engine/src/manifest.ts ItemKind and ItemsBlock; house decision #95).

// MaxItemKinds caps the kinds a ruleset declares, and ItemDefaultMax is a kind's `max` when it declares none.
const (
	MaxItemKinds   = 20
	ItemDefaultMax = 60
)

// ItemFits says what an item of a kind is fitted to: a held item of a kind in To, at most Max on one host, one per
// value of the entry's Slot field, and an entry tagged GMTag by the GM side only.
type ItemFits struct {
	To    []string `json:"to"`
	Max   int      `json:"max"`
	Slot  *string  `json:"slot"`
	GMTag *string  `json:"gmTag"`
}

// ItemKind is one kind of item (ItemKind in manifest.ts).
type ItemKind struct {
	ID       string    `json:"id"`
	Label    string    `json:"label"`
	Entry    string    `json:"entry"`
	Tag      *string   `json:"tag"`
	Entities []string  `json:"entities"`
	Card     *string   `json:"card"`
	Max      *int      `json:"max"`
	Unique   *bool     `json:"unique"`
	Stacks   *bool     `json:"stacks"`
	Spend    *bool     `json:"spend"`
	Fits     *ItemFits `json:"fits"`
	Cite     *string   `json:"cite"`
}

// ItemsBlock is the manifest's `items` block.
type ItemsBlock struct {
	Kinds []ItemKind `json:"kinds"`
	Give  *struct {
		Ref   string `json:"ref"`
		Loose string `json:"loose"`
	} `json:"give"`
}

// MaxOrDefault is how many of the kind an actor may hold.
func (k ItemKind) MaxOrDefault() int {
	if k.Max == nil {
		return ItemDefaultMax
	}
	return *k.Max
}

// Counted says whether an item of the kind has a quantity.
func (k ItemKind) Counted() bool { return k.Stacks != nil && *k.Stacks }

// Kind is the kind with that id, nil when the block has none.
func (b *ItemsBlock) Kind(id string) *ItemKind {
	if b == nil {
		return nil
	}
	for i := range b.Kinds {
		if b.Kinds[i].ID == id {
			return &b.Kinds[i]
		}
	}
	return nil
}

// KindOf is the item kind of a pack entry (manifest.ts itemKindOf): the first kind whose entry type is the entry's and
// whose tag, if it has one, the entry carries. Nil when none.
func (b *ItemsBlock) KindOf(typ string, tags []string) *ItemKind {
	if b == nil {
		return nil
	}
	for i := range b.Kinds {
		k := &b.Kinds[i]
		if k.Entry == typ && (k.Tag == nil || slices.Contains(tags, *k.Tag)) {
			return k
		}
	}
	return nil
}

var itemKindSchema = schema.Object(
	schema.Req("id", idSchema),
	schema.Req("label", label(60)),
	schema.Req("entry", idSchema),
	schema.Opt("tag", label(40)),
	schema.Req("entities", schema.Array(idSchema).Min(1).Max(50)),
	schema.Opt("card", schema.Enum("weapons", "armour", "gear")),
	schema.Opt("max", schema.Int().Min(1).Max(200)),
	schema.Opt("unique", schema.Bool()),
	schema.Opt("stacks", schema.Bool()),
	schema.Opt("spend", schema.Bool()),
	schema.Opt("fits", schema.Object(
		schema.Req("to", schema.Array(idSchema).Min(1).Max(10)),
		schema.Req("max", schema.Int().Min(1).Max(10)),
		schema.Opt("slot", fieldIDSchema),
		schema.Opt("gmTag", label(40)),
	)),
	schema.Opt("cite", citeSchema),
)

var itemsSchema = schema.Object(
	schema.Req("kinds", schema.Array(itemKindSchema).Min(1).Max(MaxItemKinds)),
	schema.Opt("give", schema.Object(schema.Req("ref", idSchema), schema.Req("loose", idSchema))),
)

// items checks the block (manifest.ts itemProblems).
func (p *problems) items(r *Ruleset, needCite func(*string, string)) {
	b := r.Items
	if b == nil {
		return
	}
	ids := map[string]bool{}
	for i, k := range b.Kinds {
		path := fmt.Sprintf("items.kinds[%d]", i)
		needCite(k.Cite, path)
		if ids[k.ID] {
			p.add(path+".id", `duplicate kind "%s"`, k.ID)
		}
		ids[k.ID] = true
		entry := entityByID(r, k.Entry)
		switch {
		case entry == nil:
			p.add(path+".entry", `unknown entity "%s"`, k.Entry)
		case entry.Base == "actor":
			p.add(path+".entry", `"%s" is an actor`, k.Entry)
		}
		for j, e := range k.Entities {
			if holder := entityByID(r, e); holder == nil || holder.Base != "actor" {
				p.add(fmt.Sprintf("%s.entities[%d]", path, j), `unknown actor type "%s"`, e)
			}
		}
		if k.Spend != nil && *k.Spend && !k.Counted() {
			p.add(path+".spend", "only a counted kind is spent")
		}
		if f := k.Fits; f != nil {
			if k.Counted() {
				p.add(path+".fits", "a counted kind is not fitted")
			}
			for j, to := range f.To {
				if b.Kind(to) == nil {
					p.add(fmt.Sprintf("%s.fits.to[%d]", path, j), `unknown item kind "%s"`, to)
				}
			}
			if f.Slot != nil && entry != nil {
				if _, has := entry.Fields[*f.Slot]; !has {
					p.add(path+".fits.slot", `%s has no field "%s"`, k.Entry, *f.Slot)
				}
			}
		}
	}
	if g := b.Give; g != nil {
		var def *FieldDef
		if r.Codex != nil {
			if d, has := r.Codex.Kinds["item"].Fields[g.Ref]; has {
				def = &d
			}
		}
		switch {
		case def == nil:
			p.add("items.give.ref", `the item entry has no field "%s"`, g.Ref)
		case def.Type != "ref" || !slices.ContainsFunc(b.Kinds, func(k ItemKind) bool { return k.Entry == def.Entity }):
			p.add("items.give.ref", "not a ref to an item kind's entry type")
		}
		switch loose := b.Kind(g.Loose); {
		case loose == nil:
			p.add("items.give.loose", `unknown item kind "%s"`, g.Loose)
		case loose.Counted():
			p.add("items.give.loose", "a counted kind is not given")
		}
	}
}

// itemHolds says whether actor type actor holds entries of type typ as items of some kind.
func itemHolds(r *Ruleset, typ, actor string) bool {
	if r.Items == nil {
		return false
	}
	return slices.ContainsFunc(r.Items.Kinds, func(k ItemKind) bool { return k.Entry == typ && slices.Contains(k.Entities, actor) })
}
