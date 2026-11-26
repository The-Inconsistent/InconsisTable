package engine

import (
	"fmt"
	"slices"
	"strconv"
)

// ExprType is a static type the checker assigns: a scalar, a list, a record or a dict.
type ExprType interface{ exprType() }

type (
	// Scalar is int, bool or text.
	Scalar string
	// ListType is a list of one element type.
	ListType struct{ Elem ExprType }
	// RecordType has named fields.
	RecordType struct{ Fields map[string]ExprType }
	// DictType maps any key to one value type.
	DictType struct{ Value ExprType }
)

func (Scalar) exprType()     {}
func (ListType) exprType()   {}
func (RecordType) exprType() {}
func (DictType) exprType()   {}

const (
	intType  = Scalar("int")
	boolType = Scalar("bool")
	textType = Scalar("text")
)

func typeName(t ExprType) string {
	switch x := t.(type) {
	case Scalar:
		return string(x)
	case ListType:
		return "list<" + typeName(x.Elem) + ">"
	case DictType:
		return "dict<" + typeName(x.Value) + ">"
	}
	return "record"
}

func sameType(a, b ExprType) bool {
	switch x := a.(type) {
	case Scalar:
		return a == b
	case ListType:
		y, ok := b.(ListType)
		return ok && sameType(x.Elem, y.Elem)
	case DictType:
		y, ok := b.(DictType)
		return ok && sameType(x.Value, y.Value)
	}
	return false
}

// The single type of a record's values, so a computed index has one type to check against.
func recordValueType(fields map[string]ExprType) ExprType {
	var out ExprType
	for _, t := range fields {
		if out == nil {
			out = t
		} else if !sameType(out, t) {
			return nil
		}
	}
	return out
}

// The number an id ends in (f12 is 12), and whether it ends in one: at most 9 digits, so the number is exact in both
// engines.
func trailingNumber(id string) (int, bool) {
	end := len(id)
	start := end
	for start > 0 && id[start-1] >= '0' && id[start-1] <= '9' {
		start--
	}
	if start == end || end-start > 9 {
		return 0, false
	}
	n, _ := strconv.Atoi(id[start:])
	return n, true
}

type checker struct {
	scope map[string]ExprType
	refs  map[string]bool
}

func (c *checker) path(n Node) string {
	p, _ := pathOf(n)
	return p
}

// inPath: this node is the object of an outer . or [], so only the outermost path is recorded as a ref.
func (c *checker) check(n Node, inPath bool) ExprType {
	t := c.typeOf(n)
	if !inPath {
		if p, ok := pathOf(n); ok {
			c.refs[p] = true
		}
	}
	return t
}

func (c *checker) expect(n Node, want ExprType, what string) {
	got := c.check(n, false)
	if !sameType(got, want) {
		exprFail("%s must be %s, got %s", what, typeName(want), typeName(got))
	}
}

func (c *checker) typeOf(n Node) ExprType {
	switch x := n.(type) {
	case NumNode:
		return intType
	case StrNode:
		return textType
	case BoolNode:
		return boolType
	case IdentNode:
		t, ok := c.scope[x.Name]
		if !ok {
			exprFail(`unknown identifier "%s"`, x.Name)
		}
		return t
	case GetNode:
		switch obj := c.check(x.Obj, true).(type) {
		case RecordType:
			t, ok := obj.Fields[x.Key]
			if !ok {
				name := x.Key
				if p, isPath := pathOf(n); isPath {
					name = p
				}
				exprFail(`unknown identifier "%s"`, name)
			}
			return t
		case DictType:
			return obj.Value
		default:
			exprFail(`cannot read ".%s" of %s`, x.Key, typeName(obj))
		}
	case IndexNode:
		return c.index(x)
	case UnaryNode:
		want := boolType
		if x.Op == "-" {
			want = intType
		}
		c.expect(x.Arg, want, fmt.Sprintf(`the operand of "%s"`, x.Op))
		return want
	case BinaryNode:
		return c.binary(x)
	case CondNode:
		c.expect(x.Test, boolType, "a condition")
		then := c.check(x.Then, false)
		c.expect(x.Else, then, "the else branch")
		return then
	case CallNode:
		return c.call(x)
	}
	panic(fmt.Sprintf("engine: unknown node %T", n))
}

func (c *checker) index(x IndexNode) ExprType {
	obj := c.check(x.Obj, true)
	switch o := obj.(type) {
	case Scalar:
		exprFail("cannot index %s", string(o))
	case ListType:
		c.expect(x.Key, intType, "a list index")
		return o.Elem
	}
	if key, isStr := x.Key.(StrNode); isStr {
		if d, isDict := obj.(DictType); isDict {
			return d.Value
		}
		t, ok := obj.(RecordType).Fields[key.V]
		if !ok {
			name := key.V
			if p, isPath := pathOf(x); isPath {
				name = p
			}
			exprFail(`unknown identifier "%s"`, name)
		}
		return t
	}
	c.expect(x.Key, textType, "a record key")
	if d, isDict := obj.(DictType); isDict {
		return d.Value
	}
	t := recordValueType(obj.(RecordType).Fields)
	if t == nil {
		name, isPath := pathOf(x.Obj)
		if !isPath {
			name = "record"
		}
		exprFail(`"%s" mixes value types, so it cannot be indexed`, name)
	}
	return t
}

