package coreschema

import (
	"fmt"
	"regexp"
	"strconv"
)

// Params fill a refusal's {slots}: names and numbers, never markup.
type Params map[string]any

// Body is the refusal as it travels: a socket ack, or the body of a REST error. Message is the English text; the web
// translates by Code.
type Body struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Params  Params `json:"params,omitzero"`
}

var slot = regexp.MustCompile(`\{(\w+)\}`)

func paramText(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

// RefusalMessage fills a code's slots. A slot with no value stays as written.
func RefusalMessage(code string, params Params) string {
	return slot.ReplaceAllStringFunc(refusals[code], func(match string) string {
		if v, ok := params[match[1:len(match)-1]]; ok && v != nil {
			return paramText(v)
		}
		return match
	})
}

// RefusalBody builds the refusal for a code. A code outside the list is a programming error.
func RefusalBody(code string, params Params) Body {
	if _, known := refusals[code]; !known {
		panic("coreschema: unknown refusal " + code)
	}
	return Body{code, RefusalMessage(code, params), params}
}

// Error is a client-facing refusal: the gateway returns its body to the sender, REST as the response body.
type Error struct {
	Code   string
	Params Params
}

func (e *Error) Error() string { return RefusalMessage(e.Code, e.Params) }

// Fail makes the refusal for a code.
func Fail(code string, params ...Params) *Error {
	if len(params) > 0 {
		return &Error{code, params[0]}
	}
	return &Error{Code: code}
}
