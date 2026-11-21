package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
)

type services struct {
	db      *pgxpool.Pool
	rooms   *campaign.Service
	library *pack.Service
	signIn  *auth.SignInRoutes
}

func newServices(t *testing.T) services {
	db := dbtest.Open(t)
	a := &auth.Service{DB: db}
	return services{
		db:      db,
		rooms:   &campaign.Service{DB: db, Auth: a, Mutate: func(_ string, fn func() error) error { return fn() }},
		library: &pack.Service{DB: db, Auth: a},
		signIn:  &auth.SignInRoutes{Auth: a},
	}
}

func call(h core.Handler, method, path, cookie, body string, values map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Cookie", cookie)
	for k, v := range values {
		r.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	core.Serve(h)(w, r)
	return w
}

// deviceUsers is how many users a device secret has: its device rows, each with its user.
func deviceUsers(t *testing.T, db *pgxpool.Pool, secret string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM device JOIN app_user ON app_user.id = device.user_id
		WHERE device.token_hash = $1`, auth.Hash(secret)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func dropDevice(t *testing.T, db *pgxpool.Pool, secret string) {
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = db.Exec(ctx, `DELETE FROM app_user WHERE id IN (SELECT user_id FROM device WHERE token_hash = $1)`, auth.Hash(secret))
		_, _ = db.Exec(ctx, `DELETE FROM device WHERE token_hash = $1`, auth.Hash(secret))
	})
}

func TestReadsByANewDeviceAnswerEmptyAndMakeNoUser(t *testing.T) {
	s := newServices(t)
	secret := auth.NewSecret()
	dropDevice(t, s.db, secret)
	cookie := auth.DeviceCookie + "=" + secret

	reads := []struct {
		name string
		h    core.Handler
		want string
	}{
		{"/api/lobby", s.rooms.Lobby, `{"canCreate":true,"name":"Player","mine":[],"seated":[],"archived":[],"characters":[]}`},
		{"/api/auth/me", s.signIn.Me, `{"signInEnabled":false,"name":null,"account":null}`},
		{"/api/rulesets", s.library.Rulesets, `[]`},
		{"/api/packs", s.library.Packs,
			`{"packs":[],"usage":{"packs":0,"bytes":0,"maxPacks":50,"maxBytes":52428800,"maxEntries":5000}}`},
		{"/api/worlds", s.library.Worlds, `[]`},
	}
	for _, read := range reads {
		w := call(read.h, http.MethodGet, read.name, cookie, "", nil)
		if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != read.want {
			t.Errorf("%s: %d %s, want 200 %s", read.name, w.Code, w.Body, read.want)
		}
	}
	if n := deviceUsers(t, s.db, secret); n != 0 {
		t.Errorf("the reads made %d user(s)", n)
	}

	if w := call(s.rooms.Lobby, http.MethodGet, "/api/lobby", "", "", nil); w.Code != http.StatusUnauthorized {
		t.Errorf("no device cookie: %d", w.Code)
	}
}

func TestAnInvitePreviewOffersANewDeviceASeatWithoutMakingItAUser(t *testing.T) {
	s := newServices(t)
	code := newInvite(t, s.db)
	secret := auth.NewSecret()
	dropDevice(t, s.db, secret)

	w := call(s.rooms.Invite, http.MethodGet, "/api/invites/"+code, auth.DeviceCookie+"="+secret, "", map[string]string{"code": code})
	var preview auth.InvitePreview
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &preview) != nil || !preview.SignedIn || preview.Member {
		t.Errorf("preview: %d %s", w.Code, w.Body)
	}
	if n := deviceUsers(t, s.db, secret); n != 0 {
		t.Errorf("the preview made %d user(s)", n)
	}
}

func TestTheFirstWritesOfANewDeviceMakeOneUser(t *testing.T) {
	s := newServices(t)
	writes := map[string]func(cookie string) *httptest.ResponseRecorder{
		"rename": func(cookie string) *httptest.ResponseRecorder {
			return call(s.rooms.Rename, http.MethodPatch, "/api/me", cookie, `{"name":"Ada"}`, nil)
		},
		"accept": func(cookie string) *httptest.ResponseRecorder {
			code := newInvite(t, s.db)
			return call(s.rooms.Accept, http.MethodPost, "/api/invites/"+code+"/accept", cookie, `{"newCharacterName":"Ada"}`,
				map[string]string{"code": code})
		},
		"import": func(cookie string) *httptest.ResponseRecorder {
			return call(s.library.ImportRuleset, http.MethodPost, "/api/rulesets", cookie, dbtest.Fixture, nil)
		},
	}
	for name, write := range writes {
		t.Run(name, func(t *testing.T) {
			secret := auth.NewSecret()
			dropDevice(t, s.db, secret)
			t.Cleanup(func() {
				_, _ = s.db.Exec(context.Background(), `DELETE FROM ruleset WHERE owner_user_id IN
					(SELECT user_id FROM device WHERE token_hash = $1)`, auth.Hash(secret))
			})
			cookie := auth.DeviceCookie + "=" + secret
			var wg sync.WaitGroup
			codes := make([]int, 2)
			for i := range codes {
				wg.Go(func() { codes[i] = write(cookie).Code })
			}
			wg.Wait()
			for _, c := range codes {
				if c >= 300 {
					t.Errorf("answered %v", codes)
				}
			}
			if n := deviceUsers(t, s.db, secret); n != 1 {
				t.Errorf("two first writes at once made %d user(s)", n)
			}
		})
	}
}

// newInvite is a room invite for a player, in a room of its own that the test drops after.
func newInvite(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var owner, room string
	if err := db.QueryRow(ctx, `INSERT INTO app_user (id, name) VALUES (uuidv7()::text, 'Owner') RETURNING id`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO campaign (name, owner_user_id) VALUES ('Room', $1) RETURNING id::text`, owner).Scan(&room); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(ctx, `DELETE FROM campaign WHERE id = $1`, room)
		_, _ = db.Exec(ctx, `DELETE FROM app_user WHERE id = $1`, owner)
	})
	code := auth.NewSecret()
	if _, err := db.Exec(ctx, `INSERT INTO invite (code_hash, campaign_id, mode, role, allow_guests, expires_at)
		VALUES ($1, $2, 'room', 'player', false, $3)`, auth.Hash(code), room, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return code
}
