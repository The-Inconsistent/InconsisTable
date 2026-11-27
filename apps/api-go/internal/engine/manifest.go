package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// MaxManifestBytes bounds a user-written import before anything else reads it.
const MaxManifestBytes = 512 * 1024

// MaxCampaignFields caps the campaign fields of a manifest.
const MaxCampaignFields = 50

// MaxFields caps the fields and derived values across a manifest.
const MaxFields = 2000

// MaxOffers caps a Test's offers and MaxMarks its marks (house decision #80).
const (
	MaxOffers = 10
	MaxMarks  = 10
)

// MaxNotices caps a manifest's notice rules, and MaxNoticeText a rule's words (house decision #79).
const (
	MaxNotices    = 50
	MaxNoticeText = 120
)

// CodexKinds are the kinds of codex entry (rules-engine CodexEntryKind; coreschema's list is this one).
var CodexKinds = []string{"adventure", "scene", "npc", "location", "faction", "item", "handout", "quest", "lore"}

// Problem is one reason a manifest was refused, with the path of the offending entry, as importers read it.
type Problem struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

func formatPath(parts []any) string {
	var b strings.Builder
	for _, p := range parts {
		switch x := p.(type) {
		case int:
			fmt.Fprintf(&b, "[%d]", x)
		case string:
			if b.Len() > 0 {
				b.WriteByte('.')
			}
			b.WriteString(x)
		}
	}
	if b.Len() == 0 {
		return "(root)"
	}
	return b.String()
}

