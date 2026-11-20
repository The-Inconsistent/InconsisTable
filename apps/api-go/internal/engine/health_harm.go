package engine

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"slices"
)

// health.harm (packages/rules-engine/src/primitives/health-harm.ts, house decision #66): damage that counts up toward
// a limit, and mobs. The arithmetic is Auspex's pcHit and combatant.adjust, with every number the manifest's.

type harmProfile struct {
	entities        []string
	shockless       *string
	spent           bool
	spentWhen       *string
	spentConditions []string
	felled          bool
	felledWhen      string
	injuries        *string
	condition       *string
	healTo          *string
	destroyed       bool
	destroyedOver   string
	destroyedField  string
}

type harmParams struct {
	wounds         string
	shock          *string
	mob            bool
	members, start string
	profiles       []harmProfile
}

func (r *objectReader) optStr(key string) *string {
	if !r.has(key) {
		return nil
	}
	s := r.str(key)
	return &s
}

func (r *objectReader) ids(key string, lo, hi int) []string {
	items := r.list(key, lo, hi)
	out := make([]string, len(items))
	for i, item := range items {
		if !isID(item) {
			r.fail(key)
			return nil
		}
		out[i] = item.(string)
	}
	return out
}

// ponytail: reads what the ops read (the manifest's own validator ran at import), as parseHealthParams does.
func parseHarmParams(raw any) (harmParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return harmParams{}, refuse("badParams", "not an object")
	}
	p := harmParams{wounds: r.id("wounds"), shock: r.optID("shock")}
	if r.has("mob") {
		m := r.nested("mob")
		p.mob, p.members, p.start = true, m.id("members"), m.str("start")
		r.absorb("mob", m)
	}
	for _, item := range r.list("profiles", 1, 10) {
		x, ok := readObject(item)
		if !ok {
			r.fail("profiles")
			continue
		}
		profile := harmProfile{entities: x.ids("entities", 1, 50), shockless: x.optStr("shockless")}
		if x.has("spent") {
			s := x.nested("spent")
			profile.spent, profile.spentWhen = true, s.optStr("when")
			if s.has("conditions") {
				profile.spentConditions = s.ids("conditions", 0, 20)
			}
			x.absorb("spent", s)
		}
		if x.has("felled") {
			f := x.nested("felled")
			profile.felled, profile.felledWhen = true, f.str("when")
			profile.injuries, profile.condition, profile.healTo = f.optStr("injuries"), f.optID("condition"), f.optStr("healTo")
			x.absorb("felled", f)
		}
		if x.has("destroyed") {
			d := x.nested("destroyed")
			profile.destroyed, profile.destroyedOver, profile.destroyedField = true, d.str("over"), d.str("field")
			x.absorb("destroyed", d)
		}
		r.absorb("profiles", x)
		p.profiles = append(p.profiles, profile)
	}
	return p, r.refusal("badParams")
}

func (p harmParams) targets() []TargetPattern {
	out := []TargetPattern{{"resource", p.wounds}}
	if p.shock != nil {
		out = append(out, TargetPattern{"resource", *p.shock})
	}
	if p.mob {
		out = append(out, TargetPattern{"resource", p.members}, TargetPattern{"field", p.start})
	}
	for _, x := range p.profiles {
		if x.felled && x.injuries != nil {
			out = append(out, TargetPattern{"field", *x.injuries})
		}
		if x.destroyed {
			out = append(out, TargetPattern{"field", x.destroyedField})
		}
	}
	return append(out, TargetPattern{"condition", "*"})
}

type hitInput struct {
	actorID       string
	wounds, shock float64
}

func parseHitInput(raw any) (hitInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return hitInput{}, refuse("badInput", "not an object")
	}
	in := hitInput{actorID: r.str("actorId")}
	if n := r.optInt("wounds", -100, 100); n != nil {
		in.wounds = *n
	}
	if n := r.optInt("shock", -100, 100); n != nil {
		in.shock = *n
	}
	if refusal := r.refusal("badInput"); refusal != nil {
		return in, refusal
	}
	if in.wounds == 0 && in.shock == 0 {
		return in, refuse("badInput", "a hit takes wounds or shock")
	}
	return in, nil
}

type musterInput struct {
	actorID string
	members float64
}

func parseMusterInput(raw any) (musterInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return musterInput{}, refuse("badInput", "not an object")
	}
	in := musterInput{actorID: r.str("actorId"), members: r.intIn("members", 1, 500)}
	return in, r.refusal("badInput")
}

