package httpapi

import (
	"bytes"
	"compress/gzip"
	"hash/fnv"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// gzipMinBytes is the smallest JSON body worth compressing.
const gzipMinBytes = 1024

var gzipPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed); return w }}

// jsonEncoding buffers 200 application/json responses so it can ETag them
// (GET only, answering 304 on If-None-Match) and gzip them when the client
// accepts it. The decision is made at WriteHeader: everything else (streams,
// artwork, SSE, ranges, already-encoded bodies, errors) passes through
// untouched and keeps its http.Flusher.
func jsonEncoding(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jw := &jsonWriter{ResponseWriter: w, req: r}
		next.ServeHTTP(jw, r)
		jw.finish()
	})
}

type jsonWriter struct {
	http.ResponseWriter
	req      *http.Request
	buf      bytes.Buffer
	buffered bool
	decided  bool
}

func (j *jsonWriter) WriteHeader(status int) {
	if !j.decided {
		j.decided = true
		h := j.Header()
		j.buffered = status == http.StatusOK && strings.HasPrefix(h.Get("Content-Type"), "application/json") &&
			h.Get("Content-Encoding") == "" && h.Get("Content-Range") == "" && j.req.Header.Get("Range") == ""
	}
	if !j.buffered {
		j.ResponseWriter.WriteHeader(status)
	}
}

func (j *jsonWriter) Write(p []byte) (int, error) {
	if !j.decided {
		j.WriteHeader(http.StatusOK)
	}
	if j.buffered {
		return j.buf.Write(p)
	}
	return j.ResponseWriter.Write(p)
}

func (j *jsonWriter) Flush() {
	if j.buffered {
		return
	}
	if f, ok := j.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (j *jsonWriter) finish() {
	if !j.buffered {
		return
	}
	h := j.Header()
	body := j.buf.Bytes()
	if j.req.Method == http.MethodGet {
		sum := fnv.New64a()
		_, _ = sum.Write(body)
		etag := `"` + strconv.FormatUint(sum.Sum64(), 36) + `"`
		h.Set("ETag", etag)
		if etagMatches(j.req.Header.Get("If-None-Match"), etag) {
			j.ResponseWriter.WriteHeader(http.StatusNotModified)
			return
		}
	}
	h.Add("Vary", "Accept-Encoding")
	if len(body) >= gzipMinBytes && acceptsGzip(j.req.Header.Get("Accept-Encoding")) {
		var out bytes.Buffer
		gz := gzipPool.Get().(*gzip.Writer)
		gz.Reset(&out)
		_, _ = gz.Write(body)
		_ = gz.Close()
		gzipPool.Put(gz)
		body = out.Bytes()
		h.Set("Content-Encoding", "gzip")
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	j.ResponseWriter.WriteHeader(http.StatusOK)
	if j.req.Method != http.MethodHead {
		_, _ = j.ResponseWriter.Write(body)
	}
}

func acceptsGzip(v string) bool {
	for _, part := range strings.Split(v, ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		if q, ok := strings.CutPrefix(strings.ReplaceAll(strings.ToLower(params), " ", ""), "q="); ok {
			f, err := strconv.ParseFloat(q, 64)
			return err != nil || f > 0
		}
		return true
	}
	return false
}

func etagMatches(header, etag string) bool {
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "*" || strings.TrimPrefix(part, "W/") == etag {
			return true
		}
	}
	return false
}
