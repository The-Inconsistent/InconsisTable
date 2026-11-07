package engine

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"slices"
	"strconv"
)

// The app rolls only on random tables, or Tests when a ruleset opts in (docs/house-decisions.md #1). Every cap below
// bounds what a manifest or a GM can ask the server to roll.
const (
	MaxDice         = 100
	MaxSides        = 1000
	MaxExplodeDepth = 10
	MaxTerms        = 20
	MaxConstant     = 10_000
)

// DiceError is refused notation, or a breached cap.
type DiceError struct{ Message string }

func (e DiceError) Error() string { return e.Message }

func diceFail(format string, args ...any) {
	panic(DiceError{fmt.Sprintf(format, args...)})
}

// Die is a numbered die, `d66` (two d6 read as tens and units, 11–66) or `F` (Fudge, −1, 0, +1).
type Die struct {
	Sides int
	D66   bool
	Fudge bool
}

func (d Die) String() string {
	switch {
	case d.Fudge:
		return "F"
	case d.D66:
		return "d66"
	}
	return strconv.Itoa(d.Sides)
}

// Keep is a term's kh or kl.
type Keep struct {
	Highest bool
	N       int
}

// DiceTerm is a constant or a group of dice. Constants have IsConst set and only Sign and Value filled.
type DiceTerm struct {
	IsConst bool
	Sign    int
	Value   int
	Count   int
	Die     Die
	Keep    *Keep
	Explode bool
	// SuccessAt is `>=T`: the term counts kept faces at or above T instead of summing them. It is unbounded, so a float.
	SuccessAt *float64
}

// DiceExpr is parsed notation.
type DiceExpr struct {
	Notation string
	Terms    []DiceTerm
}

// Rng returns an integer in [1, sides].
type Rng func(sides int) int

// TermRoll is one term's result.
type TermRoll struct {
	Notation string `json:"notation"`
	// Faces holds every face rolled, explosions included, in roll order.
	Faces []int `json:"faces"`
	// Kept is parallel to Faces: false for a face dropped by kh/kl.
	Kept []bool `json:"kept"`
	// Value is the signed contribution to the total.
	Value int `json:"value"`
}

// DiceRoll is a whole notation's result.
type DiceRoll struct {
	Notation string     `json:"notation"`
	Faces    []int      `json:"faces"`
	Total    int        `json:"total"`
	Terms    []TermRoll `json:"terms"`
}

type cursor struct {
	src []uint16
	pos int
}

func (c *cursor) skipSpace() {
	for c.pos < len(c.src) && isSpace(c.src[c.pos]) {
		c.pos++
	}
}

func (c *cursor) eat(text string) bool {
	c.skipSpace()
	if !hasPrefixAt(c.src, c.pos, text) {
		return false
	}
	c.pos += len(text)
	return true
}

// digits reads a run of digits at the cursor. Number() semantics: an endless run reads as infinity, which the caps refuse.
func (c *cursor) digits() (float64, bool) {
	end := c.pos
	for end < len(c.src) && isDigit(c.src[end]) {
		end++
	}
	if end == c.pos {
		return 0, false
	}
	v, _ := strconv.ParseFloat(unitsToString(c.src[c.pos:end]), 64)
	c.pos = end
	return v, true
}

func (c *cursor) int() (float64, bool) {
	c.skipSpace()
	return c.digits()
}

func (c *cursor) done() bool {
	c.skipSpace()
	return c.pos >= len(c.src)
}

func (c *cursor) at(i int) (uint16, bool) {
	if i < len(c.src) {
		return c.src[i], true
	}
	return 0, false
}

func (c *cursor) isAt(i int, ch uint16) bool {
	got, ok := c.at(i)
	return ok && got == ch
}

