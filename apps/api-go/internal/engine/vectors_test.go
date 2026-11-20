package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sync"
	"testing"
)

type vectorFile struct {
	Scope map[string]any `json:"scope"`
	Expr  []struct {
		Src      string  `json:"src"`
		Ast      any     `json:"ast"`
		Value    *any    `json:"value"`
		ParseErr *string `json:"parseErr"`
		EvalErr  *string `json:"evalErr"`
	} `json:"expr"`
	Canonical []struct {
		Input     string `json:"input"`
		Canonical string `json:"canonical"`
		Sha       string `json:"sha"`
	} `json:"canonical"`
	Sha []struct {
		Text string `json:"text"`
		Sha  string `json:"sha"`
	} `json:"sha"`
	Entries []struct {
		Entry map[string]any `json:"entry"`
		Hash  string         `json:"hash"`
	} `json:"entries"`
	Dice struct {
		Parse []struct {
			Notation string `json:"notation"`
			Result   struct {
				Ok    bool           `json:"ok"`
				Error string         `json:"error"`
				Dice  map[string]any `json:"dice"`
			} `json:"result"`
		} `json:"parse"`
		Plain []struct {
			Notation string `json:"notation"`
			Shape    *struct {
				Count int `json:"count"`
				Sides int `json:"sides"`
			} `json:"shape"`
		} `json:"plain"`
		Roll []struct {
			Notation string `json:"notation"`
			Seed     uint32 `json:"seed"`
			Roll     any    `json:"roll"`
		} `json:"roll"`
	} `json:"dice"`
	Ops struct {
		States []RuleState `json:"states"`
		Params []any       `json:"params"`
		Cases  []struct {
			Primitive string `json:"primitive"`
			Op        string `json:"op"`
			Params    int    `json:"params"`
			State     int    `json:"state"`
			Input     any    `json:"input"`
			Ok        bool   `json:"ok"`
			Deltas    any    `json:"deltas"`
			Touches   string `json:"touches"`
			Perm      string `json:"perm"`
			Code      string `json:"code"`
			Message   string `json:"message"`
			// Zod worded this refusal, or two unknown bands made the named one depend on key order. Clients get the code.
			CodeOnly bool `json:"codeOnly"`
		} `json:"cases"`
	} `json:"ops"`
	Charge []struct {
		State   int     `json:"state"`
		Pool    string  `json:"pool"`
		Amount  float64 `json:"amount"`
		Delta   any     `json:"delta"`
		Code    string  `json:"code"`
		Message string  `json:"message"`
	} `json:"charge"`
}

var readVectors = sync.OnceValues(func() ([]byte, error) { return os.ReadFile("testdata/vectors.json") })

func loadManifestVectors(t *testing.T) manifestVectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v manifestVectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Checks) == 0 || len(v.Cases) == 0 || len(v.Manifests) == 0 {
		t.Fatal("no manifest vectors, so this test would prove nothing")
	}
	return v
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v vectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for name, size := range map[string]int{
		"expr": len(v.Expr), "canonical": len(v.Canonical), "sha": len(v.Sha), "entries": len(v.Entries),
		"dice.parse": len(v.Dice.Parse), "dice.plain": len(v.Dice.Plain), "dice.roll": len(v.Dice.Roll),
		"charge": len(v.Charge), "ops.states": len(v.Ops.States), "ops.params": len(v.Ops.Params), "ops.cases": len(v.Ops.Cases),
	} {
		if size == 0 {
			t.Fatalf("no %s vectors, so this test would prove nothing", name)
		}
	}
	return v
}

// Through JSON, the way a value reaches a client or a cached manifest.
func viaJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func short(s string) string {
	if len(s) > 80 {
		return s[:80] + "..."
	}
	return s
}

