package engine

import (
	"encoding/json"
	"reflect"
	"testing"
)

// The helpers the api's turn plan reads, against what TypeScript answers (vectors/generate.ts seatVectors and
// poolSizeVectors).
func TestSeatHelpersAndPoolSizeMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		Seats []struct {
			Order       []string `json:"order"`
			FirstID     *string  `json:"firstId"`
			FirstPlayer string   `json:"firstPlayer"`
			Sequence    []string `json:"sequence"`
			FirstOf     *string  `json:"firstOf"`
			NextFirst   *string  `json:"nextFirst"`
		} `json:"seats"`
		PoolSizes []struct {
			Pool, Modifier, Size float64
		} `json:"poolSizes"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Seats) == 0 || len(v.PoolSizes) == 0 {
		t.Fatal("no seat or pool size vectors")
	}
	f := &failures{t: t}
	for i, x := range v.Seats {
		first := FirstOf(x.Order, x.FirstID)
		got := []any{viaJSON(t, Sequence(x.Order, x.FirstID)), viaJSON(t, first),
			viaJSON(t, NextFirst(x.FirstPlayer, x.Order, first))}
		want := []any{viaJSON(t, x.Sequence), viaJSON(t, x.FirstOf), viaJSON(t, x.NextFirst)}
		if !reflect.DeepEqual(got, want) {
			f.add("seat case %d: want %v, got %v", i, want, got)
		}
	}
	for i, x := range v.PoolSizes {
		if got := PoolSize(x.Pool, x.Modifier); got != x.Size {
			f.add("pool case %d: want %v, got %v", i, x.Size, got)
		}
	}
	f.done(len(v.Seats) + len(v.PoolSizes))
}
