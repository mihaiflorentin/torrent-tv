package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

// Environment variables that widen the trust policy as a safety valve for
// households behind a reverse proxy or a custom client. Both take a comma
// separated list. See ADR-0012.
const (
	envAllowedOrigins = "TORRENT_TV_ALLOWED_ORIGINS"
	envAllowedHosts   = "TORRENT_TV_ALLOWED_HOSTS"
)

// builtinClientOrigins are the origins the packaged TV clients send that are
// not opaque. Tizen and webOS apps send "null" (listed separately below).
var builtinClientOrigins = []string{"https://appassets.androidplatform.net"}

// trustPolicy decides which Host and Origin values the API accepts.
type trustPolicy struct {
	origins map[string]bool // client tier: exact, lowercase
	hosts   map[string]bool // extra hostnames without port, lowercase
}

func newTrustPolicy(getenv func(string) string) *trustPolicy {
	p := &trustPolicy{origins: map[string]bool{"null": true}, hosts: map[string]bool{}}
	for _, o := range builtinClientOrigins {
		p.origins[o] = true
	}
	for _, o := range splitList(getenv(envAllowedOrigins)) {
		p.origins[strings.TrimRight(o, "/")] = true
	}
	for _, h := range splitList(getenv(envAllowedHosts)) {
		p.hosts[hostOnly(h)] = true
	}
	return p
}

func splitList(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if part = strings.ToLower(strings.TrimSpace(part)); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// hostOnly strips an optional port and IPv6 brackets and lowercases.
func hostOnly(hostport string) string {
	h := strings.ToLower(strings.TrimSpace(hostport))
	if host, _, err := net.SplitHostPort(h); err == nil {
		return host
	}
	return strings.Trim(h, "[]")
}

// hostAllowed accepts IP literals, localhost and configured hostnames. A
// DNS-rebinding page reaches the server under its own hostname, which none
// of these admit.
func (p *trustPolicy) hostAllowed(hostport string) bool {
	h := hostOnly(hostport)
	if h == "" {
		return false
	}
	if _, err := netip.ParseAddr(h); err == nil {
		return true
	}
	return h == "localhost" || p.hosts[h]
}

// sameOrigin reports whether origin names the same authority as the request
// Host.
func sameOrigin(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return false
	}
	return strings.EqualFold(u.Host, host)
}

// originAllowed applies the tier rule. Admin: no Origin or same-origin only.
// Client: additionally "null", the packaged-client origins and configured ones.
func (p *trustPolicy) originAllowed(origin, host string, admin bool) bool {
	if origin == "" || sameOrigin(origin, host) {
		return true
	}
	return !admin && p.origins[strings.TrimRight(strings.ToLower(origin), "/")]
}

// isAdminPath marks the browser-only administration surface: settings
// (which carry executable paths and provider credentials), dependency tests
// and self-update.
func isAdminPath(path string) bool {
	for _, prefix := range []string{"/api/v1/settings", "/api/v1/dependencies", "/api/v1/updates"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// guard enforces Host validation on every route and the Origin policy and
// CORS headers on /api/v1. It also answers preflights, which the
// method-specific mux routes would otherwise drop on the SPA handler.
func guard(p *trustPolicy, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.hostAllowed(r.Host) {
			problem(w, http.StatusForbidden, fmt.Errorf("host %q is not allowed", r.Host))
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/v1") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if !p.originAllowed(origin, r.Host, isAdminPath(r.URL.Path)) {
			problem(w, http.StatusForbidden, fmt.Errorf("origin is not allowed"))
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
