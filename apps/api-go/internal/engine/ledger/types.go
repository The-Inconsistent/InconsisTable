package ledger

import (
	"encoding/json"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The twin of packages/rules-engine/src/build/types.ts: what resolving a build answers.

// Purchase is a purchase made in play, as a stable key for the history (Advancement.boughtIn). Kind is attribute
// (Attribute, Rating), skill (Skill, Rating), talent (ID, Choice), power, package (ID), language (Name) or ascension
// (ArchetypeID).
type Purchase struct {
	Kind        string  `json:"kind"`
	Attribute   string  `json:"attribute,omitempty"`
	Skill       string  `json:"skill,omitempty"`
	Rating      float64 `json:"rating,omitempty"`
	ID          string  `json:"id,omitempty"`
	Choice      string  `json:"choice,omitempty"`
	Name        string  `json:"name,omitempty"`
	ArchetypeID string  `json:"archetypeId,omitempty"`
}

// PurchaseKey is the purchase's key in the history. A rating is one key per point reached, a Talent's pick is part of
// it; `~n` separates the second and later copies of an otherwise identical purchase (added by Resolve).
func PurchaseKey(p Purchase) string {
	switch p.Kind {
	case "attribute":
		return "advance/attribute/" + p.Attribute + "/" + num(p.Rating)
	case "skill":
		return "advance/skill/" + p.Skill + "/" + num(p.Rating)
	case "talent":
		if p.Choice != "" {
			return "advance/talent/" + p.ID + ":" + p.Choice
		}
		return "advance/talent/" + p.ID
	case "power":
		return "advance/power/" + p.ID
	case "package":
		return "advance/package/" + p.ID
	case "language":
		return "advance/language/" + p.Name
	case "ascension":
		return "advance/ascension/" + p.ArchetypeID
	}
	return ""
}

// Num is a number of the answer. It is written as JSON.stringify writes one: NaN (a price row past its table) is null.
type Num float64

// MarshalJSON writes the number as JavaScript does.
func (n Num) MarshalJSON() ([]byte, error) { return schema.AppendJSON(nil, float64(n)) }

// GearItem is a WargearItem on the character, with the path of what gave it.
type GearItem struct {
	Name      string   `json:"name"`
	Qty       any      `json:"qty"` // a number, or dice
	WargearID string   `json:"wargearId,omitempty"`
	Upgrades  []string `json:"upgrades,omitempty"`
	TraitIDs  []string `json:"traitIds,omitempty"`
	From      string   `json:"from"`
}

// LedgerRow is one purchase. Pool is "advancement" for XP earned in play; Key and Session are the purchase history,
// only ever on an advancement row.
type LedgerRow struct {
	What    string `json:"what"`
	XP      Num    `json:"xp"`
	Cite    string `json:"cite,omitempty"`
	Step    string `json:"step"`
	Pool    string `json:"pool,omitempty"`
	Key     string `json:"key,omitempty"`
	Session *Num   `json:"session,omitempty"`
}

// PendingChoice is a choice still to make: Choose of Options (labels, answered by index) or, when Options is empty, of
// the ids or names Of describes. Pick says what `choices[Path]` picks from; without it, the builder's own field for
// that step answers it.
type PendingChoice struct {
	Path    string      `json:"path"`
	Step    string      `json:"step"`
	What    string      `json:"what"`
	Choose  Num         `json:"choose"`
	Options []string    `json:"options"`
	Of      *string     `json:"of,omitempty"`
	Cite    string      `json:"cite,omitempty"`
	Pick    *ChoicePick `json:"pick,omitempty"`
}

// ChoicePick is what a choice picks from. Kind is option, wargear (Filter), skill or attribute (From), discipline
// (From, nil for any), power (Disciplines) or keyword.
type ChoicePick struct {
	Kind        string
	Filter      *schema.Obj
	From        []string
	Disciplines []string
}

// MarshalJSON writes the fields its kind has, as the TypeScript union does.
func (p ChoicePick) MarshalJSON() ([]byte, error) {
	out := map[string]any{"kind": p.Kind}
	switch p.Kind {
	case "wargear":
		out["filter"] = p.Filter
	case "skill", "attribute", "discipline":
		out["from"] = p.From // nil is null: a Discipline the character may learn
	case "power":
		out["disciplines"] = p.Disciplines
	}
	return json.Marshal(out)
}

// BuildChoicePrompt is every choice a grant asks for, answered or not, with the current answer.
type BuildChoicePrompt struct {
	PendingChoice
	Answer []any `json:"answer"`
}

// BuildProblem is what is wrong: "error" blocks saving; "gm" needs the GM's tick (its Path in gm.approved).
type BuildProblem struct {
	Step     string `json:"step"`
	Severity string `json:"severity"`
	Path     string `json:"path,omitempty"`
	What     string `json:"what"`
	Cite     string `json:"cite,omitempty"`
}

// BuildEffect is what the build gives that a sheet has no field for.
type BuildEffect struct {
	What string `json:"what"`
	Cite string `json:"cite,omitempty"`
}

// Who is who the finished character is, for OutOfReach: species (with what it counts as, nil before one is picked),
// archetype, keywords, and the keywords a Talent or Package could still add.
type Who struct {
	Species     []string `json:"species"`
	ArchetypeID *string  `json:"archetypeId"`
	Keywords    []string `json:"keywords"`
	Buyable     []string `json:"buyable"`
}

// Advancement is the build in play: the XP earned (its budget), what advancement spends of it, Rank, the Tier now.
type Advancement struct {
	Budget Num `json:"budget"`
	Spent  Num `json:"spent"`
	Rank   Num `json:"rank"`
	Tier   Num `json:"tier"`
}

// ResolvedBuild is resolveBuild's answer.
type ResolvedBuild struct {
	Sheet       any                 `json:"sheet"`
	Budget      Num                 `json:"budget"`
	Spent       Num                 `json:"spent"`
	Ledger      []LedgerRow         `json:"ledger"`
	Pending     []PendingChoice     `json:"pending"`
	Choices     []BuildChoicePrompt `json:"choices"`
	Problems    []BuildProblem      `json:"problems"`
	Effects     []BuildEffect       `json:"effects"`
	Advancement *Advancement        `json:"advancement"`
	Who         Who                 `json:"who"`
}

// Ready is buildReady: nothing left to choose, nothing wrong, and every GM question ticked.
func Ready(r *ResolvedBuild) bool { return len(r.Pending) == 0 && len(r.Problems) == 0 }

// Creation is the record lists of the creation types, each record parsed by its schema.
type Creation struct {
	Keywords, Factions, SubFactions, Species, Backgrounds, OptionGroups []*schema.Obj
	Archetypes, Talents, Packages, Disciplines, Powers, Languages       []*schema.Obj
}

// Catalogue is what the builder reads: the creation records, the wargear by id, and whether the campaign allows the
// unofficial sources.
type Catalogue struct {
	Creation Creation
	Wargear  map[string]*schema.Obj
	Homebrew bool
}
