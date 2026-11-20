package engine

import (
	"fmt"
	"math"
	"slices"
)

const maxSafeInteger = 9007199254740991

// Runtime values are nil, bool, float64, string, *List and *Record. Numbers stay float64 so arithmetic overflows
// where JavaScript's does, and containers are pointers so == is identity, as === is on arrays and objects.
type (
	List   struct{ Items []any }
	Record struct{ Fields map[string]any }
)

// absent is JavaScript's undefined: a read that found nothing, which only has() tolerates.
type absentValue struct{}

var absent = absentValue{}

// ValueFromJSON converts decoded JSON (map[string]any, []any) to runtime values.
func ValueFromJSON(v any) any {
	switch x := v.(type) {
	case []any:
		items := make([]any, len(x))
		for i, e := range x {
			items[i] = ValueFromJSON(e)
		}
		return &List{items}
	case map[string]any:
		fields := make(map[string]any, len(x))
		for k, e := range x {
			fields[k] = ValueFromJSON(e)
		}
		return &Record{fields}
	}
	return v
}

// ValueToJSON is the inverse of ValueFromJSON.
func ValueToJSON(v any) any {
	switch x := v.(type) {
	case *List:
		items := make([]any, len(x.Items))
		for i, e := range x.Items {
			items[i] = ValueToJSON(e)
		}
		return items
	case *Record:
		fields := make(map[string]any, len(x.Fields))
		for k, e := range x.Fields {
			fields[k] = ValueToJSON(e)
		}
		return fields
	}
	return v
}

func isSafeInteger(f float64) bool { return f == math.Trunc(f) && math.Abs(f) <= maxSafeInteger }

func toInt(v any, what string) float64 {
	f, ok := v.(float64)
	if !ok || !isSafeInteger(f) {
		exprFail("%s is not an integer", what)
	}
	return f
}

func toBool(v any, what string) bool {
	b, ok := v.(bool)
	if !ok {
		exprFail("%s is not a boolean", what)
	}
	return b
}

func safe(f float64) float64 {
	if !isSafeInteger(f) {
		exprFail("integer overflow")
	}
	return f
}

// math.Mod is exact, and so is every step below on safe integers: a - r never grows past a, and r + b shrinks toward
// zero. Adding b first rounds once the sum passes 2^53.
func crosses(r, b float64) bool { return r != 0 && (r < 0) != (b < 0) }

// Floored modulo, the partner of floor division: a = b * floorDiv(a, b) + floorMod(a, b).
func floorMod(a, b float64) float64 {
	if b == 0 {
		exprFail("modulo by zero")
	}
	r := math.Mod(a, b)
	if r == 0 {
		return 0
	}
	if crosses(r, b) {
		return r + b
	}
	return r
}

// Exact floor division on integers, without a float detour that rounds wrong near 2^53.
func floorDiv(a, b float64) float64 {
	if b == 0 {
		exprFail("division by zero")
	}
	r := math.Mod(a, b)
	truncated := (a - r) / b
	if crosses(r, b) {
		truncated--
	}
	return safe(truncated)
}

func ceilDiv(a, b float64) float64 { return -floorDiv(-a, b) }

func pathOf(n Node) (string, bool) {
	switch x := n.(type) {
	case IdentNode:
		return x.Name, true
	case GetNode:
		base, ok := pathOf(x.Obj)
		if !ok {
			return "", false
		}
		return base + "." + x.Key, true
	case IndexNode:
		base, ok := pathOf(x.Obj)
		if !ok {
			return "", false
		}
		if key, isStr := x.Key.(StrNode); isStr {
			return base + "." + key.V, true
		}
		return base + ".*", true
	}
	return "", false
}

func field(r *Record, key string) any {
	if v, ok := r.Fields[key]; ok {
		return v
	}
	return absent
}

type evaluator struct{ scope *Record }

// Reads a value that may be absent.
func (e *evaluator) lookup(n Node) any {
	switch x := n.(type) {
	case IdentNode:
		return field(e.scope, x.Name)
	case GetNode:
		if r, ok := e.lookup(x.Obj).(*Record); ok {
			return field(r, x.Key)
		}
		return absent
	case IndexNode:
		obj := e.lookup(x.Obj)
		key := e.eval(x.Key)
		if l, ok := obj.(*List); ok {
			if i, ok := key.(float64); ok {
				if i == math.Trunc(i) && i >= 0 && i < float64(len(l.Items)) {
					return l.Items[int(i)]
				}
				return absent
			}
		}
		if r, ok := obj.(*Record); ok {
			if k, ok := key.(string); ok {
				return field(r, k)
			}
		}
		return absent
	}
	return e.eval(n)
}

func (e *evaluator) eval(n Node) any {
	switch x := n.(type) {
	case NumNode:
		return x.V
	case StrNode:
		return x.V
	case BoolNode:
		return x.V
	case IdentNode, GetNode, IndexNode:
		v := e.lookup(n)
		if v == absent || v == nil {
			path, ok := pathOf(n)
			if !ok {
				path = "?"
			}
			panic(ExprError{Message: fmt.Sprintf(`missing value "%s"`, path), Missing: path})
		}
		return v
	case UnaryNode:
		if x.Op == "-" {
			return safe(-toInt(e.eval(x.Arg), "operand"))
		}
		return !toBool(e.eval(x.Arg), "operand")
	case BinaryNode:
		return e.binary(x)
	case CondNode:
		if toBool(e.eval(x.Test), "condition") {
			return e.eval(x.Then)
		}
		return e.eval(x.Else)
	case CallNode:
		return e.call(x)
	}
	panic(fmt.Sprintf("engine: unknown node %T", n))
}

