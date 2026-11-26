package engine

import (
	"maps"
	"slices"
	"strings"
)

// A fitting's effect on its host's card (house decision #102; manifest.ts CARD_VALUES and hostValuesOf, compile.ts
// hostEffect).

// CardValues are the values of a `cards` variant a fitting's effect may change on its host, as `host.<value>`.
var CardValues = map[string][]string{"weapons": {"damage", "ed", "ap", "salvo"}, "armour": {"ar"}, "gear": {}}

// HostPrefix starts the path of an effect on the host's card.
const HostPrefix = "host."

// HostValuesOf is the host values a fitting of entry type typ may change: the card values of every kind its kinds fit
// to.
func HostValuesOf(b *ItemsBlock, typ string) []string {
	if b == nil {
		return nil
	}
	var hosts, out []string
	for _, k := range b.Kinds {
		if k.Entry == typ && k.Fits != nil {
			hosts = append(hosts, k.Fits.To...)
		}
	}
	for _, k := range b.Kinds {
		if slices.Contains(hosts, k.ID) && k.Card != nil {
			for _, v := range CardValues[*k.Card] {
				if !slices.Contains(out, v) {
					out = append(out, v)
				}
			}
		}
	}
	return out
}

// CardKind is the kind a line of the saved build counts as when an item is fitted to it (house decision #102): the
// first kind whose card is the line's (`weapons`, `armour`) and that the actor's type holds. Nil when none.
func (b *ItemsBlock) CardKind(card, entity string) *ItemKind {
	if b == nil {
		return nil
	}
	for i := range b.Kinds {
		k := &b.Kinds[i]
		if k.Card != nil && *k.Card == card && slices.Contains(k.Entities, entity) {
			return k
		}
	}
	return nil
}

// hostEffect checks an entry's effect on its host's card: a value of a host's card, added or overridden by a number
// that reads nothing. It never changes the actor, so it compiles to no actor effect.
func (c *compiler) hostEffect(eff *Effect, typ, path string) {
	name := strings.TrimPrefix(eff.Path, HostPrefix)
	switch {
	case !slices.Contains(HostValuesOf(c.r.Items, typ), name):
		c.problems.add(path+".path", `"%s" is not a value of a host's card`, eff.Path)
	case eff.Mode != "add" && eff.Mode != "override":
		c.problems.add(path+".mode", "a host's value is added to or overridden")
	}
	empty := []map[string]ExprType{{}}
	c.expr(eff.Value, empty, intType, path+".value")
	if eff.When != nil {
		c.problems.add(path+".when", "a host's value takes no condition")
	}
}

// Fitted is an item fitted to a host, as acquire.ts reads it: its name and its effects.
type Fitted struct {
	Name    string   `json:"name"`
	Effects []Effect `json:"effects"`
}

// WithFittings is acquire.ts withFittings: a card's values with each fitted item's `host.<value>` effects, added or
// overridden in the order the items are fitted, a value the card leaves out read as 0; by names the items that
// changed one. An amount that cannot be read changes nothing.
func WithFittings(values map[string]float64, fitted []Fitted) (map[string]float64, []string) {
	out := maps.Clone(values)
	if out == nil {
		out = map[string]float64{}
	}
	by := []string{}
	for _, item := range fitted {
		changed := false
		for _, eff := range item.Effects {
			name, ok := strings.CutPrefix(eff.Path, HostPrefix)
			if !ok {
				continue
			}
			v, refusal := read(eff.Value, &Record{map[string]any{}}, eff.Path)
			n, isNumber := v.(float64)
			if refusal != nil || !isNumber {
				continue
			}
			if eff.Mode == "override" {
				out[name] = n
			} else {
				out[name] += n
			}
			changed = true
		}
		if changed && !slices.Contains(by, item.Name) {
			by = append(by, item.Name)
		}
	}
	return out, by
}

// cardNumbers is every value a fitting may change on a card, in acquire.ts CARD_NUMBERS' order.
var cardNumbers = []string{"damage", "ed", "ap", "salvo", "ar"}

// WithFittedCard is acquire.ts withFittedCard: a card, or the means a strike reads, with what is fitted to it; a
// number the card prints as words left as printed and every other key kept.
func WithFittedCard(card map[string]any, fitted []Fitted) (map[string]any, []string) {
	values := map[string]float64{}
	for _, k := range cardNumbers {
		if v, ok := card[k].(float64); ok {
			values[k] = v
		}
	}
	changed, by := WithFittings(values, fitted)
	out := maps.Clone(card)
	if out == nil {
		out = map[string]any{}
	}
	for k, v := range changed {
		if x, ok := card[k]; !ok || isFloat(x) {
			out[k] = v + 0 // a negated 0 reads as 0, as JSON writes it
		}
	}
	return out, by
}

func isFloat(v any) bool {
	_, ok := v.(float64)
	return ok
}