func (c *checker) binary(x BinaryNode) ExprType {
	left, right := fmt.Sprintf(`the left of "%s"`, x.Op), fmt.Sprintf(`the right of "%s"`, x.Op)
	switch x.Op {
	case "+", "-", "*", "/", "%":
		c.expect(x.Left, intType, left)
		c.expect(x.Right, intType, right)
		return intType
	case "<", "<=", ">", ">=":
		c.expect(x.Left, intType, left)
		c.expect(x.Right, intType, right)
		return boolType
	case "&&", "||":
		c.expect(x.Left, boolType, left)
		c.expect(x.Right, boolType, right)
		return boolType
	}
	l := c.check(x.Left, false)
	if _, isScalar := l.(Scalar); !isScalar {
		exprFail(`"%s" compares values, not %s`, x.Op, typeName(l))
	}
	c.expect(x.Right, l, right)
	return boolType
}

func (c *checker) call(x CallNode) ExprType {
	arity := func(lo, hi int) {
		n := len(x.Args)
		if n >= lo && (hi < 0 || n <= hi) {
			return
		}
		want := fmt.Sprintf("%d or %d", lo, hi)
		if lo == hi {
			want = fmt.Sprintf("%d", lo)
		} else if hi < 0 {
			want = fmt.Sprintf("at least %d", lo)
		}
		exprFail("%s() takes %s argument(s), got %d", x.Fn, want, n)
	}
	ints := func(what func(int) string) {
		for i, a := range x.Args {
			c.expect(a, intType, what(i))
		}
	}
	numbered := func(i int) string { return fmt.Sprintf("%s() argument %d", x.Fn, i+1) }
	switch x.Fn {
	case "min", "max":
		arity(1, -1)
		if len(x.Args) == 1 {
			c.expect(x.Args[0], ListType{intType}, x.Fn+"() of one argument")
			return intType
		}
		ints(numbered)
	case "floor", "ceil":
		arity(1, 2)
		ints(numbered)
	case "clamp":
		arity(3, 3)
		ints(numbered)
	case "abs", "mod":
		arity(1, 1)
		ints(func(int) string { return x.Fn + "() argument" })
	case "count":
		arity(1, 1)
		t := c.check(x.Args[0], false)
		if _, isList := t.(ListType); !isList {
			exprFail("count() takes a list, got %s", typeName(t))
		}
	case "sum":
		arity(1, 1)
		c.expect(x.Args[0], ListType{intType}, "sum() argument")
	case "at":
		arity(2, 2)
		return c.at(x)
	case "contains":
		arity(2, 2)
		t := c.check(x.Args[0], false)
		list, isList := t.(ListType)
		if !isList {
			exprFail("contains() takes a list, got %s", typeName(t))
		}
		c.expect(x.Args[1], list.Elem, "contains() argument 2")
		return boolType
	case "overlap":
		arity(2, 2)
		t := c.check(x.Args[0], false)
		if _, isList := t.(ListType); !isList {
			exprFail("overlap() takes a list, got %s", typeName(t))
		}
		c.expect(x.Args[1], t, "overlap() argument 2")
		return intType
	case "has":
		arity(1, 1)
		if _, isPath := pathOf(x.Args[0]); !isPath {
			exprFail("has() takes a path such as res.tempHp")
		}
		// A resource its type does not have is a value that is not there (house decision #166), only under `res`, as
		// expr.check.ts.
		if get, isGet := x.Args[0].(GetNode); isGet && get.Obj == Node(IdentNode{"res"}) {
			if obj, isRecord := c.check(get.Obj, true).(RecordType); isRecord {
				if _, known := obj.Fields[get.Key]; !known {
					return boolType
				}
			}
		}
		c.check(x.Args[0], false)
		return boolType
	}
	return intType
}

// at(group, n): the member of a field group whose id ends in n. The call may read any member, so each is a reference.
func (c *checker) at(x CallNode) ExprType {
	path, isPath := pathOf(x.Args[0])
	t := c.check(x.Args[0], true)
	group, isRecord := t.(RecordType)
	if !isPath || !isRecord {
		exprFail("at() takes a group of fields, got %s", typeName(t))
	}
	c.refs[path+".*"] = true
	member := recordValueType(group.Fields)
	if member == nil {
		exprFail(`"%s" mixes value types, so at() cannot pick from it`, path)
	}
	seen := map[int]bool{}
	for _, key := range sortedKeys(group.Fields) {
		num, ok := trailingNumber(key)
		if !ok {
			exprFail(`"%s.%s" does not end in a number, so at() cannot pick it`, path, key)
		}
		if seen[num] {
			exprFail(`two members of "%s" end in %d, so at() cannot pick one`, path, num)
		}
		seen[num] = true
	}
	c.expect(x.Args[1], intType, "at() argument 2")
	return member
}

// CompiledExpr is an expression compiled at manifest load: its AST, static type and the scope paths it reads.
type CompiledExpr struct {
	Source string
	AST    Node
	Type   ExprType
	Refs   []string
}

// CompileExpr parses and type-checks. A nil expect takes any type; otherwise the wrong result type is refused.
func CompileExpr(source string, scope map[string]ExprType, expect ExprType) (expr *CompiledExpr, err error) {
	defer recoverExprError(&err)
	node, err := ParseExpr(source)
	if err != nil {
		return nil, err
	}
	c := &checker{scope, map[string]bool{}}
	t := c.check(node, false)
	if expect != nil && typeName(expect) != typeName(t) {
		exprFail("must be %s, got %s", typeName(expect), typeName(t))
	}
	refs := make([]string, 0, len(c.refs))
	for ref := range c.refs {
		refs = append(refs, ref)
	}
	slices.SortFunc(refs, compareUnits)
	return &CompiledExpr{source, node, t, refs}, nil
}
