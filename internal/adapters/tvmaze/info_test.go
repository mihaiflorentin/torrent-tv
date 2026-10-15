package tvmaze

import (
	"context"
	"net/http"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestTitleInfoMapsShowAndEmbeddedCast(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/shows/169" || r.URL.Query().Get("embed") != "cast" {
			t.Errorf("unexpected request %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"id":169,"name":"Show","summary":"<p>Story &amp; more.</p>","premiered":"2013-04-07","ended":"2021-01-02","status":"Ended","averageRuntime":24,"runtime":30,
"language":"Japanese","genres":["Action"],"rating":{"average":8.7},"network":{"country":{"name":"Japan"}},
"_embedded":{"cast":[{"person":{"name":"Yuki"},"character":{"name":"Eren"}},{"person":{"name":"Solo"},"character":{"name":""}}]}}`))
	})
	info, err := c.TitleInfo(context.Background(), "tvmaze", "169", domain.MediaSeries, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if info.Overview != "Story & more." || info.ReleaseDate != "2013-04-07" || info.LastAirDate != "2021-01-02" || info.Status != "Ended" ||
		info.RuntimeMinutes != 24 || info.OriginalLanguage != "Japanese" || len(info.Countries) != 1 || info.Rating != 8.7 {
		t.Fatalf("show fields wrong: %+v", info)
	}
	if len(info.Cast) != 2 || info.Cast[0].Name != "Yuki" || info.Cast[0].Character != "Eren" || info.Cast[1].Name != "Solo" {
		t.Fatalf("cast wrong: %+v", info.Cast)
	}
	if _, err := c.TitleInfo(context.Background(), "tmdb", "1", domain.MediaSeries, "en-US", ""); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}
