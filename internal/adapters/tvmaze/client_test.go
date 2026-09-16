package tvmaze

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	c := New()
	c.base = server.URL
	c.http = server.Client()
	return c
}

func TestLookupMapsTVmazeShow(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/lookup/shows" || r.URL.Query().Get("imdb") != "tt0773295" {
			t.Errorf("unexpected lookup request %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, err := w.Write([]byte(`{"id":169,"name":"Attack on Titan","summary":"<p>After his hometown is destroyed &#38; his mother killed, young Eren vows to cleanse the earth of the giant humanoid Titans.</p>","premiered":"2013-04-07","genres":["Animation","Action"],"rating":{"average":8.7}}`))
		if err != nil {
			t.Fatal(err)
		}
	})
	metadata, err := c.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "en-US", "")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if metadata.Provider != "tvmaze" || metadata.ProviderID != "169" {
		t.Fatalf("provider identity not stamped: %+v", metadata)
	}
	if metadata.Title != "Attack on Titan" {
		t.Fatalf("title mismatch: %q", metadata.Title)
	}
	if strings.Contains(metadata.Overview, "<p>") || strings.Contains(metadata.Overview, "&#38;") {
		t.Fatalf("overview must be tag-stripped and unescaped: %q", metadata.Overview)
	}
	if !strings.Contains(metadata.Overview, "destroyed & his mother killed") {
		t.Fatalf("overview text lost in stripping: %q", metadata.Overview)
	}
	if metadata.Year != 2013 {
		t.Fatalf("year mismatch: %d", metadata.Year)
	}
	if len(metadata.Genres) != 2 || metadata.Genres[0] != "Animation" {
		t.Fatalf("genres mismatch: %v", metadata.Genres)
	}
	if metadata.Rating != 8.7 {
		t.Fatalf("rating mismatch: %v", metadata.Rating)
	}
	if !metadata.ExpiresAt.After(time.Now()) {
		t.Fatalf("metadata must carry a future expiry: %+v", metadata)
	}
	if metadata.PosterPath != "" || metadata.BackdropPath != "" {
		t.Fatalf("keyless providers must not claim artwork: %+v", metadata)
	}
}

func TestLookupSkipsMoviesSoTheChainFallsThrough(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("no request may be made for a movie")
	})
	if _, err := c.Lookup(context.Background(), "tt0111161", "The Shawshank Redemption", domain.MediaMovie, "en-US", ""); err == nil {
		t.Fatal("movie lookups must be rejected so the chain tries the next provider")
	}
}

func TestLookupReportsMissingMatch(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("imdb") == "tt0000001" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":169,"name":"Attack on Titan"}`))
	})
	if _, err := c.Lookup(context.Background(), "tt0000001", "Unknown", domain.MediaSeries, "en-US", ""); err == nil || !strings.Contains(err.Error(), "no TVmaze match") {
		t.Fatalf("a 404 must name the missing match, got %v", err)
	}
}

func TestSeriesSeasonsFetchesSeasonEpisodeLists(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/shows/169/seasons":
			_, _ = w.Write([]byte(`[
				{"id":8211,"number":1,"episodeOrder":25},
				{"id":8212,"number":2,"episodeOrder":12}]`))
		case "/seasons/8211/episodes":
			_, _ = w.Write([]byte(`[
				{"number":1,"name":"To You, 2,000 Years From Now","airdate":"2013-04-07"},
				{"number":2,"name":"That Day","airdate":"2013-04-14"}]`))
		case "/seasons/8212/episodes":
			_, _ = w.Write([]byte(`[{"number":1,"name":"Smoke Signal","airdate":"2017-04-01"}]`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			_, _ = w.Write([]byte(`{}`))
		}
	})
	seasons, err := c.SeriesSeasons(context.Background(), "tvmaze", "169", "en-US")
	if err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	if seasons.Provider != "tvmaze" || seasons.ProviderID != "169" || seasons.Language != "en-US" {
		t.Fatalf("season identity not stamped: %+v", seasons)
	}
	if len(seasons.Seasons) != 2 {
		t.Fatalf("expected two seasons, got %+v", seasons.Seasons)
	}
	first := seasons.Seasons[0]
	if first.Number != 1 || first.EpisodeCount != 2 || len(first.Episodes) != 2 {
		t.Fatalf("season 1 malformed: %+v", first)
	}
	if first.Episodes[0].Number != 1 || first.Episodes[0].Name != "To You, 2,000 Years From Now" || first.Episodes[0].AirDate != "2013-04-07" {
		t.Fatalf("episode detail malformed: %+v", first.Episodes[0])
	}
	if second := seasons.Seasons[1]; second.Number != 2 || second.EpisodeCount != 1 || second.Episodes[0].Name != "Smoke Signal" {
		t.Fatalf("season 2 malformed: %+v", second)
	}
	if !seasons.ExpiresAt.After(time.Now()) {
		t.Fatalf("seasons must carry a future expiry: %+v", seasons)
	}
}

func TestSeriesSeasonsRejectsForeignProviders(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("no request may be made for a foreign provider")
	})
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "169", "en-US"); err == nil {
		t.Fatal("a foreign provider must be rejected")
	}
	if _, err := c.SeriesSeasons(context.Background(), "tvmaze", "", "en-US"); err == nil {
		t.Fatal("an empty provider id must be rejected")
	}
}
