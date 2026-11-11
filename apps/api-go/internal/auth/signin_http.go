package auth

import (
	"context"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"time"
	"unicode/utf16"

	"github.com/The-Inconsistent/InconsisID/packages/inconsisid-go"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Sign in, sign out, the back-channel logout and the account page (apps/api/src/auth/sign-in.controller.ts and
// account.controller.ts; house decision #35: REST writes outside the single mutation path). The CSRF check in front
// of every route already holds every write but the back-channel to the web's origin.

const (
	txMaxAge = 10 * time.Minute
	// The sign-in form and the logout token are form-encoded, like express' urlencoded({ limit: "16kb" }).
	maxForm = 16 * 1024
)

// SignInRoutes serve /api/auth/* and /api/account. Flows is nil when sign-in is off: then every route but /me and
// /logout answers 404.
type SignInRoutes struct {
	Auth    *Service
	Flows   *Flows
	Sockets interface{ EndSessions(tokenHashes []string) }
}

// Nest's bare NotFoundException.
var notFound = &core.HTTPError{Status: http.StatusNotFound, Body: map[string]any{"message": "Not Found", "statusCode": 404}}

// cookie is a __Host- cookie (§7.1, §7.4), set as express does: Max-Age and Expires both. Secure even on
// http://localhost, which Chromium treats as a secure context.
func setCookie(w http.ResponseWriter, name, value string, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", MaxAge: int(maxAge.Seconds()), Expires: time.Now().Add(maxAge),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
}

// clearCookie is express' res.clearCookie: an empty value that expired in 1970, with the same attributes.
func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Path: "/", Expires: time.Unix(0, 0), HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
}

func redirect(w http.ResponseWriter, r *http.Request, to string) (any, error) {
	http.Redirect(w, r, to, http.StatusSeeOther)
	return core.Written{}, nil
}

func signInFailed(w http.ResponseWriter, r *http.Request) (any, error) {
	return redirect(w, r, "/?signin=failed")
}

// plainStatus is express' res.sendStatus.
func plainStatus(w http.ResponseWriter, status int) (any, error) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, http.StatusText(status))
	return core.Written{}, nil
}

// formOrJSON reads a form-encoded body (up to 16 KB) or a JSON one. A key given twice reads as a list, as
// urlencoded({ extended: false }) gives it, so a schema expecting a string refuses it.
func formOrJSON(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/x-www-form-urlencoded" {
		body, err := core.ReadBody(w, r, core.MaxBody)
		object, _ := body.(map[string]any)
		return object, err
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxForm))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return nil, &core.HTTPError{Status: http.StatusRequestEntityTooLarge, Body: map[string]any{"statusCode": 413, "message": "request entity too large"}}
	}
	if err != nil {
		return nil, err
	}
	values, _ := url.ParseQuery(string(raw)) // lenient like querystring: a bad pair is skipped
	out := map[string]any{}
	for key, list := range values {
		if len(list) == 1 {
			out[key] = list[0]
			continue
		}
		items := make([]any, len(list))
		for i, v := range list {
			items[i] = v
		}
		out[key] = items
	}
	return out, nil
}

// logRefused logs why a sign-in or a logout token was refused: the code and the SDK's detail, never sent.
func logRefused(what string, err *Refused) {
	if err.Cause != nil {
		log.Printf("%s refused: %s (%v)", what, err.Reason, err.Cause)
		return
	}
	log.Printf("%s refused: %s", what, err.Reason)
}

type meView struct {
	SignInEnabled bool         `json:"signInEnabled"`
	Name          *string      `json:"name"`
	Account       *accountRole `json:"account"`
}

type accountRole struct {
	Roles []string `json:"roles"`
}

// Me is GET /api/auth/me: whether this deployment signs in at all, the caller's name (null before the device has an
// identity), and the signed-in account's roles (null for an anonymous device user).
func (h *SignInRoutes) Me(_ http.ResponseWriter, r *http.Request) (any, error) {
	user, err := h.Auth.DeviceUser(r.Context(), r.Header.Get("Cookie"))
	if err != nil {
		return nil, err
	}
	me := meView{SignInEnabled: h.Flows != nil}
	if user != nil {
		me.Name = &user.Name
		if user.Account {
			roles := user.Roles
			if roles == nil {
				roles = []string{}
			}
			me.Account = &accountRole{roles}
		}
	}
	return me, nil
}

// Login is POST /api/auth/login: a form POST from the lobby, never a link (§7.1). Its cookies are set for the
// callback's origin, so it must come from there: a LAN address over http would lose them.
func (h *SignInRoutes) Login(w http.ResponseWriter, r *http.Request) (any, error) {
	if h.Flows == nil {
		return nil, notFound
	}
	body, err := formOrJSON(w, r)
	if err != nil {
		return nil, err
	}
	if origins := r.Header.Values("Origin"); len(origins) != 1 || origins[0] != h.Flows.Config.WebOrigin {
		return signInFailed(w, r)
	}
	ctx := r.Context()
	user, err := h.Auth.DeviceUser(ctx, r.Header.Get("Cookie"))
	if err != nil {
		return nil, err
	}
	var deviceUserID *string
	if user != nil && !user.Account {
		deviceUserID = &user.UserID
	}
	handle, authURL, err := h.Flows.Start(ctx, deviceUserID, SafeReturnTo(body["returnTo"]))
	if err != nil {
		return nil, err
	}
	setCookie(w, OIDCTxCookie, handle, txMaxAge)
	return redirect(w, r, authURL)
}

