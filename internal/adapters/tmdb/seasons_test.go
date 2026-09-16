package tmdb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newSeasonsTestClient(t *testing.T, handler http.HandlerFunc, apiKey string) (*Client, *[]*http.Request) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	var requests []*http.Request
	c := New(func() string { return apiKey })
	c.base = server.URL
	c.http = server.Client()
	c.onRequest = func(r *http.Request) { requests = append(requests, r) }
	return c, &requests
}

func writeJSON(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}

func TestSeriesSeasonsFetchesShowAndSeasons(t *testing.T) {
	c, requests := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/3/tv/51445":
			writeJSON(t, w, `{"genres":[{"id":16,"name":"Animation"},{"id":10759,"name":"Action & Adventure"}],"seasons":[
				{"season_number":0,"episode_count":5,"name":"Specials"},
				{"season_number":1,"episode_count":2,"name":"Season 1"},
				{"season_number":2,"episode_count":0,"name":"Season 2"}]}`)
		case r.URL.Path == "/3/tv/51445/season/0":
			writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":"Special episode","air_date":"2013-05-01"}]}`)
		case r.URL.Path == "/3/tv/51445/season/1":
			writeJSON(t, w, `{"episodes":[
				{"episode_number":1,"name":"To You, 2,000 Years From Now","air_date":"2013-04-07"},
				{"episode_number":2,"name":"That Day","air_date":"2013-04-14"}]}`)
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
			writeJSON(t, w, `{}`)
		}
	}, "eyJbearer-token")

	seasons, err := c.SeriesSeasons(context.Background(), "tmdb", "51445", "ro-RO")
	if err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	if seasons.Provider != "tmdb" || seasons.ProviderID != "51445" || seasons.Language != "ro-RO" {
		t.Fatalf("season identity not stamped: %+v", seasons)
	}
	if !seasons.ExpiresAt.After(time.Now()) {
		t.Fatalf("seasons must carry a future expiry: %+v", seasons)
	}
	if len(seasons.Genres) != 2 || seasons.Genres[0] != "Animation" || seasons.Genres[1] != "Action & Adventure" {
		t.Fatalf("genres not carried from show details: %v", seasons.Genres)
	}
	if len(seasons.Seasons) != 2 {
		t.Fatalf("expected specials plus season 1, got %d: %+v", len(seasons.Seasons), seasons.Seasons)
	}
	if specials := seasons.Seasons[0]; specials.Number != 0 || specials.Name != "Specials" || len(specials.Episodes) != 1 {
		t.Fatalf("specials malformed: %+v", specials)
	}
	season := seasons.Seasons[1]
	if season.Number != 1 || season.Name != "Season 1" || season.EpisodeCount != 2 || len(season.Episodes) != 2 {
		t.Fatalf("season 1 malformed: %+v", season)
	}
	if season.Episodes[0].Number != 1 || season.Episodes[0].Name != "To You, 2,000 Years From Now" || season.Episodes[0].AirDate != "2013-04-07" {
		t.Fatalf("episode 1 malformed: %+v", season.Episodes[0])
	}
	paths := make([]string, 0, len(*requests))
	for _, r := range *requests {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
	}
	if len(paths) != 3 {
		t.Fatalf("expected show fetch plus two season fetches, got %v", paths)
	}
	if paths[0] != "/3/tv/51445?language=ro-RO" {
		t.Fatalf("show fetch lost the language parameter: %s", paths[0])
	}
	if paths[1] != "/3/tv/51445/season/0?language=ro-RO" || paths[2] != "/3/tv/51445/season/1?language=ro-RO" {
		t.Fatalf("season fetches have wrong shape: %s", paths)
	}
}

func TestSeriesSeasonsUsesBearerAuthForV4Token(t *testing.T) {
	c, requests := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer eyJbearer-token" {
			t.Errorf("v4 token must ride the Authorization header, got %q", got)
		}
		if got := r.URL.Query().Get("api_key"); got != "" {
			t.Errorf("v4 token must not be sent as api_key, got %q", got)
		}
		writeJSON(t, w, `{"seasons":[]}`)
	}, "eyJbearer-token")
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "51445", "en-US"); err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	if len(*requests) == 0 {
		t.Fatal("handler saw no requests")
	}
}

func TestSeriesSeasonsUsesAPIKeyQueryForV3Key(t *testing.T) {
	c, _ := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("v3 key must not ride the Authorization header, got %q", got)
		}
		if got := r.URL.Query().Get("api_key"); got != "v3-key" {
			t.Errorf("v3 key must ride api_key, got %q", got)
		}
		writeJSON(t, w, `{"seasons":[]}`)
	}, "v3-key")
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "51445", "en-US"); err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
}

func TestSeriesSeasonsSurfacesHTTPStatus(t *testing.T) {
	c, _ := newSeasonsTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}, "v3-key")
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "51445", "en-US"); err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("HTTP failures must keep their status in the error, got %v", err)
	}
}

func TestSeriesSeasonsRejectsWrongProvider(t *testing.T) {
	c, _ := newSeasonsTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("no request may be made for a foreign provider")
	}, "v3-key")
	if _, err := c.SeriesSeasons(context.Background(), "tvmaze", "1", "en-US"); err == nil {
		t.Fatal("a foreign provider must be rejected")
	}
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "", "en-US"); err == nil {
		t.Fatal("an empty provider id must be rejected")
	}
}

func TestSeriesSeasonsCapsSeasonFetches(t *testing.T) {
	c, requests := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/3/tv/51445" {
			var seasons []string
			for i := range 40 {
				seasons = append(seasons, `{"season_number":`+strconv.Itoa(i)+`,"episode_count":12,"name":"Season"}`)
			}
			writeJSON(t, w, `{"seasons":[`+strings.Join(seasons, ",")+`]}`)
			return
		}
		writeJSON(t, w, `{"episodes":[]}`)
	}, "v3-key")
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "51445", "en-US"); err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	// One show fetch + at most 30 season fetches.
	if len(*requests) > 31 {
		t.Fatalf("season fetch cap exceeded: %d requests", len(*requests))
	}
}
