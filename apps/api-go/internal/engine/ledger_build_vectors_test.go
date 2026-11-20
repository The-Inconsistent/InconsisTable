package engine

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Packs with catalogue records (house decision #62). Inputs are read in the order TypeScript wrote them, and each
// record answered is compared as text, so the key order the ledger builder reads is held equal too.
func TestLedgerPacksMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		LedgerPacks struct {
			Rulesets []any `json:"rulesets"`
			Cases    []struct {
				Ruleset  int             `json:"ruleset"`
				Input    json.RawMessage `json:"input"`
				Ok       bool            `json:"ok"`
				Pack     any             `json:"pack"`
				Hashes   []string        `json:"hashes"`
				Records  []*string       `json:"records"`
				Problems []Problem       `json:"problems"`
			} `json:"cases"`
		} `json:"ledgerPacks"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.LedgerPacks.Cases) == 0 {
		t.Fatal("no ledger pack vectors, so this test would prove nothing")
	}
	rulesets := make([]*Ruleset, len(v.LedgerPacks.Rulesets))
	for i, m := range v.LedgerPacks.Rulesets {
		rulesets[i] = mustCompile(t, m).Ruleset
	}
	// The compiled form hands the builder its parsed params and kinds; a ruleset without build has none.
	if b := mustCompile(t, v.LedgerPacks.Rulesets[0]).Build; b == nil || b.Params.Schemas() == nil || b.Kinds["sub-factions"] == "" {
		t.Errorf("the ledger ruleset compiles without its build: %+v", b)
	}
	if b := mustCompile(t, v.LedgerPacks.Rulesets[1]).Build; b != nil {
		t.Errorf("a ruleset without build compiles with one: %+v", b)
	}
	accepted := 0
	for i, x := range v.LedgerPacks.Cases {
		input, err := schema.DecodeJSON(x.Input)
		if err != nil {
			t.Fatal(err)
		}
		pack, found, _ := ValidatePack(input, rulesets[x.Ruleset])
		if !x.Ok {
			if !slices.Equal(problemKeys(found), problemKeys(x.Problems)) {
				t.Errorf("case %d\n  want %v\n  got  %v", i, problemKeys(x.Problems), problemKeys(found))
			}
			continue
		}
		if len(found) > 0 {
			t.Errorf("case %d: want it accepted, got %v", i, problemKeys(found))
			continue
		}
		accepted++
		if got := viaJSON(t, pack.Normalized); !reflect.DeepEqual(got, x.Pack) {
			t.Errorf("case %d pack: %s", i, firstDifference("", x.Pack, got))
		}
		for j, e := range pack.Normalized["entries"].([]any) {
			if got := ContentHash(e.(map[string]any)); got != x.Hashes[j] {
				t.Errorf("case %d entry %d: want hash %s, got %s", i, j, x.Hashes[j], got)
			}
			var got *string
			if r := pack.Entries[j].Record; r != nil {
				text, err := schema.AppendJSON(nil, r)
				if err != nil {
					t.Fatal(err)
				}
				s := string(text)
				got = &s
			}
			if (got == nil) != (x.Records[j] == nil) || (got != nil && *got != *x.Records[j]) {
				t.Errorf("case %d entry %d record\n  want %v\n  got  %v", i, j, deref(x.Records[j]), deref(got))
			}
		}
	}
	if accepted < 2 {
		t.Errorf("%d ledger packs accepted, so this proves little", accepted)
	}

	// A pack decoded into Go maps still validates, its records in their keys' sorted order, to the same hashes.
	first := v.LedgerPacks.Cases[0]
	var plain any
	if err := json.Unmarshal(first.Input, &plain); err != nil {
		t.Fatal(err)
	}
	pack, found, _ := ValidatePack(plain, rulesets[first.Ruleset])
	if len(found) > 0 {
		t.Fatalf("a map-decoded pack is refused: %v", found)
	}
	for j, e := range pack.Normalized["entries"].([]any) {
		if got := ContentHash(e.(map[string]any)); got != first.Hashes[j] {
			t.Errorf("map-decoded entry %d: want hash %s, got %s", j, first.Hashes[j], got)
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<none>"
	}
	return *s
}
