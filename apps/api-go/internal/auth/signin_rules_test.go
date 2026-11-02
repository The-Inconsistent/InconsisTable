package auth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
)

// apps/api/src/auth/sign-in.rules.test.ts and the pure half of account.service.test.ts.

func envOf(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func with(base map[string]string, changes ...string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for i := 0; i < len(changes); i += 2 {
		out[changes[i]] = changes[i+1]
	}
	return out
}

func keyFiles(t *testing.T) (key, bad string) {
	dir := t.TempDir()
	key, bad = filepath.Join(dir, "key.json"), filepath.Join(dir, "bad.json")
	if err := os.WriteFile(key, []byte(`{"kty":"EC","crv":"P-256","kid":"k1","x":"x","y":"y","d":"d","alg":"ES256"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad, []byte(`{"kty":"EC","crv":"P-256","kid":"k1","x":"x","y":"y"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return key, bad
}

func signInEnvs(t *testing.T) (on, dev map[string]string, bad string) {
	key, bad := keyFiles(t)
	on = map[string]string{
		"IDP_SIGN_IN":         "1",
		"IDP_ISSUER":          "https://auth.example.test",
		"IDP_CLIENT_ID":       "inconsistable",
		"IDP_REDIRECT_URI":    "https://app.example.test/api/auth/callback",
		"IDP_CLIENT_JWK_FILE": key,
	}
	dev = with(on, "IDP_DEV_HTTP", "1", "IDP_ISSUER", "http://localhost:4100", "IDP_REDIRECT_URI", "http://localhost:3000/api/auth/callback")
	return on, dev, bad
}

func refusesToBoot(t *testing.T, env map[string]string, want string) {
	t.Helper()
	config, err := LoadSignInConfig(envOf(env))
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Errorf("want a refusal with %q, got %v %v", want, config, err)
	}
}

func TestSignInIsOffUnlessIDPSignInIsSet(t *testing.T) {
	on, _, _ := signInEnvs(t)
	for _, env := range []map[string]string{{}, with(on, "IDP_SIGN_IN", "0"), with(on, "IDP_SIGN_IN", "")} {
		if config, err := LoadSignInConfig(envOf(env)); config != nil || err != nil {
			t.Errorf("%v: want off, got %v %v", env["IDP_SIGN_IN"], config, err)
		}
	}
	refusesToBoot(t, with(on, "IDP_SIGN_IN", "maybe"), "IDP_SIGN_IN must be one of")
}

func TestAnHTTPSDeploymentLoads(t *testing.T) {
	on, _, _ := signInEnvs(t)
	config, err := LoadSignInConfig(envOf(on))
	if err != nil || config == nil {
		t.Fatalf("want a config, got %v", err)
	}
	if config.WebOrigin != "https://app.example.test" || config.PostLogoutRedirectURI != "https://app.example.test/" {
		t.Errorf("web origin %q, post-logout URI %q", config.WebOrigin, config.PostLogoutRedirectURI)
	}
	var jwk map[string]string
	if err := json.Unmarshal(config.PrivateJWK, &jwk); err != nil {
		t.Fatal(err)
	}
	keys := []string{}
	for k := range jwk {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"crv", "d", "kid", "kty", "x", "y"}) {
		t.Errorf("the key reaches the SDK with %v", keys)
	}
}

func TestOnceOnAMissingValueABadKeyOrAWrongCallbackRefusesToBoot(t *testing.T) {
	on, _, bad := signInEnvs(t)
	refusesToBoot(t, with(on, "IDP_ISSUER", ""), "needs IDP_ISSUER")
	refusesToBoot(t, with(on, "IDP_CLIENT_JWK_FILE", filepath.Join(t.TempDir(), "missing.json")), "missing or not JSON")
	refusesToBoot(t, with(on, "IDP_CLIENT_JWK_FILE", bad), "not a private ES256 JWK")
	refusesToBoot(t, with(on, "IDP_REDIRECT_URI", "https://app.example.test/callback"), "must be")
	refusesToBoot(t, with(on, "IDP_REDIRECT_URI", "https://app.example.test/api/auth/callback?x=1"), "must be")
	refusesToBoot(t, with(on, "IDP_ISSUER", "not a url"), "IDP_ISSUER must be a URL")
}

func TestPlainHTTPOnlyForLocalhostWithDevHTTPNeverInProduction(t *testing.T) {
	on, dev, _ := signInEnvs(t)
	if config, err := LoadSignInConfig(envOf(dev)); err != nil || config.WebOrigin != "http://localhost:3000" {
		t.Errorf("dev: %v %v", config, err)
	}
	refusesToBoot(t, with(dev, "IDP_DEV_HTTP", ""), "must be https")
	refusesToBoot(t, with(dev, "NODE_ENV", "production"), "must be https")
	refusesToBoot(t, with(dev, "IDP_REDIRECT_URI", "http://192.168.1.86:3000/api/auth/callback"), "must be https")
	refusesToBoot(t, with(on, "IDP_ISSUER", "http://auth.example.test"), "must be https")
}

func TestTheWebOriginIsTheRedirectURIsOrigin(t *testing.T) {
	on, _, _ := signInEnvs(t)
	config, err := LoadSignInConfig(envOf(with(on, "IDP_REDIRECT_URI", "https://APP.example.test:443/api/auth/callback")))
	if err != nil || config.WebOrigin != "https://app.example.test" {
		t.Errorf("want the default port left out and the host lowercased, got %v %v", config, err)
	}
}

func TestReturnToIsOneOfTheWebsOwnRoutesElseTheLobby(t *testing.T) {
	for _, good := range []string{"/", "/library", "/admin", "/account", "/c/0199f0c8-1d2e-7a3b-9c4d-5e6f7a8b9c0d"} {
		if got := SafeReturnTo(good); got != good {
			t.Errorf("%q: got %q", good, got)
		}
	}
	for _, bad := range []any{"//evil.example", "/evil.example", `/\evil.example`, "https://evil.example", "/library/../x",
		"", "/c/x", "/library\n", 7, nil} {
		if got := SafeReturnTo(bad); got != "/" {
			t.Errorf("%v: got %q", bad, got)
		}
	}
}

func TestAppUserRoleIsCreatorExactlyWhenTheTokenSaysCreator(t *testing.T) {
	admin, creator := inconsisid.RoleAdmin, inconsisid.RoleCreator
	for _, c := range []struct {
		roles []inconsisid.Role
		want  string
	}{{nil, "user"}, {[]inconsisid.Role{creator}, "creator"}, {[]inconsisid.Role{admin}, "user"}, {[]inconsisid.Role{admin, creator}, "creator"}} {
		if got := UserRoleOf(c.roles); got != c.want {
			t.Errorf("%v: want %s, got %s", c.roles, c.want, got)
		}
	}
}

func TestAnAnonymousDeviceCreatesOnlyWhileSignInIsOff(t *testing.T) {
	for _, c := range []struct {
		role   string
		signIn bool
		want   bool
	}{{"creator", false, true}, {"user", false, false}, {"creator", true, false}, {"user", true, false}} {
		if got := DeviceCreates(c.role, c.signIn); got != c.want {
			t.Errorf("%s, sign-in %v: want %v, got %v", c.role, c.signIn, c.want, got)
		}
	}
}

func TestTheProvidersAccountPageNamesThisClientAndReturnsToAccount(t *testing.T) {
	u, err := url.Parse(IdpAccountURL("https://auth.example.test/", "inconsistable", "https://app.example.test"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme+"://"+u.Host+u.Path != "https://auth.example.test/account" || u.Query().Get("client") != "inconsistable" ||
		u.Query().Get("return_to") != "https://app.example.test/account" {
		t.Errorf("got %s", u)
	}
	if SafeReturnTo("/account") != "/account" {
		t.Error("a sign-in started on the account page lands back on it")
	}
}

func TestAnSDKRefusalBecomesAStatusAndACode(t *testing.T) {
	for code, want := range map[inconsisid.ErrorCode]struct {
		status int
		key    string
	}{
		inconsisid.ErrAccountNotFound:    {http.StatusNotFound, "accountNotFound"},
		inconsisid.ErrDisplayNameInvalid: {http.StatusBadRequest, "displayNameInvalid"},
		inconsisid.ErrAccountAPIFailed:   {http.StatusBadGateway, "accountUnavailable"},
		inconsisid.ErrDiscoveryFailed:    {http.StatusBadGateway, "accountUnavailable"},
	} {
		if status, key := AccountRefusal(code); status != want.status || key != want.key {
			t.Errorf("%s: want %v, got %d %s", code, want, status, key)
		}
	}
}
