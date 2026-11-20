package engine

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
)

type manifestVectorFile struct {
	Checks []struct {
		Src    string   `json:"src"`
		Expect any      `json:"expect"`
		Type   string   `json:"type"`
		Refs   []string `json:"refs"`
		Error  *string  `json:"error"`
	} `json:"checks"`
	CampaignValueChecks []struct {
		Def   CampaignFieldDef `json:"def"`
		Value any              `json:"value"`
		Why   *string          `json:"why"`
	} `json:"campaignValueChecks"`
	TypeScope map[string]any `json:"typeScope"`
	Manifests []any          `json:"manifests"`
	Cases     []struct {
		Manifest any       `json:"manifest"`
		Ok       bool      `json:"ok"`
		Compiled any       `json:"compiled"`
		Problems []Problem `json:"problems"`
	} `json:"manifestCases"`
	Derive []struct {
		Manifest   int                `json:"manifest"`
		Entity     string             `json:"entity"`
		Fields     map[string]any     `json:"fields"`
		Resources  map[string]float64 `json:"resources"`
		Conditions []string           `json:"conditions"`
		Characters float64            `json:"characters"`
		// Stored is what the campaign holds for its fields, and Campaign what CampaignValues makes of it; both are
		// absent for a manifest with no campaign fields.
		Stored   map[string]any `json:"stored"`
		Campaign map[string]any `json:"campaign"`
		Base     attempted      `json:"base"`
		Derived  attempted      `json:"derived"`
		Bounds   []struct {
			Resource string    `json:"resource"`
			Bounds   attempted `json:"bounds"`
			Resets   attempted `json:"resets"`
			Start    attempted `json:"start"`
			Death    attempted `json:"death"`
		} `json:"bounds"`
		States attempted `json:"states"`
	} `json:"derive"`
	// EntryDerive are derivations with chosen pack entries (house decision #61), every case written out.
	EntryDerive []struct {
		Manifest   int                `json:"manifest"`
		Entity     string             `json:"entity"`
		Fields     map[string]any     `json:"fields"`
		Resources  map[string]float64 `json:"resources"`
		Conditions []string           `json:"conditions"`
		Characters float64            `json:"characters"`
		Entries    []struct {
			Type, Key, Name string
			Effects         []Effect
		} `json:"entries"`
		Base    attempted `json:"base"`
		Derived attempted `json:"derived"`
	} `json:"entryDerive"`
}

// What TypeScript returned or threw.
type attempted struct {
	Value any     `json:"value"`
	Error *string `json:"error"`
}

func typeFromJSON(v any) ExprType {
	switch x := v.(type) {
	case string:
		return Scalar(x)
	case map[string]any:
		if elem, ok := x["list"]; ok {
			return ListType{typeFromJSON(elem)}
		}
		if value, ok := x["dict"]; ok {
			return DictType{typeFromJSON(value)}
		}
		fields := map[string]ExprType{}
		for k, f := range x["record"].(map[string]any) {
			fields[k] = typeFromJSON(f)
		}
		return RecordType{fields}
	}
	panic(fmt.Sprintf("not a type: %v", v))
}

func typeJSON(t ExprType) any {
	switch x := t.(type) {
	case Scalar:
		return string(x)
	case ListType:
		return map[string]any{"list": typeJSON(x.Elem)}
	case DictType:
		return map[string]any{"dict": typeJSON(x.Value)}
	case RecordType:
		fields := map[string]any{}
		for k, f := range x.Fields {
			fields[k] = typeJSON(f)
		}
		return map[string]any{"record": fields}
	}
	panic("unknown type")
}

