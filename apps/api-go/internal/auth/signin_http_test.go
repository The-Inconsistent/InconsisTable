package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// The routes' answers that need neither the database nor the provider: what sign-in off serves, and the refusals made
// before either is asked.

func serve(h core.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	core.Serve(h).ServeHTTP(w, r)
	return w
}

func TestWithSignInOffTheFlowRoutesAre404(t *testing.T) {
	off := &SignInRoutes{}
	for name, h := range map[string]core.Handler{
		"login": off.Login, "callback": off.Callback, "backchannel": off.BackchannelLogout, "account": off.Account,
		"rename": off.RenameAccount,
	} {
		w := serve(h, httptest.NewRequest(http.MethodPost, "/", nil))
		if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), `"message":"Not Found"`) {
			t.Errorf("%s: got %d %s", name, w.Code, w.Body)
		}
	}
}

func TestSignInRefusalsBeforeTheProviderIsAsked(t *testing.T) {
	on := &SignInRoutes{Flows: &Flows{Config: SignInConfig{WebOrigin: "https://app.example.test"}}}

	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader("returnTo=%2Flibrary"))
	login.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	login.Header.Set("Origin", "http://192.168.1.86:3000")
	if w := serve(on.Login, login); w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/?signin=failed" {
		t.Errorf("a login from another origin: got %d %s", w.Code, w.Header().Get("Location"))
	}

	w := serve(on.Callback, httptest.NewRequest(http.MethodGet, "/api/auth/callback?code=c&state=s", nil))
	cookie := w.Header().Get("Set-Cookie")
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/?signin=failed" ||
		!strings.HasPrefix(cookie, OIDCTxCookie+"=;") || !strings.Contains(cookie, "Secure") || !strings.Contains(cookie, "HttpOnly") {
		t.Errorf("a callback without a transaction: got %d %s %q", w.Code, w.Header().Get("Location"), cookie)
	}

	for _, body := range []string{"", "logout_token=", "logout_token=a&logout_token=b", "logout_token=" + strings.Repeat("a", 8001)} {
		r := httptest.NewRequest(http.MethodPost, "/api/auth/backchannel-logout", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := serve(on.BackchannelLogout, r)
		if w.Code != http.StatusBadRequest || w.Header().Get("Cache-Control") != "no-store" || w.Body.String() != "Bad Request" {
			t.Errorf("%.30q: got %d %q %q", body, w.Code, w.Header().Get("Cache-Control"), w.Body)
		}
	}
	big := httptest.NewRequest(http.MethodPost, "/api/auth/backchannel-logout", strings.NewReader("logout_token="+strings.Repeat("a", maxForm)))
	big.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if w := serve(on.BackchannelLogout, big); w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("a form over 16 KB: got %d", w.Code)
	}
}