func parseTerm(c *cursor, sign int) DiceTerm {
	lead, hasLead := c.int()
	c.skipSpace()
	if !c.isAt(c.pos, 'd') && !c.isAt(c.pos, 'D') {
		if !hasLead {
			diceFail("expected a number or dice at %d", c.pos)
		}
		if lead > MaxConstant {
			diceFail("constant %s is over %d", esNumber(lead), MaxConstant)
		}
		return DiceTerm{IsConst: true, Sign: sign, Value: int(lead)}
	}
	c.pos++
	count := 1.0
	if hasLead {
		count = lead
	}
	if count < 1 || count > MaxDice {
		diceFail("dice count must be 1–%d, got %s", MaxDice, esNumber(count))
	}
	var die Die
	switch {
	case c.isAt(c.pos, 'F'):
		c.pos++
		die = Die{Fudge: true}
	case hasPrefixAt(c.src, c.pos, "66") && !nextIsDigit(c, c.pos+2):
		c.pos += 2
		die = Die{D66: true}
	default:
		// No space allowed inside `dX`.
		sides, ok := c.digits()
		if !ok {
			diceFail(`expected sides after "d" at %d`, c.pos)
		}
		if sides < 1 || sides > MaxSides {
			diceFail("a die must have 1–%d sides, got %s", MaxSides, esNumber(sides))
		}
		die = Die{Sides: int(sides)}
	}
	term := DiceTerm{Sign: sign, Count: int(count), Die: die}
	for {
		highest := c.eat("kh")
		switch {
		case highest || c.eat("kl"):
			if term.Keep != nil {
				diceFail("only one kh/kl per term")
			}
			n, ok := c.int()
			if !ok || n < 1 || n > count {
				diceFail("keep must be 1–%s", esNumber(count))
			}
			term.Keep = &Keep{Highest: highest, N: int(n)}
		case c.eat("!"):
			if term.Explode {
				diceFail("only one ! per term")
			}
			// A d1 always rolls its max and would explode forever; F and d66 have no single top face to chain on.
			if die.Sides == 1 || die.Fudge || die.D66 {
				diceFail("cannot explode d%s", die)
			}
			term.Explode = true
		case c.eat(">="):
			if term.SuccessAt != nil {
				diceFail("only one >= per term")
			}
			if die.Fudge {
				diceFail("cannot count successes on dF")
			}
			t, ok := c.int()
			if !ok {
				diceFail(`expected a target after ">=" at %d`, c.pos)
			}
			term.SuccessAt = &t
		default:
			return term
		}
	}
}

func nextIsDigit(c *cursor, i int) bool {
	ch, ok := c.at(i)
	return ok && isDigit(ch)
}

func trimSpace(u []uint16) []uint16 {
	for len(u) > 0 && isSpace(u[0]) {
		u = u[1:]
	}
	for len(u) > 0 && isSpace(u[len(u)-1]) {
		u = u[:len(u)-1]
	}
	return u
}

// ParseDice reads notation: `NdX`, `+`/`-` constants and dice, `kh N`/`kl N`, `!`, `>=T`, `d66`, `dF`.
func ParseDice(notation string) (expr DiceExpr, err error) {
	defer func() {
		if r := recover(); r != nil {
			e, ok := r.(DiceError)
			if !ok {
				panic(r)
			}
			err = e
		}
	}()
	units := stringToUnits(notation)
	c := &cursor{src: units}
	terms := []DiceTerm{parseTerm(c, 1)}
	for !c.done() {
		sign := 1
		if c.eat("+") {
			sign = 1
		} else if c.eat("-") {
			sign = -1
		} else {
			diceFail(`unexpected "%s" at %d`, unitsToString(c.src[c.pos:c.pos+1]), c.pos)
		}
		terms = append(terms, parseTerm(c, sign))
		if len(terms) > MaxTerms {
			diceFail("more than %d terms", MaxTerms)
		}
	}
	if !slices.ContainsFunc(terms, func(t DiceTerm) bool { return !t.IsConst }) {
		diceFail("notation has no dice")
	}
	return DiceExpr{Notation: unitsToString(trimSpace(units)), Terms: terms}, nil
}

