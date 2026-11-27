package engine

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Words in more than one language against packages/rules-engine/src/words.ts (vectors/words.ts): the same rulesets
// refused with the same problems, stored with every language, and read in each language to the same document.
type wordsVectorFile struct {
	Words struct {
		Languages []string `json:"languages"`
		TermIDs   []string `json:"termIds"`
		MaxTerm   int      `json:"maxTerm"`
		Cases     []struct {
			Input    any            `json:"input"`
			Ok       bool           `json:"ok"`
			Problems []Problem      `json:"problems"`
			Document any            `json:"document"`
			Local    map[string]any `json:"local"`
		} `json:"cases"`
	} `json:"words"`
}

func loadWordsVectors(t *testing.T) wordsVectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v wordsVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Words.Cases) < 20 {
		t.Fatal("too few words vectors")
	}
	return v
}

func TestWordListsMatchTypeScript(t *testing.T) {
	w := loadWordsVectors(t).Words
	if !slices.Equal(w.Languages, Languages) {
		t.Errorf("languages: want %v, got %v", w.Languages, Languages)
	}
	if !slices.Equal(w.TermIDs, TermIDs) {
		t.Errorf("term ids: want %v, got %v", w.TermIDs, TermIDs)
	}
	if w.MaxTerm != MaxTerm {
		t.Errorf("max term: want %d, got %d", w.MaxTerm, MaxTerm)
	}
}

func TestWordsMatchTypeScript(t *testing.T) {
	cases := loadWordsVectors(t).Words.Cases
	f := &failures{t: t}
	accepted := 0
	for i, x := range cases {
		r, found := ValidateRuleset(x.Input)
		switch {
		case x.Ok && len(found) > 0:
			f.add("case %d: want it accepted, got %v", i, problemKeys(found))
		case !x.Ok && !slices.Equal(problemKeys(found), problemKeys(x.Problems)):
			f.add("case %d\n  want %v\n  got  %v", i, problemKeys(x.Problems), problemKeys(found))
		case x.Ok:
			accepted++
			if got := viaJSON(t, r.Normalized); !reflect.DeepEqual(got, viaJSON(t, x.Document)) {
				f.add("case %d document: %s", i, firstDifference("", viaJSON(t, x.Document), got))
			}
			own, _ := r.Normalized["language"].(string)
			if own == "" {
				own = Languages[0]
			}
			for _, lang := range Languages {
				local, issues := schema.ParseIn(rulesetSchema, r.Normalized, lang, own)
				if len(issues) > 0 {
					f.add("case %d read in %s: %v", i, lang, issues)
					continue
				}
				if got := viaJSON(t, local); !reflect.DeepEqual(got, viaJSON(t, x.Local[lang])) {
					f.add("case %d in %s: %s", i, lang, firstDifference("", viaJSON(t, x.Local[lang]), got))
				}
			}
		}
	}
	f.done(len(cases))
	if accepted < 8 {
		t.Errorf("only %d rulesets accepted, so this proves little", accepted)
	}
}
