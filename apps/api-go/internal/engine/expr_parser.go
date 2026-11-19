// Package engine is the Go twin of packages/rules-engine. The web keeps the TypeScript one, and the two must answer
// alike, down to the error text: vectors/generate.ts writes what TypeScript answers and the tests here compare
// (docs/adr/0008-go-api.md).
package engine

import (
	"fmt"
	"slices"
	"strconv"
	"unicode/utf16"
)

const (
	maxExprNodes  = 500
	maxExprLength = 2000
)

// ExprError is a refused expression: bad syntax, a breached cap, or a value that cannot be evaluated.
type ExprError struct{ Message string }

func (e ExprError) Error() string { return e.Message }

// Parsing and evaluating unwind with this panic, and the exported functions turn it back into an error.
func exprFail(format string, args ...any) {
	panic(ExprError{fmt.Sprintf(format, args...)})
}

func recoverExprError(err *error) {
	if r := recover(); r != nil {
		e, ok := r.(ExprError)
		if !ok {
			panic(r)
		}
		*err = e
	}
}

// Node is a parsed expression. The set of node types below is closed.
type Node interface{ exprNode() }

type (
	NumNode   struct{ V float64 }
	StrNode   struct{ V string }
	BoolNode  struct{ V bool }
	IdentNode struct{ Name string }
	GetNode   struct {
		Obj Node
		Key string
	}
	IndexNode struct{ Obj, Key Node }
	UnaryNode struct {
		Op  string
		Arg Node
	}
	BinaryNode struct {
		Op          string
		Left, Right Node
	}
	CondNode struct{ Test, Then, Else Node }
	CallNode struct {
		Fn   string
		Args []Node
	}
)

func (NumNode) exprNode()    {}
func (StrNode) exprNode()    {}
func (BoolNode) exprNode()   {}
func (IdentNode) exprNode()  {}
func (GetNode) exprNode()    {}
func (IndexNode) exprNode()  {}
func (UnaryNode) exprNode()  {}
func (BinaryNode) exprNode() {}
func (CondNode) exprNode()   {}
func (CallNode) exprNode()   {}

type tokenKind int

const (
	tokNum tokenKind = iota
	tokStr
	tokID
	tokOp
	tokEOF
)

type token struct {
	kind tokenKind
	num  float64
	text string
	at   int
}

// Longest first, so `<=` is not read as `<` then `=`.
var exprOperators = []string{
	"&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", ".", ",", "(", ")", "[", "]",
}

