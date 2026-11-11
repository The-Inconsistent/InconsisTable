package auth

import (
	"strings"
	"testing"
)

func TestReadCookie(t *testing.T) {
	cases := []struct {
		header, name, want string
		found              bool
	}{
		{"", "a", "", false},
		{"a=1", "a", "1", true},
		{"b=2; a=1", "a", "1", true},
		{"a=x%20y", "a", "x y", true},
		{"a=1=2", "a", "1=2", true},
		{"a=%", "a", "", false},
		{"a=%FF", "a", "", false},
		{"ab=1", "a", "", false},
		{"a", "a", "", true},
	}
	for _, c := range cases {
		got, found := ReadCookie(c.header, c.name)
		if got != c.want || found != c.found {
			t.Errorf("%q: want %q %v, got %q %v", c.header, c.want, c.found, got, found)
		}
	}
}

func TestIsDeviceSecret(t *testing.T) {
	for secret, ok := range map[string]bool{
		"":                             false,
		strings.Repeat("a", 31):        false,
		strings.Repeat("a", 32):        true,
		strings.Repeat("a", 200):       true,
		strings.Repeat("a", 201):       false,
		strings.Repeat("a", 31) + "=":  false,
		strings.Repeat("a", 31) + "\n": false,
	} {
		if IsDeviceSecret(secret) != ok {
			t.Errorf("%q: want %v", secret, ok)
		}
	}
}
