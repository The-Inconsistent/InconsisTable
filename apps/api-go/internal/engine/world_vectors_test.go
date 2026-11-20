package engine

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

// The World twin against packages/rules-engine/src/world.ts (vectors/world.ts).
type worldVectorFile struct {
	Worlds struct {
		MaxBytes  int      `json:"maxBytes"`
		Tokens    []string `json:"tokens"`
		Schemes   []string `json:"schemes"`
		Typefaces []string `json:"typefaces"`
		Textures  []string `json:"textures"`
		Layouts   []string `json:"layouts"`
		MaxName   int      `json:"maxLayoutName"`
		Shapes    []struct {
			Key     string   `json:"key"`
			Options []string `json:"options"`
		} `json:"shapes"`
		Pairs    []contrastPair               `json:"pairs"`
		Base     map[string]map[string]string `json:"base"`
		Sources  map[string]map[string]string `json:"sources"`
		Linear   []int64                      `json:"linear"`
		Contrast []struct {
			A, B       string
			Hundredths int64 `json:"hundredths"`
		} `json:"contrast"`
		Cases []struct {
			Input    any            `json:"input"`
			Ok       bool           `json:"ok"`
			World    map[string]any `json:"world"`
			Hash     string         `json:"hash"`
			Problems []Problem      `json:"problems"`
		} `json:"cases"`
	} `json:"worlds"`
}

func loadWorldVectors(t *testing.T) worldVectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v worldVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Worlds.Cases) == 0 {
		t.Fatal("no World vectors")
	}
	return v
}

func TestWorldListsMatchTypeScript(t *testing.T) {
	w := loadWorldVectors(t).Worlds
	if w.MaxBytes != MaxWorldBytes {
		t.Errorf("max bytes: want %d, got %d", w.MaxBytes, MaxWorldBytes)
	}
	if w.MaxName != maxHandoutLayoutName {
		t.Errorf("max layout name: want %d, got %d", w.MaxName, maxHandoutLayoutName)
	}
	for name, pair := range map[string][2][]string{
		"tokens":    {w.Tokens, worldColourTokens},
		"schemes":   {w.Schemes, worldSchemes},
		"typefaces": {w.Typefaces, worldTypefaces},
		"textures":  {w.Textures, worldTextures},
		"layouts":   {w.Layouts, HandoutLayouts},
	} {
		if !slices.Equal(pair[0], pair[1]) {
			t.Errorf("%s: want %v, got %v", name, pair[0], pair[1])
		}
	}
	if len(w.Shapes) != len(worldShapes) {
		t.Fatalf("shapes: want %d, got %d", len(w.Shapes), len(worldShapes))
	}
	for i, s := range w.Shapes {
		if s.Key != worldShapes[i].key || !slices.Equal(s.Options, worldShapes[i].options) {
			t.Errorf("shape %d: want %s %v, got %s %v", i, s.Key, s.Options, worldShapes[i].key, worldShapes[i].options)
		}
	}
	if len(w.Pairs) != len(worldContrastPairs) {
		t.Fatalf("pairs: want %d, got %d", len(w.Pairs), len(worldContrastPairs))
	}
	for i, p := range w.Pairs {
		if p != worldContrastPairs[i] {
			t.Errorf("pair %d: want %v, got %v", i, p, worldContrastPairs[i])
		}
	}
	if !reflect.DeepEqual(w.Base, worldBaseColours) {
		t.Errorf("base colours differ:\n  want %v\n  got  %v", w.Base, worldBaseColours)
	}
	if !reflect.DeepEqual(w.Sources, worldColourSources) {
		t.Errorf("colour sources differ:\n  want %v\n  got  %v", w.Sources, worldColourSources)
	}
	if !slices.Equal(w.Linear, worldLinear[:]) {
		t.Errorf("linear table differs:\n  want %v\n  got  %v", w.Linear, worldLinear)
	}
}

func TestWorldContrastMatchesTypeScript(t *testing.T) {
	for _, x := range loadWorldVectors(t).Worlds.Contrast {
		if got := contrastHundredths(x.A, x.B); got != x.Hundredths {
			t.Errorf("%s on %s: want %d, got %d", x.A, x.B, x.Hundredths, got)
		}
	}
}

func TestWorldsMatchTypeScript(t *testing.T) {
	cases := loadWorldVectors(t).Worlds.Cases
	f := &failures{t: t}
	accepted := 0
	for i, x := range cases {
		world, found := ValidateWorld(x.Input)
		switch {
		case x.Ok && len(found) > 0:
			f.add("case %d: want it accepted, got %v", i, problemKeys(found))
		case !x.Ok && !slices.Equal(problemKeys(found), problemKeys(x.Problems)):
			f.add("case %d\n  want %v\n  got  %v", i, problemKeys(x.Problems), problemKeys(found))
		case x.Ok:
			accepted++
			if got := viaJSON(t, world); !reflect.DeepEqual(got, viaJSON(t, x.World)) {
				f.add("case %d world: %s", i, firstDifference("", viaJSON(t, x.World), got))
			}
			if got := WorldHash(world); got != x.Hash {
				f.add("case %d hash: want %s, got %s", i, x.Hash, got)
			}
		}
	}
	f.done(len(cases))
	if accepted < 10 {
		t.Errorf("only %d Worlds accepted, so this proves little", accepted)
	}
}