// The typed views below hold a manifest after the schema has parsed it, so they trust its shape. A union is one flat
// struct, read by its tag.
type (
	// FieldDef is one declared field.
	FieldDef struct {
		Type       string   `json:"type"`
		Label      string   `json:"label"`
		EditableBy string   `json:"editableBy"`
		Visibility string   `json:"visibility"`
		Min        *float64 `json:"min"`
		Max        *float64 `json:"max"`
		Entity     string   `json:"entity"`
		MaxLength  *float64 `json:"maxLength"`
		Values     []string `json:"values"`
		MaxItems   *float64 `json:"maxItems"`
		// Labels and Notes are an enum's words for its values (house decision #71), Tones its good or bad ones (house
		// decision #76); nil when it declares none.
		Labels map[string]string `json:"labels"`
		Notes  map[string]string `json:"notes"`
		Tones  map[string]string `json:"tones"`
		// Kind is the codex entry kind an `entry` field links to (house decision #76).
		Kind string `json:"kind"`
		// A `tags` field's suggestions (house decision #89): pack entry types whose names are offered, fixed options
		// (worded by Labels), and whether a word outside them may be written in.
		Entities []string `json:"entities"`
		Options  []string `json:"options"`
		WriteIn  bool     `json:"writeIn"`
		// A `rows` field's columns, its cap, the pack entry types that fill a row and the switch a scene picks it with
		// (house decision #89).
		Columns []RowColumn  `json:"columns"`
		MaxRows *float64     `json:"maxRows"`
		From    []RowPrefill `json:"from"`
		Pick    *RowPick     `json:"pick"`
		// Chips and Picks are a list's (house decision #91): its items show as chips, its quick picks name an entity type.
		Chips bool        `json:"chips"`
		Picks *FieldPicks `json:"picks"`
		// Roll is the tables a codex text field's editor rolls into it (house decision #97).
		Roll *FieldRoll `json:"roll"`
	}
	// FieldRoll is tables whose rolled lines fill a text field or an entry's title, labels joined by Join (house decision
	// #97; rules-engine FieldRoll).
	FieldRoll struct {
		Tables []string `json:"tables"`
		Join   *string  `json:"join"`
	}
	// EntryPrefill is how a pack entry of Entity makes a codex entry of a kind (house decision #97; rules-engine
	// EntryPrefill): a row's prefill mapping, the ref field whose entries come along nested, and for a scene the list
	// fields of Test ids and pack keys that become prepared lines.
	EntryPrefill struct {
		Entity   string            `json:"entity"`
		Name     *string           `json:"name"`
		Values   map[string]string `json:"values"`
		Children *string           `json:"children"`
		Tests    *struct {
			Field  string            `json:"field"`
			Inputs map[string]string `json:"inputs"`
		} `json:"tests"`
		Roster *string `json:"roster"`
	}
	// RowColumn is one column of a `rows` field: an entry field's type, or `test` (house decision #89).
	RowColumn struct {
		ID        string            `json:"id"`
		Type      string            `json:"type"`
		Label     string            `json:"label"`
		Min       *float64          `json:"min"`
		Max       *float64          `json:"max"`
		MaxLength *float64          `json:"maxLength"`
		Values    []string          `json:"values"`
		Labels    map[string]string `json:"labels"`
		Notes     map[string]string `json:"notes"`
		Tones     map[string]string `json:"tones"`
		Entity    string            `json:"entity"`
	}
	// RowPrefill is how a pack entry of Entity fills a new row: Name the text column that takes its name, Values a
	// column id to the entity field it takes.
	RowPrefill struct {
		Entity string            `json:"entity"`
		Name   *string           `json:"name"`
		Values map[string]string `json:"values"`
	}
	// RowPick says a scene may pick a rows field's rows, each with one switch of this name.
	RowPick struct {
		Label string `json:"label"`
	}
	// CodexReminder is a line an entry's card shows while its values meet If (house decision #89).
	CodexReminder struct {
		ID   string  `json:"id"`
		If   string  `json:"if"`
		Text string  `json:"text"`
		Cite *string `json:"cite"`
	}
	// FieldPicks is where a list's quick picks come from: pack entries of an entity type.
	FieldPicks struct {
		Entity string `json:"entity"`
	}
	// CampaignFieldDef is one campaign field: an int has Min and Max, an enum Values; Default is a number, a word or a
	// bool by the type.
	CampaignFieldDef struct {
		Type    string            `json:"type"`
		Label   string            `json:"label"`
		Cite    *string           `json:"cite"`
		Min     float64           `json:"min"`
		Max     float64           `json:"max"`
		Values  []string          `json:"values"`
		Labels  map[string]string `json:"labels"`
		Notes   map[string]string `json:"notes"`
		Tones   map[string]string `json:"tones"`
		Default any               `json:"default"`
	}
	// CodexBlock is the manifest's codex block (house decision #71): the fields each kind of entry carries, by kind.
	// Its FieldDefs have no EditableBy and are never a list.
	CodexBlock struct {
		Kinds map[string]CodexKind `json:"kinds"`
	}
	// CodexKind is what one kind of codex entry carries.
	CodexKind struct {
		Fields    map[string]FieldDef `json:"fields"`
		Reminders []CodexReminder     `json:"reminders"`
		// From is the pack entry types an entry of this kind is made from, TitleRoll the tables rolled into its title
		// (house decision #97).
		From      []EntryPrefill `json:"from"`
		TitleRoll *FieldRoll     `json:"titleRoll"`
		// Ready is the fields an entry of this kind needs filled before it is ready for the table (house decision #107).
		Ready []string `json:"ready"`
	}
	// DerivedDef is one derived value.
	DerivedDef struct {
		ID         string `json:"id"`
		Label      string `json:"label"`
		Expr       string `json:"expr"`
		Visibility string `json:"visibility"`
		// Override names the int field holding a GM's override (house decision #96); nil when the value is never overridden.
		Override *string `json:"override"`
	}
	// EntityType is one kind of actor or entry.
	EntityType struct {
		ID      string              `json:"id"`
		Base    string              `json:"base"`
		Fields  map[string]FieldDef `json:"fields"`
		Derived []DerivedDef        `json:"derived"`
	}
	// ResetRule is one resetOn entry.
	ResetRule struct {
		Event string `json:"event"`
		To    string `json:"to"`
	}
	// Resource is one declared resource.
	Resource struct {
		ID         string      `json:"id"`
		Label      string      `json:"label"`
		EditableBy string      `json:"editableBy"`
		Cite       *string     `json:"cite"`
		Scope      string      `json:"scope"`
		Entities   *[]string   `json:"entities"`
		Min        string      `json:"min"`
		Max        *string     `json:"max"`
		Capped     bool        `json:"capped"`
		ResetOn    []ResetRule `json:"resetOn"`
		Start      *string     `json:"start"`
		Visibility string      `json:"visibility"`
	}
	// Effect is one effect of a condition.
	Effect struct {
		Path     string   `json:"path"`
		Mode     string   `json:"mode"`
		Value    string   `json:"value"`
		Phase    string   `json:"phase"`
		Priority *float64 `json:"priority"`
		When     *string  `json:"when"`
		Cite     *string  `json:"cite"`
	}
	// Condition is one declared condition.
	Condition struct {
		ID         string   `json:"id"`
		Label      string   `json:"label"`
		Duration   string   `json:"duration"`
		Stacking   string   `json:"stacking"`
		MaxStacks  *float64 `json:"maxStacks"`
		Cite       *string  `json:"cite"`
		Effects    []Effect `json:"effects"`
		Visibility string   `json:"visibility"`
		// From, At, Text and Immune are house decision #81; nil when absent.
		From   *string `json:"from"`
		At     *string `json:"at"`
		Text   *string `json:"text"`
		Immune *string `json:"immune"`
	}
	// Reminder is one line of `reminders` (house decision #81). If is nil when it has none.
	Reminder struct {
		ID   string  `json:"id"`
		At   string  `json:"at"`
		Text string  `json:"text"`
		Cite *string `json:"cite"`
		If   *string `json:"if"`
	}
	// RestRule is one of `rests` (house decision #81).
	RestRule struct {
		Event     string   `json:"event"`
		RefusedIn []string `json:"refusedIn"`
		Cite      *string  `json:"cite"`
	}
	poolBandDef struct {
		ID    string  `json:"id"`
		From  float64 `json:"from"`
		To    float64 `json:"to"`
		Worth float64 `json:"worth"`
	}
	faceRangeDef struct {
		From float64 `json:"from"`
		To   float64 `json:"to"`
	}
	// ReportedOutcome is one result of a reported Test, best first.
	ReportedOutcome struct {
		ID    string  `json:"id"`
		Label string  `json:"label"`
		Cite  *string `json:"cite"`
	}
	// Test is a sumVsTarget, poolSuccesses or reported declaration.
	Test struct {
		Outcomes     []ReportedOutcome `json:"outcomes"`
		Kind         string            `json:"kind"`
		Target       string            `json:"target"`
		Inputs       map[string]string `json:"inputs"`
		InputOptions map[string]any    `json:"inputOptions"`
		// Label, InputLabels and InputOptionLabels are what the screens call the Test, its inputs and an input's
		// options (house decision #77); without one the id shows.
		Label             *string                      `json:"label"`
		InputLabels       map[string]string            `json:"inputLabels"`
		InputOptionLabels map[string]map[string]string `json:"inputOptionLabels"`
		// Marks and Offers are what the GM sets when calling and what a result offers (house decision #80); nil when
		// absent.
		Marks  map[string]TestMark `json:"marks"`
		Offers []TestOffer         `json:"offers"`
		// Entities names the actor types that take the Test (house decision #50); nil is every actor type.
		Entities  *[]string `json:"entities"`
		Cite      *string   `json:"cite"`
		Modifier  string    `json:"modifier"`
		Dice      string    `json:"dice"`
		Advantage bool      `json:"advantage"`
		CritOn    []float64 `json:"critOn"`
		Degrees   *struct {
			Step         float64 `json:"step"`
			NaturalShift bool    `json:"naturalShift"`
			Cite         *string `json:"cite"`
		} `json:"degrees"`
		Pool    string        `json:"pool"`
		Die     float64       `json:"die"`
		Bands   []poolBandDef `json:"bands"`
		Special *struct {
			Label string                  `json:"label"`
			Count float64                 `json:"count"`
			Flags map[string]faceRangeDef `json:"flags"`
		} `json:"special"`
		Shift *string `json:"shift"`
	}
	// SideCost is a shared pool paid for a side's action out of turn, or to lift a bar.
	SideCost struct {
		Pool   string  `json:"pool"`
		Amount float64 `json:"amount"`
	}
	// Side is one side of a sides initiative.
	Side struct {
		ID       string    `json:"id"`
		Label    string    `json:"label"`
		Entities *[]string `json:"entities"`
	}
	// Initiative is a ranked, seated or sides declaration. Setup, OutOfTurn, Hold and Barred are nil when absent.
	Initiative struct {
		Strategy        string    `json:"strategy"`
		FirstPlayer     string    `json:"firstPlayer"`
		RerollEachRound bool      `json:"rerollEachRound"`
		Score           string    `json:"score"`
		Tiebreak        []string  `json:"tiebreak"`
		Cite            *string   `json:"cite"`
		Sides           []Side    `json:"sides"`
		UnableStates    *[]string `json:"unableStates"`
		FirstSide       string    `json:"firstSide"`
		RoundEnd        string    `json:"roundEnd"`
		Setup           *struct {
			Cite *string `json:"cite"`
			Note *string `json:"note"`
		} `json:"setup"`
		OutOfTurn *struct {
			Cost map[string]SideCost `json:"cost"`
			Cite *string             `json:"cite"`
		} `json:"outOfTurn"`
		Hold *struct {
			Cite *string `json:"cite"`
		} `json:"hold"`
		Barred *struct {
			ThroughRound float64             `json:"throughRound"`
			LiftCost     map[string]SideCost `json:"liftCost"`
			Cite         *string             `json:"cite"`
		} `json:"barred"`
	}
	// Scoring is a game's scoring declaration.
	Scoring struct {
		Mode      string `json:"mode"`
		Order     string `json:"order"`
		Score     string `json:"score"`
		Tiebreaks []struct {
			Expr  string `json:"expr"`
			Order string `json:"order"`
		} `json:"tiebreaks"`
		EndWhen []struct {
			When    string  `json:"when"`
			Outcome *string `json:"outcome"`
			Cite    *string `json:"cite"`
		} `json:"endWhen"`
		Cite *string `json:"cite"`
	}
	// HealthTrack is one health track.
	HealthTrack struct {
		Resource             string          `json:"resource"`
		Temp                 *string         `json:"temp"`
		DeathSaves           json.RawMessage `json:"deathSaves"`
		InstantDeathOverflow *string         `json:"instantDeathOverflow"`
	}
	// Health is the manifest's health block.
	Health struct {
		Tracks []HealthTrack `json:"tracks"`
		States []HealthState `json:"states"`
		Cite   *string       `json:"cite"`
		// Harm is nil when the ruleset declares no damage that counts up (house decision #66).
		Harm *Harm `json:"harm"`
	}
	// Harm is health.harm: damage that counts up toward a limit, and mobs (house decision #66).
	Harm struct {
		Cite   *string `json:"cite"`
		Wounds string  `json:"wounds"`
		Shock  *string `json:"shock"`
		Mob    *struct {
			Members string `json:"members"`
			Start   string `json:"start"`
		} `json:"mob"`
		Profiles []HarmProfile `json:"profiles"`
	}
	// HarmProfile is how one group of actor types takes a hit.
	HarmProfile struct {
		Entities  []string `json:"entities"`
		Shockless *string  `json:"shockless"`
		Spent     *struct {
			When       *string  `json:"when"`
			Conditions []string `json:"conditions"`
		} `json:"spent"`
		Felled *struct {
			When      string  `json:"when"`
			Injuries  *string `json:"injuries"`
			Condition *string `json:"condition"`
			HealTo    *string `json:"healTo"`
		} `json:"felled"`
		Destroyed *struct {
			Over  string `json:"over"`
			Field string `json:"field"`
		} `json:"destroyed"`
		// Convert lets `convert` move wounds to the second track (house decision #84).
		Convert bool `json:"convert"`
	}
	// SpendCost is one cost of a spend: a shared pool or a resource of the asking actor (house decision #84).
	SpendCost struct {
		Pool     *string `json:"pool"`
		Resource *string `json:"resource"`
		Amount   string  `json:"amount"`
		ByRun    bool    `json:"byRun"`
	}
	// SpendInput is a number the asker picks, within [Min, Max].
	SpendInput struct {
		Label string  `json:"label"`
		Min   float64 `json:"min"`
		Max   string  `json:"max"`
	}
	// SpendStep is one op a spend runs; a string input is an expression, anything else is taken as it is.
	SpendStep struct {
		Primitive string         `json:"primitive"`
		Op        string         `json:"op"`
		Input     map[string]any `json:"input"`
	}
	// Spend is one entry of the manifest's spends (house decision #84).
	Spend struct {
		ID       string                `json:"id"`
		Label    string                `json:"label"`
		Cite     *string               `json:"cite"`
		Entities *[]string             `json:"entities"`
		Cost     []SpendCost           `json:"cost"`
		Inputs   map[string]SpendInput `json:"inputs"`
		If       *string               `json:"if"`
		Run      []SpendStep           `json:"run"`
		ClearOn  []string              `json:"clearOn"`
		// Limit and Then are house decision #91: at most Max uses a round, and the table offered next.
		Limit *SpendLimit `json:"limit"`
		Then  *SpendThen  `json:"then"`
	}
	// SpendLimit is how often a spend may be done per actor (house decision #91).
	SpendLimit struct {
		Per string  `json:"per"`
		Max float64 `json:"max"`
	}
	// SpendThen is the table a spend offers next, and which spend inputs fill the table's inputs.
	SpendThen struct {
		Table  string            `json:"table"`
		Inputs map[string]string `json:"inputs"`
	}
	// HealthState is one display state of the health block.
	HealthState struct {
		ID    string  `json:"id"`
		Label *string `json:"label"`
		When  string  `json:"when"`
		// Entities names the actor types the state applies to (house decision #50); nil is every actor type.
		Entities *[]string `json:"entities"`
	}
	copyRule struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	// CreationStep is one step of the builder.
	CreationStep struct {
		ID       string     `json:"id"`
		Actor    string     `json:"actor"`
		Cite     *string    `json:"cite"`
		Optional bool       `json:"optional"`
		Kind     string     `json:"kind"`
		Pick     string     `json:"pick"`
		Count    float64    `json:"count"`
		Copy     []copyRule `json:"copy"`
		Fields   []string   `json:"fields"`
		Method   *struct {
			Kind   string             `json:"kind"`
			Budget float64            `json:"budget"`
			Values []float64          `json:"values"`
			Min    float64            `json:"min"`
			Max    float64            `json:"max"`
			Costs  map[string]float64 `json:"costs"`
		} `json:"method"`
	}
	idAndCite struct {
		ID   string  `json:"id"`
		Cite *string `json:"cite"`
	}
	// Phase is one phase of a round.
	Phase struct {
		idAndCite
		Label string `json:"label"`
		Mode  string `json:"mode"`
	}
	// Ruleset is a parsed manifest. Normalized is the same document as decoded JSON, defaults applied: what gets stored
	// and hashed.
	Ruleset struct {
		Normalized map[string]any `json:"-"`

		ID      string `json:"id"`
		Extends *struct {
			ID string `json:"id"`
		} `json:"extends"`
		Sources []struct {
			ID      string `json:"id"`
			License string `json:"license"`
		} `json:"sources"`
		Options   []idAndCite  `json:"options"`
		Entities  []EntityType `json:"entities"`
		Resources []Resource   `json:"resources"`
		// CampaignFields is nil when the manifest declares none.
		CampaignFields map[string]CampaignFieldDef `json:"campaignFields"`
		// Header is what the GM's header shows besides the name (house decision #109); nil when absent.
		Header     *HeaderBlock           `json:"header"`
		Conditions []Condition            `json:"conditions"`
		Reminders  []Reminder             `json:"reminders"`
		Rests      []RestRule             `json:"rests"`
		Tests      map[string]Test        `json:"tests"`
		Initiative *Initiative            `json:"initiative"`
		Phases     []Phase                `json:"phases"`
		Scoring    *Scoring               `json:"scoring"`
		Tables     map[string]RandomTable `json:"tables"`
		// Held is the records an actor gains in play, by kind id (house decision #88); nil when absent.
		Held map[string]HeldKind `json:"held"`
		// Items is the items actors hold in play (house decision #95); nil when absent.
		Items    *ItemsBlock    `json:"items"`
		Health   Health         `json:"health"`
		Creation []CreationStep `json:"creation"`
		// Build is nil when no actor type is built by the ledger builder.
		Build     *LedgerBuild `json:"build"`
		Decisions []idAndCite  `json:"decisions"`
		Game      *GameInfo    `json:"game"`
		// Codex is nil when entries carry no declared fields (house decision #71).
		Codex *CodexBlock `json:"codex"`
		// Notices is what an action's answer tells its sender about an actor (house decision #79); nil when absent.
		Notices []NoticeRule `json:"notices"`
		// Checklist is the setup checklist (house decision #90); nil when absent.
		Checklist []ChecklistStep `json:"checklist"`
		// Generators are what the GM runs in prep (house decision #98); nil when absent.
		Generators []Generator `json:"generators"`
		// Layout is read for its widget rows (house decision #83).
		Layout map[string]LayoutDef `json:"layout"`
		// Spends is what players may ask the GM to spend (house decision #84); Requests.Max caps pending asks per user.
		Spends   []Spend `json:"spends"`
		Requests *struct {
			Max float64 `json:"max"`
		} `json:"requests"`
		// Spawn is the spawn options, adjustments and encounter budget (house decision #92); nil when absent.
		Spawn *SpawnBlock `json:"spawn"`
		// Strikes are the kinds of strike the GM's guide offers (house decision #99); nil when absent.
		Strikes []Strike `json:"strikes"`
		// Panels are what a phone shows while each holds (house decision #114); nil when absent.
		Panels []Panel `json:"panels"`
	}
	// HeaderBlock is manifest.ts Header.
	HeaderBlock struct {
		Fields []string `json:"fields"`
		Round  bool     `json:"round"`
	}
	// SpawnOption is one option a spawned actor may take (manifest.ts SpawnOption).
	SpawnOption struct {
		ID       string    `json:"id"`
		Label    string    `json:"label"`
		Cite     *string   `json:"cite"`
		Entities *[]string `json:"entities"`
		When     *string   `json:"when"`
		Effects  []Effect  `json:"effects"`
	}
	// SpawnAdjust is a change made once at spawn (manifest.ts SpawnAdjust).
	SpawnAdjust struct {
		Option   *string           `json:"option"`
		Entities *[]string         `json:"entities"`
		When     *string           `json:"when"`
		Add      map[string]string `json:"add"`
		Cite     *string           `json:"cite"`
	}
	// SpawnBudgetLine is one line of the encounter budget.
	SpawnBudgetLine struct {
		ID     string `json:"id"`
		Label  string `json:"label"`
		Cost   string `json:"cost"`
		Budget string `json:"budget"`
	}
	// SpawnSwitch sets each budget line's budget to By while it is on.
	SpawnSwitch struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		By    string `json:"by"`
	}
	// SpawnBlock is the manifest's spawn block (manifest.ts SpawnBlock).
	SpawnBlock struct {
		Options []SpawnOption `json:"options"`
		Adjust  []SpawnAdjust `json:"adjust"`
		Budget  *struct {
			Cite     *string           `json:"cite"`
			Lines    []SpawnBudgetLine `json:"lines"`
			Switches []SpawnSwitch     `json:"switches"`
		} `json:"budget"`
	}
	// ChecklistStep is one step of the setup checklist (house decision #90; rules-engine ChecklistStep).
	ChecklistStep struct {
		ID   string         `json:"id"`
		Cite *string        `json:"cite"`
		Done ChecklistCount `json:"done"`
		Goto *struct {
			Tab  string  `json:"tab"`
			Kind *string `json:"kind"`
		} `json:"goto"`
	}
	// ChecklistCount is what a step counts, one flat struct read by Count.
	ChecklistCount struct {
		Count  string  `json:"count"`
		Kind   string  `json:"kind"`
		Field  *string `json:"field"`
		Equals any     `json:"equals"`
		Prep   *string `json:"prep"`
		Entity string  `json:"entity"`
		Built  *bool   `json:"built"`
		Pool   string  `json:"pool"`
	}
	// TestMark is a yes-or-no the GM sets when calling a Test, read as ctx.<id>.
	TestMark struct {
		Label string  `json:"label"`
		Cite  *string `json:"cite"`
	}
	// TestOffer is what a called Test's result offers the GM: when When holds, Changes, once.
	TestOffer struct {
		ID      string        `json:"id"`
		Label   string        `json:"label"`
		When    string        `json:"when"`
		Changes []OfferChange `json:"changes"`
		Cite    *string       `json:"cite"`
	}
	// OfferChange is one write of an offer: to a shared pool or to a resource of the taker.
	OfferChange struct {
		Pool     *string `json:"pool"`
		Resource *string `json:"resource"`
		By       string  `json:"by"`
	}
	// NoticeRule is one notice rule: when it is read, the actor types, the line it watches and the words it says.
	NoticeRule struct {
		ID       string    `json:"id"`
		When     string    `json:"when"`
		Entities *[]string `json:"entities"`
		If       string    `json:"if"`
		Text     string    `json:"text"`
		Cite     *string   `json:"cite"`
	}
	// LedgerBuild is the manifest's build block (house decision #62). Params is parsed by ValidateRuleset.
	LedgerBuild struct {
		Actor  string            `json:"actor"`
		Params *ledger.Params    `json:"-"`
		Kinds  map[string]string `json:"kinds"`
		Sheet  struct {
			Attributes   map[string]string `json:"attributes"`
			Skills       map[string]string `json:"skills"`
			Mods         map[string]string `json:"mods"`
			ArmourRating string            `json:"armourRating"`
			Powered      string            `json:"powered"`
			Speed        string            `json:"speed"`
			Species      string            `json:"species"`
			Archetype    string            `json:"archetype"`
			Keywords     string            `json:"keywords"`
			Wealth       *string           `json:"wealth"`
			Corruption   *string           `json:"corruption"`
		} `json:"sheet"`
		Tier string  `json:"tier"`
		XP   *string `json:"xp"`
		// Ascension, Gone and Award are play after creation (house decision #64): nil, empty and nil when absent.
		Ascension *struct {
			XP float64 `json:"xp"`
		} `json:"ascension"`
		Gone  []string `json:"gone"`
		Award *struct {
			Max       float64   `json:"max"`
			Suggested []float64 `json:"suggested"`
		} `json:"award"`
		// Keep is what a build over a hand-made sheet keeps (house decision #96); nil when such a build is refused.
		Keep *struct {
			Fields    []string `json:"fields"`
			Resources []string `json:"resources"`
		} `json:"keep"`
		// LibraryLine is the kind whose chosen record names a finished character on its library card (house decision
		// #187): "archetypes" or "species"; nil when the card shows none.
		LibraryLine *string `json:"libraryLine"`
	}
	// GameInfo is the manifest's `game` block: what the game is and how a table can sit for it.
	GameInfo struct {
		Title  string   `json:"title"`
		Family *string  `json:"family"`
		Genres []string `json:"genres"`
		Modes  []string `json:"modes"`
		Cite   *string  `json:"cite"`
	}
)

