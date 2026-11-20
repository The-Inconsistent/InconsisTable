package ledger

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"sync"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The vectors apps/api-go/vectors/ledger.ts writes: what the TypeScript ledger builder answers, for this package to
// match. `bun run test:go` writes them first.
type vectorFile struct {
	Params      []json.RawMessage `json:"params"`
	ParamsCases []struct {
		Input  json.RawMessage `json:"input"`
		Ok     bool            `json:"ok"`
		Parsed json.RawMessage `json:"parsed"`
	} `json:"paramsCases"`
	Parse []struct {
		Params int             `json:"params"`
		Schema string          `json:"schema"`
		Input  json.RawMessage `json:"input"`
		Ok     bool            `json:"ok"`
		Output json.RawMessage `json:"output"`
	} `json:"parse"`
	Catalogues []struct {
		Creation json.RawMessage `json:"creation"`
		Wargear  json.RawMessage `json:"wargear"`
	} `json:"catalogues"`
	Resolve []resolveCase `json:"resolve"`
	Meets   []struct {
		Ctx json.RawMessage `json:"ctx"`
		Req json.RawMessage `json:"req"`
		Why json.RawMessage `json:"why"`
	} `json:"meets"`
	OutOfReach []struct {
		Reqs json.RawMessage `json:"reqs"`
		Who  Who             `json:"who"`
		Out  bool            `json:"out"`
	} `json:"outOfReach"`
	WargearMatches []struct {
		Params  int             `json:"params"`
		Wargear string          `json:"wargear"`
		Filter  json.RawMessage `json:"filter"`
		Tier    float64         `json:"tier"`
		NewTier float64         `json:"newTier"`
		Match   bool            `json:"match"`
	} `json:"wargearMatches"`
	PurchaseKeys []struct {
		Purchase Purchase `json:"purchase"`
		Key      string   `json:"key"`
	} `json:"purchaseKeys"`
	JS struct {
		Numbers []struct {
			N any    `json:"n"`
			S string `json:"s"`
		} `json:"numbers"`
		Cuts []struct {
			S   string `json:"s"`
			N   int    `json:"n"`
			Cut string `json:"cut"`
		} `json:"cuts"`
		ToNumber []struct {
			S string `json:"s"`
			N string `json:"n"`
		} `json:"toNumber"`
		Capital []struct {
			S, Capital string
		} `json:"capital"`
		Norm []struct {
			S, Norm string
		} `json:"norm"`
		Lower []struct {
			S, Lower string
		} `json:"lower"`
		Stringify []struct {
			Value   json.RawMessage `json:"value"`
			JSON    string          `json:"json"`
			NoLabel string          `json:"noLabel"`
		} `json:"stringify"`
	} `json:"js"`
}

// What JavaScript answers itself, which js.go reproduces: String(n), .slice, Number(s), toUpperCase on the first
// unit, toLowerCase, labels.ts norm, and JSON.stringify with and without its label replacer.
func TestJavaScriptBehaviourMatches(t *testing.T) {
	v := loadVectors(t).JS
	for _, c := range v.Numbers {
		n, isNum := c.N.(float64)
		if !isNum {
			n = toNumber(c.N.(string))
		}
		if got := num(n); got != c.S {
			t.Errorf("String(%v): Go %q, JavaScript %q", c.N, got, c.S)
		}
	}
	for _, c := range v.Cuts {
		if got := cut(c.S, c.N); got != c.Cut {
			t.Errorf("%q.slice(0, %d): Go %q, JavaScript %q", c.S, c.N, got, c.Cut)
		}
	}
	for _, c := range v.ToNumber {
		if got := num(toNumber(c.S)); got != c.N {
			t.Errorf("Number(%q): Go %s, JavaScript %s", c.S, got, c.N)
		}
	}
	for _, c := range v.Capital {
		if got := capital(c.S); got != c.Capital {
			t.Errorf("capital(%q): Go %q, JavaScript %q", c.S, got, c.Capital)
		}
	}
	for _, c := range v.Norm {
		if got := norm(c.S); got != c.Norm {
			t.Errorf("norm(%q): Go %q, JavaScript %q", c.S, got, c.Norm)
		}
	}
	for _, c := range v.Lower {
		if got := lowerJS.String(c.S); got != c.Lower {
			t.Errorf("%q.toLowerCase(): Go %q, JavaScript %q", c.S, got, c.Lower)
		}
	}
	for _, c := range v.Stringify {
		value := decoded(c.Value)
		if got := stringify(value, false); got != c.JSON {
			t.Errorf("JSON.stringify: Go %s, JavaScript %s", got, c.JSON)
		}
		if got := stringify(value, true); got != c.NoLabel {
			t.Errorf("JSON.stringify without labels: Go %s, JavaScript %s", got, c.NoLabel)
		}
	}
}

