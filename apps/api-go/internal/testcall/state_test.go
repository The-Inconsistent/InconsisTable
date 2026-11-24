package testcall

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

func TestDefsOfCarriesEntitiesOnlyWhenTheTestNamesThem(t *testing.T) {
	types := []string{"character", "npc"}
	compiled := &engine.CompiledRuleset{Tests: map[string]*engine.CompiledTest{
		"brace": {Def: &engine.Test{Kind: "sumVsTarget", Dice: "1d20", Entities: &types}},
		"any":   {Def: &engine.Test{Kind: "sumVsTarget", Dice: "1d20"}},
	}}
	defs := DefsOf(compiled)
	if len(defs) != 2 {
		t.Fatalf("defs = %d", len(defs))
	}
	for _, d := range defs {
		raw, _ := json.Marshal(d)
		if has := strings.Contains(string(raw), `"entities"`); has != (d.ID == "brace") {
			t.Fatalf("%s: entities present = %v in %s", d.ID, has, raw)
		}
		if d.ID == "brace" && strings.Join(d.Entities, ",") != "character,npc" {
			t.Fatalf("brace entities = %v", d.Entities)
		}
	}
}

func TestDefsOfCarriesTheTestsWordsOnlyWhenTheRulesetGivesThem(t *testing.T) {
	label := "Ability check"
	compiled := &engine.CompiledRuleset{Tests: map[string]*engine.CompiledTest{
		"check": {Def: &engine.Test{
			Kind: "sumVsTarget", Dice: "1d20", Inputs: map[string]string{"ability": "text"}, Label: &label,
			InputLabels:       map[string]string{"ability": "Ability"},
			InputOptionLabels: map[string]map[string]string{"ability": {"str": "Strength"}},
		}},
		"bare": {Def: &engine.Test{Kind: "sumVsTarget", Dice: "1d20"}},
	}}
	for _, d := range DefsOf(compiled) {
		raw, _ := json.Marshal(d)
		worded := d.ID == "check"
		for _, key := range []string{`"label"`, `"inputLabels"`, `"inputOptionLabels"`} {
			if strings.Contains(string(raw), key) != worded {
				t.Fatalf("%s: %s present = %v in %s", d.ID, key, !worded, raw)
			}
		}
		if worded && (d.Label != label || d.InputLabels["ability"] != "Ability" ||
			d.InputOptionLabels["ability"]["str"] != "Strength") {
			t.Fatalf("check words = %s", raw)
		}
	}
}