// TableModes are the modes the ruleset allows; one with no `game` block is played with a GM.
func (r *Ruleset) TableModes() []string {
	if r.Game == nil {
		return []string{"gm"}
	}
	return r.Game.Modes
}

// Tests and fields are JSON objects, whose key order decoded JSON no longer knows, so problems about them come in
// sorted order. Which problems come back does not change.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.SortFunc(keys, compareUnits)
	return keys
}

type problems []Problem

func (p *problems) add(path, format string, args ...any) {
	*p = append(*p, Problem{path, fmt.Sprintf(format, args...)})
}

func (p *problems) duplicates(path string, ids []string) {
	seen := map[string]bool{}
	for i, id := range ids {
		if seen[id] {
			p.add(fmt.Sprintf("%s[%d].id", path, i), `duplicate id "%s"`, id)
		}
		seen[id] = true
	}
}

func idsOf[T any](items []T, id func(T) string) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = id(item)
	}
	return out
}

func (r *Ruleset) entity(id string) *EntityType {
	for i := range r.Entities {
		if r.Entities[i].ID == id {
			return &r.Entities[i]
		}
	}
	return nil
}

// Steps name real actor entities, pack entity types and fields, and no field has two writers.
func (p *problems) creation(r *Ruleset) {
	written := map[string]string{}
	claim := func(actor, field, step, path string) {
		key := actor + "/" + field
		if prev, taken := written[key]; taken {
			p.add(path, `"%s" is already set by step "%s"`, field, prev)
		} else {
			written[key] = step
		}
	}
	for i, step := range r.Creation {
		at := fmt.Sprintf("creation[%d]", i)
		actor := r.entity(step.Actor)
		if actor == nil || actor.Base != "actor" {
			p.add(at+".actor", `"%s" is not an actor entity`, step.Actor)
			continue
		}
		fieldOf := func(id, path string) *FieldDef {
			def, ok := actor.Fields[id]
			if !ok {
				p.add(path, `%s has no field "%s"`, actor.ID, id)
				return nil
			}
			return &def
		}
		if step.Kind == "choose" {
			picked := r.entity(step.Pick)
			if picked == nil {
				p.add(at+".pick", `unknown entity "%s"`, step.Pick)
			}
			if len(step.Copy) > 0 && step.Count != 1 {
				p.add(at+".copy", "copy needs count 1: with several picks it is ambiguous")
			}
			for j, c := range step.Copy {
				to := fieldOf(c.To, fmt.Sprintf("%s.copy[%d].to", at, j))
				var from *FieldDef
				if picked != nil {
					if def, ok := picked.Fields[c.From]; ok {
						from = &def
					} else {
						p.add(fmt.Sprintf("%s.copy[%d].from", at, j), `%s has no field "%s"`, picked.ID, c.From)
					}
				}
				if from != nil && to != nil && from.Type != to.Type {
					p.add(fmt.Sprintf("%s.copy[%d]", at, j), "a %s field cannot fill a %s field", from.Type, to.Type)
				}
				claim(actor.ID, c.To, step.ID, fmt.Sprintf("%s.copy[%d].to", at, j))
			}
			continue
		}
		for j, id := range step.Fields {
			path := fmt.Sprintf("%s.fields[%d]", at, j)
			def := fieldOf(id, path)
			if step.Kind == "assign" && def != nil && def.Type != "int" {
				p.add(path, "a scored field must be an int")
			}
			claim(actor.ID, id, step.ID, path)
		}
		if step.Kind != "assign" {
			continue
		}
		m := step.Method
		if m.Kind == "table" && len(m.Values) != len(step.Fields) {
			p.add(at+".method.values", "%d values for %d fields", len(m.Values), len(step.Fields))
		}
		if m.Kind == "pointBuy" {
			if m.Max < m.Min {
				p.add(at+".method.max", "max is below min")
			}
			// min and max are capped at ±1000 by the schema, so this loop is short.
			for score := m.Min; score <= m.Max; score++ {
				if _, ok := m.Costs[esNumber(score)]; !ok {
					p.add(at+".method.costs", "no cost for the score %s", esNumber(score))
					break
				}
			}
		}
	}
}

