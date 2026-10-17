package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strings"
)

// Environment variables for exposing the server beyond the LAN. Unset, the
// policy is the LAN default: any Host (the admin tier needs an IP or LAN-shaped
// name), and Origins limited to the LAN and the packaged clients. Set, each becomes a strict allowlist. Both take a comma
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
	origins map[string]bool // strict origin allowlist, exact and lowercase; nil means LAN default
	hosts   map[string]bool // strict Host allowlist without port, lowercase; nil means any Host
}

func newTrustPolicy(getenv func(string) string) *trustPolicy {
	p := &trustPolicy{}
	if list := splitList(getenv(envAllowedOrigins)); len(list) > 0 {
		p.origins = map[string]bool{}
		for _, o := range list {
			p.origins[strings.TrimRight(o, "/")] = true
		}
	}
	if list := splitList(getenv(envAllowedHosts)); len(list) > 0 {
		p.hosts = map[string]bool{}
		for _, h := range list {
			p.hosts[hostOnly(h)] = true
		}
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

// hostAllowed accepts any Host unless TORRENT_TV_ALLOWED_HOSTS is set, in
// which case only the listed names pass. The default trades DNS-rebinding
// protection for working under any LAN name (IP, mDNS, router hostname).
func (p *trustPolicy) hostAllowed(hostport string) bool {
	if p.hosts == nil {
		return true
	}
	return p.hosts[hostOnly(hostport)]
}

// isLANName reports whether a non-IP host is localhost or a single-label,
// .local, .lan or .home.arpa name: a name a public DNS record cannot own.
func isLANName(h string) bool {
	if h == "" {
		return false
	}
	if h == "localhost" || !strings.Contains(h, ".") {
		return true
	}
	for _, suffix := range []string{".local", ".lan", ".home.arpa"} {
		if strings.HasSuffix(h, suffix) {
			return true
		}
	}
	return false
}

// isLANOrigin reports whether origin is an http(s) origin whose host is
// localhost, a loopback/private/link-local IP, or a single-label, .local,
// .lan or .home.arpa name.
func isLANOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if h == "" {
		return false
	}
	if addr, err := netip.ParseAddr(h); err == nil {
		addr = addr.Unmap()
		return addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast()
	}
	return isLANName(h)
}

// adminHostAllowed is the extra Host rule of the admin tier. With
// TORRENT_TV_ALLOWED_HOSTS set, that allowlist (already applied) is the whole
// rule. Otherwise the Host must be an IP address or a LAN-shaped name, so a
// DNS-rebinding page served from a public domain is refused.
func (p *trustPolicy) adminHostAllowed(hostport string) bool {
	if p.hosts != nil {
		return p.hosts[hostOnly(hostport)]
	}
	h := hostOnly(hostport)
	if _, err := netip.ParseAddr(h); err == nil {
		return true
	}
	return isLANName(h)
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

// isTVClientOrigin reports whether origin is one the packaged TV clients send:
// "null" (Tizen and webOS file:// pages) or the Android WebView asset origin.
// The TV Settings screen uses the admin endpoints, so the admin tier accepts
// these too. "null" is also what a sandboxed iframe sends; ADR-0012 records
// that residual risk, bounded by the LAN-shaped Host rule.
func isTVClientOrigin(origin string) bool {
	lower := strings.TrimRight(strings.ToLower(origin), "/")
	return lower == "null" || slices.Contains(builtinClientOrigins, lower)
}

// originAllowed applies the tier rule. A missing or same-origin Origin always
// passes. With TORRENT_TV_ALLOWED_ORIGINS set, any other origin must be listed
// and the built-in rules are off, except that on the admin tier only a listed
// TV client origin is taken (web and LAN origins never are). Otherwise the
// packaged TV client origins ("null" and the Android asset origin) pass on both
// tiers, and the client tier also takes LAN origins. The admin tier refuses
// every other origin, including another LAN page and any web origin.
func (p *trustPolicy) originAllowed(origin, host string, admin bool) bool {
	if origin == "" || sameOrigin(origin, host) {
		return true
	}
	if p.origins != nil {
		listed := p.origins[strings.TrimRight(strings.ToLower(origin), "/")]
		return listed && (!admin || isTVClientOrigin(origin))
	}
	return isTVClientOrigin(origin) || (!admin && isLANOrigin(origin))
}

// isAdminPath marks the administration surface: settings
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
		admin := isAdminPath(r.URL.Path)
		if admin && !p.adminHostAllowed(r.Host) {
			problem(w, http.StatusForbidden, fmt.Errorf("host %q is not allowed for administration", r.Host))
			return
		}
		origin := r.Header.Get("Origin")
		if !p.originAllowed(origin, r.Host, admin) {
			problem(w, http.StatusForbidden, fmt.Errorf("origin is not allowed"))
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Expose-Headers", "ETag")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
