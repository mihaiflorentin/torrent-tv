package httpapi

import (
	"embed"
	"fmt"
	"net/http"
	"strings"

	"github.com/mihaiflorentin/torrent-tv/internal/application"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// familyArt is the bundled, designed artwork each Category family falls back to
// when none of its titles has artwork. One SVG per family key.
//
//go:embed familyart/*.svg
var familyArt embed.FS

// catalogFamilies serves the Tracker > Categories tiles.
func (a *API) catalogFamilies(w http.ResponseWriter, r *http.Request) {
	items, err := a.service.CatalogFamilies(r.Context())
	if err != nil {
		problem(w, http.StatusInternalServerError, err)
		return
	}
	write(w, http.StatusOK, map[string]any{"items": items, "nextCursor": nil, "total": len(items)})
}

// familyArtSVG serves a family's bundled artwork. It never changes between
// releases, so clients may cache it for a day.
func (a *API) familyArtSVG(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if _, ok := domain.CategoryFamilyByKey(key); !ok {
		problem(w, http.StatusNotFound, fmt.Errorf("unknown category family"))
		return
	}
	body, err := familyArt.ReadFile("familyart/" + key + ".svg")
	if err != nil {
		problem(w, http.StatusNotFound, fmt.Errorf("family artwork not found"))
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(body)
}

// libraryFamilies serves My Library > Categories. Without a query it lists the
// families that hold managed items; with ?family= (and optionally ?category=,
// a raw tracker category inside that family) it returns that family's items.
func (a *API) libraryFamilies(w http.ResponseWriter, r *http.Request) {
	familyKey := strings.TrimSpace(r.URL.Query().Get("family"))
	if familyKey != "" {
		if _, ok := domain.CategoryFamilyByKey(familyKey); !ok {
			problem(w, http.StatusBadRequest, fmt.Errorf("unknown category family"))
			return
		}
	}
	state, err := a.service.HouseholdState(r.Context())
	if err != nil {
		problem(w, http.StatusInternalServerError, err)
		return
	}
	items := application.DedupeLibraryItems(state)
	if familyKey != "" {
		selected := application.LibraryFamilyItems(items, familyKey, strings.TrimSpace(r.URL.Query().Get("category")))
		write(w, http.StatusOK, map[string]any{"items": selected, "nextCursor": nil, "total": len(selected)})
		return
	}
	families := application.LibraryFamilies(items, a.service.CurrentFamilyQuarter())
	write(w, http.StatusOK, map[string]any{"items": families, "nextCursor": nil, "total": len(families)})
}