func TestCheckerMatchesTypeScript(t *testing.T) {
	v := loadManifestVectors(t)
	scope := map[string]ExprType{}
	for k, f := range v.TypeScope {
		scope[k] = typeFromJSON(f)
	}
	for _, x := range v.Checks {
		var expect ExprType
		if x.Expect != nil {
			expect = typeFromJSON(x.Expect)
		}
		got, err := CompileExpr(x.Src, scope, expect)
		switch {
		case x.Error != nil && (err == nil || err.Error() != *x.Error):
			t.Errorf("check %q: want error %q, got %v", short(x.Src), *x.Error, err)
		case x.Error == nil && err != nil:
			t.Errorf("check %q: %v", short(x.Src), err)
		case x.Error == nil && (typeName(got.Type) != x.Type || !slices.Equal(got.Refs, x.Refs)):
			t.Errorf("check %q: want %s %v, got %s %v", short(x.Src), x.Type, x.Refs, typeName(got.Type), got.Refs)
		}
	}
}

func exprJSON(e *CompiledExpr) any {
	if e == nil {
		return nil
	}
	return map[string]any{"source": e.Source, "ast": astJSON(e.AST), "type": typeName(e.Type), "refs": e.Refs}
}

func exprsJSON(list []*CompiledExpr) []any {
	out := make([]any, len(list))
	for i, e := range list {
		out[i] = exprJSON(e)
	}
	return out
}

func compiledJSON(c *CompiledRuleset) any {
	entities := map[string]any{}
	for id, e := range c.Entities {
		derived := make([]any, len(e.Derived))
		for i, d := range e.Derived {
			derived[i] = map[string]any{"id": d.ID, "label": d.Label, "visibility": d.Visibility, "deps": d.Deps, "expr": exprJSON(d.Expr)}
		}
		effects := make([]any, len(e.Effects))
		for i, x := range e.Effects {
			effects[i] = map[string]any{
				"conditionId": x.SourceID, "phase": x.Phase, "mode": x.Mode, "target": x.Target, "priority": x.Priority,
				"value": exprJSON(x.Value), "when": exprJSON(x.When),
			}
		}
		resources := e.Resources
		if resources == nil {
			resources = []string{}
		}
		entities[id] = map[string]any{
			"resources": resources, "scope": typeJSON(RecordType{e.Scope}).(map[string]any)["record"], "derived": derived, "effects": effects,
		}
	}
	resources := map[string]any{}
	for id, r := range c.Resources {
		resets := make([]any, len(r.ResetOn))
		for i, x := range r.ResetOn {
			resets[i] = map[string]any{"event": x.Event, "to": exprJSON(x.To)}
		}
		resources[id] = map[string]any{"min": exprJSON(r.Min), "max": exprJSON(r.Max), "resetOn": resets, "start": exprJSON(r.Start)}
	}
	tests := map[string]any{}
	for id, x := range c.Tests {
		tests[id] = map[string]any{
			"modifier": exprJSON(x.Modifier), "target": exprJSON(x.Target), "pool": exprJSON(x.Pool),
			"modifierVisibility": x.ModifierVisibility, "targetVisibility": x.TargetVisibility,
		}
	}
	var initiative any
	if i := c.Initiative; i != nil {
		initiative = map[string]any{"score": exprJSON(i.Score), "tiebreak": exprsJSON(i.Tiebreak)}
	}
	var scoring any
	if s := c.Scoring; s != nil {
		scoring = map[string]any{"score": exprJSON(s.Score), "tiebreaks": exprsJSON(s.Tiebreaks), "endWhen": exprsJSON(s.EndWhen)}
	}
	states := make([]any, len(c.HealthStates))
	for i, s := range c.HealthStates {
		states[i] = map[string]any{"id": s.ID, "label": s.Label, "when": exprJSON(s.When), "entities": s.Entities}
	}
	death := map[string]any{}
	for id, e := range c.InstantDeath {
		death[id] = exprJSON(e)
	}
	return map[string]any{
		"ruleset": c.Ruleset.Normalized, "entities": entities, "resources": resources, "tests": tests,
		"initiative": initiative,
		"scoring":    scoring, "healthStates": states, "instantDeath": death, "conditions": sortedKeys(c.Conditions),
	}
}

