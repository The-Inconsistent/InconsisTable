package engine

import (
	"math"
	"slices"
)

type deathSaves struct {
	successes, failures, criticalFailureCounts float64
	criticalSuccessHeals                       *float64
	failuresOnDamage, failuresOnCriticalDamage *float64
}

type healthTrack struct {
	resource   string
	temp       *string
	deathSaves *deathSaves
}

type healthParams struct {
	tracks                                 []healthTrack
	stateField, successField, failureField string
}

func parseHealthParams(raw any) (healthParams, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return healthParams{}, refuse("badParams", "not an object")
	}
	p := healthParams{
		stateField:   stringOr(r, "stateField", "healthState"),
		successField: stringOr(r, "successField", "deathSaveSuccesses"),
		failureField: stringOr(r, "failureField", "deathSaveFailures"),
	}
	if r.has("tracks") {
		for _, item := range r.list("tracks", 0, 10) {
			t, ok := readObject(item)
			if !ok {
				r.fail("tracks")
				continue
			}
			track := healthTrack{resource: t.id("resource"), temp: t.optID("temp")}
			if t.has("deathSaves") {
				d := t.nested("deathSaves")
				track.deathSaves = &deathSaves{
					successes:                d.intIn("successes", 1, 20),
					failures:                 d.intIn("failures", 1, 20),
					criticalFailureCounts:    d.intOr("criticalFailureCounts", 1, 20, 1),
					criticalSuccessHeals:     d.optInt("criticalSuccessHeals", 1, maxSafeInteger),
					failuresOnDamage:         d.optInt("failuresOnDamage", 1, 20),
					failuresOnCriticalDamage: d.optInt("failuresOnCriticalDamage", 1, 20),
				}
				t.absorb("deathSaves", d)
			}
			r.absorb("tracks", t)
			p.tracks = append(p.tracks, track)
		}
	}
	return p, r.refusal("badParams")
}

func stringOr(r *objectReader, key, fallback string) string {
	if !r.has(key) {
		return fallback
	}
	return r.str(key)
}

func (p healthParams) targets() []TargetPattern {
	var out []TargetPattern
	for _, t := range p.tracks {
		out = append(out, TargetPattern{"resource", t.resource})
		if t.temp != nil {
			out = append(out, TargetPattern{"resource", *t.temp})
		}
	}
	return append(out,
		TargetPattern{"field", p.stateField}, TargetPattern{"field", p.successField}, TargetPattern{"field", p.failureField})
}

func (p healthParams) pickTrack(id *string) *healthTrack {
	for i := range p.tracks {
		if id == nil || p.tracks[i].resource == *id {
			return &p.tracks[i]
		}
	}
	return nil
}

func (p healthParams) deathSaveTrack() *healthTrack {
	for i := range p.tracks {
		if p.tracks[i].deathSaves != nil {
			return &p.tracks[i]
		}
	}
	return nil
}

var healthStates = []string{"ok", "dying", "stable", "dead"}

type trackContext struct {
	track  *healthTrack
	actor  *ActorState
	hp     *ResourceState
	temp   *ResourceState
	status string
}

func loadTrack(p healthParams, state *RuleState, actorID string, track *healthTrack) (*trackContext, *Refusal) {
	if track == nil {
		return nil, refuse("badParams", "no such health track")
	}
	actor, hp, refusal := actorResource(state, actorID, track.resource)
	if refusal != nil {
		return nil, refusal
	}
	c := &trackContext{track: track, actor: actor, hp: hp, status: "ok"}
	// No temp row yet means no temporary hit points, not an error.
	if track.temp != nil {
		c.temp = actor.resource(*track.temp)
	}
	if s, ok := actor.Fields[p.stateField].(string); ok && slices.Contains(healthStates, s) {
		c.status = s
	}
	return c, nil
}

func tally(actor *ActorState, field string) float64 {
	n, _ := actor.Fields[field].(float64)
	return n
}

// Entering or leaving dying starts the tallies over.
func (p healthParams) setStatus(actorID, status string) []Delta {
	return []Delta{
		setField(actorID, p.stateField, status),
		setField(actorID, p.successField, 0.0),
		setField(actorID, p.failureField, 0.0),
	}
}

func (p healthParams) healDeltas(c *trackContext, amount float64) []Delta {
	// Healing never lowers a value already over a max that has since dropped.
	next := c.hp.Value + amount
	if c.hp.Max != nil {
		next = math.Max(c.hp.Value, math.Min(*c.hp.Max, c.hp.Value+amount))
	}
	var deltas []Delta
	if next != c.hp.Value {
		deltas = append(deltas, addResource(c.actor.ID, c.track.resource, next-c.hp.Value))
	}
	if c.track.deathSaves != nil && amount > 0 && (c.status == "dying" || c.status == "stable") {
		deltas = append(deltas, p.setStatus(c.actor.ID, "ok")...)
	}
	return deltas
}

type healInput struct {
	actorID  string
	amount   float64
	track    *string
	critical bool
}

func parseHealInput(raw any) (healInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return healInput{}, refuse("badInput", "not an object")
	}
	in := healInput{actorID: r.str("actorId"), amount: r.intIn("amount", 0, 1_000_000), track: r.optID("track")}
	return in, r.refusal("badInput")
}

func parseDamageInput(raw any) (healInput, *Refusal) {
	in, refusal := parseHealInput(raw)
	if refusal != nil {
		return in, refusal
	}
	r, _ := readObject(raw)
	in.critical = r.boolOr("critical", false)
	return in, r.refusal("badInput")
}

