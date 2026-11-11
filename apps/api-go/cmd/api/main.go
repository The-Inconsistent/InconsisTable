// Command api is the Go api, not deployed yet (docs/adr/0008-go-api.md).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func run() error {
	if err := core.CheckAdminKey(os.Getenv("ADMIN_KEY")); err != nil {
		return err
	}
	ctx := context.Background()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	db, err := core.Open(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := core.RunMigrations(ctx, db, env("MIGRATIONS_DIR", "../api/drizzle")); err != nil {
		return err
	}

	authService := &auth.Service{DB: db}
	rooms := &campaign.Service{DB: db, Auth: authService}

	mux := http.NewServeMux()
	// For the platform's restart check. Unauthenticated; answers 200 or 503 and never says why.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			core.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"statusCode": 503, "message": "Service Unavailable"})
		}
	})
	mux.Handle("POST /api/campaigns", core.Serve(rooms.Create))
	mux.Handle("GET /api/lobby", core.Serve(rooms.Lobby))
	mux.Handle("PATCH /api/me", core.Serve(rooms.Rename))
	mux.Handle("GET /api/campaigns/{id}/me", core.Serve(rooms.Me))
	mux.Handle("POST /api/join", core.Serve(rooms.Join))
	mux.Handle("GET /api/guest", core.Serve(rooms.Guest))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		core.WriteJSON(w, http.StatusNotFound, map[string]any{
			"statusCode": 404, "error": "Not Found", "message": "Cannot " + r.Method + " " + r.URL.Path,
		})
	})

	address := ":" + env("PORT", "4000")
	log.Printf("listening on %s", address)
	return http.ListenAndServe(address, guarded(mux))
}

func under(path string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

var campaignRules = regexp.MustCompile(`^/api/campaigns/[^/]+/rules`)

// guarded puts the limits and the CSRF check in front of every route, before any body is read, so a flood is refused
// cheaply. The order and numbers are apps/api/src/main.ts's.
func guarded(next http.Handler) http.Handler {
	// The unauthenticated door: 60/min leaves room for a whole table of phones behind one NAT.
	door := core.NewLimiter(60, time.Minute)
	// Signing in and out, /api/auth/me and the provider's back-channel logout.
	signIn := core.NewLimiter(60, time.Minute)
	// ponytail: per-IP window; key it by the device user once imports and the library land.
	signedIn := core.NewLimiter(120, time.Minute)
	// Admin-key REST calls, right or wrong key alike, so the key can't be guessed at speed.
	adminKey := core.NewLimiter(20, time.Minute)
	// ponytail: per-IP like the rest; per user once the limiter is keyed by device user.
	imports := core.NewLimiter(20, time.Minute)
	webOrigins := core.WebOrigins(os.Getenv("WEB_ORIGIN"))

	tooMany := func(w http.ResponseWriter, message string) {
		core.WriteJSON(w, http.StatusTooManyRequests, map[string]string{"message": message})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, ip := r.URL.Path, core.ClientIP(r)
		const slowDown = "Too many requests. Wait a minute."
		if under(path, "/api/join", "/api/guest", "/api/invites") && !door.Allow(ip) {
			tooMany(w, slowDown)
			return
		}
		if under(path, "/api/auth") && !signIn.Allow(ip) {
			tooMany(w, slowDown)
			return
		}
		if (under(path, "/api/lobby", "/api/me", "/api/admin", "/api/rulesets", "/api/packs") || campaignRules.MatchString(path)) && !signedIn.Allow(ip) {
			tooMany(w, slowDown)
			return
		}
		if under(path, "/api") && r.Header.Get("X-Admin-Key") != "" && !adminKey.Allow(ip) {
			tooMany(w, slowDown)
			return
		}
		if under(path, "/api/rulesets", "/api/packs") && r.Method == http.MethodPost && !imports.Allow(ip) {
			tooMany(w, "Too many imports. Wait a minute.")
			return
		}
		if core.CrossSiteWrite(r, webOrigins) {
			core.WriteJSON(w, http.StatusForbidden, map[string]string{"message": "Cross-site request refused."})
			return
		}
		next.ServeHTTP(w, r)
	})
}
