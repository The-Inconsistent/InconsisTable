package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"
)

// The pure rules of signing in, with no database: the boot config, where a sign-in may return to, what the ID token's
// roles make of an app_user, and the provider's account pages (apps/api/src/auth/sign-in.rules.ts).

const (
	// OIDCTxCookie holds the handle of a sign-in in flight; SessionCookie the session after it.
	OIDCTxCookie = "__Host-it_oidc_tx"
	// CallbackPath is the callback route; the registered redirect URI must end in it.
	CallbackPath = "/api/auth/callback"
	// AccountPage is the web's account page, which the provider's own account pages send the user back to.
	AccountPage = "/account"
	// What the api refuses on its own, beside the SDK's codes: a callback without a live transaction, and a logout
	// token already acted on. Logged, never shown.
	refusedNoTransaction = "no_transaction"
	refusedReplayed      = "replayed"
)

// The web routes a sign-in may land back on (RFC 9700 §4.11.1: the client is no open redirector). Anything else is "/".
var returnTo = regexp.MustCompile(`^/(?:library|admin|account|c/[0-9a-f-]{36})?$`)

// SafeReturnTo is where a sign-in started with value lands: one of the web's own routes, else the lobby.
func SafeReturnTo(value any) string {
	if s, ok := value.(string); ok && returnTo.MatchString(s) {
		return s
	}
	return "/"
}

// UserRoleOf: app_user.role gates starting rooms, so it is creator exactly when the token says so (§8). admin grants
// nothing in this slice; it travels on the session's roles only.
func UserRoleOf(roles []inconsisid.Role) string {
	if slices.Contains(roles, inconsisid.RoleCreator) {
		return "creator"
	}
	return "user"
}

// IdpAccountURL is the provider's account page, themed for this client and sending the user back to the web's
// /account (the provider accepts a return_to only on an origin of the client's registered redirect URIs).
func IdpAccountURL(issuer, clientID, webOrigin string) string {
	u, _ := url.Parse(strings.TrimSuffix(issuer, "/") + "/account")
	q := u.Query()
	q.Set("client", clientID)
	q.Set("return_to", webOrigin+AccountPage)
	u.RawQuery = q.Encode()
	return u.String()
}

// AccountRefusal is how an account API refusal reaches the browser: a status and a refusal code, never the SDK's detail.
func AccountRefusal(code inconsisid.ErrorCode) (status int, key string) {
	switch code {
	case inconsisid.ErrAccountNotFound:
		return http.StatusNotFound, "accountNotFound"
	case inconsisid.ErrDisplayNameInvalid:
		return http.StatusBadRequest, "displayNameInvalid"
	}
	return http.StatusBadGateway, "accountUnavailable"
}

// SignInConfig is the client's registration at the identity provider, and the web origin the callback lands on (the
// login POST must come from it: its cookies are set for that origin).
type SignInConfig struct {
	Issuer, ClientID, RedirectURI, PostLogoutRedirectURI, WebOrigin string
	// PrivateJWK is the client's private ES256 key as JSON, holding only the members the SDK reads.
	PrivateJWK []byte
}

// Options is the SDK's view of the config.
func (c *SignInConfig) Options() inconsisid.Options {
	return inconsisid.Options{
		Issuer: c.Issuer, ClientID: c.ClientID, PrivateJWK: c.PrivateJWK,
		RedirectURI: c.RedirectURI, PostLogoutRedirectURI: c.PostLogoutRedirectURI,
	}
}

var (
	truthy   = []string{"true", "1", "yes", "on", "y", "enabled"}
	falsy    = []string{"false", "0", "no", "off", "n", "disabled"}
	loopback = []string{"localhost", "127.0.0.1", "::1"}
)

// stringBool is zod's z.stringbool().default(false). An empty value reads as unset.
func stringBool(name, value string) (bool, error) {
	v := strings.ToLower(value)
	switch {
	case v == "" || slices.Contains(falsy, v):
		return false, nil
	case slices.Contains(truthy, v):
		return true, nil
	}
	return false, fmt.Errorf("%s must be one of %s", name, strings.Join(append(slices.Clone(truthy), falsy...), ", "))
}

// absoluteURL stands in for z.url(): a scheme and a host.
func absoluteURL(value string) (*url.URL, bool) {
	u, err := url.Parse(strings.TrimSpace(value))
	return u, err == nil && u.Scheme != "" && u.Host != ""
}

