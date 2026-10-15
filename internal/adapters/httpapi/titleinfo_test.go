package httpapi

import (
	"context"
	"database/sql"
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

type noMetadataRepo struct{ application.Repository }

func (noMetadataRepo) GetCatalogMetadata(context.Context, string) (domain.CatalogMetadata, error) {
	return domain.CatalogMetadata{}, sql.ErrNoRows
}

func TestTitleInfoRouteAnswersUnavailableInsteadOfFailing(t *testing.T) {
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
	handler := New(service, store, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/titles/abc/info", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var info domain.TitleInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil || info.TitleID != "abc" || info.Available {
		t.Fatalf("unexpected body %s (%v)", rec.Body.String(), err)
	}
}
