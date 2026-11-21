package view

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The manifest a seat is served must compile (house decision #101; vectors/reference/view.compiles.ts). Cutting a
// definition a seat may not read leaves the parts that name it dangling, so the compiler's own problems say where:
// each is answered with one cut, and the manifest compiled again, until it compiles. A cut only removes or narrows,
// so nothing is served that was not before. The same problems in the same order give the same cuts in both engines.

type answerKind int

const (
	// narrow: a definition scoped to actor types whose expression reads what one type hides keeps the types it
	// compiles for; another problem inside is cut where it names.
	narrowPart answerKind = iota
	// narrowOrCut: a spend not narrowed is cut whole, never left without the cost the seat cannot see (#84); a strike,
	// whose figures and outcomes go together (#99).
	narrowOrCutPart
	// cut: an offer (the GM side's alone, #80), an effect, a reminder, a side's cost, a generator (#98).
	cutPart
)

// The parts a problem inside is answered for as a whole, `*` any key or index.
var compilableParts = []struct {
	at     []string
	answer answerKind
}{
	{[]string{"resources", "*"}, narrowPart},
	{[]string{"tests", "*"}, narrowPart},
	{[]string{"tests", "*", "offers", "*"}, cutPart},
	{[]string{"health", "states", "*"}, narrowPart},
	{[]string{"health", "harm", "profiles", "*"}, narrowPart},
	{[]string{"notices", "*"}, narrowPart},
	{[]string{"spends", "*"}, narrowOrCutPart},
	{[]string{"spawn", "options", "*"}, narrowPart},
	{[]string{"spawn", "options", "*", "effects", "*"}, cutPart},
	{[]string{"spawn", "adjust", "*"}, narrowPart},
	{[]string{"tables", "*"}, narrowPart},
	{[]string{"conditions", "*", "effects", "*"}, cutPart},
	{[]string{"reminders", "*"}, cutPart},
	{[]string{"initiative", "outOfTurn", "cost", "*"}, cutPart},
	{[]string{"initiative", "barred", "liftCost", "*"}, cutPart},
	// A strike the seat cannot work out (a figure, an addition, an outcome, a value) is not guided on it; a means, a
	// further number or a note it cannot read goes alone (house decision #99: nothing reads them).
	{[]string{"strikes", "*"}, narrowOrCutPart},
	{[]string{"strikes", "*", "means", "*"}, cutPart},
	{[]string{"strikes", "*", "shows", "*"}, cutPart},
	{[]string{"strikes", "*", "notes", "*"}, cutPart},
	// A step's `when` or a pick's `filter` cut alone would ask what the server's run check refuses (house decision #98).
	{[]string{"generators", "*"}, cutPart},
}

const maxCuts = 200

// compilable is the manifest as served, cut until it compiles; returned as it came when it already does. The input is
// never written to: the first cut works on a copy.
//
// ponytail: a problem no cut answers leaves the manifest as it is (the phone works without a compiled ruleset, as
// before); add its part to compilableParts when one shows up.
func compilable(manifest map[string]any) map[string]any {
	m := manifest
	for range maxCuts {
		problems := problemsOf(m)
		if len(problems) == 0 {
			return m
		}
		next := answerProblem(m, problems[0])
		if next == nil {
			return m
		}
		m = next
	}
	return m
}

func problemsOf(m map[string]any) []engine.Problem {
	_, problems := engine.CompileRuleset(m)
	slices.SortStableFunc(problems, func(a, b engine.Problem) int {
		if c := strings.Compare(a.Path, b.Path); c != 0 {
			return c
		}
		return strings.Compare(a.Message, b.Message)
	})
	return problems
}

var indexPattern = regexp.MustCompile(`\[(\d+)\]`)

// segmentsOf reads `a.b[2].c` as segments; a dotted key (`attr.str`) is joined again where the document has it.
func segmentsOf(path string) []any {
	var out []any
	for _, part := range strings.Split(path, ".") {
		if name := indexPattern.ReplaceAllString(part, ""); name != "" {
			out = append(out, name)
		}
		for _, m := range indexPattern.FindAllStringSubmatch(part, -1) {
			n, _ := strconv.Atoi(m[1])
			out = append(out, n)
		}
	}
	return out
}

// locate is the keys of the document a path reaches, as far as it reaches; whole when it reaches the end.
func locate(root any, path string) (keys []any, whole bool) {
	segs := segmentsOf(path)
	node := root
	i := 0
	for i < len(segs) {
		if arr, ok := node.([]any); ok {
			if n, isInt := segs[i].(int); isInt && n < len(arr) {
				keys = append(keys, n)
				node = arr[n]
				i++
				continue
			}
		}
		obj, ok := node.(map[string]any)
		if !ok {
			break
		}
		// The longest run of named segments that is a key: field ids may be dotted.
		taken := 0
		for n := len(segs) - i; n >= 1 && taken == 0; n-- {
			names := make([]string, 0, n)
			for _, s := range segs[i : i+n] {
				if name, isName := s.(string); isName {
					names = append(names, name)
				}
			}
			if len(names) == n {
				if _, has := obj[strings.Join(names, ".")]; has {
					taken = n
				}
			}
		}
		if taken == 0 {
			break
		}
		names := make([]string, 0, taken)
		for _, s := range segs[i : i+taken] {
			names = append(names, s.(string))
		}
		key := strings.Join(names, ".")
		keys = append(keys, key)
		node = obj[key]
		i += taken
	}
	return keys, i == len(segs)
}

func nodeAt(root any, keys []any) any {
	node := root
	for _, k := range keys {
		switch key := k.(type) {
		case int:
			arr, _ := node.([]any)
			if key >= len(arr) {
				return nil
			}
			node = arr[key]
		case string:
			obj, _ := node.(map[string]any)
			node = obj[key]
		}
	}
	return node
}

func keyText(k any) string {
	if n, ok := k.(int); ok {
		return strconv.Itoa(n)
	}
	s, _ := k.(string)
	return s
}

func matchesKeys(pattern []string, keys []any) bool {
	if len(pattern) > len(keys) {
		return false
	}
	for i, p := range pattern {
		if p != "*" && p != keyText(keys[i]) {
			return false
		}
	}
	return true
}

// answerProblem is the cut that answers one problem, or nil when none does.
func answerProblem(m map[string]any, problem engine.Problem) map[string]any {
	keys, whole := locate(m, problem.Path)
	best := -1
	for i, p := range compilableParts {
		if matchesKeys(p.at, keys) && (best < 0 || len(p.at) > len(compilableParts[best].at)) {
			best = i
		}
	}
	if best >= 0 {
		part := compilableParts[best]
		partKeys := keys[:len(part.at)]
		if part.answer == cutPart {
			return cutAt(m, partKeys)
		}
		if strings.HasPrefix(problem.Message, "unknown identifier") {
			if narrowed := narrowAt(m, partKeys); narrowed != nil {
				return narrowed
			}
			return cutAt(m, partKeys)
		}
		if part.answer == narrowOrCutPart {
			return cutAt(m, partKeys)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	// The node the problem names, or the one holding the required part an earlier cut took; a guard takes its part.
	if last, ok := keys[len(keys)-1].(string); whole && ok && (last == "if" || last == "when") {
		return cutAt(m, keys[:len(keys)-1])
	}
	return cutAt(m, keys)
}

// narrowAt is the part at keys narrowed to the actor types it compiles for, or nil when that is none or every one.
func narrowAt(m map[string]any, keys []any) map[string]any {
	def, ok := nodeAt(m, keys).(map[string]any)
	if !ok {
		return nil
	}
	// A shared pool carries no actor types.
	if keys[0] == "resources" && def["scope"] != "entity" {
		return nil
	}
	var candidates []string
	if declared, isList := def["entities"].([]any); isList {
		for _, id := range declared {
			if s, isText := id.(string); isText {
				candidates = append(candidates, s)
			}
		}
	} else {
		for _, e := range list(m["entities"]) {
			if entity, _ := e.(map[string]any); entity["base"] == "actor" {
				id, _ := entity["id"].(string)
				candidates = append(candidates, id)
			}
		}
	}
	// An expression's problem means the manifest validated, so a narrowing that does not validate broke something else
	// that needs the type (a layout row naming the resource on it): that type stays out of the narrowing.
	var keep []string
	for _, id := range candidates {
		trial := withEntities(m, keys, []string{id})
		if _, problems := engine.ValidateRuleset(trial); len(problems) > 0 {
			continue
		}
		under := false
		for _, p := range problemsOf(trial) {
			if at, _ := locate(trial, p.Path); matchesKeys(keyTexts(keys), at) {
				under = true
				break
			}
		}
		if !under {
			keep = append(keep, id)
		}
	}
	if len(keep) == 0 || len(keep) == len(candidates) {
		return nil
	}
	return withEntities(m, keys, keep)
}

func keyTexts(keys []any) []string {
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = keyText(k)
	}
	return out
}

func withEntities(m map[string]any, keys []any, entities []string) map[string]any {
	out, _ := cloneJSON(m).(map[string]any)
	def, _ := nodeAt(out, keys).(map[string]any)
	list := make([]any, len(entities))
	for i, id := range entities {
		list[i] = id
	}
	def["entities"] = list
	return out
}

func cutAt(m map[string]any, keys []any) map[string]any {
	if len(keys) == 0 {
		return nil
	}
	out, _ := cloneJSON(m).(map[string]any)
	last := keys[len(keys)-1]
	parentKeys := keys[:len(keys)-1]
	switch parent := nodeAt(out, parentKeys).(type) {
	case []any:
		n, _ := last.(int)
		cut := slices.Delete(slices.Clone(parent), n, n+1)
		if len(parentKeys) == 0 {
			return out
		}
		setAt(out, parentKeys, cut)
	case map[string]any:
		delete(parent, keyText(last))
	}
	return out
}

// setAt replaces the node at keys (never the root) in a document cloneJSON made.
func setAt(root map[string]any, keys []any, v any) {
	holder := nodeAt(root, keys[:len(keys)-1])
	switch h := holder.(type) {
	case []any:
		n, _ := keys[len(keys)-1].(int)
		h[n] = v
	case map[string]any:
		h[keyText(keys[len(keys)-1])] = v
	}
}

// cloneJSON copies a decoded JSON document deep, so a cut never writes into the manifest it was given.
func cloneJSON(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, item := range x {
			out[k] = cloneJSON(item)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = cloneJSON(item)
		}
		return out
	default:
		return v
	}
}
