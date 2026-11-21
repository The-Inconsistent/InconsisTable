package engine

import (
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