// PlainDice returns the shape of plain `NdX` notation, and false for anything else.
func PlainDice(notation string) (count, sides int, ok bool) {
	expr, err := ParseDice(notation)
	if err != nil || len(expr.Terms) != 1 {
		return 0, 0, false
	}
	t := expr.Terms[0]
	if t.IsConst || t.Die.D66 || t.Die.Fudge || t.Keep != nil || t.Explode || t.SuccessAt != nil || t.Sign != 1 {
		return 0, 0, false
	}
	return t.Count, t.Die.Sides, true
}

func formatTerm(t DiceTerm) string {
	if t.IsConst {
		return strconv.Itoa(t.Value)
	}
	die := t.Die.String()
	if t.Die.D66 {
		die = "66"
	}
	out := strconv.Itoa(t.Count) + "d" + die
	if t.Keep != nil {
		which := "kl"
		if t.Keep.Highest {
			which = "kh"
		}
		out += which + strconv.Itoa(t.Keep.N)
	}
	if t.Explode {
		out += "!"
	}
	if t.SuccessAt != nil {
		out += ">=" + esNumber(*t.SuccessAt)
	}
	return out
}

// CryptoRng is uniform in [1, sides], so no face is favoured.
func CryptoRng(sides int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(sides)))
	if err != nil {
		panic(err)
	}
	return int(v.Int64()) + 1
}

func draw(rng Rng, sides int) int {
	v := rng(sides)
	if v < 1 || v > sides {
		diceFail("rng returned %d for a d%d", v, sides)
	}
	return v
}

func rollOne(rng Rng, die Die) int {
	switch {
	case die.Fudge:
		return draw(rng, 3) - 2
	case die.D66:
		tens := draw(rng, 6)
		return tens*10 + draw(rng, 6)
	}
	return draw(rng, die.Sides)
}

func rollTerm(t DiceTerm, rng Rng) TermRoll {
	faces := []int{}
	for range t.Count {
		face := rollOne(rng, t.Die)
		faces = append(faces, face)
		// `!` is refused on F and d66 at parse, so the die is numeric here.
		for depth := 0; t.Explode && face == t.Die.Sides && depth < MaxExplodeDepth; depth++ {
			face = rollOne(rng, t.Die)
			faces = append(faces, face)
		}
	}
	kept := make([]bool, len(faces))
	if t.Keep == nil {
		for i := range kept {
			kept[i] = true
		}
	} else {
		order := make([]int, len(faces))
		for i := range order {
			order[i] = i
		}
		// Stable: equal faces keep roll order, so the same rolls always drop the same dice.
		slices.SortStableFunc(order, func(a, b int) int {
			if t.Keep.Highest {
				return faces[b] - faces[a]
			}
			return faces[a] - faces[b]
		})
		for _, i := range order[:t.Keep.N] {
			kept[i] = true
		}
	}
	raw := 0
	for i, face := range faces {
		if !kept[i] {
			continue
		}
		if t.SuccessAt == nil {
			raw += face
		} else if float64(face) >= *t.SuccessAt {
			raw++
		}
	}
	return TermRoll{Notation: formatTerm(t), Faces: faces, Kept: kept, Value: t.Sign * raw}
}

// RollDice rolls notation, and returns a DiceError on bad notation or a breached cap.
func RollDice(notation string, rng Rng) (roll DiceRoll, err error) {
	expr, err := ParseDice(notation)
	if err != nil {
		return DiceRoll{}, err
	}
	defer func() {
		if r := recover(); r != nil {
			e, ok := r.(DiceError)
			if !ok {
				panic(r)
			}
			err = e
		}
	}()
	roll = DiceRoll{Notation: expr.Notation, Faces: []int{}, Terms: []TermRoll{}}
	for _, t := range expr.Terms {
		var tr TermRoll
		if t.IsConst {
			tr = TermRoll{Notation: formatTerm(t), Faces: []int{}, Kept: []bool{}, Value: t.Sign * t.Value}
		} else {
			tr = rollTerm(t, rng)
		}
		roll.Faces = append(roll.Faces, tr.Faces...)
		roll.Total += tr.Value
		roll.Terms = append(roll.Terms, tr)
	}
	return roll, nil
}