// Every face range fits the die, bands never overlap, and shift names a band.
// harm is harmProblems of manifest.ts: health.harm's resources, fields and conditions (house decision #66).
// spends is manifest.ts spendProblems (house decision #84): ids, costs and inputs. Expressions and run ops are compiled.
// spawn is manifest.ts spawnProblems (house decision #92): ids, cites, actor types, and what an adjustment adds to.
func (p *problems) spawn(r *Ruleset, actorTypes func(*[]string, string), needCite func(*string, string)) {
	s := r.Spawn
	if s == nil {
		return
	}
	p.duplicates("spawn.options", idsOf(s.Options, func(o SpawnOption) string { return o.ID }))
	for i, o := range s.Options {
		needCite(o.Cite, fmt.Sprintf("spawn.options[%d]", i))
		actorTypes(o.Entities, fmt.Sprintf("spawn.options[%d].entities", i))
	}
	for i, a := range s.Adjust {
		path := fmt.Sprintf("spawn.adjust[%d]", i)
		needCite(a.Cite, path)
		actorTypes(a.Entities, path+".entities")
		if a.Option != nil && !slices.ContainsFunc(s.Options, func(o SpawnOption) bool { return o.ID == *a.Option }) {
			p.add(path+".option", `unknown option "%s"`, *a.Option)
		}
		for _, key := range sortedKeys(a.Add) {
			counts := false
			for j := range r.Entities {
				e := &r.Entities[j]
				if e.Base != "actor" || (a.Entities != nil && !slices.Contains(*a.Entities, e.ID)) {
					continue
				}
				if f, ok := e.Fields[key]; ok && f.Type == "int" {
					counts = true
				}
				for _, x := range r.Resources {
					if x.ID == key && x.Scope == "entity" && (x.Entities == nil || slices.Contains(*x.Entities, e.ID)) {
						counts = true
					}
				}
			}
			if !counts {
				p.add(path+".add."+key, `no spawned actor has an integer "%s"`, key)
			}
		}
	}
	if s.Budget != nil {
		needCite(s.Budget.Cite, "spawn.budget")
		p.duplicates("spawn.budget.lines", idsOf(s.Budget.Lines, func(l SpawnBudgetLine) string { return l.ID }))
		p.duplicates("spawn.budget.switches", idsOf(s.Budget.Switches, func(w SpawnSwitch) string { return w.ID }))
	}
}

func (p *problems) spends(r *Ruleset, actorTypes func(*[]string, string)) {
	p.duplicates("spends", idsOf(r.Spends, func(s Spend) string { return s.ID }))
	resources := map[string]Resource{}
	for _, x := range r.Resources {
		resources[x.ID] = x
	}
	for i, s := range r.Spends {
		path := fmt.Sprintf("spends[%d]", i)
		actorTypes(s.Entities, path+".entities")
		for j, c := range s.Cost {
			at := fmt.Sprintf("%s.cost[%d]", path, j)
			if (c.Pool == nil) == (c.Resource == nil) {
				p.add(at, "a cost names a pool or a resource")
				continue
			}
			id, key := "", "pool"
			if c.Pool != nil {
				id = *c.Pool
			} else {
				id, key = *c.Resource, "resource"
			}
			res, known := resources[id]
			switch {
			case !known:
				p.add(at+"."+key, `unknown resource "%s"`, id)
			case c.Pool != nil && res.Scope == "entity":
				p.add(at+".pool", `"%s" must be a shared pool`, id)
			case c.Resource != nil && res.Scope != "entity":
				p.add(at+".resource", `"%s" must be an entity-scoped resource`, id)
			}
		}
		for _, name := range sortedKeys(s.Inputs) {
			if name == "self" || name == "fight" {
				p.add(path+".inputs."+name, `"%s" is reserved`, name)
			}
		}
		if len(s.ClearOn) != len(slices.Compact(slices.Sorted(slices.Values(s.ClearOn)))) {
			p.add(path+".clearOn", "an event is listed twice")
		}
		if s.Then != nil {
			table, hasTable := r.Tables[s.Then.Table]
			if !hasTable {
				p.add(path+".then.table", `unknown table "%s"`, s.Then.Table)
			}
			for _, key := range sortedKeys(s.Then.Inputs) {
				if _, known := s.Inputs[s.Then.Inputs[key]]; !known {
					p.add(path+".then.inputs."+key, `"%s" is not an input of the spend`, s.Then.Inputs[key])
				}
				// The key names one of the table's inputs (house decision #91).
				if hasTable && !slices.ContainsFunc(table.Inputs, func(x TableInput) bool { return x.ID == key }) {
					p.add(path+".then.inputs."+key, `"%s" is not an input of the table`, key)
				}
			}
		}
	}
	// A list's quick picks name an entity type (house decision #91).
	for i, e := range r.Entities {
		for _, id := range sortedKeys(e.Fields) {
			f := e.Fields[id]
			if f.Type == "list" && f.Picks != nil && !slices.ContainsFunc(r.Entities, func(x EntityType) bool { return x.ID == f.Picks.Entity }) {
				p.add(fmt.Sprintf("entities[%d].fields.%s.picks.entity", i, id), `unknown entity "%s"`, f.Picks.Entity)
			}
		}
	}
}