// Callback is GET /api/auth/callback, the provider's redirect back. Any refusal is one generic page; the reason goes
// to the log only.
func (h *SignInRoutes) Callback(w http.ResponseWriter, r *http.Request) (any, error) {
	if h.Flows == nil {
		return nil, notFound
	}
	cookies := r.Header.Get("Cookie")
	clearCookie(w, OIDCTxCookie)
	handle, _ := ReadCookie(cookies, OIDCTxCookie)
	previous, _ := ReadCookie(cookies, SessionCookie)
	done, err := h.Flows.Finish(r.Context(), handle, r.RequestURI, previous)
	var refused *Refused
	if errors.As(err, &refused) {
		logRefused("sign-in", refused)
		return signInFailed(w, r)
	}
	if err != nil {
		return nil, err
	}
	h.Sockets.EndSessions(done.Ended)
	log.Printf("signed in: user %s", done.UserID)
	setCookie(w, SessionCookie, done.Token, SessionMax)
	return redirect(w, r, done.ReturnTo)
}

// Logout is POST /api/auth/logout: it ends the api session and its sockets, then hands over to the provider, which
// asks before ending its own.
func (h *SignInRoutes) Logout(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	token, _ := ReadCookie(r.Header.Get("Cookie"), SessionCookie)
	ended, err := EndSessionByToken(ctx, h.Auth.DB, token)
	if err != nil {
		return nil, err
	}
	h.Sockets.EndSessions(ended)
	to := "/"
	if h.Flows != nil {
		if to, err = h.Flows.LogoutRedirect(ctx); err != nil {
			return nil, err
		}
	}
	log.Printf("signed out: %d session(s) ended", len(ended))
	clearCookie(w, SessionCookie)
	return redirect(w, r, to)
}

// BackchannelLogout is POST /api/auth/backchannel-logout, the provider server to server (§7.6): it reads no cookie,
// answers 200 or 400 and is never cached.
func (h *SignInRoutes) BackchannelLogout(w http.ResponseWriter, r *http.Request) (any, error) {
	if h.Flows == nil {
		return nil, notFound
	}
	w.Header().Set("Cache-Control", "no-store")
	body, err := formOrJSON(w, r)
	if err != nil {
		return nil, err
	}
	token, _ := body["logout_token"].(string)
	if n := len(utf16.Encode([]rune(token))); n < 1 || n > 8000 {
		log.Printf("back-channel logout refused: no logout_token")
		return plainStatus(w, http.StatusBadRequest)
	}
	ended, err := h.Flows.ReceiveLogout(r.Context(), token)
	var refused *Refused
	if errors.As(err, &refused) {
		logRefused("back-channel logout", refused)
		return plainStatus(w, http.StatusBadRequest)
	}
	if err != nil {
		return nil, err
	}
	h.Sockets.EndSessions(ended)
	log.Printf("back-channel logout: %d session(s) ended", len(ended))
	return plainStatus(w, http.StatusOK)
}

// accountCaller is the signed-in caller of /api/account and its provider. Off without sign-in, like the sign-in
// routes; an anonymous device user has no account to show.
func (h *SignInRoutes) accountCaller(w http.ResponseWriter, r *http.Request) (AccountIDP, string, error) {
	w.Header().Set("Cache-Control", "no-store")
	if h.Flows == nil {
		return AccountIDP{}, "", notFound
	}
	user, err := h.Auth.DeviceUser(r.Context(), r.Header.Get("Cookie"))
	if err != nil {
		return AccountIDP{}, "", err
	}
	if user == nil || !user.Account {
		return AccountIDP{}, "", core.Refuse(http.StatusUnauthorized, "unauthorized")
	}
	c := h.Flows.Config
	return AccountIDP{
		Issuer:    c.Issuer,
		ManageURL: IdpAccountURL(c.Issuer, c.ClientID, c.WebOrigin),
		Client:    func(ctx context.Context) (AccountClient, error) { return h.Flows.IDP(ctx) },
	}, user.UserID, nil
}

// accountAnswer: the provider's refusals become a status and a code; the SDK's code and detail go to the log only.
func accountAnswer(view *AccountView, err error) (any, error) {
	var idErr *inconsisid.Error
	if errors.As(err, &idErr) {
		log.Printf("account API refused: %s (%v)", idErr.Code, errors.Unwrap(idErr))
		status, key := AccountRefusal(idErr.Code)
		return nil, core.Refuse(status, key)
	}
	if err != nil {
		return nil, err
	}
	if view == nil {
		return nil, core.Refuse(http.StatusNotFound, "accountNotFound")
	}
	return view, nil
}

// Account is GET /api/account: the signed-in account at the provider (house decision #35: a user's own sign-in
// methods are owner-scoped REST).
func (h *SignInRoutes) Account(w http.ResponseWriter, r *http.Request) (any, error) {
	idp, userID, err := h.accountCaller(w, r)
	if err != nil {
		return nil, err
	}
	return accountAnswer(ReadAccount(r.Context(), h.Auth.DB, idp, userID))
}

// RenameAccount is PATCH /api/account.
func (h *SignInRoutes) RenameAccount(w http.ResponseWriter, r *http.Request) (any, error) {
	idp, userID, err := h.accountCaller(w, r)
	if err != nil {
		return nil, err
	}
	body, err := core.ParseBody(w, r, coreschema.RenameAccount)
	if err != nil {
		return nil, err
	}
	return accountAnswer(RenameAccount(r.Context(), h.Auth.DB, idp, userID, body["displayName"].(string)))
}
