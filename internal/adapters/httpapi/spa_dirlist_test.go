package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAppShellDoesNotListDirectories(t *testing.T) {
	handler := newShellHandler(t)
	for _, path := range []string{"/assets", "/assets/"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest(http.MethodGet, path, nil))
		body := rec.Body.String()
		if strings.Contains(body, "app.js") || !strings.Contains(body, `id="app"`) {
			t.Fatalf("GET %s must serve the app shell, not a listing: %q", path, body)
		}
	}
}