func (p *problems) harm(r *Ruleset, harm *Harm, actorTypes func(*[]string, string)) {
	// The last declaration wins, as in TypeScript's Map built from the list.
	resources := map[string]*Resource{}
	for i := range r.Resources {
		resources[r.Resources[i].ID] = &r.Resources[i]
	}
	tracked := map[string]bool{}
	for _, t := range r.Health.Tracks {
		tracked[t.Resource] = true
		if t.Temp != nil {
			tracked[*t.Temp] = true
		}
	}
	type named struct {
		key    string
		id     *string
		capped bool
	}
	list := []named{{"wounds", &harm.Wounds, false}, {"shock", harm.Shock, false}}
	if harm.Mob != nil {
		list = append(list, named{"mob.members", &harm.Mob.Members, true})
	}
	used := map[string]string{}
	for _, n := range list {
		if n.id == nil {
			continue
		}
		id, path := *n.id, "health.harm."+n.key
		res := resources[id]
		other, taken := used[id]
		switch {
		case res == nil:
			p.add(path, `unknown resource "%s"`, id)
		case res.Scope != "entity":
			p.add(path, `"%s" must be an entity-scoped resource`, id)
		case tracked[id]:
			p.add(path, `"%s" is already a health track`, id)
		case taken:
			p.add(path, `"%s" is already health.harm.%s`, id, other)
		case res.Capped != n.capped && n.capped:
			p.add(path, `"%s" must be capped`, id)
		case res.Capped != n.capped:
			p.add(path, `"%s" must be declared capped: false`, id)
		}
		if !taken {
			used[id] = n.key
		}
	}
	var actors []*EntityType
	for i := range r.Entities {
		if r.Entities[i].Base == "actor" {
			actors = append(actors, &r.Entities[i])
		}
	}
	fieldOf := func(e *EntityType, id, typ, path string) {
		if def, ok := e.Fields[id]; !ok || def.Type != typ {
			p.add(path, `"%s" has no %s field "%s"`, e.ID, typ, id)
		}
	}
	if mob := harm.Mob; mob != nil {
		if members := resources[mob.Members]; members != nil && members.Scope == "entity" {
			for _, e := range actors {
				if members.Entities == nil || slices.Contains(*members.Entities, e.ID) {
					fieldOf(e, mob.Start, "int", "health.harm.mob.start")
				}
			}
		}
	}
	condition := func(id, path string) {
		if !slices.ContainsFunc(r.Conditions, func(c Condition) bool { return c.ID == id }) {
			p.add(path, `unknown condition "%s"`, id)
		}
	}
	profiled := map[string]int{}
	for i, x := range harm.Profiles {
		path := fmt.Sprintf("health.harm.profiles[%d]", i)
		actorTypes(&x.Entities, path+".entities")
		for j, id := range x.Entities {
			if other, taken := profiled[id]; taken {
				p.add(fmt.Sprintf("%s.entities[%d]", path, j), `"%s" is already in profiles[%d]`, id, other)
			} else {
				profiled[id] = i
			}
		}
		for _, e := range actors {
			if !slices.Contains(x.Entities, e.ID) {
				continue
			}
			if x.Felled != nil && x.Felled.Injuries != nil {
				fieldOf(e, *x.Felled.Injuries, "int", path+".felled.injuries")
			}
			if x.Destroyed != nil {
				fieldOf(e, x.Destroyed.Field, "bool", path+".destroyed.field")
			}
		}
		if x.Spent != nil {
			for j, id := range x.Spent.Conditions {
				condition(id, fmt.Sprintf("%s.spent.conditions[%d]", path, j))
			}
		}
		if x.Felled != nil && x.Felled.Condition != nil {
			condition(*x.Felled.Condition, path+".felled.condition")
		}
	}
}

func (p *problems) pool(t *Test, path string) {
	checkRange := func(from, to float64, at string) {
		if to < from {
			p.add(at+".to", "to is below from")
		}
		if to > t.Die {
			p.add(at+".to", "a d%s has no face %s", esNumber(t.Die), esNumber(to))
		}
	}
	p.duplicates(path+".bands", idsOf(t.Bands, func(b poolBandDef) string { return b.ID }))
	for i, b := range t.Bands {
		checkRange(b.From, b.To, fmt.Sprintf("%s.bands[%d]", path, i))
		for j, o := range t.Bands[:i] {
			if o.From <= b.To && b.From <= o.To {
				p.add(fmt.Sprintf("%s.bands[%d]", path, i), "overlaps bands[%d]", j)
				break
			}
		}
	}
	if t.Special != nil {
		for _, flag := range sortedKeys(t.Special.Flags) {
			f := t.Special.Flags[flag]
			checkRange(f.From, f.To, path+".special.flags."+flag)
		}
	}
	if t.Shift != nil && !slices.ContainsFunc(t.Bands, func(b poolBandDef) bool { return b.ID == *t.Shift }) {
		p.add(path+".shift", `no band "%s"`, *t.Shift)
	}
}

var reservedRoots = []string{"derived", "res", "party", "campaign", "ctx", "max", "min", "true", "false"}

// Words an expression reads as themselves, so a campaign field may not take them.
var expressionWords = []string{"true", "false", "max", "min"}

func (p *problems) campaignFields(r *Ruleset, needCite func(*string, string)) {
	for _, id := range sortedKeys(r.CampaignFields) {
		def := r.CampaignFields[id]
		path := "campaignFields." + id
		if slices.Contains(expressionWords, id) {
			p.add(path, `"%s" is reserved for expressions`, id)
		}
		needCite(def.Cite, path)
		switch def.Type {
		case "int":
			if def.Max < def.Min {
				p.add(path+".max", "max is below min")
			}
			if n := def.Default.(float64); n < def.Min || n > def.Max {
				p.add(path+".default", "the default is not allowed")
			}
		case "enum":
			seen := map[string]bool{}
			for i, v := range def.Values {
				if seen[v] {
					p.add(fmt.Sprintf("%s.values[%d]", path, i), `duplicate id "%s"`, v)
				}
				seen[v] = true
			}
			if !slices.Contains(def.Values, def.Default.(string)) {
				p.add(path+".default", "the default is not allowed")
			}
			p.enumWords(path, def.Values, def.Labels, def.Notes, def.Tones)
		}
	}
}

// testWords checks that a Test's words name only its own inputs, and an input's option words only its declared options.
// testOutcomes are a Test's marks and offers (house decision #80): a mark is not also an input; each change names
// what it writes.
func (p *problems) testOutcomes(r *Ruleset, id string, t *Test, needCite func(*string, string)) {
	path := "tests." + id
	for _, key := range sortedKeys(t.Marks) {
		if _, input := t.Inputs[key]; input {
			p.add(path+".marks."+key, `"%s" is also an input`, key)
		}
	}
	p.duplicates(path+".offers", idsOf(t.Offers, func(o TestOffer) string { return o.ID }))
	var takers []*EntityType
	for i := range r.Entities {
		e := &r.Entities[i]
		if e.Base == "actor" && (t.Entities == nil || slices.Contains(*t.Entities, e.ID)) {
			takers = append(takers, e)
		}
	}
	// An offer reads the result as `result`, so a taker's field cannot be called that.
	if len(t.Offers) > 0 {
		for _, e := range takers {
			for f := range e.Fields {
				if head, _, _ := strings.Cut(f, "."); head == "result" {
					p.add(path+".offers", `"result" is a field of "%s"`, e.ID)
					break
				}
			}
		}
	}
	for i, o := range t.Offers {
		needCite(o.Cite, fmt.Sprintf("%s.offers[%d]", path, i))
		for j, c := range o.Changes {
			at := fmt.Sprintf("%s.offers[%d].changes[%d]", path, i, j)
			if (c.Pool == nil) == (c.Resource == nil) {
				p.add(at, "a change names one pool or one resource")
				continue
			}
			named, key := "", "pool"
			if c.Pool != nil {
				named = *c.Pool
			} else {
				named, key = *c.Resource, "resource"
			}
			var res *Resource
			for k := range r.Resources {
				if r.Resources[k].ID == named {
					res = &r.Resources[k]
					break
				}
			}
			switch {
			case res == nil:
				p.add(at+"."+key, `unknown resource "%s"`, named)
			case c.Pool != nil && res.Scope == "entity":
				p.add(at+".pool", `"%s" is not a shared pool`, named)
			case c.Resource != nil && res.Scope != "entity":
				p.add(at+".resource", `"%s" must be an entity-scoped resource`, named)
			case c.Resource != nil:
				for _, e := range takers {
					if res.Entities != nil && !slices.Contains(*res.Entities, e.ID) {
						p.add(at+".resource", `"%s" does not carry "%s"`, e.ID, named)
					}
				}
			}
		}
	}
}

func (p *problems) testWords(t *Test, path string) {
	for _, key := range sortedKeys(t.InputLabels) {
		if _, ok := t.Inputs[key]; !ok {
			p.add(path+".inputLabels."+key, `"%s" is not an input`, key)
		}
	}
	for _, key := range sortedKeys(t.InputOptionLabels) {
		if _, ok := t.Inputs[key]; !ok {
			p.add(path+".inputOptionLabels."+key, `"%s" is not an input`, key)
			continue
		}
		options, _ := t.InputOptions[key].([]any)
		for _, option := range sortedKeys(t.InputOptionLabels[key]) {
			if !slices.Contains(options, any(option)) {
				p.add(path+".inputOptionLabels."+key+"."+option, `"%s" is not an option`, option)
			}
		}
	}
}

