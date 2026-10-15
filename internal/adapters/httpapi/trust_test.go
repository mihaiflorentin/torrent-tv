package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newRequest is httptest.NewRequest with a LAN IP Host, which is what a real
// client sends instead of httptest's default "example.com".
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

func TestGuardDefaultAcceptsAnyHost(t *testing.T) {
	h := guardWith(nil)
	for _, host := range []string{
		"192.168.1.20:8097", "10.0.0.5", "[::1]:8097", "localhost:8097",
		"torrenttv.local", "tv", "evil.example.com:8097", "203.0.113.9", "",
	} {
		for _, path := range []string{"/api/v1/state", "/"} {
			if got := do(h, "GET", path, host, "", nil).Code; got != 200 {
				t.Errorf("host %q path %s = %d, want 200", host, path, got)
			}
		}
	}
}

func TestGuardHostAllowlistFromEnvironment(t *testing.T) {
	h := guardWith(map[string]string{"TORRENT_TV_ALLOWED_HOSTS": " tv.example.com , Proxy.Lan , 192.168.1.20 "})
	cases := []struct {
		host string
		want int
	}{
		{"tv.example.com", 200},
		{"TV.example.com:8097", 200},
		{"proxy.lan", 200},
		{"192.168.1.20:8097", 200},
		{"other.example.com", 403},
		{"192.168.1.21", 403},
		{"localhost", 403},
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

func TestIsLANOrigin(t *testing.T) {
	yes := []string{
		"http://localhost:5173", "https://LOCALHOST", "http://127.0.0.1:8097", "http://127.5.5.5",
		"http://10.1.2.3", "http://172.16.0.1:80", "http://172.31.255.255", "http://192.168.1.99:8097",
		"http://169.254.1.1", "http://[::1]:8097", "http://[fe80::1]", "http://[fd12:3456::1]", "http://[fc00::1]",
		"http://torrenttv.local", "http://tv.lan:8097", "http://tv.home.arpa", "http://tv", "http://TV:3000",
	}
	no := []string{
		"https://evil.example", "http://172.32.0.1", "http://172.15.0.1", "http://11.0.0.1", "http://192.169.1.1",
		"http://8.8.8.8", "http://[2001:db8::1]", "https://tv.example.com", "http://evil.local.example.com",
		"http://lan.evil.com", "ftp://192.168.1.1", "file:///x", "null", "", "192.168.1.1", "http://",
	}
	for _, o := range yes {
		if !isLANOrigin(o) {
			t.Errorf("isLANOrigin(%q) = false, want true", o)
		}
	}
	for _, o := range no {
		if isLANOrigin(o) {
			t.Errorf("isLANOrigin(%q) = true, want false", o)
		}
	}
}

type originCase struct {
	origin string
	want   int
}

func TestGuardDefaultClientTierOrigins(t *testing.T) {
	checkOrigins(t, guardWith(nil), "/api/v1/downloads", "192.168.1.20:8097", []originCase{
		{"", 200},
		{"null", 200},
		{"http://192.168.1.20:8097", 200},
		{"https://appassets.androidplatform.net", 200},
		{"http://192.168.1.99:8097", 200},
		{"http://localhost:5173", 200},
		{"http://torrenttv.local:8097", 200},
		{"https://evil.example", 403},
		{"http://8.8.8.8", 403},
		{"http://203.0.113.9:8097", 403},
	})
}

func TestGuardOriginAllowlistFromEnvironment(t *testing.T) {
	h := guardWith(map[string]string{"TORRENT_TV_ALLOWED_ORIGINS": "https://tv.example, null, http://dev.example:5173/"})
	checkOrigins(t, h, "/api/v1/downloads", "tv.example:8097", []originCase{
		{"", 200},
		{"http://tv.example:8097", 200}, // same-origin
		{"https://tv.example", 200},
		{"null", 200},
		{"http://dev.example:5173", 200},
		{"https://appassets.androidplatform.net", 403}, // not listed: built-ins and LAN default are off
		{"http://192.168.1.99:8097", 403},
		{"http://localhost:5173", 403},
		{"https://evil.example", 403},
	})
}

func checkOrigins(t *testing.T, h http.Handler, path, host string, cases []originCase) {
	t.Helper()
	for _, c := range cases {
		rec := do(h, "GET", path, host, c.origin, nil)
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

func TestGuardAdminTier(t *testing.T) {
	paths := []struct{ method, path string }{
		{"PUT", "/api/v1/settings"},
		{"GET", "/api/v1/settings"},
		{"GET", "/api/v1/settings/schema"},
		{"POST", "/api/v1/dependencies/tmdb/test"},
		{"POST", "/api/v1/updates/apply"},
		{"POST", "/api/v1/updates/check"},
	}
	run := func(name string, env map[string]string, cases []originCase) {
		h := guardWith(env)
		for _, p := range paths {
			for _, c := range cases {
				if got := do(h, p.method, p.path, "192.168.1.20:8097", c.origin, nil).Code; got != c.want {
					t.Errorf("%s: %s %s origin %q = %d, want %d", name, p.method, p.path, c.origin, got, c.want)
				}
			}
		}
	}
	run("default", nil, []originCase{
		{"", 200},
		{"http://192.168.1.20:8097", 200},
		{"http://192.168.1.99:8097", 403}, // another LAN page is not the admin UI
		{"http://torrenttv.local", 403},
		{"http://localhost:5173", 403},
		{"null", 403},
		{"https://appassets.androidplatform.net", 403},
		{"https://evil.example", 403},
		{"http://8.8.8.8", 403},
	})
	run("allowlist", map[string]string{"TORRENT_TV_ALLOWED_ORIGINS": "https://tv.example"}, []originCase{
		{"", 200},
		{"http://192.168.1.20:8097", 200},
		{"http://192.168.1.99:8097", 403},
		{"https://tv.example", 403},
		{"null", 403},
	})
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

func TestGuardAdminTierRequiresLANShapedHost(t *testing.T) {
	adminPaths := []string{"/api/v1/settings", "/api/v1/dependencies/tmdb/test", "/api/v1/updates/check"}
	allowed := []string{"192.168.1.20:8097", "203.0.113.9", "[::1]:8097", "localhost:8097", "torrenttv", "torrenttv.local", "tv.lan:8097", "tv.home.arpa"}
	rebound := []string{"evil.example.com:8097", "attacker.com", "tv.local.evil.com", "lan.evil.com", ""}
	h := guardWith(nil)
	for _, path := range adminPaths {
		for _, host := range allowed {
			if got := do(h, "GET", path, host, "", nil).Code; got != 200 {
				t.Errorf("admin %s host %q = %d, want 200", path, host, got)
			}
		}
		for _, host := range rebound {
			if got := do(h, "GET", path, host, "", nil).Code; got != 403 {
				t.Errorf("admin %s host %q = %d, want 403", path, host, got)
			}
		}
	}
	// The client tier keeps accepting any Host.
	for _, host := range rebound {
		if got := do(h, "GET", "/api/v1/downloads", host, "", nil).Code; got != 200 {
			t.Errorf("client tier host %q = %d, want 200", host, got)
		}
	}
	// A name in TORRENT_TV_ALLOWED_HOSTS is accepted on the admin tier too.
	listed := guardWith(map[string]string{"TORRENT_TV_ALLOWED_HOSTS": "tv.example.com"})
	if got := do(listed, "GET", "/api/v1/settings", "tv.example.com", "", nil).Code; got != 200 {
		t.Errorf("listed host on admin tier = %d, want 200", got)
	}
	if got := do(listed, "GET", "/api/v1/settings", "other.example.com", "", nil).Code; got != 403 {
		t.Errorf("unlisted host on admin tier = %d, want 403", got)
	}
}
