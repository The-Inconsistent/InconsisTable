package engine

import (
	"encoding/json"
	"testing"
)

// JSON.stringify prints negative zero as 0 and Go prints -0, and the vector comparison cannot tell them apart.
func TestNegativeZeroLeavesAsZero(t *testing.T) {
	scope := ValueFromJSON(map[string]any{"zero": 0.0}).(*Record)
	for _, source := range []string{"-zero", "0 * -3", "ceil(-1,2)", "7 % -7"} {
		node, err := ParseExpr(source)
		if err != nil {
			t.Fatal(err)
		}
		value, err := Evaluate(node, scope)
		if err != nil {
			t.Fatal(err)
		}
		text, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if string(text) != "0" {
			t.Errorf("%s printed %s", source, text)
		}
	}
}

func TestRollDiceDefaultsToCryptoRng(t *testing.T) {
	roll, err := RollDice("2d6", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(roll.Faces) != 2 || roll.Total < 2 || roll.Total > 12 {
		t.Errorf("got %+v", roll)
	}
}