// enumWords checks that an enum's labels, notes and tones name only its own values.
func (p *problems) enumWords(path string, values []string, labels, notes, tones map[string]string) {
	for i, words := range []map[string]string{labels, notes, tones} {
		key := [...]string{"labels", "notes", "tones"}[i]
		for _, value := range sortedKeys(words) {
			if !slices.Contains(values, value) {
				p.add(path+"."+key+"."+value, `"%s" is not a value`, value)
			}
		}
	}
}

// codex checks the codex block (house decision #71): a ref names a declared entity, an int range is the right way up,
// an enum's words name its values.
func (p *problems) codex(r *Ruleset) {
	if r.Codex == nil {
		return
	}
	for _, kind := range sortedKeys(r.Codex.Kinds) {
		fields := r.Codex.Kinds[kind].Fields
		for _, id := range sortedKeys(fields) {
			def, path := fields[id], "codex.kinds."+kind+".fields."+id
			if def.Type == "ref" && r.entity(def.Entity) == nil {
				p.add(path+".entity", `unknown entity "%s"`, def.Entity)
			}
			if def.Type == "int" && def.Min != nil && def.Max != nil && *def.Max < *def.Min {
				p.add(path+".max", "max is below min")
			}
			if def.Type == "enum" {
				p.enumWords(path, def.Values, def.Labels, def.Notes, def.Tones)
			}
			if def.Type == "tags" {
				p.tags(r, &def, path)
			}
			if def.Type == "rows" {
				p.rows(r, &def, path)
			}
			if def.Type == "text" && def.Roll != nil {
				p.roll(r, def.Roll, path+".roll")
			}
		}
		k := r.Codex.Kinds[kind]
		p.duplicates("codex.kinds."+kind+".reminders", idsOf(k.Reminders, func(x CodexReminder) string { return x.ID }))
		if k.TitleRoll != nil {
			p.roll(r, k.TitleRoll, "codex.kinds."+kind+".titleRoll")
		}
		p.entryFrom(r, kind, &k)
		seenReady := map[string]bool{}
		for i, id := range k.Ready {
			at := fmt.Sprintf("codex.kinds.%s.ready[%d]", kind, i)
			if _, ok := k.Fields[id]; !ok {
				p.add(at, `unknown field "%s"`, id)
			} else if seenReady[id] {
				p.add(at, `duplicate id "%s"`, id)
			}
			seenReady[id] = true
		}
	}
}

// roll checks a field's roll (house decision #97; rollProblems in manifest.ts): its tables exist and are rolled, not
// dealt.
func (p *problems) roll(r *Ruleset, roll *FieldRoll, path string) {
	for i, id := range roll.Tables {
		t, has := r.Tables[id]
		switch {
		case !has:
			p.add(fmt.Sprintf("%s.tables[%d]", path, i), `unknown table "%s"`, id)
		case t.Visibility == "owner":
			p.add(fmt.Sprintf("%s.tables[%d]", path, i), `"%s" is dealt, never rolled`, id)
		}
	}
}

// entryFrom checks how a kind is made from pack entries (house decision #97; entryFromProblems in manifest.ts).
func (p *problems) entryFrom(r *Ruleset, kind string, k *CodexKind) {
	seen := map[string]bool{}
	for i, f := range k.From {
		at := fmt.Sprintf("codex.kinds.%s.from[%d]", kind, i)
		if seen[f.Entity] {
			p.add(at+".entity", `"%s" fills entries twice`, f.Entity)
		}
		seen[f.Entity] = true
		entity := r.entity(f.Entity)
		if entity == nil {
			p.add(at+".entity", `unknown entity "%s"`, f.Entity)
			continue
		}
		if f.Name != nil {
			if def, has := k.Fields[*f.Name]; !has || def.Type != "text" {
				p.add(at+".name", `"%s" is not a text field of %s`, *f.Name, kind)
			}
		}
		for _, to := range sortedKeys(f.Values) {
			fieldID := f.Values[to]
			def, declared := k.Fields[to]
			field, has := entity.Fields[fieldID]
			switch {
			case !declared:
				p.add(at+".values."+to, `"%s" is not a field of %s`, to, kind)
			case !has:
				p.add(at+".values."+to, `"%s" is not a field of "%s"`, fieldID, f.Entity)
			case !fitsColumn(&RowColumn{Type: def.Type, Values: def.Values, Entity: def.Entity}, &field):
				p.add(at+".values."+to, `"%s" does not fit the field`, fieldID)
			}
		}
		if f.Children != nil {
			ref, has := entity.Fields[*f.Children]
			switch {
			case !has || ref.Type != "ref" || ref.Entity != f.Entity:
				p.add(at+".children", `"%s" is not a ref to "%s"`, *f.Children, f.Entity)
			case kind == "scene":
				p.add(at+".children", "a scene sits under an adventure, not a scene")
			}
		}
		list := func(id, path string) {
			if kind != "scene" {
				p.add(path, "only a scene holds prepared lines")
			} else if def, has := entity.Fields[id]; !has || def.Type != "list" {
				p.add(path, `"%s" is not a list field of "%s"`, id, f.Entity)
			}
		}
		if f.Tests != nil {
			list(f.Tests.Field, at+".tests.field")
			for _, input := range sortedKeys(f.Tests.Inputs) {
				fieldID := f.Tests.Inputs[input]
				if def := entity.Fields[fieldID]; !slices.Contains([]string{"int", "text", "enum", "bool"}, def.Type) {
					p.add(at+".tests.inputs."+input, `"%s" is not a value field of "%s"`, fieldID, f.Entity)
				}
			}
		}
		if f.Roster != nil {
			list(*f.Roster, at+".roster")
		}
	}
}

// tags checks a tags field (house decision #89; tagsProblems in manifest.ts): its suggestions name declared entities,
// its labels its options, and something can be entered.
func (p *problems) tags(r *Ruleset, def *FieldDef, path string) {
	for i, e := range def.Entities {
		if r.entity(e) == nil {
			p.add(fmt.Sprintf("%s.entities[%d]", path, i), `unknown entity "%s"`, e)
		}
	}
	p.enumWords(path, def.Options, def.Labels, nil, nil)
	if def.Entities == nil && def.Options == nil && !def.WriteIn {
		p.add(path, "a tags field needs entities, options or writeIn")
	}
}

// fitsColumn says whether an entity field's values fit a column: the same type, an enum's values among the column's,
// a ref's entity.
func fitsColumn(col *RowColumn, field *FieldDef) bool {
	switch {
	case col.Type != field.Type:
		return false
	case col.Type == "enum":
		for _, v := range field.Values {
			if !slices.Contains(col.Values, v) {
				return false
			}
		}
	case col.Type == "ref":
		return field.Entity == col.Entity
	}
	return true
}

func columnOf(def *FieldDef, id string) *RowColumn {
	for i := range def.Columns {
		if def.Columns[i].ID == id {
			return &def.Columns[i]
		}
	}
	return nil
}

// rows checks a rows field (house decision #89; rowsProblems in manifest.ts): its columns are unique and sound, and
// each prefill names a declared entity whose fields fit their columns.
func (p *problems) rows(r *Ruleset, def *FieldDef, path string) {
	p.duplicates(path+".columns", idsOf(def.Columns, func(c RowColumn) string { return c.ID }))
	for i, c := range def.Columns {
		at := fmt.Sprintf("%s.columns[%d]", path, i)
		if c.Type == "ref" && r.entity(c.Entity) == nil {
			p.add(at+".entity", `unknown entity "%s"`, c.Entity)
		}
		if c.Type == "int" && c.Min != nil && c.Max != nil && *c.Max < *c.Min {
			p.add(at+".max", "max is below min")
		}
		if c.Type == "enum" {
			p.enumWords(at, c.Values, c.Labels, c.Notes, c.Tones)
		}
	}
	seen := map[string]bool{}
	for i, f := range def.From {
		at := fmt.Sprintf("%s.from[%d]", path, i)
		if seen[f.Entity] {
			p.add(at+".entity", `"%s" fills rows twice`, f.Entity)
		}
		seen[f.Entity] = true
		entity := r.entity(f.Entity)
		if entity == nil {
			p.add(at+".entity", `unknown entity "%s"`, f.Entity)
			continue
		}
		if f.Name != nil {
			if c := columnOf(def, *f.Name); c == nil || c.Type != "text" {
				p.add(at+".name", `"%s" is not a text column`, *f.Name)
			}
		}
		for _, col := range sortedKeys(f.Values) {
			fieldID := f.Values[col]
			c := columnOf(def, col)
			field, has := entity.Fields[fieldID]
			switch {
			case c == nil:
				p.add(at+".values."+col, `"%s" is not a column`, col)
			case !has:
				p.add(at+".values."+col, `"%s" is not a field of "%s"`, fieldID, f.Entity)
			case !fitsColumn(c, &field):
				p.add(at+".values."+col, `"%s" does not fit the column`, fieldID)
			}
		}
	}
}

