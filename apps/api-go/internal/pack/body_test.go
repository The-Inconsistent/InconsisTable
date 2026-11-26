package pack

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

func TestLoneSurrogate(t *testing.T) {
	for _, c := range []struct {
		name, raw string
		lone      bool
	}{
		{"plain text", `{"a":"b"}`, false},
		{"a valid pair", `{"a":"😀"}`, false},
		{"a pair in upper case", `{"a":"😀"}`, false},
		{"a high surrogate alone", `{"a":"\ud800"}`, true},
		{"a low surrogate alone", `{"a":"\udc00"}`, true},
		{"a high surrogate before text", `{"a":"\ud83dx"}`, true},
		{"a high surrogate before another high one", `{"a":"\ud83d😀"}`, true},
		{"a low surrogate then a high one", `{"a":"\ude00\ud83d"}`, true},
		{"in a key", `{"\ud800":1}`, true},
		{"an escaped backslash before u", `{"a":"\\ud800"}`, false},
		{"an escaped backslash, then a real escape", `{"a":"\\\ud800"}`, true},
		{"a non-surrogate escape", `{"a":"é퟿"}`, false},
	} {
		if _, got := LoneSurrogate([]byte(c.raw)); got != c.lone {
			t.Errorf("%s: LoneSurrogate(%s) = %v, want %v", c.name, c.raw, got, c.lone)
		}
	}
}

func post(body string) (*httptest.ResponseRecorder, *http.Request) {
	r := httptest.NewRequest(http.MethodPost, "/api/packs", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return httptest.NewRecorder(), r
}

func TestImportBodyRefusesALoneSurrogate(t *testing.T) {
	w, r := post(`{"ruleset":{"id":"sample-d20"},"entries":[{"name":"\ud800"}]}`)
	_, err := ReadBody(w, r, false)
	var refused *ruleset.Refused
	if !errors.As(err, &refused) || len(refused.Problems) != 1 {
		t.Fatalf("a lone surrogate must be refused as an import problem, got %v", err)
	}
	// The same text with a valid pair goes through, whole.
	w, r = post(`{"name":"😀"}`)
	body, err := ReadBody(w, r, false)
	if err != nil || body.(map[string]any)["name"] != "\U0001F600" {
		t.Fatalf("a valid pair must decode, got %v, %v", body, err)
	}
}

func TestPackBodyKeepsKeyOrder(t *testing.T) {
	w, r := post(`{"b":1,"a":{"z":1,"y":2}}`)
	body, err := ReadBody(w, r, true)
	o, ok := body.(*schema.Obj)
	if err != nil || !ok || !slices.Equal(o.Keys(), []string{"b", "a"}) {
		t.Fatalf("a pack body must decode in its order, got %v, %v", body, err)
	}
	w, r = post(`{"a":1} x`)
	if _, err := ReadBody(w, r, true); err == nil {
		t.Error("text after the value must be refused")
	}
}