// JavaScript's \s.
func isSpace(c uint16) bool {
	switch c {
	case 9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return c >= 0x2000 && c <= 0x200a
}

func isDigit(c uint16) bool { return c >= '0' && c <= '9' }

func isIDStart(c uint16) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func unitsToString(u []uint16) string { return string(utf16.Decode(u)) }

func stringToUnits(s string) []uint16 { return utf16.Encode([]rune(s)) }

func hasPrefixAt(src []uint16, at int, text string) bool {
	if at+len(text) > len(src) {
		return false
	}
	for i := range len(text) {
		if src[at+i] != uint16(text[i]) {
			return false
		}
	}
	return true
}

// Positions count UTF-16 units, because the TypeScript engine's messages do.
func lex(src []uint16) []token {
	var out []token
	i := 0
	for i < len(src) {
		c := src[i]
		switch {
		case isSpace(c):
			i++
		case isDigit(c):
			end := i
			for end < len(src) && isDigit(src[end]) {
				end++
			}
			if end < len(src) && (src[end] == '.' || isIDStart(src[end])) {
				exprFail("bad number at %d: integers only", i)
			}
			// An out-of-range literal parses to infinity, which the safe-integer check refuses.
			v, _ := strconv.ParseFloat(unitsToString(src[i:end]), 64)
			if !isSafeInteger(v) {
				exprFail("number too large at %d", i)
			}
			out = append(out, token{kind: tokNum, num: v, at: i})
			i = end
		case isIDStart(c):
			end := i
			for end < len(src) && (isIDStart(src[end]) || isDigit(src[end])) {
				end++
			}
			out = append(out, token{kind: tokID, text: unitsToString(src[i:end]), at: i})
			i = end
		case c == '"':
			end := i + 1
			for end < len(src) && src[end] != '"' {
				end++
			}
			if end >= len(src) {
				exprFail("unterminated string at %d", i)
			}
			if slices.Contains(src[i+1:end], '\\') {
				exprFail("escapes are not allowed in strings (at %d)", i)
			}
			out = append(out, token{kind: tokStr, text: unitsToString(src[i+1 : end]), at: i})
			i = end + 1
		default:
			found := ""
			for _, op := range exprOperators {
				if hasPrefixAt(src, i, op) {
					found = op
					break
				}
			}
			if found == "" {
				exprFail(`unexpected character "%s" at %d`, unitsToString(src[i:i+1]), i)
			}
			out = append(out, token{kind: tokOp, text: found, at: i})
			i += len(found)
		}
	}
	return append(out, token{kind: tokEOF, at: len(src)})
}

// Binding powers, loosest first. Postfix `.` and `[` bind tightest.
var infixBP = map[string]int{
	"?": 1, "||": 2, "&&": 3, "==": 4, "!=": 4, "<": 5, "<=": 5, ">": 5, ">=": 5,
	"+": 6, "-": 6, "*": 7, "/": 7, "%": 7, ".": 9, "[": 9,
}

const prefixBP = 8

var exprFunctions = []string{"min", "max", "floor", "ceil", "clamp", "abs", "mod", "count", "sum", "has", "at"}

type parser struct {
	tokens []token
	pos    int
	nodes  int
}

func (p *parser) peek() token { return p.tokens[p.pos] }

func (p *parser) next() token {
	t := p.peek()
	if t.kind != tokEOF {
		p.pos++
	}
	return t
}

func describe(t token) string {
	switch t.kind {
	case tokEOF:
		return "end"
	case tokNum:
		return esNumber(t.num)
	}
	return t.text
}

func (p *parser) expectOp(op string) {
	t := p.next()
	if t.kind != tokOp || t.text != op {
		exprFail(`expected "%s" at %d, got "%s"`, op, t.at, describe(t))
	}
}

// Called after a node's children are parsed, which decides where the cap trips and so which error wins.
func (p *parser) count() {
	p.nodes++
	if p.nodes > maxExprNodes {
		exprFail("expression has more than %d nodes", maxExprNodes)
	}
}

func (p *parser) expr(minBP int) Node {
	left := p.prefix()
	for {
		t := p.peek()
		if t.kind != tokOp {
			return left
		}
		bp, ok := infixBP[t.text]
		if !ok || bp < minBP {
			return left
		}
		p.next()
		left = p.infix(left, t.text, bp)
	}
}

func (p *parser) prefix() Node {
	t := p.next()
	switch t.kind {
	case tokNum:
		p.count()
		return NumNode{t.num}
	case tokStr:
		p.count()
		return StrNode{t.text}
	case tokID:
		if t.text == "true" || t.text == "false" {
			p.count()
			return BoolNode{t.text == "true"}
		}
		if after := p.peek(); after.kind == tokOp && after.text == "(" {
			return p.call(t.text, t.at)
		}
		p.count()
		return IdentNode{t.text}
	case tokOp:
		if t.text == "(" {
			inner := p.expr(0)
			p.expectOp(")")
			return inner
		}
		if t.text == "-" || t.text == "!" {
			arg := p.expr(prefixBP)
			p.count()
			return UnaryNode{t.text, arg}
		}
		exprFail(`unexpected "%s" at %d`, t.text, t.at)
	}
	exprFail("unexpected end of expression")
	return nil
}

func (p *parser) call(name string, at int) Node {
	if !slices.Contains(exprFunctions, name) {
		exprFail(`unknown function "%s" at %d`, name, at)
	}
	p.expectOp("(")
	args := []Node{}
	if c := p.peek(); c.kind == tokOp && c.text == ")" {
		p.next()
	} else {
		for {
			args = append(args, p.expr(0))
			sep := p.next()
			if sep.kind == tokOp && sep.text == ")" {
				break
			}
			if sep.kind != tokOp || sep.text != "," {
				exprFail(`expected "," or ")" at %d`, sep.at)
			}
		}
	}
	p.count()
	return CallNode{name, args}
}

func (p *parser) infix(left Node, op string, bp int) Node {
	switch op {
	case ".":
		key := p.next()
		if key.kind != tokID {
			exprFail(`expected a name after "." at %d`, key.at)
		}
		p.count()
		return GetNode{left, key.text}
	case "[":
		key := p.expr(0)
		p.expectOp("]")
		p.count()
		return IndexNode{left, key}
	case "?":
		then := p.expr(0)
		p.expectOp(":")
		// Right-associative: `a ? b : c ? d : e` nests in the else branch.
		otherwise := p.expr(bp)
		p.count()
		return CondNode{left, then, otherwise}
	}
	// Left-associative: the right side binds one tighter.
	right := p.expr(bp + 1)
	p.count()
	return BinaryNode{op, left, right}
}

// ParseExpr turns source into an AST, or an ExprError on bad syntax, an unknown function, or a breached cap.
func ParseExpr(source string) (node Node, err error) {
	defer recoverExprError(&err)
	units := stringToUnits(source)
	if len(units) > maxExprLength {
		exprFail("expression longer than %d characters", maxExprLength)
	}
	p := &parser{tokens: lex(units)}
	node = p.expr(0)
	if t := p.peek(); t.kind != tokEOF {
		exprFail(`unexpected "%s" at %d`, describe(t), t.at)
	}
	return node, nil
}