func (r *Ruleset) semanticProblems() problems {
	var p problems
	// CLAUDE.md principle 1: every rule entry cites its printed page, unless the whole ruleset is homebrew.
	homebrew := true
	for _, s := range r.Sources {
		homebrew = homebrew && s.License == "homebrew"
	}
	needCite := func(cite *string, path string) {
		if !homebrew && cite == nil {
			p.add(path+".cite", "a rule entry needs a cite")
		}
	}
	for i, x := range r.Resources {
		needCite(x.Cite, fmt.Sprintf("resources[%d]", i))
	}
	for i, x := range r.Options {
		needCite(x.Cite, fmt.Sprintf("options[%d]", i))
	}
	p.campaignFields(r, needCite)
	for i, c := range r.Conditions {
		needCite(c.Cite, fmt.Sprintf("conditions[%d]", i))
		for j, e := range c.Effects {
			cite := e.Cite
			if cite == nil {
				cite = c.Cite
			}
			needCite(cite, fmt.Sprintf("conditions[%d].effects[%d]", i, j))
		}
		if (c.At == nil) != (c.Text == nil) {
			p.add(fmt.Sprintf("conditions[%d]", i), "a reminder needs both at and text")
		}
		if c.From != nil && c.Duration != "ownTurnEnd" {
			p.add(fmt.Sprintf("conditions[%d].from", i), "only an ownTurnEnd condition is armed from a turn")
		}
	}
	for i, x := range r.Reminders {
		needCite(x.Cite, fmt.Sprintf("reminders[%d]", i))
	}
	for i, x := range r.Rests {
		needCite(x.Cite, fmt.Sprintf("rests[%d]", i))
		for j, id := range x.RefusedIn {
			if !slices.ContainsFunc(r.Health.States, func(s HealthState) bool { return s.ID == id }) {
				p.add(fmt.Sprintf("rests[%d].refusedIn[%d]", i, j), `unknown health state "%s"`, id)
			}
		}
	}
	for _, id := range sortedKeys(r.Tests) {
		t := r.Tests[id]
		needCite(t.Cite, "tests."+id)
		if t.Degrees != nil {
			needCite(t.Degrees.Cite, "tests."+id+".degrees")
		}
		for j, o := range t.Outcomes {
			needCite(o.Cite, fmt.Sprintf("tests.%s.outcomes[%d]", id, j))
		}
	}
	if r.Initiative != nil {
		needCite(r.Initiative.Cite, "initiative")
		if i := r.Initiative; i.Strategy == "sides" {
			if i.Setup != nil {
				needCite(i.Setup.Cite, "initiative.setup")
			}
			if i.OutOfTurn != nil {
				needCite(i.OutOfTurn.Cite, "initiative.outOfTurn")
			}
			if i.Hold != nil {
				needCite(i.Hold.Cite, "initiative.hold")
			}
			if i.Barred != nil {
				needCite(i.Barred.Cite, "initiative.barred")
			}
		}
	}
	for i, x := range r.Phases {
		needCite(x.Cite, fmt.Sprintf("phases[%d]", i))
	}
	for _, id := range sortedKeys(r.Tables) {
		t := r.Tables[id]
		needCite(t.Cite, "tables."+id)
		p.table(r, id, &t)
	}
	p.held(r, needCite)
	p.items(r, needCite)
	if s := r.Scoring; s != nil {
		needCite(s.Cite, "scoring")
		for i, x := range s.EndWhen {
			needCite(x.Cite, fmt.Sprintf("scoring.endWhen[%d]", i))
		}
		wins := false
		for i, x := range s.EndWhen {
			path := fmt.Sprintf("scoring.endWhen[%d].outcome", i)
			if s.Mode == "compete" && x.Outcome != nil {
				p.add(path, "only a cooperative game has an outcome")
			}
			if s.Mode == "coop" && x.Outcome == nil {
				p.add(path, "a cooperative trigger names its outcome")
			}
			wins = wins || (x.Outcome != nil && *x.Outcome == "win")
		}
		if s.Mode == "coop" && !wins {
			p.add("scoring.endWhen", "a cooperative game needs a trigger that wins")
		}
	}
	// Playing without a GM or alone is a rule of the game, so it is cited (principle 1).
	if r.Game != nil && slices.ContainsFunc(r.Game.Modes, func(m string) bool { return m != "gm" }) {
		needCite(r.Game.Cite, "game")
	}
	// Death saves and damage order are rules too.
	if len(r.Health.Tracks) > 0 {
		needCite(r.Health.Cite, "health")
	}
	if r.Health.Harm != nil {
		needCite(r.Health.Harm.Cite, "health.harm")
	}
	for i, x := range r.Creation {
		needCite(x.Cite, fmt.Sprintf("creation[%d]", i))
	}

	fieldCount := 0
	for _, e := range r.Entities {
		fieldCount += len(e.Fields) + len(e.Derived)
	}
	if fieldCount > MaxFields {
		p.add("entities", "%d fields, over the cap of %d", fieldCount, MaxFields)
	}
	if r.Extends != nil && r.Extends.ID == r.ID {
		p.add("extends.id", "a ruleset cannot extend itself")
	}
	idOf := func(x idAndCite) string { return x.ID }
	p.duplicates("sources", func() []string {
		out := make([]string, len(r.Sources))
		for i, s := range r.Sources {
			out[i] = s.ID
		}
		return out
	}())
	p.duplicates("entities", idsOf(r.Entities, func(e EntityType) string { return e.ID }))
	p.duplicates("resources", idsOf(r.Resources, func(x Resource) string { return x.ID }))
	p.duplicates("conditions", idsOf(r.Conditions, func(x Condition) string { return x.ID }))
	p.duplicates("reminders", idsOf(r.Reminders, func(x Reminder) string { return x.ID }))
	p.duplicates("rests", idsOf(r.Rests, func(x RestRule) string { return x.Event }))
	p.duplicates("phases", idsOf(r.Phases, func(x Phase) string { return x.ID }))
	if i := r.Initiative; i != nil && i.Strategy == "sides" {
		p.duplicates("initiative.sides", idsOf(i.Sides, func(x Side) string { return x.ID }))
		if r.Phases != nil {
			p.add("phases", "sides do not combine with phases yet")
		}
	}
	if h := r.Header; h != nil {
		for i, id := range h.Fields {
			path := fmt.Sprintf("header.fields[%d]", i)
			if _, ok := r.CampaignFields[id]; !ok {
				p.add(path, `unknown campaign field "%s"`, id)
			} else if slices.Index(h.Fields, id) != i {
				p.add(path, `duplicate field "%s"`, id)
			}
		}
		if h.Round && r.Initiative == nil {
			p.add("header.round", "a round needs an initiative")
		}
	}
	p.duplicates("options", idsOf(r.Options, idOf))
	p.duplicates("creation", idsOf(r.Creation, func(x CreationStep) string { return x.ID }))
	p.duplicates("decisions", idsOf(r.Decisions, idOf))
	p.creation(r)
	p.build(r)

	for i, e := range r.Entities {
		p.duplicates(fmt.Sprintf("entities[%d].derived", i), idsOf(e.Derived, func(d DerivedDef) string { return d.ID }))
		ids := sortedKeys(e.Fields)
		for _, id := range ids {
			path := fmt.Sprintf("entities[%d].fields.%s", i, id)
			root, _, _ := strings.Cut(id, ".")
			if slices.Contains(reservedRoots, root) {
				p.add(path, `"%s" is reserved for expressions`, root)
			}
			// attr and attr.str cannot both be fields: attr would be a value and a group at once.
			if slices.ContainsFunc(ids, func(other string) bool { return strings.HasPrefix(other, id+".") }) {
				p.add(path, "is also a group of other fields")
			}
			def := e.Fields[id]
			if def.Type == "ref" && r.entity(def.Entity) == nil {
				p.add(path+".entity", `unknown entity "%s"`, def.Entity)
			}
			if def.Type == "int" && def.Min != nil && def.Max != nil && *def.Max < *def.Min {
				p.add(path+".max", "max is below min")
			}
			if def.Type == "enum" {
				p.enumWords(path, def.Values, def.Labels, def.Notes, def.Tones)
			}
		}
	}
	p.codex(r)
	p.layout(r)

	for i, x := range r.Resources {
		if x.Entities != nil {
			for j, id := range *x.Entities {
				if r.entity(id) == nil {
					p.add(fmt.Sprintf("resources[%d].entities[%d]", i, j), `unknown entity "%s"`, id)
				}
			}
			if x.Scope != "entity" {
				p.add(fmt.Sprintf("resources[%d].entities", i), "only an entity-scoped resource names entities")
			}
		}
	}

	if i := r.Initiative; i != nil && i.Strategy == "sides" {
		p.sideCosts(r, i)
	}

	trackResource := func(id, path string) {
		// The last declaration wins, as in TypeScript's Map built from the list.
		var res *Resource
		for i := range r.Resources {
			if r.Resources[i].ID == id {
				res = &r.Resources[i]
			}
		}
		if res == nil {
			p.add(path, `unknown resource "%s"`, id)
		} else if res.Scope != "entity" {
			p.add(path, `"%s" must be an entity-scoped resource`, id)
		}
	}
	withDeathSaves := 0
	for i, t := range r.Health.Tracks {
		trackResource(t.Resource, fmt.Sprintf("health.tracks[%d].resource", i))
		if t.Temp != nil {
			trackResource(*t.Temp, fmt.Sprintf("health.tracks[%d].temp", i))
		}
		if t.DeathSaves != nil {
			withDeathSaves++
		}
	}
	// One dying/stable/dead status per actor, so only one track can run death saves.
	if withDeathSaves > 1 {
		p.add("health.tracks", "only one track may have deathSaves")
	}

	actorTypes := func(ids *[]string, path string) {
		if ids == nil {
			return
		}
		for j, id := range *ids {
			if e := r.entity(id); e == nil {
				p.add(fmt.Sprintf("%s[%d]", path, j), `unknown entity "%s"`, id)
			} else if e.Base != "actor" {
				p.add(fmt.Sprintf("%s[%d]", path, j), `"%s" is not an actor entity`, id)
			}
		}
	}
	for i, s := range r.Health.States {
		actorTypes(s.Entities, fmt.Sprintf("health.states[%d].entities", i))
	}
	if r.Health.Harm != nil {
		p.harm(r, r.Health.Harm, actorTypes)
	}
	for i, x := range r.Spends {
		needCite(x.Cite, fmt.Sprintf("spends[%d]", i))
	}
	p.spends(r, actorTypes)
	p.spawn(r, actorTypes, needCite)
	p.strikes(r, actorTypes, needCite)
	p.panels(r, actorTypes, needCite)

	for _, id := range sortedKeys(r.Tests) {
		t := r.Tests[id]
		path := "tests." + id
		actorTypes(t.Entities, path+".entities")
		for _, key := range sortedKeys(t.InputOptions) {
			if t.Inputs[key] != "text" {
				p.add(path+".inputOptions."+key, "options are only for text inputs")
			}
		}
		p.testWords(&t, path)
		p.testOutcomes(r, id, &t, needCite)
		if t.Kind == "poolSuccesses" {
			p.pool(&t, path)
			continue
		}
		if t.Kind == "reported" {
			seen := map[string]bool{}
			for j, o := range t.Outcomes {
				if seen[o.ID] {
					p.add(fmt.Sprintf("%s.outcomes[%d].id", path, j), `duplicate outcome "%s"`, o.ID)
				}
				seen[o.ID] = true
			}
			continue
		}
		count, sides, ok := PlainDice(t.Dice)
		if !ok {
			p.add(path+".dice", "sumVsTarget takes plain NdX dice")
			continue
		}
		if t.Advantage && count != 1 {
			p.add(path+".advantage", "advantage needs a single die (1dX)")
		}
		for j, n := range t.CritOn {
			if n > float64(count*sides) {
				p.add(fmt.Sprintf("%s.critOn[%d]", path, j), "%s cannot be rolled", esNumber(n))
			}
		}
		if t.Degrees != nil {
			if t.CritOn != nil {
				p.add(path+".critOn", "degrees replace critOn")
			}
			if t.Degrees.NaturalShift && count != 1 {
				p.add(path+".degrees.naturalShift", "a natural shift needs a single die (1dX)")
			}
		}
	}
	for i, n := range r.Notices {
		needCite(n.Cite, fmt.Sprintf("notices[%d]", i))
		actorTypes(n.Entities, fmt.Sprintf("notices[%d].entities", i))
	}
	p.duplicates("notices", idsOf(r.Notices, func(n NoticeRule) string { return n.ID }))
	for i, s := range r.Checklist {
		path := fmt.Sprintf("checklist[%d]", i)
		needCite(s.Cite, path)
		p.checklist(r, &s.Done, path+".done")
		if s.Goto != nil && s.Goto.Kind != nil && s.Goto.Tab != "codex" {
			p.add(path+".goto.kind", "only the codex tab takes a kind")
		}
	}
	p.duplicates("checklist", idsOf(r.Checklist, func(s ChecklistStep) string { return s.ID }))
	for i := range r.Generators {
		path := fmt.Sprintf("generators[%d]", i)
		needCite(r.Generators[i].Cite, path)
		p.generator(r, &r.Generators[i], path)
	}
	p.duplicates("generators", idsOf(r.Generators, func(g Generator) string { return g.ID }))
	return p
}

