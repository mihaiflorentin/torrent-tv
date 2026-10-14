package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newRequest is httptest.NewRequest with a LAN IP Host, which is what a real
// client sends; the default "example.com" Host is rejected by the guard.
func newRequest(method, target string, body io.Reader) *http.Request {
	r := httptest.NewRequest(method, target, body)
	r.Host = "192.0.2.1:8097"
	return r
}

func guardWith(env map[string]string) http.Handler {
	policy := newTrustPolicy(func(k string) string { return env[k] })
	return guard(policy, http.HandlerFunc(passThrough))
}

func do(h http.Handler, method, path, host, origin string, extra map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	for k, v := range extra {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestGuardHostValidation(t *testing.T) {
	h := guardWith(nil)
	cases := []struct {
		host string
		want int
	}{
		{"192.168.1.20:8097", 200},
		{"10.0.0.5", 200},
		{"[::1]:8097", 200},
		{"[fe80::1]", 200},
		{"localhost:8097", 200},
		{"LOCALHOST", 200},
		{"127.0.0.1:8097", 200},
		{"evil.example.com:8097", 403},
		{"192.168.1.20.evil.com", 403},
		{"torrenttv.local", 403},
		{"", 403},
	}
	for _, c := range cases {
		for _, path := range []string{"/api/v1/state", "/"} {
			if got := do(h, "GET", path, c.host, "", nil).Code; got != c.want {
				t.Errorf("host %q path %s = %d, want %d", c.host, path, got, c.want)
			}
		}
	}
}

func TestGuardExtraHostsFromEnvironment(t *testing.T) {
	h := guardWith(map[string]string{"TORRENT_TV_ALLOWED_HOSTS": " tv.home , Proxy.Lan "})
	for _, host := range []string{"tv.home", "tv.home:8097", "proxy.lan"} {
		if got := do(h, "GET", "/api/v1/state", host, "", nil).Code; got != 200 {
			t.Errorf("host %q = %d, want 200", host, got)
		}
	}
	if got := do(h, "GET", "/api/v1/state", "other.home", "", nil).Code; got != 403 {
		t.Errorf("unlisted host = %d, want 403", got)
	}
}

func TestGuardClientTierOrigins(t *testing.T) {
	h := guardWith(map[string]string{"TORRENT_TV_ALLOWED_ORIGINS": "https://tv.example, http://dev.lan:5173"})
	host := "192.168.1.20:8097"
	cases := []struct {
		origin string
		want   int
	}{
		{"", 200},
		{"null", 200},
		{"http://192.168.1.20:8097", 200},
		{"https://appassets.androidplatform.net", 200},
		{"https://tv.example", 200},
		{"http://dev.lan:5173", 200},
		{"https://evil.example", 403},
		{"http://192.168.1.99:8097", 403},
		{"http://192.168.1.20:9999", 403},
	}
	for _, c := range cases {
		rec := do(h, "GET", "/api/v1/downloads", host, c.origin, nil)
		if rec.Code != c.want {
			t.Errorf("origin %q = %d, want %d", c.origin, rec.Code, c.want)
		}
		if c.want == 200 && c.origin != "" {
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != c.origin {
				t.Errorf("origin %q echoed as %q", c.origin, got)
			}
		}
		if c.want == 403 && rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("origin %q rejected but got CORS header", c.origin)
		}
		if rec.Header().Get("Vary") != "Origin" {
			t.Errorf("origin %q: Vary = %q", c.origin, rec.Header().Get("Vary"))
		}
	}
}

func TestGuardNoWildcardCORS(t *testing.T) {
	h := guardWith(nil)
	rec := do(h, "GET", "/api/v1/state", "192.168.1.20:8097", "", nil)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin without Origin = %q, want empty", got)
	}
}

func TestGuardAdminTierIsSameOriginOnly(t *testing.T) {
	h := guardWith(map[string]string{"TORRENT_TV_ALLOWED_ORIGINS": "https://tv.example"})
	host := "192.168.1.20:8097"
	paths := []struct{ method, path string }{
		{"PUT", "/api/v1/settings"},
		{"GET", "/api/v1/settings"},
		{"GET", "/api/v1/settings/schema"},
		{"POST", "/api/v1/dependencies/tmdb/test"},
		{"POST", "/api/v1/updates/apply"},
		{"POST", "/api/v1/updates/check"},
	}
	for _, p := range paths {
		for _, c := range []struct {
			origin string
			want   int
		}{
			{"", 200},
			{"http://192.168.1.20:8097", 200},
			{"null", 403},
			{"https://tv.example", 403},
			{"https://appassets.androidplatform.net", 403},
			{"https://evil.example", 403},
		} {
			if got := do(h, p.method, p.path, host, c.origin, nil).Code; got != c.want {
				t.Errorf("%s %s origin %q = %d, want %d", p.method, p.path, c.origin, got, c.want)
			}
		}
	}
}

func TestGuardPreflight(t *testing.T) {
	h := guardWith(nil)
	host := "192.168.1.20:8097"
	pf := map[string]string{"Access-Control-Request-Method": "PUT"}
	rec := do(h, "OPTIONS", "/api/v1/playback/x", host, "null", pf)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "null" {
		t.Fatalf("client preflight = %d %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
	if rec.Header().Get("Access-Control-Allow-Headers") != "Content-Type" || rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight headers missing: %v", rec.Header())
	}
	if rec := do(h, "OPTIONS", "/api/v1/settings", host, "null", pf); rec.Code != 403 {
		t.Fatalf("admin preflight from null = %d, want 403", rec.Code)
	}
	if rec := do(h, "OPTIONS", "/api/v1/playback/x", host, "https://evil.example", pf); rec.Code != 403 {
		t.Fatalf("foreign preflight = %d, want 403", rec.Code)
	}
}
