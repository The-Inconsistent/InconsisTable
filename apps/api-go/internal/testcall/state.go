// Package testcall holds the Tests a GM calls (docs/design.md §6.3). The snapshot's read and the test.* actions.
package testcall

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Closed calls older than the session are history, not state. A busy table calls a few Tests an hour.
//
// ponytail: the newest 50 calls; page the rest into a results screen if a session ever calls more.
const maxCalls = 50

// What the Test rolls, as the table reads it: the dice of a sum Test, the die of a Dice pool.
func diceOf(t *engine.Test) string {
	switch t.Kind {
	case "sumVsTarget":
		return t.Dice
	case "reported":
		return "reported"
	}
	return "d" + strconv.Itoa(int(t.Die)) + " pool"
}

// The phone's part of a Dice pool Test. Nil for a sum Test.
func poolSpecOf(t *engine.Test) *cs.PoolSpec {
	if t.Kind != "poolSuccesses" {
		return nil
	}
	spec := &cs.PoolSpec{Die: int(t.Die), Bands: []cs.PoolBand{}, Shift: t.Shift}
	for _, b := range t.Bands {
		spec.Bands = append(spec.Bands, cs.PoolBand{ID: b.ID, From: int(b.From), To: int(b.To), Worth: int(b.Worth)})
	}
	if t.Special != nil {
		spec.Special = &cs.PoolSpecial{Label: t.Special.Label, Count: int(t.Special.Count)}
	}
	return spec
}

// The results a reported Test lists, best first. Nil for every other kind.
func outcomesOf(t *engine.Test) []cs.OutcomeSpec {
	if t.Kind != "reported" {
		return nil
	}
	out := make([]cs.OutcomeSpec, len(t.Outcomes))
	for i, o := range t.Outcomes {
		out[i] = cs.OutcomeSpec{ID: o.ID, Label: o.Label}
	}
	return out
}

// jsonbOrder is the order TypeScript's Object.entries reads a stored manifest's record in: Postgres jsonb keeps object
// keys shortest first, then bytewise, and ids are never integer-like, which JavaScript would put first.
func jsonbOrder[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(keys[i]) != len(keys[j]) {
			return len(keys[i]) < len(keys[j])
		}
		return keys[i] < keys[j]
	})
	return keys
}

// DefsOf is the pinned ruleset's Tests as the GM's call form needs them.
func DefsOf(compiled *engine.CompiledRuleset) []cs.TestDef {
	out := []cs.TestDef{}
	if compiled == nil {
		return out
	}
	for _, id := range jsonbOrder(compiled.Tests) {
		t := compiled.Tests[id].Def
		def := cs.TestDef{
			ID: id, Dice: diceOf(t), Advantage: t.Kind == "sumVsTarget" && t.Advantage, Pool: poolSpecOf(t),
			Outcomes: outcomesOf(t), Inputs: []cs.TestDefInput{},
		}
		for _, inputID := range jsonbOrder(t.Inputs) {
			input := cs.TestDefInput{ID: inputID, Type: t.Inputs[inputID]}
			if options, ok := t.InputOptions[inputID].([]any); ok {
				input.Options = []string{}
				for _, o := range options {
					if s, isText := o.(string); isText {
						input.Options = append(input.Options, s)
					}
				}
			}
			def.Inputs = append(def.Inputs, input)
		}
		out = append(out, def)
	}
	return out
}

// TargetInputs is the call inputs the target expression reads: ctx.<input>.
func TargetInputs(t *engine.CompiledTest) []string {
	out := []string{}
	for _, ref := range t.Target.Refs {
		if rest, ok := strings.CutPrefix(ref, "ctx."); ok {
			head, _, _ := strings.Cut(rest, ".")
			out = append(out, head)
		}
	}
	return out
}

// Never "visible" for an actor the ruleset has no entry for: fail closed, like everything else.
func everyoneMay(visibility map[string]string, targets []string, built map[string]*actor.Built, noGM bool) bool {
	for _, actorID := range targets {
		b := built[actorID]
		if b == nil {
			return false
		}
		v, ok := visibility[b.Entity]
		// Without a GM the numbers go to every seat, so only what the whole table sees is told (docs/adr/0009-table-modes.md).
		if !ok || v == "gm" || (noGM && v != "public" && v != "party") {
			return false
		}
	}
	return true
}

func intPtr(n *int32) *int {
	if n == nil {
		return nil
	}
	v := int(*n)
	return &v
}

