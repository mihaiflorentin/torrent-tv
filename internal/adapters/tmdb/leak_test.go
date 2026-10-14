package tmdb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestFailedRequestErrorOmitsAPIKey(t *testing.T) {
	const key = "tmdb-secret-key-123"
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	c := New(func() string { return key })
	c.base = server.URL
	server.Close()
	_, err := c.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "en-US", "en-US")
	if err == nil {
		t.Fatal("expected a transport failure")
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("error leaks the TMDB key: %v", err)
	}
	if !strings.Contains(err.Error(), "TMDB") {
		t.Fatalf("error must still name the provider: %v", err)
	}
}
