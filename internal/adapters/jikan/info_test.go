package jikan

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func infoClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	c := New()
	c.base = server.URL
	c.http = server.Client()
	return c
}

func TestTitleInfoMapsFullEntryAndCharacters(t *testing.T) {
	c := infoClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/anime/16498/full":
			_, _ = w.Write([]byte(`{"data":{"synopsis":"Humanity <b>fights</b>.","background":"","score":8.5,"scored_by":1500,"episodes":25,"status":"Finished Airing","duration":"24 min per ep","rating":"R - 17+","aired":{"from":"2013-04-07T00:00:00+00:00","to":"2013-09-29T00:00:00+00:00"},"genres":[{"name":"Action"}],"studios":[{"name":"Wit"}]}}`))
		case "/anime/16498/characters":
			_, _ = w.Write([]byte(`{"data":[{"character":{"name":"Eren"},"role":"Main","voice_actors":[{"person":{"name":"Kaji, Yuki"},"language":"English"},{"person":{"name":"Kaji, Yuuki"},"language":"Japanese"}]},{"character":{"name":"Extra"},"role":"Supporting","voice_actors":[]}]}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	info, err := c.TitleInfo(context.Background(), "jikan", "16498", domain.MediaSeries, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if info.Overview != "Humanity fights." || info.ReleaseDate != "2013-04-07" || info.LastAirDate != "2013-09-29" || info.RuntimeMinutes != 24 ||
		info.Episodes != 25 || info.Rating != 8.5 || info.RatingVotes != 1500 || info.Certification != "R - 17+" || info.Status != "Finished Airing" {
		t.Fatalf("fields wrong: %+v", info)
	}
	if len(info.Cast) != 2 || info.Cast[0].Name != "Kaji, Yuuki" || info.Cast[0].Character != "Eren" || info.Cast[1].Name != "Extra" {
		t.Fatalf("cast wrong: %+v", info.Cast)
	}
}

func TestTitleInfoSurvivesCharacterFailure(t *testing.T) {
	c := infoClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/anime/1/full" {
			_, _ = w.Write([]byte(`{"data":{"synopsis":"S"}}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	})
	info, err := c.TitleInfo(context.Background(), "jikan", "1", domain.MediaSeries, "en-US", "")
	if err != nil || info.Overview != "S" || len(info.Cast) != 0 {
		t.Fatalf("cast failure must degrade, got %+v %v", info, err)
	}
	if _, err := c.TitleInfo(context.Background(), "tmdb", "1", domain.MediaSeries, "en-US", ""); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}
