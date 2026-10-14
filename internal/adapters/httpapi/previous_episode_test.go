package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPreviousEpisodeRouteMirrorsNextEpisode proves the route is registered
// and reports failures exactly as the next-episode route does.
func TestPreviousEpisodeRouteMirrorsNextEpisode(t *testing.T) {
	handler := newAnchorHTTPTest(t, &anchorHTTPProbe{}, anchorCompleteDownload())
	statuses := map[string]int{}
	for _, route := range []string{"next-episode", "previous-episode"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest(http.MethodPost, "/api/v1/downloads/missing/"+route, nil))
		statuses[route] = rec.Code
	}
	if statuses["previous-episode"] == http.StatusNotFound || statuses["previous-episode"] == http.StatusMethodNotAllowed {
		t.Fatalf("previous-episode route is not registered: %d", statuses["previous-episode"])
	}
	if statuses["previous-episode"] != statuses["next-episode"] {
		t.Fatalf("status mismatch: %v", statuses)
	}
}
