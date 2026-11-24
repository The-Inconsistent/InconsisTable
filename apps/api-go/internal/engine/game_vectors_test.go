package engine

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"testing"
)

type gameVectorFile struct {
	Manifests        []any       `json:"manifests"`
	ScoringManifests []any       `json:"scoringManifests"`
	CreationManifest any         `json:"creationManifest"`
	CreationEntries  []PackEntry `json:"creationEntries"`
	FieldValues      []struct {
		Def   FieldDef `json:"def"`
		Value any      `json:"value"`
		Why   *string  `json:"why"`
	} `json:"fieldValues"`
	FitRows []struct {
		Def   FieldDef `json:"def"`
		Value any      `json:"value"`
		Fit   any      `json:"fit"`
	} `json:"fitRows"`
	Scoring []struct {
		Manifest int                       `json:"manifest"`
		Actors   map[string]map[string]any `json:"actors"`
		Order    []string                  `json:"order"`
		Round    float64                   `json:"round"`
		Met      []int                     `json:"met"`
		Rows     any                       `json:"rows"`
		Error    *string                   `json:"error"`
		Ranked   any                       `json:"ranked"`
	} `json:"scoring"`
	Views []struct {
		Manifest int         `json:"manifest"`
		Viewer   Viewer      `json:"viewer"`
		Actors   []ActorView `json:"actors"`
		View     any         `json:"view"`
	} `json:"views"`
	Creation []struct {
		Actor    string         `json:"actor"`
		Answers  map[string]any `json:"answers"`
		Ok       bool           `json:"ok"`
		Fields   any            `json:"fields"`
		Choices  any            `json:"choices"`
		Problems []Problem      `json:"problems"`
	} `json:"creation"`
	Packs struct {
		Rulesets []any `json:"rulesets"`
		Cases    []struct {
			Ruleset  int       `json:"ruleset"`
			Input    any       `json:"input"`
			Big      bool      `json:"big"`
			Ok       bool      `json:"ok"`
			Warnings []Problem `json:"warnings"`
			Pack     any       `json:"pack"`
			Hashes   []string  `json:"hashes"`
			Problems []Problem `json:"problems"`
		} `json:"cases"`
	} `json:"packs"`
	Diffs []struct {
		Prev map[string]string `json:"prev"`
		Next map[string]string `json:"next"`
		Diff any               `json:"diff"`
	} `json:"diffs"`
}

func loadGameVectors(t *testing.T) gameVectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v gameVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for name, size := range map[string]int{
		"fieldValues": len(v.FieldValues), "scoring": len(v.Scoring), "views": len(v.Views), "creation": len(v.Creation),
		"packs": len(v.Packs.Cases), "diffs": len(v.Diffs), "scoringManifests": len(v.ScoringManifests),
	} {
		if size == 0 {
			t.Fatalf("no %s vectors, so this test would prove nothing", name)
		}
	}
	return v
}

func mustCompile(t *testing.T, manifest any) *CompiledRuleset {
	t.Helper()
	c, found := CompileRuleset(manifest)
	if len(found) > 0 {
		t.Fatalf("a fixture does not compile: %v", found)
	}
	return c
}

// Keeps a failure list readable when one bug breaks thousands of cases.
type failures struct {
	t     *testing.T
	count int
}

func (f *failures) add(format string, args ...any) {
	f.t.Helper()
	f.count++
	if f.count <= 25 {
		f.t.Errorf(format, args...)
	}
}

func (f *failures) done(total int) {
	f.t.Helper()
	if f.count > 0 {
		f.t.Errorf("%d of %d cases differ", f.count, total)
	}
}

func TestFieldValuesMatchTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	f := &failures{t: t}
	for _, x := range v.FieldValues {
		want := ""
		if x.Why != nil {
			want = *x.Why
		}
		if got := CheckFieldValue(&x.Def, x.Value); got != want {
			f.add("%s value %v: want %q, got %q", x.Def.Type, short(fmt.Sprint(x.Value)), want, got)
		}
	}
	f.done(len(v.FieldValues))
}

// A stored rows value as the declaration now fits it (house decision #89) is what fitRows in field-value.ts answers.
func TestFitRowsMatchesTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	if len(v.FitRows) == 0 {
		t.Fatal("no fitRows vectors")
	}
	f := &failures{t: t}
	for _, x := range v.FitRows {
		var got any
		if fit := FitRows(&x.Def, x.Value); fit != nil {
			got = fit
		}
		if !reflect.DeepEqual(roundTrip(t, got), x.Fit) {
			f.add("value %v: want %v, got %v", short(fmt.Sprint(x.Value)), x.Fit, got)
		}
	}
	f.done(len(v.FitRows))
}

