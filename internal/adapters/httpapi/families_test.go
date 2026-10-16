package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestEveryFamilyHasBundledArt(t *testing.T) {
	handler := newStubHandler(t, nil)
	for _, family := range domain.CategoryFamilies {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest(http.MethodGet, domain.BundledFamilyArtURL(family.Key), nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s art status = %d", family.Key, rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/svg+xml") {
			t.Fatalf("%s art content type = %q", family.Key, got)
		}
		if !strings.Contains(rec.Body.String(), "<svg") || !strings.Contains(rec.Header().Get("Cache-Control"), "max-age") {
			t.Fatalf("%s art body or caching is wrong", family.Key)
		}
	}
}

func TestBundledArtForUnknownFamilyIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	newStubHandler(t, nil).ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/families/nope/art.svg", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestCatalogTitlesRejectsUnknownFamily(t *testing.T) {
	rec := httptest.NewRecorder()
	newStubHandler(t, nil).ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/catalog/titles?family=nope", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestLibraryFamilyRejectsUnknownFamily(t *testing.T) {
	rec := httptest.NewRecorder()
	newStubHandler(t, nil).ServeHTTP(rec, newRequest(http.MethodGet, "/api/v1/library/families?family=nope", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
}
