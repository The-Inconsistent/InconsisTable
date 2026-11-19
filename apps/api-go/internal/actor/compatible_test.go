package actor

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

func compile(t *testing.T, fields, resources, conditions string) *engine.CompiledRuleset {
	t.Helper()
	var m any
	doc := `{"id": "unit", "version": "0.1.0", "core": "^0.1.0",
		"sources": [{"id": "s", "title": "Unit", "license": "private"}],
		"entities": [{"id": "hero", "label": "Hero", "base": "actor", "fields": ` + fields + `}],
		"resources": ` + resources + `, "conditions": ` + conditions + `,
		"health": {"tracks": [], "states": []}}`
	if err := json.Unmarshal([]byte(doc), &m); err != nil {
		t.Fatal(err)
	}
	c, problems := engine.CompileRuleset(m)
	if len(problems) > 0 {
		t.Fatalf("%v", problems)
	}
	return c
}

func TestIncompatibleReadsStoredValuesUnderTheNewVersion(t *testing.T) {
	level := `"level": {"type": "int", "label": "L", "min": 1, "max": 20, "visibility": "party"}`
	hp := `[{"id": "hp", "label": "HP", "cite": "U p.1", "scope": "entity", "max": "9", "visibility": "party"}]`
	stun := `[{"id": "stun", "label": "Stun", "duration": "manual", "cite": "U p.2", "effects": []}]`
	old := compile(t, `{`+level+`}`, hp, stun)
	five, nine := int32(5), int32(9)
	rows := func(level *int32) []Rows {
		return []Rows{{
			Actor:      Row{Name: "Ada", EntityType: "hero"},
			Fields:     []FieldRow{{FieldID: "level", Int: level}, {FieldID: "engineOwned", Int: &five}},
			Resources:  []ResourceRow{{ResourceID: "hp", Value: 99}},
			Conditions: []ConditionRow{{ConditionID: "stun"}},
		}, {Actor: Row{Name: "Npc"}}}
	}
	if got := Incompatible(old, old, rows(&five)); len(got) != 0 {
		t.Fatalf("same version: %v", got)
	}
	lowered := compile(t, `{"level": {"type": "int", "label": "L", "min": 1, "max": 4, "visibility": "party"}}`, hp, `[]`)
	want := []string{`Ada: condition "stun" is gone`, `Ada: field "level": above the maximum of 4`}
	if got := Incompatible(old, lowered, rows(&nine)); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
	bare := compile(t, `{}`, `[]`, `[]`)
	want = []string{`Ada: condition "stun" is gone`, `Ada: field "level" is gone`, `Ada: resource "hp" is gone`}
	if got := Incompatible(old, bare, rows(&five)); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
}
