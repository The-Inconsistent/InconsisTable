package admin

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// The users routes need the key before they touch anything: none is 401, a wrong one 403 (house decision #94).
func TestTheUsersRoutesNeedTheKey(t *testing.T) {
	t.Setenv("ADMIN_KEY", "k-0123456789abcdef0123456789abcdef")
	s := &Service{} // no database: a refused call never reaches it
	routes := map[string]func(http.ResponseWriter, *http.Request) (any, error){"users": s.Users, "seats": s.RemoveSeats}
	for name, route := range routes {
		for key, want := range map[string]int{"": http.StatusUnauthorized, "wrong": http.StatusForbidden} {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if key != "" {
				r.Header.Set("X-Admin-Key", key)
			}
			_, err := route(httptest.NewRecorder(), r)
			var refusal *core.HTTPError
			if !errors.As(err, &refusal) || refusal.Status != want {
				t.Errorf("%s with key %q: want %d, got %v", name, key, want, err)
			}
		}
	}
}