// The wide catalogue and its params, as the vector writer numbers them.
const (
	wideParams    = 5
	wideCatalogue = 3
)

func set(list []string) map[string]bool {
	out := map[string]bool{}
	for _, x := range list {
		out[x] = true
	}
	return out
}

func TestMeetsMatchesTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	wargear := catalogueFor(t, v, wideParams, wideCatalogue, true).Wargear
	for i, c := range v.Meets {
		var in struct {
			Attributes, Skills                                          map[string]float64
			Keywords, Species, SubFactionIDs, Talents, TalentCategories []string
			ArchetypeID                                                 *string
			Powers                                                      []Power
			Gear                                                        []GearItem
			Options                                                     []Option
			Influence, Rank, Tier                                       float64
			Chosen                                                      *string
		}
		if err := json.Unmarshal(c.Ctx, &in); err != nil {
			t.Fatal(err)
		}
		ctx := Ctx{
			Params: params[wideParams], Attributes: in.Attributes, Skills: in.Skills, Keywords: set(in.Keywords),
			Species: in.Species, ArchetypeID: in.ArchetypeID, SubFactionIDs: set(in.SubFactionIDs),
			Talents: set(in.Talents), TalentCategories: in.TalentCategories, Powers: in.Powers, Gear: in.Gear,
			Wargear: wargear, Options: in.Options, Influence: in.Influence, Rank: in.Rank, Tier: in.Tier, Chosen: in.Chosen,
		}
		why := Meets(decoded(c.Req).(*schema.Obj), ctx)
		var got any = why.Reason
		switch {
		case why.Met:
			got = true
		case why.GM != nil:
			got = map[string]any{"gm": *why.GM}
		}
		out, _ := json.Marshal(got)
		if !same(t, out, c.Why) {
			t.Fatalf("meets case %d: Go %s, TypeScript %s\nreq %s\nctx %s", i, out, c.Why, c.Req, c.Ctx)
		}
	}
}

func TestOutOfReachMatchesTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	for i, c := range v.OutOfReach {
		reqs, _ := decoded(c.Reqs).([]any)
		if got := OutOfReach(asObjs(reqs), c.Who); got != c.Out {
			t.Fatalf("outOfReach case %d: Go %v, TypeScript %v\nreqs %s\nwho %+v", i, got, c.Out, c.Reqs, c.Who)
		}
	}
}

func TestWargearMatchesMatchesTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	wargear := catalogueFor(t, v, wideParams, wideCatalogue, true).Wargear
	for i, c := range v.WargearMatches {
		f, _ := decoded(c.Filter).(*schema.Obj)
		if got := WargearMatches(wargear[c.Wargear], f, c.Tier, c.NewTier, params[c.Params]); got != c.Match {
			t.Fatalf("wargearMatches case %d: %s with %s at %v/%v under params %d: Go %v, TypeScript %v",
				i, c.Wargear, c.Filter, c.Tier, c.NewTier, c.Params, got, c.Match)
		}
	}
}

func TestPurchaseKeyMatchesTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	for _, c := range v.PurchaseKeys {
		if got := PurchaseKey(c.Purchase); got != c.Key {
			t.Fatalf("purchaseKey %+v: Go %q, TypeScript %q", c.Purchase, got, c.Key)
		}
	}
}

