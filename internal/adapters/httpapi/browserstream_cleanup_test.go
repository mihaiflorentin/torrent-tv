package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/application"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

type audioInfoProbe struct{ application.MediaProbe }

func (audioInfoProbe) ProbeMedia(context.Context, string) (domain.MediaInfo, error) {
	return domain.MediaInfo{DurationMS: 60000, AudioTracks: []domain.MediaAudioTrack{{Index: 1, Default: true}}}, nil
}

// brokenWriter models a browser that went away: headers are accepted, body
// writes fail.
type brokenWriter struct{ header http.Header }

func (w *brokenWriter) Header() http.Header       { return w.header }
func (w *brokenWriter) WriteHeader(int)           {}
func (w *brokenWriter) Write([]byte) (int, error) { return 0, errors.New("client went away") }

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestBrowserStreamWriteFailureKillsFFmpegAndLogsItsStderr(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "ffmpeg")
	script := "#!/bin/sh\necho 'ffmpeg-fatal-detail: muxer exploded' >&2\nexec yes\n"
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	settingsFile := filepath.Join(dir, "settings.json")
	b, _ := json.Marshal(map[string]any{
		"databasePath":  filepath.Join(dir, "test.db"),
		"downloadRoot":  dir,
		"listenAddress": "127.0.0.1:1",
		"ffmpegPath":    fake,
		"trustedCidrs":  []string{"127.0.0.0/8", "::1/128", "192.0.2.0/24"},
	})
	if err := os.WriteFile(settingsFile, b, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(config.EnvironmentPrefix+"SETTINGS_PATH", settingsFile)
	t.Setenv(config.EnvironmentPrefix+"DOWNLOAD_ROOT", dir)
	store, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	repo, err := sqlite.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	media := filepath.Join(dir, "movie.mkv")
	if err := os.WriteFile(media, []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	download := anchorCompleteDownload()
	download.AbsolutePath = media
	if err := repo.SaveDownload(context.Background(), download); err != nil {
		t.Fatal(err)
	}
	service := application.NewService(nil, testEngineSet(t, nil), repo, store)
	service.SetMediaProbe(audioInfoProbe{})
	logs := &syncBuffer{}
	handler := New(service, store, slog.New(slog.NewTextHandler(logs, nil)), "test")

	done := make(chan struct{})
	go func() {
		defer close(done)
		req := newRequest(http.MethodGet, "/api/v1/streams/source/browser", nil)
		handler.ServeHTTP(&brokenWriter{header: http.Header{}}, req)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("browser stream handler still running after a write failure: ffmpeg was not killed")
	}
	if got := logs.String(); !strings.Contains(got, "ffmpeg-fatal-detail") {
		t.Fatalf("ffmpeg stderr missing from log:\n%s", got)
	}
}
