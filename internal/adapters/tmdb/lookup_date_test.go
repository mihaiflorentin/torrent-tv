package tmdb

import (
	"context"
	"net/http"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestLookupReportsReleaseDateAndMatchedKind(t *testing.T) {
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/3/find/tt1" {
			writeJSON(t, w, `{"tv_results":[{"id":7,"name":"Show","first_air_date":"2019-03-14"}]}`)
			return
		}
		writeJSON(t, w, `{"genres":[]}`)
	}, "key")
	// The release was parsed as a movie but TMDB matched a series: the
	// matched kind must be reported so details use the right endpoint.
	m, err := c.Lookup(context.Background(), "tt1", "Show", domain.MediaMovie, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if m.ReleaseDate != "2019-03-14" || m.Kind != domain.MediaSeries {
		t.Fatalf("release date/kind missing: %+v", m)
	}
}