func problemKeys(list []Problem) []string {
	out := make([]string, len(list))
	for i, p := range list {
		out[i] = p.Path + " | " + p.Message
	}
	slices.Sort(out)
	return out
}

func TestManifestsMatchTypeScript(t *testing.T) {
	v := loadManifestVectors(t)
	failed, accepted := 0, 0
	report := func(i int, format string, args ...any) {
		failed++
		if failed <= 30 {
			t.Errorf("manifest case %d: %s", i, fmt.Sprintf(format, args...))
		}
	}
	for i, x := range v.Cases {
		compiled, found := CompileRuleset(x.Manifest)
		if x.Ok {
			accepted++
		}
		switch {
		case x.Ok && len(found) > 0:
			report(i, "want it accepted, got %v", problemKeys(found))
		case !x.Ok && len(found) == 0:
			report(i, "want %v, got it accepted", problemKeys(x.Problems))
		case !x.Ok:
			want, got := problemKeys(x.Problems), problemKeys(found)
			if !slices.Equal(want, got) {
				report(i, "problems differ\n  want %v\n  got  %v", want, got)
			}
		default:
			got := viaJSON(t, compiledJSON(compiled))
			if !reflect.DeepEqual(got, x.Compiled) {
				report(i, "compiled differs: %s", firstDifference("", x.Compiled, got))
			}
		}
	}
	if failed > 0 {
		t.Errorf("%d of %d manifest cases differ", failed, len(v.Cases))
	}
	if accepted == 0 || accepted == len(v.Cases) {
		t.Errorf("%d of %d accepted, so this proves little", accepted, len(v.Cases))
	}
}

// Names the first place two decoded JSON values part, since a whole compiled ruleset is too long to read.
func firstDifference(path string, want, got any) string {
	wm, wok := want.(map[string]any)
	gm, gok := got.(map[string]any)
	if wok && gok {
		for _, k := range sortedKeys(wm) {
			if !reflect.DeepEqual(wm[k], gm[k]) {
				return firstDifference(path+"."+k, wm[k], gm[k])
			}
		}
		for _, k := range sortedKeys(gm) {
			if _, in := wm[k]; !in {
				return path + "." + k + " is extra"
			}
		}
	}
	wl, wok := want.([]any)
	gl, gok := got.([]any)
	if wok && gok && len(wl) == len(gl) {
		for i := range wl {
			if !reflect.DeepEqual(wl[i], gl[i]) {
				return firstDifference(fmt.Sprintf("%s[%d]", path, i), wl[i], gl[i])
			}
		}
	}
	w, _ := json.Marshal(want)
	g, _ := json.Marshal(got)
	return fmt.Sprintf("%s: want %s, got %s", path, short(string(w)), short(string(g)))
}

func TestCampaignValueChecksMatchTypeScript(t *testing.T) {
	v := loadManifestVectors(t)
	if len(v.CampaignValueChecks) == 0 {
		t.Fatal("no campaign value vectors")
	}
	for _, x := range v.CampaignValueChecks {
		want := ""
		if x.Why != nil {
			want = *x.Why
		}
		if got := CheckCampaignValue(&x.Def, x.Value); got != want {
			t.Errorf("%s value %v: want %q, got %q", x.Def.Type, x.Value, want, got)
		}
	}
}

