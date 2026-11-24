// Package item is the items an actor holds in play (house decision #95): GIVE and TAKE BACK of a codex item, an item
// added by hand, EDIT CARRIED, fitting one item to another, and a counted item's quantity. Every write sets an
// actor_item row whole through actor.WriteDelta, so one action is one logged step and Undo takes it back.
package item

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// MaxQuantity is the most of one counted item an actor holds (the column's check).
const MaxQuantity = 999

// room is what every item action reads: the ruleset's items and the room's actors as built.
type room struct {
	ctx    context.Context
	tx     core.Conn
	c      cs.Ctx
	rc     *ruleset.Context
	items  *engine.ItemsBlock
	deltas []engine.Delta
}

func open(ctx context.Context, tx core.Conn, c cs.Ctx) (*room, error) {
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return nil, err
	}
	if rc.Compiled.Ruleset.Items == nil {
		return nil, cs.Fail("noItems")
	}
	return &room{ctx: ctx, tx: tx, c: c, rc: rc, items: rc.Compiled.Ruleset.Items}, nil
}

// served is a pack entry of that type and key the room is served (the first by pack slug), with its tags.
type served struct {
	Name string
	Tags []string
	Body map[string]any
}

func (r *room) served(typ, key string) (*served, error) {
	var s served
	var body []byte
	err := r.tx.QueryRow(r.ctx, `SELECT e.name, e.tags, e.body FROM campaign_pack
		JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id
		JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE e.type = $2 AND e.key = $3 AND `+actor.ServedPacks("$1")+` ORDER BY pack.slug LIMIT 1`,
		r.c.CampaignID, typ, key).Scan(&s.Name, &s.Tags, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, json.Unmarshal(body, &s.Body)
}

// holder is an actor of the room that holds items, refused when it is not one.
func (r *room) holder(actorID string) (*actor.Built, error) {
	b, ok := r.rc.Built[actorID]
	if !ok {
		return nil, cs.Fail("characterNotFound")
	}
	return b, nil
}

// kind is the kind with that id, refused when the ruleset has none or the actor's type does not hold it.
func (r *room) kind(id string, b *actor.Built) (*engine.ItemKind, error) {
	k := r.items.Kind(id)
	if k == nil {
		return nil, cs.Fail("noItemKind", cs.Params{"kind": id})
	}
	if !slices.Contains(k.Entities, b.Entity) {
		return nil, cs.Fail("itemNotFor", cs.Params{"name": b.Row.Name, "kind": k.Label})
	}
	return k, nil
}

// canHold refuses a new item of kind k (an entry's, or a hand-written one with entryKey nil) for b: one of a unique
// entry, and no more than the kind's max.
func canHold(b *actor.Built, k *engine.ItemKind, entryKey *string, label string) error {
	n := 0
	for _, x := range b.Items {
		if x.Kind != k.ID {
			continue
		}
		n++
		if k.Unique != nil && *k.Unique && entryKey != nil && x.EntryKey != nil && *x.EntryKey == *entryKey {
			return cs.Fail("itemAlready", cs.Params{"name": b.Row.Name, "item": label})
		}
	}
	if n >= k.MaxOrDefault() {
		return cs.Fail("itemsFull", cs.Params{"name": b.Row.Name, "kind": k.Label, "max": k.MaxOrDefault()})
	}
	return nil
}

// set is a write of an item row whole; nil removes it.
func (r *room) set(itemID string, value map[string]any) {
	var v any
	if value != nil {
		v = value
	}
	r.deltas = append(r.deltas, engine.Delta{Target: engine.DeltaTarget{Item: itemID}, Kind: "set", Value: v})
}

// value is an item row as it is logged, with changes applied.
func value(actorID string, x actor.ItemRow, change map[string]any) map[string]any {
	v := map[string]any{"actorId": actorID, "kind": x.Kind, "entryType": str(x.EntryType), "entryKey": str(x.EntryKey),
		"name": x.Name, "note": x.Note, "quantity": num(x.Quantity), "fittedTo": str(x.FittedTo), "source": x.Source,
		"codexEntryId": str(x.CodexEntryID), "ordinal": float64(x.Ordinal)}
	for k, x := range change {
		v[k] = x
	}
	return v
}

func str(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func num(n *int) any {
	if n == nil {
		return nil
	}
	return float64(*n)
}

// add writes a new item for b at the end of its list.
func (r *room) add(b *actor.Built, fields map[string]any) {
	ordinal := 0
	for _, x := range b.Items {
		ordinal = max(ordinal, x.Ordinal+1)
	}
	v := map[string]any{"actorId": b.Row.ID, "entryType": nil, "entryKey": nil, "name": "", "note": "", "quantity": nil,
		"fittedTo": nil, "codexEntryId": nil, "ordinal": float64(ordinal)}
	for k, x := range fields {
		v[k] = x
	}
	r.set(core.NewUUID(), v)
}

// remove takes an item away, the items fitted to it coming loose first.
func (r *room) remove(b *actor.Built, x actor.ItemRow) {
	for _, y := range b.Items {
		if y.FittedTo != nil && *y.FittedTo == x.ID {
			r.set(y.ID, value(b.Row.ID, y, map[string]any{"fittedTo": nil}))
		}
	}
	r.set(x.ID, nil)
}

// write writes the deltas and logs them as one action.
func (r *room) write() (cs.Result, error) {
	written := []eventlog.Written{}
	for _, d := range r.deltas {
		w, err := actor.WriteDelta(r.ctx, r.tx, actor.Write{CampaignID: r.c.CampaignID, Delta: d})
		if err != nil {
			return cs.Result{}, err
		}
		written = append(written, w)
	}
	id := core.NewUUID()
	logged, err := eventlog.Record(r.ctx, r.tx, r.c, id, written)
	if err != nil || !logged {
		return cs.Done(""), err
	}
	return cs.Done(id), nil
}

// loaded is an item of the room and its holder; the holder's seat or the GM side when own is set.
func (r *room) loaded(itemID string, own bool) (*actor.Built, actor.ItemRow, error) {
	for _, id := range r.rc.Order {
		b := r.rc.Built[id]
		for _, x := range b.Items {
			if x.ID == itemID {
				if own {
					if refused := cs.RequirePerm(r.c, "character:edit:own", b.Row.ID); refused != nil {
						return nil, x, refused
					}
				}
				return b, x, nil
			}
		}
	}
	return nil, actor.ItemRow{}, cs.Fail("itemNotFound")
}

// codexItem is a codex entry of kind item: its title and declared fields, and the item that holds it now.
type codexItem struct {
	Title  string
	Fields map[string]any
	Held   *string
}

func (r *room) codexItem(entryID string) (*codexItem, error) {
	var e codexItem
	var kind string
	var fields []byte
	err := r.tx.QueryRow(r.ctx, `SELECT kind, title, fields, (SELECT i.id::text FROM actor_item i WHERE i.codex_entry_id = codex_entry.id)
		FROM codex_entry WHERE id = $1 AND campaign_id = $2`, entryID, r.c.CampaignID).Scan(&kind, &e.Title, &fields, &e.Held)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && kind != "item") {
		return nil, cs.Fail("itemNotFound")
	}
	if err != nil {
		return nil, err
	}
	return &e, json.Unmarshal(fields, &e.Fields)
}

// Give is item.give (house decision #95; the source app's GIVE, rules-flow §11.112-114): the GM hands a codex item to
// a character with no Test, while a session runs. The pack entry its `give.ref` field names becomes an item of its
// kind; an item entry naming none becomes a hand-written item of `give.loose`, by its title. Refused for an item given
// already, a counted kind (counted by type: added by hand), an actor type the kind is not for, a second of a unique
// entry, and a full kind.
func Give(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	g := r.items.Give
	if g == nil {
		return cs.Result{}, cs.Fail("noItems")
	}
	session, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	if session == nil {
		return cs.Result{}, cs.Fail("noSessionRunning")
	}
	e, err := r.codexItem(a.Str("entryId"))
	if err != nil {
		return cs.Result{}, err
	}
	if e.Held != nil {
		return cs.Result{}, cs.Fail("itemGiven", cs.Params{"item": e.Title})
	}
	b, err := r.holder(a.Str("actorId"))
	if err != nil {
		return cs.Result{}, err
	}
	fields := map[string]any{"source": "give", "codexEntryId": a.Str("entryId")}
	kindID, label := g.Loose, e.Title
	var key *string
	if k, _ := e.Fields[g.Ref].(string); k != "" {
		typ := r.rc.Compiled.Ruleset.Codex.Kinds["item"].Fields[g.Ref].Entity
		s, err := r.served(typ, k)
		if err != nil {
			return cs.Result{}, err
		}
		if s == nil {
			return cs.Result{}, cs.Fail("itemNoEntry", cs.Params{"entry": k})
		}
		kind := r.items.KindOf(typ, s.Tags)
		if kind == nil {
			return cs.Result{}, cs.Fail("itemNotAnItem", cs.Params{"entry": s.Name, "kind": ""})
		}
		kindID, label, key = kind.ID, s.Name, &k
		fields["entryType"], fields["entryKey"] = typ, k
	} else {
		fields["name"] = e.Title
	}
	kind, err := r.kind(kindID, b)
	if err != nil {
		return cs.Result{}, err
	}
	if kind.Counted() {
		return cs.Result{}, cs.Fail("itemCounted", cs.Params{"item": label})
	}
	if err := canHold(b, kind, key, label); err != nil {
		return cs.Result{}, err
	}
	fields["kind"] = kind.ID
	r.add(b, fields)
	return r.write()
}

// Take is item.take (TAKE BACK): the item a GIVE made is taken away, the items fitted to it coming loose, and the codex
// item has no holder again.
func Take(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	e, err := r.codexItem(a.Str("entryId"))
	if err != nil {
		return cs.Result{}, err
	}
	if e.Held == nil {
		return cs.Result{}, cs.Fail("itemNotGiven", cs.Params{"item": e.Title})
	}
	b, x, err := r.loaded(*e.Held, false)
	if err != nil {
		return cs.Result{}, err
	}
	r.remove(b, x)
	return r.write()
}

// Add is item.add (ADD BY HAND): a served pack entry of the kind, or a hand-written name, with a note. A counted kind
// adds to the row of the same entry or name the actor has, up to MaxQuantity.
func Add(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b, err := r.holder(a.Str("actorId"))
	if err != nil {
		return cs.Result{}, err
	}
	kind, err := r.kind(a.Str("kind"), b)
	if err != nil {
		return cs.Result{}, err
	}
	entry, hasEntry := a["entry"].(string)
	name, hasName := a["name"].(string)
	if hasEntry == hasName {
		return cs.Result{}, cs.Fail("itemEntryOrName")
	}
	fields := map[string]any{"kind": kind.ID, "source": "hand", "note": a.Str("note"), "name": name}
	label := name
	var key *string
	if hasEntry {
		s, err := r.served(kind.Entry, entry)
		if err != nil {
			return cs.Result{}, err
		}
		if s == nil {
			return cs.Result{}, cs.Fail("itemNoEntry", cs.Params{"entry": entry})
		}
		if k := r.items.KindOf(kind.Entry, s.Tags); k == nil || k.ID != kind.ID {
			return cs.Result{}, cs.Fail("itemNotAnItem", cs.Params{"entry": s.Name, "kind": kind.Label})
		}
		fields["entryType"], fields["entryKey"], fields["name"], label, key = kind.Entry, entry, "", s.Name, &entry
	}
	quantity, _ := a["quantity"].(float64)
	if kind.Counted() {
		for _, x := range b.Items {
			same := x.Kind == kind.ID && ((key != nil && x.EntryKey != nil && *x.EntryKey == *key) || (key == nil && x.EntryKey == nil && x.Name == name))
			if same {
				r.set(x.ID, value(b.Row.ID, x, map[string]any{"quantity": float64(min(MaxQuantity, *x.Quantity+int(quantity)))}))
				return r.write()
			}
		}
		fields["quantity"] = quantity
	}
	if err := canHold(b, kind, key, label); err != nil {
		return cs.Result{}, err
	}
	r.add(b, fields)
	return r.write()
}

// Edit is item.edit (EDIT CARRIED): the GM rewrites a line's note, a hand-written line's name, or removes the line.
// Refused when the line's revision is not the one the screen read (the source app's stale-line guard).
func Edit(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b, x, err := r.loaded(a.Str("itemId"), false)
	if err != nil {
		return cs.Result{}, err
	}
	if rev, _ := a["rev"].(float64); int64(rev) != x.Rev {
		return cs.Result{}, cs.Fail("itemChanged")
	}
	if remove, _ := a["remove"].(bool); remove {
		r.remove(b, x)
		return r.write()
	}
	change := map[string]any{}
	if note, sent := a["note"].(string); sent {
		change["note"] = note
	}
	if name, sent := a["name"].(string); sent {
		if x.EntryKey != nil {
			return cs.Result{}, cs.Fail("itemEntryOrName")
		}
		change["name"] = name
	}
	r.set(x.ID, value(b.Row.ID, x, change))
	return r.write()
}

// Fit is item.fit: an item of a kind that fits is fitted to another item its holder holds, or taken off (to null), by
// the holder's seat or the GM side. Refused for a kind that is not fitted, a host of a kind it does not fit (or one
// fitted itself, or the item itself), an item fitted already, an entry tagged as the GM's from another seat, a second
// of the same entry on one host, a host at the kind's max, and a slot taken.
func Fit(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b, x, err := r.loaded(a.Str("itemId"), true)
	if err != nil {
		return cs.Result{}, err
	}
	kind := r.items.Kind(x.Kind)
	if kind == nil || kind.Fits == nil {
		return cs.Result{}, cs.Fail("itemNoFit", cs.Params{"item": x.Label()})
	}
	to, _ := a["to"].(string)
	if to == "" {
		if x.FittedTo == nil {
			return cs.Result{}, cs.Fail("itemNotFitted", cs.Params{"item": x.Label()})
		}
		r.set(x.ID, value(b.Row.ID, x, map[string]any{"fittedTo": nil}))
		return r.write()
	}
	if x.FittedTo != nil {
		return cs.Result{}, cs.Fail("itemFitted", cs.Params{"item": x.Label()})
	}
	i := slices.IndexFunc(b.Items, func(y actor.ItemRow) bool { return y.ID == to })
	if i < 0 {
		return cs.Result{}, cs.Fail("itemNotFound")
	}
	host := b.Items[i]
	if host.ID == x.ID || host.FittedTo != nil || !slices.Contains(kind.Fits.To, host.Kind) {
		return cs.Result{}, cs.Fail("itemFitsNot", cs.Params{"item": x.Label(), "host": host.Label()})
	}
	if kind.Fits.GMTag != nil && slices.Contains(x.Tags, *kind.Fits.GMTag) && !view.ActorGmSide(c, b.Row.Kind) {
		return cs.Result{}, cs.Fail("itemFitGm", cs.Params{"item": x.Label()})
	}
	on := []actor.ItemRow{}
	for _, y := range b.Items {
		if y.FittedTo != nil && *y.FittedTo == host.ID {
			on = append(on, y)
		}
	}
	for _, y := range on {
		if x.EntryKey != nil && y.EntryKey != nil && *y.EntryKey == *x.EntryKey {
			return cs.Result{}, cs.Fail("itemAlready", cs.Params{"name": host.Label(), "item": x.Label()})
		}
	}
	if len(on) >= kind.Fits.Max {
		return cs.Result{}, cs.Fail("itemFitFull", cs.Params{"host": host.Label(), "max": kind.Fits.Max})
	}
	if slot := kind.Fits.Slot; slot != nil {
		mine, err := r.slotOf(x, *slot)
		if err != nil {
			return cs.Result{}, err
		}
		for _, y := range on {
			theirs, err := r.slotOf(y, *slot)
			if err != nil {
				return cs.Result{}, err
			}
			if mine != "" && theirs == mine {
				return cs.Result{}, cs.Fail("itemSlotTaken", cs.Params{"host": host.Label(), "slot": mine, "other": y.Label()})
			}
		}
	}
	r.set(x.ID, value(b.Row.ID, x, map[string]any{"fittedTo": host.ID}))
	return r.write()
}

// slotOf is the text of the entry's slot field, "" for a hand-written item or an entry that leaves it unset.
func (r *room) slotOf(x actor.ItemRow, field string) (string, error) {
	if x.EntryKey == nil {
		return "", nil
	}
	s, err := r.served(*x.EntryType, *x.EntryKey)
	if err != nil || s == nil {
		return "", err
	}
	v, _ := s.Body[field].(string)
	return v, nil
}

// Adjust is item.adjust: a counted item's quantity by a delta, the holder only spending one of a kind it spends, the
// GM side either way. A quantity that reaches 0 removes the item (the source app's empty type disappears).
func Adjust(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return cs.Result{}, err
	}
	b, x, err := r.loaded(a.Str("itemId"), true)
	if err != nil {
		return cs.Result{}, err
	}
	kind := r.items.Kind(x.Kind)
	if kind == nil || !kind.Counted() || x.Quantity == nil {
		return cs.Result{}, cs.Fail("itemNotCounted", cs.Params{"item": x.Label()})
	}
	by, _ := a["by"].(float64)
	if !view.ActorGmSide(c, b.Row.Kind) && (by > 0 || kind.Spend == nil || !*kind.Spend) {
		return cs.Result{}, cs.Fail("itemOnlySpend", cs.Params{"item": x.Label()})
	}
	left := *x.Quantity + int(by)
	if left <= 0 {
		r.remove(b, x)
	} else {
		r.set(x.ID, value(b.Row.ID, x, map[string]any{"quantity": float64(min(MaxQuantity, left))}))
	}
	return r.write()
}
