package schema

import (
	"math"
	"testing"
)

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	out, err := AppendJSON(nil, v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func decode(t *testing.T, text string) any {
	t.Helper()
	v, err := DecodeJSON([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// JSON.parse's order: array indexes first and ascending, then the rest as written; a repeated key keeps its first place
// and takes its last value.
func TestDecodeJSONKeepsJavaScriptOrder(t *testing.T) {
	got := jsonOf(t, decode(t, `{"z":1,"2":2,"a":{"y":1,"x":2},"1":4,"01":5,"z":6,"4294967295":7,"b":1e400}`))
	want := `{"1":4,"2":2,"z":6,"a":{"y":1,"x":2},"01":5,"4294967295":7,"b":null}`
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	if v, _ := decode(t, `{"b":1e400}`).(*Obj).Get("b"); !math.IsInf(v.(float64), 1) {
		t.Fatalf("1e400 is %v, want +Inf", v)
	}
	for _, bad := range []string{`{"a":1} 2`, `{"a":}`, `[1,`} {
		if _, err := DecodeJSON([]byte(bad)); err == nil {
			t.Fatalf("%s decoded", bad)
		}
	}
}

// An Obj in gives an Obj out: z.object in the shape's order (prefaults parsed, defaults as given), records in the
// input's order, extend replacing in place and appending.
func TestOrderedParse(t *testing.T) {
	inner := Object(Def("d", Int(), 7.0), Opt("o", Int()))
	shape := Object(
		Req("b", Int()),
		Opt("a", Int()),
		Pre("p", inner, NewObj()),
		Req("r", Record(String(), Int())),
		Req("pr", PartialRecord(Int(), "A", "B", "C")),
		Opt("t", Literal(true)),
		Opt("f", Float().Positive().Max(1)),
	).Extend(Req("a", String()), Opt("z", Int())).Omit("t")
	out, issues := Parse(shape, decode(t, `{"z":1,"pr":{"C":1,"A":2},"r":{"y":1,"x":2},"a":"s","b":3,"junk":0,"f":0.5}`))
	if len(issues) > 0 {
		t.Fatal(issues)
	}
	want := `{"b":3,"a":"s","p":{"d":7},"r":{"y":1,"x":2},"pr":{"C":1,"A":2},"f":0.5,"z":1}`
	if got := jsonOf(t, out); got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	// a plain map in still gives a map out
	if _, isMap := mustParse(t, inner, map[string]any{}).(map[string]any); !isMap {
		t.Fatal("a map input answered with something else")
	}
	for _, refused := range []struct {
		s Schema
		v any
	}{
		{Literal(true), false},
		{Float().Positive(), 0.0},
		{Float().Max(1), 1.5},
		{Float(), math.Inf(1)},
		{PartialRecord(Int(), "A"), decode(t, `{"B":1}`)},
	} {
		if _, issues := Parse(refused.s, refused.v); len(issues) == 0 {
			t.Fatalf("%v accepted", refused.v)
		}
	}
}

func mustParse(t *testing.T, s Schema, v any) any {
	t.Helper()
	out, issues := Parse(s, v)
	if len(issues) > 0 {
		t.Fatal(issues)
	}
	return out
}
