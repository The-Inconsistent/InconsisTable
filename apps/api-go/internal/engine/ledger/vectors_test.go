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