// read is one expression of the block on the actor. The manifest's text is parsed here: the validator checked it.
func read(source string, scope *Record, path string) (any, *Refusal) {
	node, err := ParseExpr(source)
	if err == nil {
		var v any
		if v, err = Evaluate(node, scope); err == nil {
			return v, nil
		}
	}
	return nil, refuse("wrongState", "%s: %s", path, err.Error())
}

func readBool(source string, scope *Record, path string) (bool, *Refusal) {
	v, refusal := read(source, scope, path)
	if refusal != nil {
		return false, refusal
	}
	b, ok := v.(bool)
	if !ok {
		return false, refuse("wrongState", "%s: not a boolean", path)
	}
	return b, nil
}

func readNumber(source string, scope *Record, path string) (float64, *Refusal) {
	v, refusal := read(source, scope, path)
	if refusal != nil {
		return 0, refusal
	}
	n, ok := v.(float64)
	if !ok {
		return 0, refuse("wrongState", "%s: not a number", path)
	}
	return n, nil
}

func (a *ActorState) holds(condition string) bool {
	return slices.ContainsFunc(a.Conditions, func(c ConditionState) bool { return c.ConditionID == condition })
}

func (a *ActorState) optResource(id *string) *ResourceState {
	if id == nil {
		return nil
	}
	return a.resource(*id)
}

func (p harmParams) load(state *RuleState, actorID string) (*ActorState, *harmProfile, int, *Refusal) {
	actor := state.actor(actorID)
	if actor == nil {
		return nil, nil, 0, refuse("unknownActor", `no actor "%s"`, actorID)
	}
	at := -1
	if actor.Entity != "" {
		at = slices.IndexFunc(p.profiles, func(x harmProfile) bool { return slices.Contains(x.entities, actor.Entity) })
	}
	if at < 0 {
		return nil, nil, 0, refuse("noHarmHere", `"%s" takes no hits under this ruleset`, actorID)
	}
	if actor.Scope == nil {
		return nil, nil, 0, refuse("wrongState", `"%s" has values that cannot be read yet`, actorID)
	}
	return actor, &p.profiles[at], at, nil
}

