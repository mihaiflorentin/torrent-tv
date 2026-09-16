package tmdb

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestSelectResultFallsBackWhenParsedKindDisagrees(t *testing.T) {
	var result findResult
	if err := json.Unmarshal([]byte(`{
		"tv_results":[{"id":123,"name":"Correct TV title","original_name":"Original","overview":"Overview","vote_average":8.2,"vote_count":42}],
		"movie_results":[{"id":456,"title":"Correct movie title","original_title":"Original movie","overview":"Movie overview","vote_average":7.1,"vote_count":12}]
	}`), &result); err != nil {
		t.Fatal(err)
	}

	got, gotKind := selectResult(findResult{TVResults: result.TVResults}, domain.MediaMovie, "en-US")
	if got.Title != "Correct TV title" || got.ProviderID != "123" {
		t.Fatalf("movie-classified TV result was discarded: %#v", got)
	}
	if gotKind != domain.MediaSeries {
		t.Fatalf("matched kind must be reported for details fetches, got %q", gotKind)
	}
	got, gotKind = selectResult(findResult{MovieResults: result.MovieResults}, domain.MediaSeries, "en-US")
	if got.Title != "Correct movie title" || got.ProviderID != "456" {
		t.Fatalf("series-classified movie result was discarded: %#v", got)
	}
	if gotKind != domain.MediaMovie {
		t.Fatalf("matched kind must be reported for details fetches, got %q", gotKind)
	}
}

func TestSelectResultStillPrefersRequestedKind(t *testing.T) {
	var result findResult
	if err := json.Unmarshal([]byte(`{"tv_results":[{"id":1,"name":"TV"}],"movie_results":[{"id":2,"title":"Movie"}]}`), &result); err != nil {
		t.Fatal(err)
	}
	if got, gotKind := selectResult(result, domain.MediaSeries, "en-US"); got.Title != "TV" || gotKind != domain.MediaSeries {
		t.Fatalf("series preference returned %#v kind %q", got, gotKind)
	}
	if got, gotKind := selectResult(result, domain.MediaMovie, "en-US"); got.Title != "Movie" || gotKind != domain.MediaMovie {
		t.Fatalf("movie preference returned %#v kind %q", got, gotKind)
	}
}

func newLookupTestClient(t *testing.T, handler http.HandlerFunc, apiKey string) (*Client, *[]*http.Request) {
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

func TestLookupFetchesGenresFromDetailsEndpoint(t *testing.T) {
	c, requests := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/3/find/tt0773295":
			if got := r.URL.Query().Get("external_source"); got != "imdb_id" {
				t.Errorf("find lost external_source: %s", r.URL.RawQuery)
			}
			writeJSON(t, w, `{"tv_results":[{"id":51445,"name":"Attack on Titan","original_name":"Shingeki no Kyojin","overview":"Overview","vote_average":8.2,"vote_count":42,"first_air_date":"2013-04-07"}]}`)
		case r.URL.Path == "/3/tv/51445":
			writeJSON(t, w, `{"genres":[{"name":"Animation"},{"name":"Action & Adventure"}]}`)
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
			writeJSON(t, w, `{}`)
		}
	}, "v3-key")
	metadata, err := c.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "ro-RO", "en-US")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(metadata.Genres) != 2 || metadata.Genres[0] != "Animation" || metadata.Genres[1] != "Action & Adventure" {
		t.Fatalf("Lookup lost the genres: %v", metadata.Genres)
	}
	if metadata.Provider != "tmdb" || metadata.ProviderID != "51445" {
		t.Fatalf("lookup identity broken: %+v", metadata)
	}
	if len(*requests) != 2 {
		t.Fatalf("expected find plus one details fetch, got %d requests", len(*requests))
	}
}

func TestLookupSurvivesDetailsFailureWithoutGenres(t *testing.T) {
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/3/find/tt0773295" {
			writeJSON(t, w, `{"tv_results":[{"id":51445,"name":"Attack on Titan","overview":"Overview"}]}`)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}, "v3-key")
	metadata, err := c.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "ro-RO", "en-US")
	if err != nil {
		t.Fatalf("a details failure must not fail the lookup, got %v", err)
	}
	if len(metadata.Genres) != 0 {
		t.Fatalf("a failed details fetch must leave genres empty, got %v", metadata.Genres)
	}
}
