package subtitles

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

// roundTripFunc stands in for the network so the pinned SubDL host can be
// exercised without dialing it.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newSubDLTestProvider(t *testing.T, key string, transport http.RoundTripper) *SubDL {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	raw, err := json.Marshal(map[string]string{"subDLApiKey": key})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := config.LoadAt(path)
	if err != nil {
		t.Fatal(err)
	}
	p := NewSubDL(store)
	p.client.Transport = transport
	return p
}

func TestSubDLRedirectToOtherHostDropsAPIKey(t *testing.T) {
	const key = "subdl-secret-key-789"
	var leaked []string
	p := newSubDLTestProvider(t, key, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		rec := httptest.NewRecorder()
		if r.URL.Host == "api.subdl.com" {
			http.Redirect(rec, r, "https://elsewhere.example/landing", http.StatusFound)
			return rec.Result(), nil
		}
		for name, values := range r.Header {
			for _, value := range values {
				if strings.Contains(value, key) {
					leaked = append(leaked, name)
				}
			}
		}
		rec.Write([]byte(`{}`))
		return rec.Result(), nil
	}))
	if _, _, err := p.get(context.Background(), "/api/v2/me", nil); err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(leaked) > 0 {
		t.Fatalf("API key forwarded across hosts in headers %v", leaked)
	}
}

func TestSubDLFailedRequestErrorOmitsAPIKey(t *testing.T) {
	const key = "subdl-secret-key-789"
	p := newSubDLTestProvider(t, key, roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	}))
	_, err := p.Test(context.Background())
	if err == nil {
		t.Fatal("expected a transport failure")
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("error leaks the SubDL key: %v", err)
	}
	if !strings.Contains(err.Error(), "SubDL") {
		t.Fatalf("error must still name the provider: %v", err)
	}
}