// The AST's JSON shape is the TypeScript ExprNode.
func astJSON(n Node) any {
	switch x := n.(type) {
	case NumNode:
		return map[string]any{"k": "num", "v": x.V}
	case StrNode:
		return map[string]any{"k": "str", "v": x.V}
	case BoolNode:
		return map[string]any{"k": "bool", "v": x.V}
	case IdentNode:
		return map[string]any{"k": "id", "name": x.Name}
	case GetNode:
		return map[string]any{"k": "get", "obj": astJSON(x.Obj), "key": x.Key}
	case IndexNode:
		return map[string]any{"k": "index", "obj": astJSON(x.Obj), "key": astJSON(x.Key)}
	case UnaryNode:
		return map[string]any{"k": "unary", "op": x.Op, "arg": astJSON(x.Arg)}
	case BinaryNode:
		return map[string]any{"k": "binary", "op": x.Op, "left": astJSON(x.Left), "right": astJSON(x.Right)}
	case CondNode:
		return map[string]any{"k": "cond", "test": astJSON(x.Test), "then": astJSON(x.Then), "else": astJSON(x.Else)}
	case CallNode:
		args := make([]any, len(x.Args))
		for i, a := range x.Args {
			args[i] = astJSON(a)
		}
		return map[string]any{"k": "call", "fn": x.Fn, "args": args}
	}
	panic(fmt.Sprintf("unknown node %T", n))
}

func TestExprMatchesTypeScript(t *testing.T) {
	v := loadVectors(t)
	scope := ValueFromJSON(v.Scope).(*Record)
	for _, x := range v.Expr {
		node, err := ParseExpr(x.Src)
		if x.ParseErr != nil {
			if err == nil || err.Error() != *x.ParseErr {
				t.Errorf("parse %q: want error %q, got %v", short(x.Src), *x.ParseErr, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("parse %q: %v", short(x.Src), err)
			continue
		}
		if got := viaJSON(t, astJSON(node)); !reflect.DeepEqual(got, x.Ast) {
			t.Errorf("ast %q: want %v, got %v", short(x.Src), x.Ast, got)
			continue
		}
		value, err := Evaluate(node, scope)
		if x.EvalErr != nil {
			if err == nil || err.Error() != *x.EvalErr {
				t.Errorf("eval %q: want error %q, got %v, %v", short(x.Src), *x.EvalErr, value, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("eval %q: %v", short(x.Src), err)
			continue
		}
		if got := ValueToJSON(value); !reflect.DeepEqual(got, *x.Value) {
			t.Errorf("eval %q: want %v, got %v", short(x.Src), *x.Value, got)
		}
	}
}

func TestPackHashMatchesTypeScript(t *testing.T) {
	v := loadVectors(t)
	for _, x := range v.Canonical {
		var in any
		if err := json.Unmarshal([]byte(x.Input), &in); err != nil {
			t.Fatal(err)
		}
		got := CanonicalJSON(in)
		if got != x.Canonical {
			t.Errorf("canonical %s: want %s, got %s", x.Input, x.Canonical, got)
		}
		if Sha256Hex(got) != x.Sha {
			t.Errorf("sha of %s", x.Input)
		}
	}
	for _, x := range v.Sha {
		if got := Sha256Hex(x.Text); got != x.Sha {
			t.Errorf("sha %q: want %s, got %s", short(x.Text), x.Sha, got)
		}
	}
	for _, x := range v.Entries {
		if got := ContentHash(x.Entry); got != x.Hash {
			t.Errorf("content hash of %v: want %s, got %s", x.Entry["key"], x.Hash, got)
		}
	}
}

func TestContentHashRefusesAnUnparsedEntry(t *testing.T) {
	for name, tags := range map[string]any{
		"missing":    nil,
		"not a list": "xy",
		"not []any":  []string{"x"},
		"a number":   []any{1.0},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Error("hashed an entry that was never parsed, so a retag could keep its old hash")
				}
			}()
			ContentHash(map[string]any{"key": "a", "tags": tags})
		})
	}
}

func dieJSON(d Die) any {
	switch {
	case d.Fudge:
		return "F"
	case d.D66:
		return "d66"
	}
	return d.Sides
}

