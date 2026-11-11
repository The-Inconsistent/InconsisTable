package table

import (
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Every action a client may send runs in Go: none falls through to the serverError of a type without a handler.
func TestEveryActionHasAHandler(t *testing.T) {
	for actionType := range cs.ActionPerms {
		if _, ok := handlers[actionType]; !ok {
			t.Errorf("%s has no handler", actionType)
		}
	}
	for actionType := range handlers {
		if _, ok := cs.ActionPerms[actionType]; !ok {
			t.Errorf("%s has a handler but is no action", actionType)
		}
	}
}