func roundTrip(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestScoringMatchesTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	compiled := make([]*CompiledRuleset, len(v.ScoringManifests))
	for i, m := range v.ScoringManifests {
		compiled[i] = mustCompile(t, m)
	}
	f := &failures{t: t}
	for i, x := range v.Scoring {
		c := compiled[x.Manifest]
		scopes := map[string]*Record{}
		for id, fields := range x.Actors {
			if fields != nil {
				scopes[id] = ActorScope(fields, nil, nil, 0, nil)
			}
		}
		if got := c.EndMet(scopes, x.Order, x.Round); !slices.Equal(got, x.Met) {
			f.add("case %d met: want %v, got %v", i, x.Met, got)
		}
		rows, err := c.ScoreRows(scopes, x.Order)
		if x.Error != nil {
			if err == nil || err.Error() != *x.Error {
				f.add("case %d: want error %q, got %v", i, *x.Error, err)
			}
			continue
		}
		if err != nil {
			f.add("case %d: %v", i, err)
			continue
		}
		if got := viaJSON(t, rows); !reflect.DeepEqual(got, x.Rows) {
			f.add("case %d rows: want %v, got %v", i, x.Rows, got)
		}
		if c.Scoring != nil {
			if got := viaJSON(t, RankResults(c.Scoring.Def, rows, x.Met)); !reflect.DeepEqual(got, x.Ranked) {
				f.add("case %d ranked: want %v, got %v", i, x.Ranked, got)
			}
		}
	}
	f.done(len(v.Scoring))
}

func TestViewsMatchTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	compiled := make([]*CompiledRuleset, len(v.Manifests))
	for i, m := range v.Manifests {
		compiled[i] = mustCompile(t, m)
	}
	f := &failures{t: t}
	for i, x := range v.Views {
		got := viaJSON(t, compiled[x.Manifest].ToViewerView(x.Viewer, x.Actors))
		if !reflect.DeepEqual(got, x.View) {
			f.add("case %d: %s", i, firstDifference("", x.View, got))
		}
	}
	f.done(len(v.Views))
}

func TestCreationMatchesTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	r := mustCompile(t, v.CreationManifest).Ruleset
	lookup := func(entityType, key string) *PackEntry {
		for i := range v.CreationEntries {
			if e := &v.CreationEntries[i]; e.Type == entityType && e.Key == key {
				return e
			}
		}
		return nil
	}
	f := &failures{t: t}
	for i, x := range v.Creation {
		fields, choices, found := r.RunCreation(x.Actor, x.Answers, lookup)
		switch {
		case x.Ok && len(found) > 0:
			f.add("case %d: want it accepted, got %v, answers %v", i, problemKeys(found), x.Answers)
		case !x.Ok && !slices.Equal(problemKeys(found), problemKeys(x.Problems)):
			f.add("case %d answers %v\n  want %v\n  got  %v", i, x.Answers, problemKeys(x.Problems), problemKeys(found))
		case x.Ok && !reflect.DeepEqual(viaJSON(t, fields), x.Fields):
			f.add("case %d fields: want %v, got %v", i, x.Fields, viaJSON(t, fields))
		case x.Ok && !reflect.DeepEqual(viaJSON(t, choices), x.Choices):
			f.add("case %d choices: want %v, got %v", i, x.Choices, viaJSON(t, choices))
		}
	}
	f.done(len(v.Creation))
}

func TestPacksMatchTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	rulesets := make([]*Ruleset, len(v.Packs.Rulesets))
	for i, m := range v.Packs.Rulesets {
		rulesets[i] = mustCompile(t, m).Ruleset
	}
	f := &failures{t: t}
	accepted := 0
	for i, x := range v.Packs.Cases {
		if x.Big {
			// Only the size refusal, whose input is too large to keep in the vectors.
			continue
		}
		pack, found, warnings := ValidatePack(x.Input, rulesets[x.Ruleset])
		if x.Ok {
			accepted++
		}
		switch {
		case x.Ok && len(found) > 0:
			f.add("case %d: want it accepted, got %v", i, problemKeys(found))
		case !x.Ok && !slices.Equal(problemKeys(found), problemKeys(x.Problems)):
			f.add("case %d\n  want %v\n  got  %v", i, problemKeys(x.Problems), problemKeys(found))
		case !slices.Equal(problemKeys(warnings), problemKeys(x.Warnings)):
			f.add("case %d warnings\n  want %v\n  got  %v", i, problemKeys(x.Warnings), problemKeys(warnings))
		case x.Ok:
			if got := viaJSON(t, pack.Normalized); !reflect.DeepEqual(got, x.Pack) {
				f.add("case %d pack: %s", i, firstDifference("", x.Pack, got))
			}
			hashes := make([]string, len(pack.Entries))
			for j, e := range pack.Normalized["entries"].([]any) {
				hashes[j] = ContentHash(e.(map[string]any))
			}
			if !slices.Equal(hashes, x.Hashes) {
				f.add("case %d hashes: want %v, got %v", i, x.Hashes, hashes)
			}
		}
	}
	f.done(len(v.Packs.Cases))
	if accepted == 0 {
		t.Error("no pack accepted, so this proves little")
	}
}

func TestOversizedPacksAreRefused(t *testing.T) {
	v := loadGameVectors(t)
	r := mustCompile(t, v.Packs.Rulesets[1]).Ruleset
	entry := map[string]any{"key": "a", "type": "kin", "name": "A", "body": map[string]any{"note": string(make([]byte, MaxPackBytes))}}
	_, found, _ := ValidatePack(map[string]any{"entries": []any{entry}}, r)
	if len(found) != 1 || found[0].Path != "(root)" {
		t.Errorf("got %v", found)
	}
}

func TestDiffHashesMatchTypeScript(t *testing.T) {
	v := loadGameVectors(t)
	f := &failures{t: t}
	for i, x := range v.Diffs {
		if got := viaJSON(t, DiffHashes(x.Prev, x.Next)); !reflect.DeepEqual(got, x.Diff) {
			f.add("case %d: want %v, got %v", i, x.Diff, got)
		}
	}
	f.done(len(v.Diffs))
}
