package qbittorrent

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// Credentials are read from settings on every login. Switching a client that
// started credential-free over to a real, authenticating qBittorrent must
// start logging in, and a changed password must be applied.
func TestClientPicksUpCredentialChangesAfterAuthlessStart(t *testing.T) {
	var mu sync.Mutex
	user, pass := "", ""
	loggedPasswords := []string{}
	authenticated := false
	client := New(func() (string, string, string) {
		mu.Lock()
		defer mu.Unlock()
		return "http://qb.test", user, pass
	})
	client.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		respond := func(code int, body string) (*http.Response, error) {
			return &http.Response{StatusCode: code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
		}
		if r.URL.Path == "/api/v2/auth/login" {
			_ = r.ParseForm()
			loggedPasswords = append(loggedPasswords, r.Form.Get("password"))
			authenticated = r.Form.Get("password") == "secret2"
			if authenticated {
				return respond(200, "Ok.")
			}
			return respond(200, "Fails.")
		}
		if user != "" && !authenticated {
			return respond(403, "Forbidden")
		}
		return respond(200, "v5.0.0")
	})
	if _, err := client.Test(t.Context()); err != nil {
		t.Fatalf("authless start: %v", err)
	}
	mu.Lock()
	user, pass = "admin", "secret2"
	mu.Unlock()
	if _, err := client.Test(t.Context()); err != nil {
		t.Fatalf("after switching to a real qBittorrent with credentials: %v", err)
	}
	if len(loggedPasswords) == 0 {
		t.Fatal("the client never logged in with the new credentials")
	}
}
