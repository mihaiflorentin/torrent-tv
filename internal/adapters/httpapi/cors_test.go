package httpapi

import (
	"net/http"
	"testing"
)

func passThrough(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

func TestGuardLeavesNonAPIPathsWithoutCORS(t *testing.T) {
	rec := do(guardWith(nil), "GET", "/", "192.168.1.20:8097", "https://evil.example", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 pass-through", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want empty", got)
	}
}