func (e *evaluator) binary(n BinaryNode) any {
	// Short-circuit first, so `has(x) && x > 0` never reads a missing x.
	if n.Op == "&&" {
		return toBool(e.eval(n.Left), "left") && toBool(e.eval(n.Right), "right")
	}
	if n.Op == "||" {
		return toBool(e.eval(n.Left), "left") || toBool(e.eval(n.Right), "right")
	}
	l := e.eval(n.Left)
	r := e.eval(n.Right)
	if n.Op == "==" {
		return l == r
	}
	if n.Op == "!=" {
		return l != r
	}
	a := toInt(l, fmt.Sprintf(`left of "%s"`, n.Op))
	b := toInt(r, fmt.Sprintf(`right of "%s"`, n.Op))
	switch n.Op {
	case "+":
		return safe(a + b)
	case "-":
		return safe(a - b)
	case "*":
		return safe(a * b)
	case "/":
		return floorDiv(a, b)
	case "%":
		return floorMod(a, b)
	case "<":
		return a < b
	case "<=":
		return a <= b
	case ">":
		return a > b
	}
	return a >= b
}

func (e *evaluator) ints(nodes []Node, fn string) []float64 {
	out := make([]float64, len(nodes))
	for i, n := range nodes {
		out[i] = toInt(e.eval(n), fmt.Sprintf("%s() argument %d", fn, i+1))
	}
	return out
}

func listInts(v any, what string) []float64 {
	l, ok := v.(*List)
	if !ok {
		exprFail("%s needs a list", what)
	}
	out := make([]float64, len(l.Items))
	for i, x := range l.Items {
		out[i] = toInt(x, fmt.Sprintf("%s item %d", what, i+1))
	}
	return out
}

func argOr(args []float64, i int, fallback float64) float64 {
	if i < len(args) {
		return args[i]
	}
	return fallback
}

func (e *evaluator) firstArg(n CallNode) any {
	if len(n.Args) == 0 {
		return absent
	}
	return e.eval(n.Args[0])
}

func (e *evaluator) call(n CallNode) any {
	switch n.Fn {
	case "min", "max":
		var list []float64
		if len(n.Args) == 1 {
			list = listInts(e.eval(n.Args[0]), n.Fn+"()")
		} else {
			list = e.ints(n.Args, n.Fn)
		}
		if len(list) == 0 {
			exprFail("%s() of an empty list", n.Fn)
		}
		if n.Fn == "min" {
			return slices.Min(list)
		}
		return slices.Max(list)
	case "floor", "ceil":
		args := e.ints(n.Args, n.Fn)
		a, b := argOr(args, 0, 0), argOr(args, 1, 1)
		if n.Fn == "floor" {
			return floorDiv(a, b)
		}
		return ceilDiv(a, b)
	case "clamp":
		args := e.ints(n.Args, n.Fn)
		x, lo, hi := argOr(args, 0, 0), argOr(args, 1, 0), argOr(args, 2, 0)
		// A max below the min collapses to the min, the same rule resource.capped applies.
		return math.Max(lo, math.Min(math.Max(lo, hi), x))
	case "abs":
		return safe(math.Abs(argOr(e.ints(n.Args, n.Fn), 0, 0)))
	case "mod":
		return floorDiv(argOr(e.ints(n.Args, n.Fn), 0, 0)-10, 2)
	case "count":
		l, ok := e.firstArg(n).(*List)
		if !ok {
			exprFail("count() of a non-list")
		}
		return float64(len(l.Items))
	case "sum":
		total := 0.0
		for _, x := range listInts(e.firstArg(n), "sum()") {
			total += x
		}
		return safe(total)
	case "at":
		// The checker holds two arguments; the evaluator reads what it is given, as the TypeScript one does.
		name, group := "?", (*Record)(nil)
		if len(n.Args) > 0 {
			if p, ok := pathOf(n.Args[0]); ok {
				name = p
			}
			group, _ = e.lookup(n.Args[0]).(*Record)
		}
		var second any = absent
		if len(n.Args) > 1 {
			second = e.eval(n.Args[1])
		}
		want := toInt(second, "at() argument 2")
		var found any = absent
		if group != nil {
			for key, v := range group.Fields {
				if num, ok := trailingNumber(key); ok && float64(num) == want {
					found = v
				}
			}
		}
		if found == absent || found == nil {
			exprFail(`missing value "%s[%s]"`, name, esNumber(want))
		}
		return found
	case "has":
		if len(n.Args) == 0 {
			return false
		}
		v := e.lookup(n.Args[0])
		return v != absent && v != nil
	}
	panic("engine: unknown function " + n.Fn)
}

// Evaluate runs an AST against runtime values. It is pure, and returns an ExprError on a missing value, an overflow or
// a division by zero.
func Evaluate(node Node, scope *Record) (value any, err error) {
	defer recoverExprError(&err)
	value = (&evaluator{scope}).eval(node)
	// JSON.stringify prints negative zero as 0, and Go's encoder prints -0.
	if value == 0.0 {
		value = 0.0
	}
	return value, nil
}