type resolveCase struct {
	Name      string          `json:"name"`
	Seed      *int            `json:"seed"`
	Params    int             `json:"params"`
	Catalogue int             `json:"catalogue"`
	Homebrew  bool            `json:"homebrew"`
	Build     json.RawMessage `json:"build"`
	Play      *Play           `json:"play"`
	Result    json.RawMessage `json:"result"`
	Ready     bool            `json:"ready"`
	Throws    *string         `json:"throws"`
}

var catalogues = map[[2]int]Catalogue{}

// catalogueFor parses a vector catalogue under one params, once.
func catalogueFor(t *testing.T, v *vectorFile, params, catalogue int, homebrew bool) Catalogue {
	t.Helper()
	key := [2]int{params, catalogue}
	c, ok := catalogues[key]
	if !ok {
		p := paramsAt(params)
		raw := v.Catalogues[catalogue]
		creation, err := ParseCreation(p, decoded(raw.Creation))
		if err != nil {
			t.Fatal(err)
		}
		list, _ := decoded(raw.Wargear).([]any)
		wargear, err := ParseWargear(p, list)
		if err != nil {
			t.Fatal(err)
		}
		c = Catalogue{Creation: creation, Wargear: wargear}
		catalogues[key] = c
	}
	c.Homebrew = homebrew
	return c
}

func paramsAt(i int) *Params { return params[i] }

// firstDiff names the first place two decoded JSON values differ.
func firstDiff(path string, a, b any) string {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok {
			return path
		}
		keys := map[string]bool{}
		for k := range x {
			keys[k] = true
		}
		for k := range y {
			keys[k] = true
		}
		for k := range keys {
			if d := firstDiff(path+"."+k, x[k], y[k]); d != "" {
				return d
			}
		}
		return ""
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			out, _ := json.Marshal(map[string]any{"go": a, "ts": b})
			return path + " " + string(out)
		}
		for i := range x {
			if d := firstDiff(path+"["+strconv.Itoa(i)+"]", x[i], y[i]); d != "" {
				return d
			}
		}
		return ""
	}
	if !reflect.DeepEqual(a, b) {
		out, _ := json.Marshal(map[string]any{"go": a, "ts": b})
		return path + " " + string(out)
	}
	return ""
}

// checkResolve resolves one vector case and compares it with the TypeScript's answer.
func checkResolve(t *testing.T, v *vectorFile, c resolveCase) {
	t.Helper()
	name := c.Name
	if c.Seed != nil {
		name = "seed " + strconv.Itoa(*c.Seed) + " " + name
	}
	got, err := Resolve(paramsAt(c.Params), catalogueFor(t, v, c.Params, c.Catalogue, c.Homebrew), decoded(c.Build), c.Play)
	if c.Throws != nil {
		if err == nil {
			t.Fatalf("%s: the TypeScript throws (%s), Go answers\nbuild %s", name, *c.Throws, c.Build)
		}
		return
	}
	if err != nil {
		t.Fatalf("%s: Go fails: %v\nbuild %s", name, err, c.Build)
	}
	out, _ := json.Marshal(got)
	var a, b any
	_ = json.Unmarshal(out, &a)
	_ = json.Unmarshal(c.Result, &b)
	if d := firstDiff("", a, b); d != "" {
		t.Fatalf("%s: differs at %s\nbuild %s\nplay %+v params %d catalogue %d homebrew %v",
			name, d, c.Build, c.Play, c.Params, c.Catalogue, c.Homebrew)
	}
	if Ready(got) != c.Ready {
		t.Fatalf("%s: Ready is %v, the TypeScript's %v", name, Ready(got), c.Ready)
	}
}

func TestResolveMatchesTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	for _, c := range v.Resolve {
		checkResolve(t, v, c)
	}
}

var (
	vectorsOnce sync.Once
	vectors     vectorFile
	vectorsErr  error
	params      []*Params
)