func validateNotDead(p healthParams, state *RuleState, in healInput) *Refusal {
	c, refusal := loadTrack(p, state, in.actorID, p.pickTrack(in.track))
	if refusal != nil {
		return refusal
	}
	if c.status == "dead" {
		return refuse("wrongState", "the actor is dead")
	}
	return nil
}

func applyDamage(p healthParams, state *RuleState, in healInput) []Delta {
	c, refusal := loadTrack(p, state, in.actorID, p.pickTrack(in.track))
	if refusal != nil {
		return nil
	}
	id, hp := c.actor.ID, c.hp
	// Temporary points soak first; what is left goes to the track, which stops at its min (overflow is lost).
	absorbed := 0.0
	if c.temp != nil {
		absorbed = math.Min(in.amount, math.Max(0, c.temp.Value-c.temp.Min))
	}
	left := in.amount - absorbed
	next := math.Max(hp.Min, hp.Value-left)
	var deltas []Delta
	if absorbed > 0 && c.track.temp != nil {
		deltas = append(deltas, addResource(id, *c.track.temp, -absorbed))
	}
	if next != hp.Value {
		deltas = append(deltas, addResource(id, c.track.resource, next-hp.Value))
	}
	// Damage left once the track is at its min; an instant death rule reads it (docs/house-decisions.md #13).
	overflow := math.Max(0, left-math.Max(0, hp.Value-hp.Min))
	if hp.InstantDeathAt != nil && overflow >= *hp.InstantDeathAt {
		return append(deltas, setField(id, p.stateField, "dead"))
	}
	rules := c.track.deathSaves
	if rules == nil {
		return deltas
	}
	// A hit that reaches the track at its min starts dying. A stable actor hit again starts with fresh tallies (#12).
	if left > 0 && next <= hp.Min && c.status != "dying" {
		deltas = append(deltas, p.setStatus(id, "dying")...)
	}
	// A dying actor hit again: failures only when the ruleset says so (docs/house-decisions.md #7).
	if rules.failuresOnDamage != nil && left > 0 && c.status == "dying" {
		added := *rules.failuresOnDamage
		if in.critical && rules.failuresOnCriticalDamage != nil {
			added = *rules.failuresOnCriticalDamage
		}
		failures := tally(c.actor, p.failureField) + added
		deltas = append(deltas, setField(id, p.failureField, failures))
		if failures >= rules.failures {
			deltas = append(deltas, setField(id, p.stateField, "dead"))
		}
	}
	return deltas
}

type deathSaveInput struct{ actorID, result string }

var deathSaveResults = []string{"success", "failure", "criticalSuccess", "criticalFailure"}

func parseDeathSaveInput(raw any) (deathSaveInput, *Refusal) {
	r, ok := readObject(raw)
	if !ok {
		return deathSaveInput{}, refuse("badInput", "not an object")
	}
	in := deathSaveInput{r.str("actorId"), r.enum("result", deathSaveResults)}
	return in, r.refusal("badInput")
}

func validateDeathSave(p healthParams, state *RuleState, in deathSaveInput) *Refusal {
	track := p.deathSaveTrack()
	if track == nil {
		return refuse("badParams", "this ruleset has no death saves")
	}
	c, refusal := loadTrack(p, state, in.actorID, track)
	if refusal != nil {
		return refusal
	}
	if c.status != "dying" {
		return refuse("wrongState", "only a dying actor rolls death saves")
	}
	return nil
}

func applyDeathSave(p healthParams, state *RuleState, in deathSaveInput) []Delta {
	track := p.deathSaveTrack()
	c, refusal := loadTrack(p, state, in.actorID, track)
	if refusal != nil {
		return nil
	}
	rules := track.deathSaves
	if in.result == "criticalSuccess" && rules.criticalSuccessHeals != nil {
		return p.healDeltas(c, *rules.criticalSuccessHeals)
	}
	successes := tally(c.actor, p.successField)
	failures := tally(c.actor, p.failureField)
	switch in.result {
	case "success", "criticalSuccess":
		successes++
	case "criticalFailure":
		failures += rules.criticalFailureCounts
	default:
		failures++
	}
	id := c.actor.ID
	deltas := []Delta{setField(id, p.successField, successes), setField(id, p.failureField, failures)}
	// The thresholds are the manifest's numbers, never the engine's.
	if failures >= rules.failures {
		deltas = append(deltas, setField(id, p.stateField, "dead"))
	} else if successes >= rules.successes {
		deltas = append(deltas, setField(id, p.stateField, "stable"))
	}
	return deltas
}

// The tracks count down from max to min (hit points). A track that counts damage up past its max is a different
// mechanic and gets its own primitive.
var healthTracks = definePrimitive(parseHealthParams, map[string]primitiveOp{
	"damage": defineOp("encounter:run", parseDamageInput, healthParams.targets, validateNotDead, applyDamage),
	"heal": defineOp("encounter:run", parseHealInput, healthParams.targets,
		// Dead is a GM's call to undo (field.set), not something healing reverses.
		validateNotDead,
		func(p healthParams, state *RuleState, in healInput) []Delta {
			c, refusal := loadTrack(p, state, in.actorID, p.pickTrack(in.track))
			if refusal != nil {
				return nil
			}
			return p.healDeltas(c, in.amount)
		}),
	"deathSave": defineOp("encounter:run", parseDeathSaveInput, healthParams.targets, validateDeathSave, applyDeathSave),
})
