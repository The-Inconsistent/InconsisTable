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
	Acquire *ItemAcquire `json:"acquire"`
}

// AcquirePart is one labelled part of a number an acquisition works out (house decision #102).
type AcquirePart struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// ItemAcquire is acquiring an item by a Test (manifest.ts ItemAcquire, house decision #102).
type ItemAcquire struct {
	Test   string                   `json:"test"`
	Kinds  *[]string                `json:"kinds"`
	Inputs map[string][]AcquirePart `json:"inputs"`
	Picks  map[string]SpendInput    `json:"picks"`
	If     *string                  `json:"if"`
	Limits []struct {
		Kinds []string `json:"kinds"`
		Max   int      `json:"max"`
	} `json:"limits"`
	TopUp *struct {
		Resource string  `json:"resource"`
		Max      *string `json:"max"`
	} `json:"topUp"`
	Quantity *string `json:"quantity"`
	Load     *struct {
		Field    string `json:"field"`
		Quantity string `json:"quantity"`
	} `json:"load"`
	Cite *string `json:"cite"`
}

// The offers an acquisition's call carries beside the Test's own (manifest.ts ACQUIRE_OFFERS).
const (
	AcquireGrantOffer = "acquire"
	AcquireTopUpOffer = "acquireTopUp"
)

// AcquiredKinds are the kinds an acquisition may grant: its Kinds, else every kind (manifest.ts acquiredKinds).
func (b *ItemsBlock) AcquiredKinds() []*ItemKind {
	var out []*ItemKind
	for i := range b.Kinds {
		if a := b.Acquire; a != nil && (a.Kinds == nil || slices.Contains(*a.Kinds, b.Kinds[i].ID)) {
			out = append(out, &b.Kinds[i])
		}
	}
	return out
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

// acquireSchema is manifest.ts ItemAcquire (house decision #102).
var acquireSchema = schema.Object(
	schema.Req("test", idSchema),
	schema.Opt("kinds", schema.Array(idSchema).Min(1).Max(MaxItemKinds)),
	schema.Req("inputs", schema.Refined(schema.Record(idSchema, schema.Array(schema.Object(
		schema.Req("label", label(60)),
		schema.Req("value", exprSource),
	)).Min(1).Max(6)), func(v any) bool { return len(v.(map[string]any)) <= 6 }, "at most 6 inputs")),
	schema.Opt("picks", schema.Refined(schema.Record(idSchema, schema.Object(
		schema.Req("label", label(60)),
		schema.Req("min", schema.Int().Min(-1000).Max(1000)),
		schema.Req("max", exprSource),
	)), func(v any) bool { return len(v.(map[string]any)) <= 3 }, "at most 3 picks")),
	schema.Opt("if", exprSource),
	schema.Opt("limits", schema.Array(schema.Object(
		schema.Req("kinds", schema.Array(idSchema).Min(1).Max(MaxItemKinds)),
		schema.Req("max", schema.Int().Min(1).Max(10)),
	)).Max(10)),
	schema.Opt("topUp", schema.Object(schema.Req("resource", idSchema), schema.Opt("max", exprSource))),
	schema.Opt("quantity", exprSource),
	schema.Opt("load", schema.Object(schema.Req("field", fieldIDSchema), schema.Req("quantity", exprSource))),
	schema.Opt("cite", citeSchema),
)

var itemsSchema = schema.Object(
	schema.Req("kinds", schema.Array(itemKindSchema).Min(1).Max(MaxItemKinds)),
	schema.Opt("give", schema.Object(schema.Req("ref", idSchema), schema.Req("loose", idSchema))),
	schema.Opt("acquire", acquireSchema),
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
	if b.Acquire != nil {
		p.acquire(r, b, b.Acquire, needCite)
	}
}

// acquire checks the acquisition (manifest.ts acquireProblems, house decision #102).
func (p *problems) acquire(r *Ruleset, b *ItemsBlock, a *ItemAcquire, needCite func(*string, string)) {
	const path = "items.acquire"
	needCite(a.Cite, path)
	known := func(ids []string, at string) {
		for j, id := range ids {
			if b.Kind(id) == nil {
				p.add(fmt.Sprintf("%s[%d]", at, j), `unknown item kind "%s"`, id)
			}
		}
	}
	if a.Kinds != nil {
		known(*a.Kinds, path+".kinds")
	}
	for i, l := range a.Limits {
		known(l.Kinds, fmt.Sprintf("%s.limits[%d].kinds", path, i))
	}
	test, has := r.Tests[a.Test]
	switch {
	case !has:
		p.add(path+".test", `unknown test "%s"`, a.Test)
	case test.Kind == "reported":
		p.add(path+".test", "a reported Test has no number to reach")
	default:
		for _, name := range sortedKeys(test.Inputs) {
			if test.Inputs[name] != "int" {
				p.add(path+".test", `the Test's input "%s" is not a number`, name)
			} else if _, set := a.Inputs[name]; !set {
				p.add(path+".inputs", `the Test's input "%s" is not set`, name)
			}
		}
		for _, name := range sortedKeys(a.Inputs) {
			if _, is := test.Inputs[name]; !is {
				p.add(path+".inputs."+name, `"%s" is not an input of the Test`, name)
			}
		}
		for _, id := range []string{AcquireGrantOffer, AcquireTopUpOffer} {
			if slices.ContainsFunc(test.Offers, func(o TestOffer) bool { return o.ID == id }) {
				p.add(path+".test", `the Test's offer "%s" is the acquisition's`, id)
			}
		}
	}
	kinds := b.AcquiredKinds()
	types := func(counted bool) []string {
		var out []string
		for _, k := range kinds {
			if (counted || !k.Counted()) && !slices.Contains(out, k.Entry) {
				out = append(out, k.Entry)
			}
		}
		return out
	}
	for _, typ := range types(true) {
		if entry := entityByID(r, typ); entry != nil {
			if _, has := entry.Fields["tags"]; has {
				p.add(path+".kinds", `%s has a field "tags", which is the entry's own`, typ)
			}
		}
	}
	if t := a.TopUp; t != nil {
		res := resourceByID(r, t.Resource)
		holders := []string{}
		for _, k := range kinds {
			for _, h := range k.Entities {
				if !slices.Contains(holders, h) {
					holders = append(holders, h)
				}
			}
		}
		switch {
		case res == nil || res.Scope != "entity":
			p.add(path+".topUp.resource", `"%s" is not an entity resource`, t.Resource)
		case res.Entities != nil && slices.ContainsFunc(holders, func(h string) bool { return !slices.Contains(*res.Entities, h) }):
			p.add(path+".topUp.resource", `not every holder carries "%s"`, res.ID)
		}
	}
	if l := a.Load; l != nil {
		for _, typ := range types(false) {
			if entry := entityByID(r, typ); entry != nil {
				if _, has := entry.Fields[l.Field]; !has {
					p.add(path+".load.field", `%s has no field "%s"`, typ, l.Field)
				}
			}
		}
		if !slices.ContainsFunc(b.Kinds, func(k ItemKind) bool { return k.Counted() }) {
			p.add(path+".load", "no counted kind to load")
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