func diceJSON(e DiceExpr) any {
	terms := make([]any, len(e.Terms))
	for i, t := range e.Terms {
		if t.IsConst {
			terms[i] = map[string]any{"kind": "const", "sign": t.Sign, "value": t.Value}
			continue
		}
		var keep any
		if t.Keep != nil {
			which := "lowest"
			if t.Keep.Highest {
				which = "highest"
			}
			keep = map[string]any{"which": which, "n": t.Keep.N}
		}
		var successAt any
		if t.SuccessAt != nil {
			successAt = *t.SuccessAt
		}
		terms[i] = map[string]any{
			"kind": "dice", "sign": t.Sign, "count": t.Count, "die": dieJSON(t.Die),
			"keep": keep, "explode": t.Explode, "successAt": successAt,
		}
	}
	return map[string]any{"notation": e.Notation, "terms": terms}
}

// mulberry32, the TypeScript seededRng, so both engines roll the same faces.
func seededRng(seed uint32) Rng {
	s := seed
	return func(sides int) int {
		s += 0x6d2b79f5
		x := s
		x = (x ^ (x >> 15)) * (x | 1)
		x ^= x + (x^(x>>7))*(x|61)
		unit := float64(x^(x>>14)) / 0x1_0000_0000
		return 1 + int(unit*float64(sides))
	}
}

