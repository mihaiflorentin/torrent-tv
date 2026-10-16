package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/application"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

func seasonInfoHandler(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	b, _ := json.Marshal(map[string]any{
		"databasePath": filepath.Join(dir, "test.db"), "downloadRoot": filepath.Join(dir, "downloads"),
		"trustedCidrs": []string{"127.0.0.0/8", "::1/128", "192.0.2.0/24"}, "torrentSessionDir": filepath.Join(dir, "torrent-session"),
	})
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(config.EnvironmentPrefix+"SETTINGS_PATH", path)
	store, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	service := application.NewService(nil, testEngineSet(t, nil), noMetadataRepo{}, store)
	return New(service, store, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
}

func TestSeasonInfoRoutesAnswerUnavailableInsteadOfFailing(t *testing.T) {
	handler := seasonInfoHandler(t)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/titles/abc/info/seasons", nil))
	var seasons domain.TitleSeasons
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &seasons) != nil || seasons.TitleID != "abc" || seasons.Available || seasons.Seasons == nil {
		t.Fatalf("seasons: status %d body %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !json.Valid([]byte(body)) || !contains(body, `"seasons":[]`) {
		t.Fatalf("seasons must serialize as an empty array, got %s", body)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/titles/abc/info/seasons/2", nil))
	var season domain.SeasonInfo
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &season) != nil || season.TitleID != "abc" || season.Number != 2 || season.Available || !contains(rec.Body.String(), `"episodes":[]`) {
		t.Fatalf("season: status %d body %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/titles/abc/info/seasons/2/episodes/5", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown episode must be 404, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestSeasonInfoRoutesRejectMalformedNumbers(t *testing.T) {
	handler := seasonInfoHandler(t)
	for _, path := range []string{
		"/api/v1/catalog/titles/abc/info/seasons/x",
		"/api/v1/catalog/titles/abc/info/seasons/-1",
		"/api/v1/catalog/titles/abc/info/seasons/99999",
		"/api/v1/catalog/titles/abc/info/seasons/1/episodes/y",
		"/api/v1/catalog/titles/abc/info/seasons/y/episodes/1",
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status %d, want 400", path, rec.Code)
		}
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
