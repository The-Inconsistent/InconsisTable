package coreschema

import (
	"context"
	"reflect"
	"strings"
)

// NoticeParams is the params each notice code carries (packages/core-schema/src/actions.ts NOTICE_PARAMS, held equal by
// the vectors): `poolFull` and `restSkipped` are the platform's own lines, `rule` a ruleset's (house decision #79).
var NoticeParams = map[string][]string{
	"poolFull":    {"pool", "lost"},
	"restSkipped": {"names", "count"},
	"rule":        {"rule", "name"},
	// sessionDeleted: what the session awarded stays with the characters (house decision #85).
	"sessionDeleted": {"number"},
	// sceneBegun and revealSkipped answer scene.begin (house decision #86).
	"sceneBegun":    {"title", "revealed"},
	"revealSkipped": {"line", "reason"},
	// conditionSkipped answers table.apply (house decision #87).
	"conditionSkipped": {"name", "condition"},
	// shockSkipped answers table.apply: the shock of a hit its target never takes (house decision #163).
	"shockSkipped": {"name", "shock"},
	// extraRolls answers table.apply: a granted record tells the GM to roll that many more (house decision #191).
	"extraRolls": {"entry", "count"},
	// advanced answers campaign.setField raising the field an advance follows (house decision #96).
	"advanced": {"field", "from", "to", "steps"},
}

// SceneBegun is the notice that a scene began and revealed that many entries.
func SceneBegun(title string, revealed int) Notice {
	return Notice{Code: "sceneBegun", Params: Params{"title": title, "revealed": revealed}}
}

// RevealSkipped is the notice that a scene's reveal line (its label or id) was not sent, with the refusal's code.
func RevealSkipped(line, reason string) Notice {
	return Notice{Code: "revealSkipped", Params: Params{"line": line, "reason": reason}}
}

// Notice is one line an accepted action's answer tells the seat that sent it, and no one else. Text is a ruleset's
// own words, the actor's name filled in; the screen words the platform's codes itself.
type Notice struct {
	Code   string `json:"code"`
	Params Params `json:"params"`
	Text   string `json:"text,omitempty"`
}

// PoolFull is the notice that a change to a shared pool was clamped at its max: lost is what it could not take.
func PoolFull(label string, lost float64) Notice {
	return Notice{Code: "poolFull", Params: Params{"pool": label, "lost": lost}}
}

// RestSkipped is the notice that a rest of everyone left out the actors its ruleset refuses that rest in their health
// state (house decision #81): names in name order, joined with ", ".
func RestSkipped(names []string) Notice {
	return Notice{Code: "restSkipped", Params: Params{"names": strings.Join(names, ", "), "count": len(names)}}
}

// SessionDeleted is the notice that session number was deleted.
func SessionDeleted(number int) Notice {
	return Notice{Code: "sessionDeleted", Params: Params{"number": number}}
}

// ShockSkipped is the notice that a lookup left out the shock of a hit its target never takes (house decision #163).
func ShockSkipped(name, shock string) Notice {
	return Notice{Code: "shockSkipped", Params: Params{"name": name, "shock": shock}}
}

// ConditionSkipped is the notice that a lookup left out a condition its target is immune to (house decision #87).
func ConditionSkipped(name, condition string) Notice {
	return Notice{Code: "conditionSkipped", Params: Params{"name": name, "condition": condition}}
}

// Advanced is the notice that the field an advance follows was raised by hand from one value to another: that many
// steps, each read as an advance (house decision #96).
func Advanced(field string, from, to float64) Notice {
	return Notice{Code: "advanced", Params: Params{"field": field, "from": from, "to": to, "steps": to - from}}
}

// RuleNotice is a ruleset's notice rule raised for one actor.
func RuleNotice(rule, name, text string) Notice {
	return Notice{Code: "rule", Params: Params{"rule": rule, "name": name}, Text: text}
}

type noticesKey struct{}

// WithNotices is ctx carrying a list that Notify adds to, for the action it runs: the answer's notices come from
// whichever write raised them, however deep, without every write path returning them.
func WithNotices(ctx context.Context) (context.Context, *[]Notice) {
	list := &[]Notice{}
	return context.WithValue(ctx, noticesKey{}, list), list
}

// Notify adds a notice to the action ctx runs, once; without WithNotices it is dropped.
func Notify(ctx context.Context, n Notice) {
	list, ok := ctx.Value(noticesKey{}).(*[]Notice)
	if !ok {
		return
	}
	for _, had := range *list {
		if reflect.DeepEqual(had, n) {
			return
		}
	}
	*list = append(*list, n)
}

// ExtraRolls is the notice that a granted record asks for that many more rolls on its table (house decision #191).
func ExtraRolls(entry string, count int) Notice {
	return Notice{Code: "extraRolls", Params: Params{"entry": entry, "count": count}}
}