func TestDiceMatchesTypeScript(t *testing.T) {
	v := loadVectors(t)
	for _, x := range v.Dice.Parse {
		got, err := ParseDice(x.Notation)
		if !x.Result.Ok {
			if err == nil || err.Error() != x.Result.Error {
				t.Errorf("dice %q: want error %q, got %v", short(x.Notation), x.Result.Error, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("dice %q: %v", short(x.Notation), err)
			continue
		}
		if j := viaJSON(t, diceJSON(got)); !reflect.DeepEqual(j, any(x.Result.Dice)) {
			t.Errorf("dice %q: want %v, got %v", short(x.Notation), x.Result.Dice, j)
		}
	}
	for _, x := range v.Dice.Plain {
		count, sides, ok := PlainDice(x.Notation)
		same := ok == (x.Shape != nil) && (!ok || (count == x.Shape.Count && sides == x.Shape.Sides))
		if !same {
			t.Errorf("plain %q: want %+v, got %d %d %v", short(x.Notation), x.Shape, count, sides, ok)
		}
	}
	for _, x := range v.Dice.Roll {
		got, err := RollDice(x.Notation, seededRng(x.Seed))
		if err != nil {
			t.Errorf("roll %q: %v", short(x.Notation), err)
			continue
		}
		if j := viaJSON(t, got); !reflect.DeepEqual(j, x.Roll) {
			t.Errorf("roll %q seed %d: want %v, got %v", short(x.Notation), x.Seed, x.Roll, j)
		}
	}
}

func TestCryptoRngStaysInRange(t *testing.T) {
	seen := map[int]bool{}
	for range 2000 {
		f := CryptoRng(6)
		if f < 1 || f > 6 {
			t.Fatalf("d6 rolled %d", f)
		}
		seen[f] = true
	}
	if len(seen) != 6 {
		t.Errorf("2000 rolls of a d6 showed only %v", seen)
	}
}

func TestOpsMatchTypeScript(t *testing.T) {
	v := loadVectors(t)
	failed := 0
	for _, x := range v.Ops.Cases {
		var params any
		if x.Params >= 0 {
			params = v.Ops.Params[x.Params]
		}
		got, refusal := RunOp(x.Primitive, x.Op, params, x.Input, &v.Ops.States[x.State])
		problem := ""
		switch {
		case x.Ok && refusal != nil:
			problem = fmt.Sprintf("want deltas %v, got refusal %+v", x.Deltas, *refusal)
		case !x.Ok && refusal == nil:
			problem = fmt.Sprintf("want refusal %s %q, got %+v", x.Code, x.Message, got)
		case !x.Ok && refusal.Code != x.Code:
			problem = fmt.Sprintf("want code %s %q, got %+v", x.Code, x.Message, *refusal)
		case !x.Ok && !x.CodeOnly && refusal.Message != x.Message:
			problem = fmt.Sprintf("want message %q, got %q", x.Message, refusal.Message)
		case x.Ok && (got.Touches != x.Touches || got.Perm != x.Perm):
			problem = fmt.Sprintf("want %s %s, got %s %s", x.Touches, x.Perm, got.Touches, got.Perm)
		case x.Ok && !reflect.DeepEqual(viaJSON(t, got.Deltas), x.Deltas):
			problem = fmt.Sprintf("want deltas %v, got %v", x.Deltas, viaJSON(t, got.Deltas))
		}
		if problem != "" {
			failed++
			if failed <= 25 {
				t.Errorf("%s.%s params %d state %d input %v: %s", x.Primitive, x.Op, x.Params, x.State, x.Input, problem)
			}
		}
	}
	if failed > 0 {
		t.Errorf("%d of %d op cases differ", failed, len(v.Ops.Cases))
	}
}

func TestChargeMatchesTypeScript(t *testing.T) {
	v := loadVectors(t)
	failed := 0
	for _, x := range v.Charge {
		delta, refusal := Charge(&v.Ops.States[x.State], x.Pool, x.Amount)
		problem := ""
		switch {
		case x.Delta != nil && refusal != nil:
			problem = fmt.Sprintf("want delta %v, got refusal %+v", x.Delta, *refusal)
		case x.Delta == nil && refusal == nil:
			problem = fmt.Sprintf("want refusal %s %q, got %+v", x.Code, x.Message, delta)
		case x.Delta == nil && (refusal.Code != x.Code || refusal.Message != x.Message):
			problem = fmt.Sprintf("want %s %q, got %+v", x.Code, x.Message, *refusal)
		case x.Delta != nil && !reflect.DeepEqual(viaJSON(t, delta), x.Delta):
			problem = fmt.Sprintf("want delta %v, got %v", x.Delta, viaJSON(t, delta))
		}
		if problem != "" {
			failed++
			if failed <= 25 {
				t.Errorf("state %d pool %s amount %v: %s", x.State, x.Pool, x.Amount, problem)
			}
		}
	}
	if failed > 0 {
		t.Errorf("%d of %d charge cases differ", failed, len(v.Charge))
	}
}

func TestDeltaChecksMatchTypeScript(t *testing.T) {
	raw, err := readVectors()
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		DeltaChecks []struct {
			Deltas  []Delta             `json:"deltas"`
			Targets []map[string]string `json:"targets"`
			Refusal *Refusal            `json:"refusal"`
		} `json:"deltaChecks"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.DeltaChecks) == 0 {
		t.Fatal("no delta check vectors, so this test would prove nothing")
	}
	for _, x := range v.DeltaChecks {
		var targets []TargetPattern
		for _, p := range x.Targets {
			for kind, name := range p {
				targets = append(targets, TargetPattern{kind, name})
			}
		}
		if got := checkDeltas(x.Deltas, targets); !reflect.DeepEqual(got, x.Refusal) {
			t.Errorf("%+v against %v: want %+v, got %+v", x.Deltas, x.Targets, x.Refusal, got)
		}
	}
}

func TestDeltasOutsideTheTargetsAreRefused(t *testing.T) {
	refusal := checkDeltas(
		[]Delta{addResource("a", "hp", 1)},
		[]TargetPattern{{"resource", "mana"}, {"field", "*"}},
	)
	want := `delta writes {"actorId":"a","resource":"hp"}, outside the op's targets`
	if refusal == nil || refusal.Code != "outOfTargets" || refusal.Message != want {
		t.Errorf("got %+v", refusal)
	}
	if refusal := checkDeltas([]Delta{addResource("a", "hp", 1)}, []TargetPattern{{"resource", "*"}}); refusal != nil {
		t.Errorf("a wildcard target refused: %+v", refusal)
	}
}

func TestRunOpRefusesAnOpThatWritesOutsideItsTargets(t *testing.T) {
	primitives["test.rogue"] = definePrimitive(parseEmpty("badParams"), map[string]primitiveOp{
		"write": defineOp("test:call", parseEmpty("badInput"),
			func(struct{}) []TargetPattern { return []TargetPattern{{"resource", "mana"}} },
			nil,
			func(struct{}, *RuleState, struct{}) []Delta { return []Delta{addResource("a", "hp", 1)} }),
	})
	defer delete(primitives, "test.rogue")
	_, refusal := RunOp("test.rogue", "write", map[string]any{}, map[string]any{}, &RuleState{})
	if refusal == nil || refusal.Code != "outOfTargets" {
		t.Errorf("got %+v", refusal)
	}
}
