package ledger

import (
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/wargear.ts.

// isMeleeProfile: a melee weapon adds Strength or prints one short reach. A throw is not a reach.
func isMeleeProfile(p *Params, addStrength bool, rng []any) bool {
	if addStrength {
		return true
	}
	if len(rng) != 1 {
		return false
	}
	reach, _ := rng[0].(float64)
	return reach <= p.Weapon.MeleeMaxReach
}

// sheetWeapon is a catalogue weapon as a sheet weapon: a thrown range becomes N x the character's Strength in metres;
// a weapon that is also melee keeps its reach and notes the throw as a trait.
func sheetWeapon(p *Params, name string, weapon *schema.Obj, strength float64) *schema.Obj {
	thrown, isThrown := get(weapon, "thrown").(float64)
	rng, hasRange := get(weapon, "range").([]any)
	out := newObj("name", name)
	for _, k := range weapon.Keys() {
		if k != "thrown" && k != "range" {
			out.Set(k, get(weapon, k))
		}
	}
	melee := isMeleeProfile(p, boolean(weapon, "addStrength"), rng)
	if !hasRange {
		reach := 1.0
		if isThrown {
			reach = strength * thrown
		}
		return out.Set("range", []any{reach}).Set("melee", melee)
	}
	out.Set("range", rng).Set("melee", melee)
	if isThrown {
		trait := strings.Replace(p.Weapon.ThrownTrait, "{m}", num(strength*thrown), 1)
		out.Set("traits", append(slices.Clone(list(weapon, "traits")), trait))
	}
	return out
}

// gearLine is a catalogue item as a gear line on the sheet (at most 200 characters): the name, armour's AR, and where
// to read it.
func gearLine(p *Params, w *schema.Obj) string {
	ar := ""
	if a := sub(w, "armour"); a != nil {
		ar = "AR " + num(number(a, "ar"))
		if boolean(a, "invulnerable") {
			ar += "*"
		}
		if truthy(get(a, "powered")) {
			ar += ", Powered (" + num(number(a, "powered")) + ")"
		}
		if traits := strs(a, "traits"); len(traits) > 0 {
			ar += ", " + strings.Join(traits, ", ")
		}
		ar += "; "
	}
	return cut(str(w, "name")+" ("+ar+p.cite(w)+")", 200)
}

type wargearProblem struct {
	what string
	gm   bool
}

// advancedWargearProblems is what breaks the Tier's limits: Total Value strictly under the number, no item over the
// Max. Value, and the Rarity allowance. The table stops at its last row; an item with no printed Value or Rarity is
// the GM's call.
func advancedWargearProblems(p *Params, items []*schema.Obj, tier float64) []wargearProblem {
	rows := p.Advanced.Wargear.Rows
	top := float64(len(rows))
	row := rows[int(min(top, max(1, tier)))-1]
	rareName, veryRareName, refused := p.Rarity.Rare, p.Rarity.VeryRare, p.Rarity.Refused
	var out []wargearProblem
	if tier > top {
		out = append(out, wargearProblem{
			"Advanced Creation's Wargear table stops at Tier " + num(top) + "; Tier " + num(tier) + " uses its Tier " +
				num(top) + " row", true,
		})
	}
	total, rare, veryRare := 0.0, 0.0, 0.0
	at := num(min(tier, top))
	for _, w := range items {
		value, priced := get(w, "value").(float64)
		rarity, rated := get(w, "rarity").(string)
		if !priced || !rated {
			missing := "Rarity"
			if !priced {
				missing = "Value"
			}
			out = append(out, wargearProblem{str(w, "name") + " has no printed " + missing, true})
			continue
		}
		total += value
		if row.Max != nil && value > *row.Max {
			out = append(out, wargearProblem{
				str(w, "name") + " is Value " + num(value) + ", over the Tier " + at + " maximum of " + num(*row.Max), false,
			})
		}
		switch {
		case rarity == rareName:
			rare++
		case rarity == veryRareName:
			veryRare++
		case contains(refused, rarity):
			out = append(out, wargearProblem{str(w, "name") + " is " + rarity + ": no Tier takes one", false})
		}
	}
	if total >= row.Total {
		out = append(out, wargearProblem{"Total Value " + num(total) + " must be under " + num(row.Total), false})
	}
	if rare > row.Rare {
		out = append(out, wargearProblem{num(rare) + " " + rareName + " pieces; Tier " + at + " allows " + num(row.Rare), false})
	}
	if veryRare > row.VeryRare {
		out = append(out, wargearProblem{
			num(veryRare) + " " + veryRareName + " pieces; Tier " + at + " allows " + num(row.VeryRare), false,
		})
	}
	return out
}
