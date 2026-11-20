package coreschema

import (
	"context"
	"reflect"
)

// NoticeParams is the params each notice code carries (packages/core-schema/src/actions.ts NOTICE_PARAMS, held equal by
// the vectors): `poolFull` is the platform's own line, `rule` a ruleset's (house decision #79).
var NoticeParams = map[string][]string{
	"poolFull": {"pool", "lost"},
	"rule":     {"rule", "name"},
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
