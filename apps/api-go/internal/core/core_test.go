package core

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCookieHeaderJoinsEveryCookieHeader(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Add("Cookie", "a=1")
	r.Header.Add("Cookie", "it_device=2; b=3")
	if got := CookieHeader(r); got != "a=1; it_device=2; b=3" {
		t.Fatalf("got %q", got)
	}
}

func TestClientIPTrustsForwardedHeadersOnlyWhenTold(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "9.9.9.9:1234"
	r.Header.Set("Cf-Connecting-Ip", "5.5.5.5")
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 1.2.3.4")
	if got := ClientIP(r); got != "9.9.9.9" {
		t.Errorf("nothing trusted: got %s", got)
	}
	t.Setenv("TRUST_XFF", "1")
	if got := ClientIP(r); got != "1.2.3.4" {
		t.Errorf("TRUST_XFF takes the last entry (what Cloud Run saw), not a forged first one: got %s", got)
	}
	r.Header.Set("X-Forwarded-For", "")
	if got := ClientIP(r); got != "9.9.9.9" {
		t.Errorf("an empty header falls back to the peer: got %s", got)
	}
	t.Setenv("TRUST_CF", "1")
	if got := ClientIP(r); got != "5.5.5.5" {
		t.Errorf("TRUST_CF: got %s", got)
	}
}

func TestLimiterWindowsAndKeyCap(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter(2, time.Minute)
	l.now = func() time.Time { return now }
	for i, want := range []bool{true, true, false} {
		if got := l.Allow("a"); got != want {
			t.Errorf("hit %d: want %v", i, want)
		}
	}
	now = now.Add(time.Minute)
	if !l.Allow("a") {
		t.Error("a new window should allow again")
	}
	for i := range maxLimiterKeys {
		l.Allow(fmt.Sprint("k", i))
	}
	if l.Allow("one more") {
		t.Error("past the key cap a new key is refused")
	}
	now = now.Add(time.Minute)
	if !l.Allow("one more") {
		t.Error("expired windows are swept, so a new key fits again")
	}
}

func TestCrossSiteWrite(t *testing.T) {
	origins := []string{"https://app.example"}
	cases := []struct {
		method, path, header, value string
		refused                     bool
	}{
		{"GET", "/api/lobby", "", "", false},
		{"HEAD", "/api/lobby", "", "", false},
		{"POST", "/api/campaigns", "", "", true},
		{"POST", "/api/campaigns", "Sec-Fetch-Site", "same-origin", false},
		{"POST", "/api/campaigns", "Sec-Fetch-Site", "same-site", true},
		{"POST", "/api/campaigns", "Sec-Fetch-Site", "cross-site", true},
		{"POST", "/api/campaigns", "Origin", "https://app.example", false},
		{"POST", "/api/campaigns", "Origin", "https://evil.example", true},
		{"DELETE", "/api/x", "", "", true},
		{"POST", "/api/auth/backchannel-logout", "", "", false},
		{"POST", "/api/auth/backchannel-logout", "Sec-Fetch-Site", "cross-site", false},
		{"POST", "/api/auth/backchannel-logout/", "", "", true},
		{"POST", "/api/auth/Backchannel-logout", "", "", true},
		{"POST", "/api/auth/logout", "", "", true},
		{"POST", "/api/auth/login", "Sec-Fetch-Site", "cross-site", true},
		{"PATCH", "/api/account", "", "", true},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if c.header != "" {
			r.Header.Set(c.header, c.value)
		}
		if got := CrossSiteWrite(r, origins); got != c.refused {
			t.Errorf("%s %s %s=%s: want %v", c.method, c.path, c.header, c.value, c.refused)
		}
	}
}

func TestCheckAdminKey(t *testing.T) {
	for key, ok := range map[string]bool{"": true, "short": false, "change-me": false, "a-key-of-thirty-two-characters-ok": true} {
		if got := CheckAdminKey(key) == nil; got != ok {
			t.Errorf("%q: want %v", key, ok)
		}
	}
}
