package composition

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

type countingBody struct {
	io.Reader
	closed atomic.Int32
}

func (c *countingBody) Close() error {
	c.closed.Add(1)
	return nil
}

func TestAssetBodyClosesPreviousBodyBeforeResuming(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), 1000)
	total := int64(len(payload))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start, _ := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(r.Header.Get("Range"), "bytes="), "-"), 10, 64)
		w.Header().Set("Content-Range", "bytes "+strconv.FormatInt(start, 10)+"-"+strconv.FormatInt(total-1, 10)+"/"+strconv.FormatInt(total, 10))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[start:])
	}))
	defer srv.Close()

	first := &countingBody{Reader: bytes.NewReader(payload[:600])}
	body := &completingAssetBody{
		ctx: context.Background(), client: srv.Client(), url: srv.URL,
		length: total, body: first,
	}
	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("completed body = %d bytes, want %d", len(got), total)
	}
	if n := first.closed.Load(); n != 1 {
		t.Fatalf("replaced body closed %d times, want 1", n)
	}
}

func TestStartupFailureClosesRepository(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	dbPath := filepath.Join(dir, "test.db")
	// A regular file where the session directory belongs makes the native
	// engine fail after the repository is already open.
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	body := `{"listenAddress": "127.0.0.1:0",` +
		` "torrentSessionDir": "` + filepath.Join(blocker, "session") + `",` +
		` "databasePath": "` + dbPath + `",` +
		` "artworkCachePath": "` + filepath.Join(dir, "artwork") + `",` +
		` "downloadRoot": "` + filepath.Join(dir, "downloads") + `"}`
	if err := os.WriteFile(settingsPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAt(settingsPath, testLogger()); err == nil {
		t.Fatal("NewAt succeeded with an unusable session directory")
	}
	// SQLite removes its WAL sidecar only when the last connection closes.
	if _, err := os.Stat(dbPath + "-wal"); !os.IsNotExist(err) {
		t.Fatalf("database still open after startup failure (wal stat err = %v)", err)
	}
}
