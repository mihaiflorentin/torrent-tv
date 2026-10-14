package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

// internalFetchHeader carries the per-process token on the requests the
// server makes to itself for ffmpeg and ffprobe.
const internalFetchHeader = "X-Torrent-TV-Internal"

func newInternalToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// internalStreamURL names the stream route on the address the server is
// actually listening on. A wildcard or empty host is reached over IPv4
// loopback; a specific host (a LAN IP, [::1]) is dialled as configured, since
// a listener bound there does not answer on 127.0.0.1.
func internalStreamURL(listenAddress, sourceID string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddress)
	if err != nil || port == "" {
		return "", fmt.Errorf("invalid listen address %q", listenAddress)
	}
	if addr, parseErr := netip.ParseAddr(host); host == "" || (parseErr == nil && addr.IsUnspecified()) {
		host = "127.0.0.1"
	}
	u := url.URL{Scheme: "http", Host: net.JoinHostPort(host, port), Path: "/api/v1/streams/" + sourceID}
	return u.String(), nil
}

// internalFetch lets the server's own media tools read the stream route. A
// request qualifies when it carries the process token, targets /api/v1/streams
// and originates from loopback or the listener's own address; it then skips
// the trusted-CIDR and Host/Origin checks, which would otherwise 403 ffmpeg
// whenever an operator narrows the trusted ranges. Everything else goes to
// fallback unchanged.
func internalFetch(token string, direct, fallback http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if presented := r.Header.Get(internalFetchHeader); presented != "" &&
			subtle.ConstantTimeCompare([]byte(presented), []byte(token)) == 1 &&
			strings.HasPrefix(r.URL.Path, "/api/v1/streams/") &&
			(r.Method == http.MethodGet || r.Method == http.MethodHead) &&
			isOwnAddress(r) {
			direct.ServeHTTP(w, r)
			return
		}
		fallback.ServeHTTP(w, r)
	})
}

func isOwnAddress(r *http.Request) bool {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	addr, err := netip.ParseAddr(remote)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	if addr.IsLoopback() {
		return true
	}
	if local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		if localHost, _, splitErr := net.SplitHostPort(local.String()); splitErr == nil {
			if localAddr, parseErr := netip.ParseAddr(localHost); parseErr == nil {
				return localAddr.Unmap() == addr
			}
		}
	}
	return false
}
