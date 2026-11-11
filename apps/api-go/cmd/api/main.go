// Command api is the Go api, not deployed yet (docs/adr/0008-go-api.md).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/admin"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/table"
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

	// Read once at boot: a bad config refuses to boot; no config means sign-in is off.
	signInConfig, err := auth.LoadSignInConfig(os.Getenv)
	if err != nil {
		return err
	}

	authService := &auth.Service{DB: db, SignIn: signInConfig != nil}
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

	// The table socket. Like socket.io under Nest it sits beside the REST guards, not behind them: its polling POSTs
	// carry no Fetch Metadata from scripts, and its own door is the handshake (CORS with WEB_ORIGIN, the connect limit,
	// the seat).
	// Admin-key calls, right or wrong key alike, REST and socket handshakes together, so the key can't be guessed at speed.
	adminKey := core.NewLimiter(20, time.Minute)
	gateway := table.NewGateway(db, authService, core.WebOrigins(os.Getenv("WEB_ORIGIN")), adminKey)
	defer gateway.Close()

	// Invites (campaign.controller.ts): accepting one runs in the table's queue and rebroadcasts like an action.
	rooms.Mutate = gateway.Mutate
	mux.Handle("GET /api/invites/{code}", core.Serve(rooms.Invite))
	mux.Handle("POST /api/invites/{code}/accept", core.Serve(rooms.Accept))

	// The owner-scoped library, the admin console, and the rules a seat reads.
	library := &pack.Service{DB: db, Auth: authService}
	console := &admin.Service{DB: db, Table: gateway}
	mux.Handle("POST /api/rulesets", core.Serve(library.ImportRuleset))
	mux.Handle("GET /api/rulesets", core.Serve(library.Rulesets))
	mux.Handle("POST /api/packs", core.Serve(library.ImportPack))
	mux.Handle("GET /api/packs", core.Serve(library.Packs))
	mux.Handle("GET /api/packs/{id}/export", core.Serve(library.Export))
	mux.Handle("POST /api/packs/{id}/hide", core.Serve(library.Hide))
	mux.Handle("GET /api/admin/campaigns", core.Serve(console.Campaigns))
	mux.Handle("POST /api/admin/campaigns/{id}/action", core.Serve(console.Action))
	mux.Handle("GET /api/admin/packs", core.Serve(console.Packs))
	mux.Handle("POST /api/admin/packs/{id}/disable", core.Serve(console.DisablePack))
	mux.Handle("GET /api/admin/events", core.Serve(console.Events))
	mux.Handle("GET /api/campaigns/{id}/rules", core.Serve(library.Rules))

	// Signing in through InconsisID, and the signed-in account's page.
	signIn := &auth.SignInRoutes{Auth: authService, Sockets: gateway}
	if signInConfig != nil {
		signIn.Flows = &auth.Flows{Config: *signInConfig, DB: db}
		// Discovery now, so a misconfigured provider shows in the boot log; sign-in retries it on first use either way.
		if _, err := signIn.Flows.IDP(ctx); err != nil {
			log.Printf("sign-in: %v (%v)", err, errors.Unwrap(err))
		}
	}
	mux.Handle("GET /api/auth/me", core.Serve(signIn.Me))
	mux.Handle("POST /api/auth/login", core.Serve(signIn.Login))
	mux.Handle("GET /api/auth/callback", core.Serve(signIn.Callback))
	mux.Handle("POST /api/auth/logout", core.Serve(signIn.Logout))
	mux.Handle("POST /api/auth/backchannel-logout", core.Serve(signIn.BackchannelLogout))
	mux.Handle("GET /api/account", core.Serve(signIn.Account))
	mux.Handle("PATCH /api/account", core.Serve(signIn.RenameAccount))

	rest := guarded(mux, adminKey)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if under(r.URL.Path, "/socket.io") {
			gateway.ServeHTTP(w, r)
			return
		}
		rest.ServeHTTP(w, r)
	})

	address := ":" + env("PORT", "4000")
	log.Printf("listening on %s", address)
	return http.ListenAndServe(address, handler)
}

func under(path string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// guarded puts the limits and the CSRF check in front of every route, before any body is read, so a flood is refused
// cheaply. The order and numbers are apps/api/src/main.ts's.
func guarded(next http.Handler, adminKey *core.Limiter) http.Handler {
	// The unauthenticated door: 60/min leaves room for a whole table of phones behind one NAT.
	door := core.NewLimiter(60, time.Minute)
	// Signing in and out, /api/auth/me and the provider's back-channel logout.
	signIn := core.NewLimiter(60, time.Minute)
	// ponytail: per-IP window; key it by the device user once imports and the library land.
	signedIn := core.NewLimiter(120, time.Minute)
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
		if under(path, "/api/lobby", "/api/me", "/api/account", "/api/campaigns", "/api/admin", "/api/rulesets", "/api/packs") && !signedIn.Allow(ip) {
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