func TestDerivedValuesMatchTypeScript(t *testing.T) {
	v := loadManifestVectors(t)
	compiled := make([]*CompiledRuleset, len(v.Manifests))
	for i, m := range v.Manifests {
		c, found := CompileRuleset(m)
		if len(found) > 0 {
			t.Fatalf("fixture %d: %v", i, found)
		}
		compiled[i] = c
	}
	failed := 0
	compare := func(what string, want attempted, got any, err error) {
		problem := ""
		switch {
		case want.Error != nil && (err == nil || !strings.Contains(err.Error(), *want.Error)):
			problem = fmt.Sprintf("want error %q, got %v, %v", *want.Error, got, err)
		case want.Error == nil && err != nil:
			problem = fmt.Sprintf("want %v, got error %v", want.Value, err)
		case want.Error == nil && !reflect.DeepEqual(viaJSON(t, got), want.Value):
			problem = fmt.Sprintf("want %v, got %v", want.Value, viaJSON(t, got))
		}
		if problem != "" {
			failed++
			if failed <= 25 {
				t.Errorf("%s: %s", what, problem)
			}
		}
	}
	for i, x := range v.Derive {
		c := compiled[x.Manifest]
		values := ActorValues{Fields: x.Fields, Resources: x.Resources, Conditions: x.Conditions, Characters: x.Characters}
		name := fmt.Sprintf("case %d %s", i, x.Entity)
		if x.Stored != nil {
			values.Campaign = CampaignValues(c, x.Stored)
			compare(name+" campaign", attempted{Value: x.Campaign}, values.Campaign, nil)
		}
		base, err := c.ApplyBaseEffects(x.Entity, values)
		compare(name+" base", x.Base, base, err)
		derived, err := c.DeriveValues(x.Entity, values)
		compare(name+" derived", x.Derived, derived, err)
		live := &Record{map[string]any{}}
		for k, n := range derived {
			live.Fields[k] = n
		}
		scope := ActorScopeWith(x.Fields, live, x.Resources, x.Characters, values.Campaign, nil)
		for _, b := range x.Bounds {
			bounds, err := c.ResourceBounds(b.Resource, scope)
			compare(name+" bounds "+b.Resource, b.Bounds, map[string]any{"min": bounds.Min, "max": bounds.Max, "capped": bounds.Capped}, err)
			resets, err := c.ResetValues(b.Resource, scope)
			compare(name+" resets "+b.Resource, b.Resets, resets, err)
			start, err := c.StartValue(b.Resource, scope)
			compare(name+" start "+b.Resource, b.Start, start, err)
			death, err := c.InstantDeathAt(b.Resource, scope)
			compare(name+" death "+b.Resource, b.Death, death, err)
		}
		states, err := c.HealthStatesOf(x.Entity, scope)
		compare(name+" states", x.States, states, err)
	}
	if failed > 0 {
		t.Errorf("%d derived comparisons differ", failed)
	}
	if len(v.Derive) == 0 {
		t.Fatal("no derive vectors")
	}
}

func TestEntryEffectsMatchTypeScript(t *testing.T) {
	v := loadManifestVectors(t)
	if len(v.EntryDerive) == 0 {
		t.Fatal("no entry derive vectors")
	}
	for i, x := range v.EntryDerive {
		c, found := CompileRuleset(v.Manifests[x.Manifest])
		if len(found) > 0 {
			t.Fatal(found)
		}
		entries := make([]ActiveEntry, len(x.Entries))
		for k, e := range x.Entries {
			entries[k] = ActiveEntry{Type: e.Type, Key: e.Key, Name: e.Name, Effects: e.Effects}
		}
		values := ActorValues{Fields: x.Fields, Resources: x.Resources, Conditions: x.Conditions, Characters: x.Characters, Entries: entries}
		for what, run := range map[string]struct {
			want attempted
			got  func() (any, error)
		}{
			"base":    {x.Base, func() (any, error) { return c.ApplyBaseEffects(x.Entity, values) }},
			"derived": {x.Derived, func() (any, error) { return c.DeriveValues(x.Entity, values) }},
		} {
			got, err := run.got()
			switch {
			case run.want.Error != nil && (err == nil || !strings.Contains(err.Error(), *run.want.Error)):
				t.Errorf("case %d %s: want error %q, got %v, %v", i, what, *run.want.Error, got, err)
			case run.want.Error == nil && err != nil:
				t.Errorf("case %d %s: want %v, got error %v", i, what, run.want.Value, err)
			case run.want.Error == nil && !reflect.DeepEqual(viaJSON(t, got), run.want.Value):
				t.Errorf("case %d %s: want %v, got %v", i, what, run.want.Value, viaJSON(t, got))
			}
		}
	}
}
