package engine

import (
	"maps"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// A fitting's effect on its host's card (house decision #102; manifest.ts CARD_VALUES and hostValuesOf, compile.ts
// hostEffect).

// CardValues are the values of a `cards` variant a fitting's effect may change on its host, as `host.<value>`.
var CardValues = map[string][]string{"weapons": {"damage", "ed", "ap", "salvo"}, "armour": {"ar"}, "gear": {}}

// HostPrefix starts the path of an effect on the host's card.
const HostPrefix = "host."

// TraitPrefix, after HostPrefix, starts a fitting's change to a Trait of its host (house decision #198; manifest.ts
// TRAIT_PREFIX, TRAIT_CARDS and TRAIT_NAME): the Trait's word, with no bracket or comma. Weapons and armour carry Traits.
const TraitPrefix = "trait."

var traitCards = []string{"weapons", "armour"}
var traitName = regexp.MustCompile(`^[^\t\n\r (),]([^\t\n\r(),]{0,38}[^\t\n\r (),])?$`)

// hostCardsOf is the `cards` variants of every kind the kinds of entry type typ fit to.
func hostCardsOf(b *ItemsBlock, typ string) []string {
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
			out = append(out, *k.Card)
		}
	}
	return out
}

// HostValuesOf is the host values a fitting of entry type typ may change: the card values of every kind its kinds fit
// to.
func HostValuesOf(b *ItemsBlock, typ string) []string {
	var out []string
	for _, card := range hostCardsOf(b, typ) {
		for _, v := range CardValues[card] {
			if !slices.Contains(out, v) {
				out = append(out, v)
			}
		}
	}
	return out
}

// hostTakesTraits is whether a fitting of entry type typ fits to a kind whose card carries Traits.
func hostTakesTraits(b *ItemsBlock, typ string) bool {
	return slices.ContainsFunc(hostCardsOf(b, typ), func(c string) bool { return slices.Contains(traitCards, c) })
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
	trait, isTrait := strings.CutPrefix(name, TraitPrefix)
	switch {
	case isTrait && (!traitName.MatchString(trait) || !hostTakesTraits(c.r.Items, typ)):
		c.problems.add(path+".path", `"%s" is not a Trait of a host's card`, eff.Path)
	case isTrait && eff.Mode != "upgrade" && eff.Mode != "add" && eff.Mode != "override":
		c.problems.add(path+".mode", "a host's Trait is gained (upgrade), re-rated (add) or set")
	case isTrait:
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
			if !ok || strings.HasPrefix(name, TraitPrefix) { // a Trait: fittedTraits
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
	traits, traitsBy := fittedTraits(card, fitted)
	if traits != nil {
		list := make([]any, len(traits))
		for i, t := range traits {
			list[i] = t
		}
		out["traits"] = list
	}
	names := []string{}
	for _, f := range fitted {
		if (slices.Contains(by, f.Name) || slices.Contains(traitsBy, f.Name)) && !slices.Contains(names, f.Name) {
			names = append(names, f.Name)
		}
	}
	return out, names
}

// traitList is acquire.ts traitList: a card's Traits, an array's words or a text's comma-separated words.
func traitList(v any) []string {
	out := []string{}
	switch x := v.(type) {
	case []any:
		for _, t := range x {
			if s, ok := t.(string); ok {
				out = append(out, s)
			}
		}
	case []string:
		out = append(out, x...)
	case string:
		for _, t := range strings.Split(x, ",") {
			if t = strings.TrimSpace(t); t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}

var traitRating = regexp.MustCompile(`\((\d{1,3})\)`)

func traitKey(t string) string {
	name, _, _ := strings.Cut(t, "(")
	return strings.ToLower(strings.TrimSpace(name))
}

func ratingOf(t string) float64 {
	m := traitRating.FindStringSubmatch(t)
	if m == nil {
		return 0
	}
	n, _ := strconv.ParseFloat(m[1], 64)
	return n
}

// rated is a Trait as the card prints it, "Name (rating)" or the bare name, its rating at most 999.
func rated(name string, rating float64) string {
	if rating <= 0 {
		return name
	}
	return name + " (" + strconv.FormatFloat(min(999, rating), 'f', -1, 64) + ")"
}

// fittedTraits is acquire.ts fittedTraits (house decision #198): the card's Traits with each fitted item's
// `host.trait.<name>` effects in order, and the items that changed one; nil when none did.
func fittedTraits(card map[string]any, fitted []Fitted) ([]string, []string) {
	var list []string
	by := []string{}
	for _, item := range fitted {
		for _, eff := range item.Effects {
			name, ok := strings.CutPrefix(eff.Path, HostPrefix+TraitPrefix)
			if !ok {
				continue
			}
			v, refusal := read(eff.Value, &Record{map[string]any{}}, eff.Path)
			n, isNumber := v.(float64)
			if refusal != nil || !isNumber || n != math.Trunc(n) || !traitName.MatchString(name) {
				continue
			}
			traits := list
			if traits == nil {
				traits = traitList(card["traits"])
			}
			key := strings.ToLower(name)
			at := slices.IndexFunc(traits, func(t string) bool { return traitKey(t) == key })
			had := 0.0
			if at >= 0 {
				had = ratingOf(traits[at])
			}
			set := func(rating float64) []string {
				out := slices.Clone(traits)
				out[at] = rated(name, rating)
				return out
			}
			switch {
			case eff.Mode == "upgrade" && at < 0:
				list = append(slices.Clone(traits), rated(name, n))
			case eff.Mode == "upgrade" && n > 0:
				list = set(max(had, n))
			case eff.Mode == "upgrade", eff.Mode == "add" && at < 0:
				continue // no rating to raise, or no rating to move: nothing changes
			case eff.Mode == "add" && had+n <= 0:
				list = slices.Delete(slices.Clone(traits), at, at+1)
			case eff.Mode == "add":
				list = set(had + n)
			case eff.Mode == "override" && n <= 0:
				list = slices.DeleteFunc(slices.Clone(traits), func(t string) bool { return traitKey(t) == key })
			case eff.Mode == "override" && at < 0:
				list = append(slices.Clone(traits), rated(name, n))
			case eff.Mode == "override":
				list = set(n)
			default:
				continue
			}
			if !slices.Contains(by, item.Name) {
				by = append(by, item.Name)
			}
		}
	}
	return list, by
}

func isFloat(v any) bool {
	_, ok := v.(float64)
	return ok
}