// Load is the open calls and this session's closed ones, whole (every target number and result): the GM's copy. A
// number the call computed is told to the table only if the GM didn't hide it and the ruleset lets every called
// character's owner see what it was computed from.
func Load(ctx context.Context, conn core.Conn, campaignID string, sessionID *string, noGM bool, compiled *engine.CompiledRuleset,
	built map[string]*actor.Built) ([]cs.TestCall, error) {
	if compiled == nil {
		return []cs.TestCall{}, nil
	}
	rows, err := conn.Query(ctx, `SELECT id::text, test_id, status, created_at, inputs, hide_target, show_outcome, revealed
		FROM test_call WHERE campaign_id = $1 AND (status = 'open' OR session_id = $2)
		ORDER BY created_at DESC, id DESC LIMIT $3`, campaignID, sessionID, maxCalls)
	if err != nil {
		return nil, err
	}
	type call struct {
		id, testID, status      string
		createdAt               time.Time
		inputs                  []byte
		hideTarget, showOutcome bool
		revealed                bool
	}
	calls, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (call, error) {
		var c call
		err := r.Scan(&c.id, &c.testID, &c.status, &c.createdAt, &c.inputs, &c.hideTarget, &c.showOutcome, &c.revealed)
		return c, err
	})
	if err != nil || len(calls) == 0 {
		return []cs.TestCall{}, err
	}
	ids := make([]string, len(calls))
	for i, c := range calls {
		ids[i] = c.id
	}
	targets := map[string][]cs.TestTargetState{}
	rows, err = conn.Query(ctx, `SELECT call_id::text, actor_id::text, modifier, target, pool FROM test_call_target
		WHERE call_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var callID string
		var t cs.TestTargetState
		var modifier, target int32
		var pool *int32
		if err := rows.Scan(&callID, &t.ActorID, &modifier, &target, &pool); err != nil {
			rows.Close()
			return nil, err
		}
		m, tg := int(modifier), int(target)
		t.Modifier, t.Target, t.Pool = &m, &tg, intPtr(pool)
		targets[callID] = append(targets[callID], t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reports := map[string]*cs.TestResult{}
	rows, err = conn.Query(ctx, `SELECT call_id::text, actor_id::text, "natural", total, outcome, margin, shifts, flags
		FROM test_report WHERE call_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var callID, actorID, outcome string
		var natural, margin, shifts *int32
		var total int32
		var flags []string
		if err := rows.Scan(&callID, &actorID, &natural, &total, &outcome, &margin, &shifts, &flags); err != nil {
			rows.Close()
			return nil, err
		}
		if flags == nil {
			flags = []string{}
		}
		t := int(total)
		reports[callID+"/"+actorID] = &cs.TestResult{
			Natural: intPtr(natural), Total: &t, Outcome: &outcome, Margin: intPtr(margin), Shifts: intPtr(shifts), Flags: flags,
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := []cs.TestCall{}
	for _, c := range calls {
		test := compiled.Tests[c.testID]
		if test == nil {
			continue // a Test the pinned ruleset no longer has
		}
		mine := targets[c.id]
		if mine == nil {
			mine = []cs.TestTargetState{}
		}
		actorIDs := make([]string, len(mine))
		reported := 0
		for i := range mine {
			actorIDs[i] = mine[i].ActorID
			mine[i].Report = reports[c.id+"/"+mine[i].ActorID]
			if mine[i].Report != nil {
				reported++
			}
		}
		// A reported Test has no target or modifier to show or hide; its results follow the same rules (house decision #41).
		isReported := test.Def.Kind == "reported"
		showTarget := !isReported && !c.hideTarget && everyoneMay(test.TargetVisibility, actorIDs, built, noGM)
		secret := []string{}
		if !showTarget {
			secret = TargetInputs(test)
		}
		inputs := map[string]any{}
		if err := json.Unmarshal(c.inputs, &inputs); err != nil {
			return nil, err
		}
		out = append(out, cs.TestCall{
			ID: c.id, TestID: c.testID, Dice: diceOf(test.Def), Advantage: test.Def.Kind == "sumVsTarget" && test.Def.Advantage,
			Pool: poolSpecOf(test.Def), Outcomes: outcomesOf(test.Def), Status: c.status, CreatedAt: core.ISOTime(c.createdAt),
			Inputs: inputs, SecretInputs: secret, ShowTarget: showTarget,
			ShowModifier: !isReported && everyoneMay(test.ModifierVisibility, actorIDs, built, noGM),
			ShowOutcome:  c.showOutcome || showTarget || isReported, Revealed: c.revealed, Called: len(mine), Reported: reported,
			Targets: mine,
		})
	}
	return out, nil
}