// origin is the URL's origin as WHATWG URL prints it: lowercase host, default port left out.
func origin(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" && !(u.Scheme == "https" && port == "443") && !(u.Scheme == "http" && port == "80") {
		host += ":" + port
	}
	return u.Scheme + "://" + host
}

// Accounts exist only on HTTPS deployments (house decision #33). Plain http is allowed only for a loopback host, with
// IDP_DEV_HTTP=1 and outside production: browsers keep Secure cookies on http://localhost, nowhere else.
func httpProblem(u *url.URL, raw string, devHTTP, production bool) error {
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" && devHTTP && !production && slices.Contains(loopback, strings.ToLower(u.Hostname())) {
		return nil
	}
	return fmt.Errorf("%s must be https (http only for localhost, with IDP_DEV_HTTP=1, outside production)", raw)
}

// LoadSignInConfig is read once at boot. Sign-in is off (nil) unless IDP_SIGN_IN is set; once on, a missing or unsafe
// value refuses to boot.
func LoadSignInConfig(getenv func(string) string) (*SignInConfig, error) {
	on, err := stringBool("IDP_SIGN_IN", getenv("IDP_SIGN_IN"))
	if err != nil {
		return nil, err
	}
	devHTTP, err := stringBool("IDP_DEV_HTTP", getenv("IDP_DEV_HTTP"))
	if err != nil {
		return nil, err
	}
	// z.url() hands back the value trimmed.
	issuer, redirectURI := strings.TrimSpace(getenv("IDP_ISSUER")), strings.TrimSpace(getenv("IDP_REDIRECT_URI"))
	clientID, jwkFile := getenv("IDP_CLIENT_ID"), getenv("IDP_CLIENT_JWK_FILE")
	// The shape checks run whether or not sign-in is on, as zod parses the whole environment first.
	for name, value := range map[string]string{"IDP_ISSUER": issuer, "IDP_REDIRECT_URI": redirectURI} {
		if _, ok := absoluteURL(value); value != "" && !ok {
			return nil, fmt.Errorf("%s must be a URL", name)
		}
	}
	if len(clientID) > 200 {
		return nil, fmt.Errorf("IDP_CLIENT_ID must be at most 200 characters")
	}
	if !on {
		return nil, nil
	}
	if issuer == "" || clientID == "" || redirectURI == "" || jwkFile == "" {
		return nil, fmt.Errorf("IDP_SIGN_IN=1 needs IDP_ISSUER, IDP_CLIENT_ID, IDP_REDIRECT_URI and IDP_CLIENT_JWK_FILE")
	}
	production := getenv("NODE_ENV") == "production"
	issuerURL, _ := absoluteURL(issuer)
	redirect, _ := absoluteURL(redirectURI)
	if err := httpProblem(issuerURL, issuer, devHTTP, production); err != nil {
		return nil, err
	}
	if err := httpProblem(redirect, redirectURI, devHTTP, production); err != nil {
		return nil, err
	}
	if redirect.Path != CallbackPath || redirect.RawQuery != "" {
		return nil, fmt.Errorf("IDP_REDIRECT_URI must be <web origin>%s", CallbackPath)
	}
	raw, err := os.ReadFile(jwkFile)
	var file map[string]any
	if err == nil {
		err = json.Unmarshal(raw, &file)
	}
	if err != nil {
		return nil, fmt.Errorf("IDP_CLIENT_JWK_FILE %s is missing or not JSON: %w", jwkFile, err)
	}
	// The client's private ES256 key, checked here so a bad file refuses to boot; only these members go to the SDK.
	jwk := map[string]string{}
	for _, member := range []string{"kty", "crv", "kid", "x", "y", "d"} {
		s, ok := file[member].(string)
		if !ok || s == "" {
			return nil, fmt.Errorf("IDP_CLIENT_JWK_FILE %s is not a private ES256 JWK", jwkFile)
		}
		jwk[member] = s
	}
	if jwk["kty"] != "EC" || jwk["crv"] != "P-256" {
		return nil, fmt.Errorf("IDP_CLIENT_JWK_FILE %s is not a private ES256 JWK", jwkFile)
	}
	privateJWK, _ := json.Marshal(jwk)
	webOrigin := origin(redirect)
	return &SignInConfig{
		Issuer: issuer, ClientID: clientID, RedirectURI: redirectURI,
		PostLogoutRedirectURI: webOrigin + "/", WebOrigin: webOrigin, PrivateJWK: privateJWK,
	}, nil
}
