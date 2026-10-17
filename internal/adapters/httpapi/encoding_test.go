package httpapi

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func bigDetail() map[string]any {
	sources := make([]map[string]any, 723)
	for i := range sources {
		sources[i] = map[string]any{"id": i, "release": map[string]any{"name": "South.Park.S01E01.1080p.WEB-DL.x264-GRP", "trackerId": "filelist", "seeders": i % 40, "sizeBytes": 1_500_000_000 + i*7919, "infoHash": strings.Repeat("ab", 20)}}
	}
	return map[string]any{"title": map[string]any{"id": "t1"}, "sources": sources}
}

func encodingServer() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/catalog/titles/{id}", func(w http.ResponseWriter, r *http.Request) { write(w, 200, bigDetail()) })
	mux.HandleFunc("GET /api/v1/tiny", func(w http.ResponseWriter, r *http.Request) { write(w, 200, map[string]string{"ok": "yes"}) })
	raw := func(contentType string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", contentType)
			_, _ = w.Write(bytes.Repeat([]byte("x"), 4096))
			w.(http.Flusher).Flush()
		}
	}
	mux.HandleFunc("GET /api/v1/streams/{id}", raw("video/mp4"))
	mux.HandleFunc("GET /api/v1/artwork/{id}", raw("image/jpeg"))
	mux.HandleFunc("GET /api/v1/events", raw("text/event-stream"))
	return jsonEncoding(mux)
}

func get(h http.Handler, path string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", path, nil)
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestJSONIsGzippedWhenAccepted(t *testing.T) {
	h := encodingServer()
	plain := get(h, "/api/v1/catalog/titles/t1", nil)
	if plain.Header().Get("Content-Encoding") != "" || plain.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("plain request encoded: %v", plain.Header())
	}
	rec := get(h, "/api/v1/catalog/titles/t1", map[string]string{"Accept-Encoding": "gzip, deflate"})
	if rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("headers = %v", rec.Header())
	}
	wire := rec.Body.Len()
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if !bytes.Equal(body, plain.Body.Bytes()) || !json.Valid(body) {
		t.Fatal("gzip body differs from the identity body")
	}
	t.Logf("json %d bytes -> gzip %d bytes (%.1f%%)", len(body), wire, 100*float64(wire)/float64(len(body)))
	if get(h, "/api/v1/catalog/titles/t1", map[string]string{"Accept-Encoding": "gzip;q=0"}).Header().Get("Content-Encoding") != "" {
		t.Fatal("gzip;q=0 must not be encoded")
	}
}

func TestSmallJSONIsNotGzipped(t *testing.T) {
	rec := get(encodingServer(), "/api/v1/tiny", map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "" || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("tiny body encoded: %v", rec.Header())
	}
}

func TestStreamsAndArtworkAreNeverEncoded(t *testing.T) {
	h := encodingServer()
	for _, path := range []string{"/api/v1/streams/1", "/api/v1/artwork/1", "/api/v1/events"} {
		rec := get(h, path, map[string]string{"Accept-Encoding": "gzip"})
		if rec.Header().Get("Content-Encoding") != "" || rec.Header().Get("ETag") != "" || rec.Body.Len() != 4096 || !rec.Flushed {
			t.Fatalf("%s was touched: %v len=%d flushed=%v", path, rec.Header(), rec.Body.Len(), rec.Flushed)
		}
	}
}

func TestJSONETagAnswers304(t *testing.T) {
	h := encodingServer()
	first := get(h, "/api/v1/catalog/titles/t1", map[string]string{"Accept-Encoding": "gzip"})
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	for _, accept := range []string{"", "gzip"} {
		rec := get(h, "/api/v1/catalog/titles/t1", map[string]string{"If-None-Match": etag, "Accept-Encoding": accept})
		if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 || rec.Header().Get("ETag") != etag {
			t.Fatalf("accept %q: status %d body %d", accept, rec.Code, rec.Body.Len())
		}
	}
	if rec := get(h, "/api/v1/catalog/titles/t1", map[string]string{"If-None-Match": `"stale"`}); rec.Code != 200 || rec.Header().Get("ETag") != etag {
		t.Fatalf("stale etag: status %d etag %q", rec.Code, rec.Header().Get("ETag"))
	}
}

func TestCORSExposesETagAndAllowsIfNoneMatch(t *testing.T) {
	h := guardWith(nil)
	rec := do(h, "GET", "/api/v1/catalog/titles/x", "192.168.1.20:8097", "null", nil)
	if rec.Header().Get("Access-Control-Expose-Headers") != "ETag" {
		t.Fatalf("expose = %q", rec.Header().Get("Access-Control-Expose-Headers"))
	}
	rec = do(h, "OPTIONS", "/api/v1/catalog/titles/x", "192.168.1.20:8097", "null", map[string]string{"Access-Control-Request-Method": "GET"})
	if !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "If-None-Match") {
		t.Fatalf("allow headers = %q", rec.Header().Get("Access-Control-Allow-Headers"))
	}
}