func loadVectors(t *testing.T) *vectorFile {
	t.Helper()
	vectorsOnce.Do(func() {
		data, err := os.ReadFile("../testdata/ledger.json")
		if err != nil {
			vectorsErr = err
			return
		}
		if vectorsErr = json.Unmarshal(data, &vectors); vectorsErr != nil {
			return
		}
		for _, raw := range vectors.Params {
			p, err := ParseParams(decoded(raw))
			if err != nil {
				vectorsErr = err
				return
			}
			params = append(params, p)
		}
	})
	if vectorsErr != nil {
		t.Fatalf("ledger vectors (run `bun run test:go`): %v", vectorsErr)
	}
	return &vectors
}

func decoded(raw json.RawMessage) any {
	v, err := schema.DecodeJSON(raw)
	if err != nil {
		panic(err)
	}
	return v
}

// ordered writes v as JSON with its key order, so two trees compare order and all.
func ordered(t *testing.T, v any) string {
	t.Helper()
	out, err := schema.AppendJSON(nil, v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// same compares two JSON texts as values: key order aside, numbers as numbers.
func same(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(x, y)
}

var plainSchemas = map[string]schema.Schema{
	"Scaled": Scaled, "Amount": Amount, "XpCost": XpCost, "UpgradeMod": UpgradeMod, "WeaponMod": WeaponMod,
	"RankAmount": RankAmount, "Weapon": Weapon, "WargearItem": WargearItem, "BuildChoice": BuildChoice,
	"AdvancedBuild": AdvancedBuild,
}

func schemaNamed(p *Params, name string) schema.Schema {
	if s, ok := plainSchemas[name]; ok {
		return s
	}
	f := reflect.ValueOf(p.Schemas()).Elem().FieldByName(name)
	if !f.IsValid() {
		return nil
	}
	s, _ := f.Interface().(schema.Schema)
	return s
}

func TestParamsMatchTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	for i, c := range v.ParamsCases {
		p, err := ParseParams(decoded(c.Input))
		if (err == nil) != c.Ok {
			t.Fatalf("params case %d: Go ok %v (%v), TypeScript ok %v\n%s", i, err == nil, err, c.Ok, c.Input)
		}
		if err != nil {
			continue
		}
		got, _ := json.Marshal(p)
		if !same(t, got, c.Parsed) {
			t.Fatalf("params case %d:\n Go %s\n TS %s", i, got, c.Parsed)
		}
	}
}

// Every schema buildSchemas returns, and the plain ones beside it: the same inputs pass and refuse, and a parsed value
// is the same tree with its keys in the same order.
func TestSchemasMatchTheTypeScript(t *testing.T) {
	v := loadVectors(t)
	seen := map[string]bool{}
	for i, c := range v.Parse {
		s := schemaNamed(params[c.Params], c.Schema)
		if s == nil {
			t.Fatalf("parse case %d: no schema %s", i, c.Schema)
		}
		seen[c.Schema] = true
		out, issues := schema.Parse(s, decoded(c.Input))
		if (len(issues) == 0) != c.Ok {
			t.Fatalf("parse case %d (%s, params %d): Go ok %v %v, TypeScript ok %v\n%s",
				i, c.Schema, c.Params, len(issues) == 0, issues, c.Ok, c.Input)
		}
		if !c.Ok {
			continue
		}
		if got, want := ordered(t, out), ordered(t, decoded(c.Output)); got != want {
			t.Fatalf("parse case %d (%s, params %d): %s\n Go %s\n TS %s", i, c.Schema, c.Params, c.Input, got, want)
		}
	}
	for _, name := range reflect.VisibleFields(reflect.TypeFor[Schemas]()) {
		if !seen[name.Name] {
			t.Errorf("no parse vector for %s", name.Name)
		}
	}
	if !bytes.Contains([]byte(ordered(t, decoded(json.RawMessage(`{"b":1,"a":2}`)))), []byte(`"b":1,"a":2`)) {
		t.Fatal("the decoder lost the key order")
	}
}