// checklist checks that a checklist step counts what the ruleset declares (house decision #90; checklistProblems in
// manifest.ts).
func (p *problems) checklist(r *Ruleset, done *ChecklistCount, path string) {
	switch done.Count {
	case "entries":
		var def *FieldDef
		if r.Codex != nil && done.Field != nil {
			if d, has := r.Codex.Kinds[done.Kind].Fields[*done.Field]; has {
				def = &d
			}
		}
		if done.Field != nil && def == nil {
			p.add(path+".field", `"%s" is not a field of %s`, *done.Field, done.Kind)
		}
		if done.Equals != nil && done.Field == nil {
			p.add(path+".equals", "equals needs a field")
		}
		if done.Equals != nil && def != nil {
			if why := CheckFieldValue(def, done.Equals); why != "" {
				p.add(path+".equals", "%s", why)
			}
		}
		if done.Prep != nil && done.Kind != "scene" {
			p.add(path+".prep", "only a scene holds prepared lines")
		}
	case "actors":
		e := r.entity(done.Entity)
		switch {
		case e == nil:
			p.add(path+".entity", `unknown entity "%s"`, done.Entity)
		case e.Base != "actor":
			p.add(path+".entity", `"%s" is not an actor entity`, done.Entity)
		case done.Built != nil && *done.Built && (r.Build == nil || r.Build.Actor != done.Entity):
			p.add(path+".built", `"%s" has no build`, done.Entity)
		}
	case "campaignField":
		if _, has := r.CampaignFields[*done.Field]; !has {
			p.add(path+".field", `unknown campaign field "%s"`, *done.Field)
		}
	case "pool":
		shared := false
		for _, res := range r.Resources {
			shared = shared || (res.ID == done.Pool && res.Scope != "entity")
		}
		if !shared {
			p.add(path+".pool", `"%s" is not a shared pool`, done.Pool)
		}
	}
}

// ValidateRuleset takes a manifest as decoded JSON: size cap, schema, then the rules a schema can't say.
func ValidateRuleset(input any) (*Ruleset, []Problem) {
	if size := len(CanonicalJSON(input)); size > MaxManifestBytes {
		return nil, []Problem{{"(root)", fmt.Sprintf("%d bytes, over the cap of %d", size, MaxManifestBytes)}}
	}
	parsed, issues := schema.Parse(rulesetSchema, input)
	if len(issues) > 0 {
		out := make([]Problem, len(issues))
		for i, issue := range issues {
			out[i] = Problem{formatPath(issue.Path), issue.Message}
		}
		return nil, out
	}
	raw, err := json.Marshal(parsed)
	if err != nil {
		panic(err)
	}
	r := &Ruleset{Normalized: parsed.(map[string]any)}
	if err := json.Unmarshal(raw, r); err != nil {
		panic(err)
	}
	if r.Build != nil {
		// The schema has run ledger.ParamsSchema, refinements included, so these parse.
		if r.Build.Params, err = ledger.ParseParams(r.Normalized["build"].(map[string]any)["params"]); err != nil {
			panic(err)
		}
	}
	if found := r.semanticProblems(); len(found) > 0 {
		return nil, found
	}
	return r, nil
}

// sideCosts checks that every cost of a sides initiative names a declared side and a shared pool.
func (p *problems) sideCosts(r *Ruleset, init *Initiative) {
	listed := map[string]string{}
	for i, side := range init.Sides {
		if side.Entities == nil {
			continue
		}
		for j, id := range *side.Entities {
			path := fmt.Sprintf("initiative.sides[%d].entities[%d]", i, j)
			if e := r.entity(id); e == nil {
				p.add(path, `unknown entity "%s"`, id)
			} else if e.Base != "actor" {
				p.add(path, `"%s" is not an actor entity`, id)
			}
			if other, taken := listed[id]; taken {
				p.add(path, `"%s" is already on side "%s"`, id, other)
			} else {
				listed[id] = side.ID
			}
		}
	}
	if init.UnableStates != nil {
		for i, id := range *init.UnableStates {
			declared := false
			for _, st := range r.Health.States {
				declared = declared || st.ID == id
			}
			if !declared {
				p.add(fmt.Sprintf("initiative.unableStates[%d]", i), `unknown health state "%s"`, id)
			}
		}
	}
	declared := map[string]bool{}
	for _, side := range init.Sides {
		declared[side.ID] = true
	}
	costs := func(record map[string]SideCost, path string) {
		for _, side := range sortedKeys(record) {
			cost := record[side]
			if !declared[side] {
				p.add(path+"."+side, `unknown side "%s"`, side)
			}
			// The last declaration wins, as in TypeScript's Map built from the list.
			var res *Resource
			for i := range r.Resources {
				if r.Resources[i].ID == cost.Pool {
					res = &r.Resources[i]
				}
			}
			if res == nil {
				p.add(path+"."+side+".pool", `unknown resource "%s"`, cost.Pool)
			} else if res.Scope == "entity" {
				p.add(path+"."+side+".pool", `"%s" must be a shared pool`, cost.Pool)
			}
		}
	}
	if init.OutOfTurn != nil {
		costs(init.OutOfTurn.Cost, "initiative.outOfTurn.cost")
	}
	if init.Barred != nil {
		costs(init.Barred.LiftCost, "initiative.barred.liftCost")
	}
}
