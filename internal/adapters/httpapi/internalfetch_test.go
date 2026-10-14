package httpapi

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalStreamURLDialsTheListener(t *testing.T) {
	cases := map[string]string{
		":8097":            "http://127.0.0.1:8097/api/v1/streams/x",
		"0.0.0.0:8097":     "http://127.0.0.1:8097/api/v1/streams/x",
		"[::]:8097":        "http://127.0.0.1:8097/api/v1/streams/x",
		"192.168.1.5:8097": "http://192.168.1.5:8097/api/v1/streams/x",
		"[::1]:8097":       "http://[::1]:8097/api/v1/streams/x",
		"127.0.0.1:9000":   "http://127.0.0.1:9000/api/v1/streams/x",
	}
	for listen, want := range cases {
		got, err := internalStreamURL(listen, "x")
		if err != nil || got != want {
			t.Errorf("internalStreamURL(%q) = %q, %v; want %q", listen, got, err, want)
		}
	}
	if _, err := internalStreamURL("nonsense", "x"); err == nil {
		t.Error("an address without a port must fail")
	}
}

func TestInternalFetchBypassesTrustAndHostGuards(t *testing.T) {
	reached := 0
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached++ })
	rejecting := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) })
	handler := internalFetch("secret", inner, rejecting)

	do := func(remote, token, path string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = remote
		if token != "" {
			req.Header.Set(internalFetchHeader, token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := do("127.0.0.1:5000", "secret", "/api/v1/streams/x"); code != 200 || reached != 1 {
		t.Fatalf("loopback with token must reach the stream, code=%d reached=%d", code, reached)
	}
	if code := do("[::1]:5000", "secret", "/api/v1/streams/x"); code != 200 {
		t.Fatalf("IPv6 loopback with token must pass, code=%d", code)
	}
	if code := do("127.0.0.1:5000", "", "/api/v1/streams/x"); code != http.StatusForbidden {
		t.Fatalf("no token must fall through to the normal guards, code=%d", code)
	}
	if code := do("127.0.0.1:5000", "wrong", "/api/v1/streams/x"); code != http.StatusForbidden {
		t.Fatalf("wrong token must be rejected, code=%d", code)
	}
	if code := do("203.0.113.9:5000", "secret", "/api/v1/streams/x"); code != http.StatusForbidden {
		t.Fatalf("token from a foreign address must be rejected, code=%d", code)
	}
	if code := do("127.0.0.1:5000", "secret", "/api/v1/settings"); code != http.StatusForbidden {
		t.Fatalf("token must only open the stream route, code=%d", code)
	}
}

func TestInternalFetchAcceptsOwnAddressAsSource(t *testing.T) {
	reached := false
	handler := internalFetch("secret",
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }),
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/streams/x", nil)
	req.RemoteAddr = "192.168.1.5:5000"
	req.Header.Set(internalFetchHeader, "secret")
	local := &net.TCPAddr{IP: net.ParseIP("192.168.1.5"), Port: 8097}
	req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey, net.Addr(local)))
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if !reached {
		t.Fatal("a request whose source is the listener's own address is internal")
	}
}
