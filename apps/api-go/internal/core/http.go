package core

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// MaxBody is the default limit on a JSON body, as express's json() had.
const MaxBody = 100 * 1024

// HTTPError is a response with a status and a JSON body.
type HTTPError struct {
	Status int
	Body   any
}

func (e *HTTPError) Error() string { return fmt.Sprintf("%d", e.Status) }

// Refuse makes a refusal with a status: what the web reads on a failed REST call.
func Refuse(status int, code string, params ...coreschema.Params) *HTTPError {
	var p coreschema.Params
	if len(params) > 0 {
		p = params[0]
	}
	return &HTTPError{status, coreschema.RefusalBody(code, p)}
}

// Handler is a route that returns its JSON result, or an error for the response. A nil result is an empty 200.
type Handler func(w http.ResponseWriter, r *http.Request) (any, error)

// Serve turns a Handler into an http.Handler. A refusal from a service becomes a 400 with its body; anything else
// unknown is logged and answered with a generic 500, never a stack trace.
func Serve(h Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				log.Printf("panic in %s %s: %v", r.Method, r.URL.Path, p)
				WriteJSON(w, http.StatusInternalServerError, map[string]any{"statusCode": 500, "message": "Internal server error"})
			}
		}()
		result, err := h(w, r)
		var httpErr *HTTPError
		var refusal *coreschema.Error
		switch {
		case err == nil && result == nil:
			w.WriteHeader(http.StatusOK)
		case err == nil:
			WriteJSON(w, http.StatusOK, result)
		case errors.As(err, &httpErr):
			WriteJSON(w, httpErr.Status, httpErr.Body)
		case errors.As(err, &refusal):
			WriteJSON(w, http.StatusBadRequest, coreschema.RefusalBody(refusal.Code, refusal.Params))
		default:
			log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
			WriteJSON(w, http.StatusInternalServerError, map[string]any{"statusCode": 500, "message": "Internal server error"})
		}
	}
}

// WriteJSON writes one JSON response.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("writing a response: %v", err)
	}
}

// ReadBody decodes a JSON body, up to limit bytes. A request that is not JSON has an empty object as its body, as it
// had behind express's json(), so the schema is what refuses it.
func ReadBody(w http.ResponseWriter, r *http.Request, limit int64) (any, error) {
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		return map[string]any{}, nil
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return nil, &HTTPError{http.StatusRequestEntityTooLarge, map[string]any{"statusCode": 413, "message": "request entity too large"}}
	}
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var body any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, &HTTPError{http.StatusBadRequest, map[string]any{"statusCode": 400, "error": "Bad Request", "message": "Malformed JSON"}}
	}
	// express's json() takes only objects and arrays.
	switch body.(type) {
	case map[string]any, []any:
		return body, nil
	}
	return nil, &HTTPError{http.StatusBadRequest, map[string]any{"statusCode": 400, "error": "Bad Request", "message": "Malformed JSON"}}
}

// Parse reads a value with a schema, refusing with the schema's own words.
func Parse(s schema.Schema, value any) (any, error) {
	out, issues := schema.Parse(s, value)
	if len(issues) > 0 {
		return nil, Refuse(http.StatusBadRequest, "badRequest", coreschema.Params{"detail": schema.Prettify(issues)})
	}
	return out, nil
}

// ParseBody reads the request's JSON body with a schema, into a decoded object.
func ParseBody(w http.ResponseWriter, r *http.Request, s schema.Schema) (map[string]any, error) {
	body, err := ReadBody(w, r, MaxBody)
	if err != nil {
		return nil, err
	}
	out, err := Parse(s, body)
	if err != nil {
		return nil, err
	}
	return out.(map[string]any), nil
}

// ISOTime is JavaScript's toISOString, which clients parse.
func ISOTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// IsAdminKey compares the admin key (scripts only) in constant time. With ADMIN_KEY unset, the admin path is off.
func IsAdminKey(key string) bool {
	expected := os.Getenv("ADMIN_KEY")
	return expected != "" && key != "" && subtle.ConstantTimeCompare([]byte(key), []byte(expected)) == 1
}

const minAdminKeyLength = 32

// CheckAdminKey refuses to boot on a short or placeholder admin key: it grants full admin over every campaign.
func CheckAdminKey(key string) error {
	if key != "" && (len(key) < minAdminKeyLength || key == "change-me") {
		return fmt.Errorf(`ADMIN_KEY must be at least %d characters and not "change-me"`, minAdminKeyLength)
	}
	return nil
}

// CookieSecure says whether the guest seat cookie is Secure: everywhere but local development and tests.
func CookieSecure() bool {
	env := os.Getenv("NODE_ENV")
	return env != "development" && env != "test"
}

var safeMethods = []string{http.MethodGet, http.MethodHead, http.MethodOptions}

// csrfExempt: the identity provider calls it server to server, with no cookie; the logout token is its proof.
const csrfExempt = "/api/auth/backchannel-logout"

// CrossSiteWrite: a write needs Sec-Fetch-Site: same-origin, or, from a client that sends no Fetch Metadata, an Origin
// among WEB_ORIGIN. same-site is not enough: auth.<domain> and app2.<domain> share a site. A non-browser client can send
// these headers, but it carries no victim's cookies, which is what CSRF abuses.
func CrossSiteWrite(r *http.Request, webOrigins []string) bool {
	if slices.Contains(safeMethods, r.Method) || r.URL.Path == csrfExempt {
		return false
	}
	if site := r.Header.Values("Sec-Fetch-Site"); len(site) > 0 {
		return site[0] != "same-origin"
	}
	origin := r.Header.Values("Origin")
	return len(origin) == 0 || !slices.Contains(webOrigins, origin[0])
}

// WebOrigins splits WEB_ORIGIN, which may list several origins (localhost and the LAN address).
func WebOrigins(value string) []string {
	var out []string
	for _, origin := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

const maxLimiterKeys = 10_000

type limiterWindow struct {
	hits  int
	reset time.Time
}

// Limiter is a fixed-window rate limit per key.
//
// ponytail: in-process, assumes one api instance; Redis or pg counters if we ever scale out.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*limiterWindow
	swept  time.Time
	now    func() time.Time
}

// NewLimiter makes a limiter of max hits per window.
func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string]*limiterWindow{}, now: time.Now}
}

// Allow counts one hit. Past the key cap a new key is refused (fail closed) until the windows expire.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if h, ok := l.hits[key]; ok && now.Before(h.reset) {
		h.hits++
		return h.hits <= l.max
	}
	if len(l.hits) >= maxLimiterKeys {
		// Bounded memory: drop expired windows, at most once per window; still full means a flood.
		if now.Sub(l.swept) >= l.window {
			l.swept = now
			for k, h := range l.hits {
				if !now.Before(h.reset) {
					delete(l.hits, k)
				}
			}
		}
		if _, known := l.hits[key]; !known && len(l.hits) >= maxLimiterKeys {
			return false
		}
	}
	l.hits[key] = &limiterWindow{1, now.Add(l.window)}
	return true
}

// ClientIP is the caller's IP. CF-Connecting-IP is trusted only when TRUST_CF=1, because any client can send it.
//
// ponytail: forgeable by a client that bypasses Cloudflare to hit Pangolin directly; allow only Cloudflare IPs there.
func ClientIP(r *http.Request) string {
	if os.Getenv("TRUST_CF") == "1" {
		if cf := r.Header.Values("Cf-Connecting-Ip"); len(cf) > 0 {
			return cf[0]
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}