// hit is what one hit does, in the order of house decision #66; every expression is read on the actor before it.
func (p harmParams) hit(state *RuleState, in hitInput) ([]Delta, *Refusal) {
	actor, profile, at, refusal := p.load(state, in.actorID)
	if refusal != nil {
		return nil, refusal
	}
	scope, id, path := actor.Scope, actor.ID, fmt.Sprintf("health.harm.profiles[%d]", at)
	if in.shock != 0 {
		if p.shock == nil {
			return nil, refuse("badRequest", "this ruleset has no shock")
		}
		if profile.shockless != nil {
			never, refusal := readBool(*profile.shockless, scope, path+".shockless")
			if refusal != nil {
				return nil, refusal
			}
			if never {
				return nil, refuse("neverShocked", `"%s" never takes shock`, id)
			}
		}
	}
	shockRes := actor.optResource(p.shock)
	// b. A mob: wounds take members away, and more shock in one hit than its limit takes one more. It keeps no wounds.
	if members := actor.resource(p.members); p.mob && members != nil {
		var limit *float64
		if shockRes != nil {
			limit = shockRes.Limit
			if limit == nil {
				limit = shockRes.Max
			}
		}
		loss := in.wounds
		if limit != nil && in.shock > *limit {
			loss++
		}
		ceiling := math.Inf(1)
		if members.Max != nil {
			ceiling = *members.Max
		}
		next := math.Max(0, math.Min(ceiling, members.Value-loss))
		if next == members.Value {
			return []Delta{}, nil
		}
		return []Delta{addResource(id, p.members, next-members.Value)}, nil
	}
	_, wRes, refusal := actorResource(state, id, p.wounds)
	if refusal != nil {
		return nil, refusal
	}
	wounds, shock := in.wounds, in.shock
	// a. Already spent: shock taken becomes wounds. Healing shock is never turned into anything.
	if profile.spent && shock > 0 {
		spent := false
		if profile.spentWhen != nil {
			if spent, refusal = readBool(*profile.spentWhen, scope, path+".spent.when"); refusal != nil {
				return nil, refusal
			}
		}
		spent = spent || slices.ContainsFunc(profile.spentConditions, actor.holds)
		if spent {
			wounds, shock = wounds+shock, 0
		}
	}
	// c. Destroyed: one hit past the line ends the actor outright, and nothing else changes.
	if profile.destroyed {
		over, refusal := readNumber(profile.destroyedOver, scope, path+".destroyed.over")
		if refusal != nil {
			return nil, refusal
		}
		if wounds > over {
			return []Delta{setField(id, profile.destroyedField, true)}, nil
		}
	}
	deltas := []Delta{}
	// d. Shock: never below 0, no ceiling.
	if shockRes != nil && shock != 0 {
		if next := math.Max(0, shockRes.Value+shock); next != shockRes.Value {
			deltas = append(deltas, addResource(id, *p.shock, next-shockRes.Value))
		}
	}
	if wounds == 0 {
		return deltas, nil
	}
	// e. Wounds. Down already: a wound is one more injury, healing lifts it no higher than healTo.
	down := false
	if profile.felled {
		if down, refusal = readBool(profile.felledWhen, scope, path+".felled.when"); refusal != nil {
			return nil, refusal
		}
	}
	if down {
		if wounds > 0 {
			if profile.injuries != nil {
				had, _ := actor.Fields[*profile.injuries].(float64)
				deltas = append(deltas, setField(id, *profile.injuries, had+1))
			}
			return deltas, nil
		}
		ceiling := math.Inf(1)
		if profile.healTo != nil {
			if ceiling, refusal = readNumber(*profile.healTo, scope, path+".felled.healTo"); refusal != nil {
				return nil, refusal
			}
		}
		if next := math.Max(0, math.Min(ceiling, wRes.Value+wounds)); next != wRes.Value {
			deltas = append(deltas, addResource(id, p.wounds, next-wRes.Value))
		}
		return deltas, nil
	}
	next := math.Max(0, wRes.Value+wounds)
	if next != wRes.Value {
		deltas = append(deltas, addResource(id, p.wounds, next-wRes.Value))
	}
	if !profile.felled || profile.condition == nil {
		return deltas, nil
	}
	// Brought down by this hit: felled.when read again with the new wounds (the rest of the scope as before).
	// ponytail: derived values keep their pre-hit numbers, so a limit derived from the wounds themselves is stale here;
	// derive again with the new wounds if a ruleset needs it.
	res := map[string]any{}
	if r, ok := scope.Fields["res"].(*Record); ok {
		res = maps.Clone(r.Fields)
	}
	res[p.wounds] = next
	after := &Record{maps.Clone(scope.Fields)}
	after.Fields["res"] = &Record{res}
	nowDown, refusal := readBool(profile.felledWhen, after, path+".felled.when")
	if refusal != nil {
		return nil, refusal
	}
	if nowDown && !actor.holds(*profile.condition) {
		deltas = append(deltas, Delta{DeltaTarget{ActorID: id, ApplyCondition: *profile.condition}, "add", 1.0})
	}
	return deltas, nil
}

func (p harmParams) mobOf(state *RuleState, actorID string) (*ActorState, *ResourceState, *Refusal) {
	actor := state.actor(actorID)
	if actor == nil {
		return nil, nil, refuse("unknownActor", `no actor "%s"`, actorID)
	}
	members := actor.resource(p.members)
	if !p.mob || members == nil {
		return nil, nil, refuse("notAMob", `"%s" is not a mob`, actorID)
	}
	return actor, members, nil
}

var healthHarm = definePrimitive(parseHarmParams, map[string]primitiveOp{
	"hit": defineOp("encounter:run", parseHitInput, harmParams.targets,
		func(p harmParams, state *RuleState, in hitInput) *Refusal {
			_, refusal := p.hit(state, in)
			return refusal
		},
		func(p harmParams, state *RuleState, in hitInput) []Delta {
			deltas, _ := p.hit(state, in)
			return deltas
		}),
	"muster": defineOp("encounter:run", parseMusterInput, harmParams.targets,
		func(p harmParams, state *RuleState, in musterInput) *Refusal {
			_, _, refusal := p.mobOf(state, in.actorID)
			return refusal
		},
		func(p harmParams, state *RuleState, in musterInput) []Delta {
			actor, members, refusal := p.mobOf(state, in.actorID)
			if refusal != nil {
				return []Delta{}
			}
			start, _ := actor.Fields[p.start].(float64)
			deltas := []Delta{}
			if in.members > start {
				deltas = append(deltas, setField(actor.ID, p.start, in.members))
			}
			if in.members != members.Value {
				deltas = append(deltas, addResource(actor.ID, p.members, in.members-members.Value))
			}
			return deltas
		}),
})

// UnmarshalJSON reads a scope as decoded JSON (the vectors hand one to an op through the state).
func (r *Record) UnmarshalJSON(b []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	r.Fields = ValueFromJSON(raw).(*Record).Fields
	return nil
}
