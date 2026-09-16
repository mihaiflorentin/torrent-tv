package jikan

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
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

func TestLookupMatchesNormalizedTitle(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/anime" {
			t.Errorf("unexpected search path %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("q"); got != "Attack on Titan" {
			t.Errorf("search lost the title query, got %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Errorf("search must cap candidates at 5, got %q", got)
		}
		writeJSON(t, w, `{"data":[
			{"mal_id":5114,"title":"Fullmetal Alchemist: Brotherhood","title_english":"Fullmetal Alchemist: Brotherhood","title_japanese":"鋼の錬金術師 FULLMETAL ALCHEMIST","score":9.1,"year":2009},
			{"mal_id":16498,"title":"Shingeki no Kyojin","title_english":"Attack on Titan","title_japanese":"進撃の巨人","synopsis":"<p>After his hometown is destroyed, young Eren Jaeger vows to cleanse the earth of the giant humanoid Titans.</p>","score":8.56,"year":2013,
			 "genres":[{"name":"Action"},{"name":"Drama"}]}
		]}`)
	})
	metadata, err := c.Lookup(context.Background(), "", "Attack on Titan", domain.MediaSeries, "en-US", "")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if metadata.Provider != "jikan" || metadata.ProviderID != "16498" {
		t.Fatalf("provider identity not stamped: %+v", metadata)
	}
	if metadata.Title != "Attack on Titan" {
		t.Fatalf("expected english title preference, got %q", metadata.Title)
	}
	if strings.Contains(metadata.Overview, "<p>") {
		t.Fatalf("overview must be tag-stripped: %q", metadata.Overview)
	}
	if !strings.Contains(metadata.Overview, "After his hometown is destroyed") {
		t.Fatalf("overview text lost: %q", metadata.Overview)
	}
	if len(metadata.Genres) != 2 || metadata.Genres[0] != "Action" {
		t.Fatalf("genres mismatch: %v", metadata.Genres)
	}
	if metadata.Rating != 8.56 || metadata.Year != 2013 {
		t.Fatalf("rating/year mismatch: %+v", metadata)
	}
	if !metadata.ExpiresAt.After(time.Now()) {
		t.Fatalf("metadata must carry a future expiry: %+v", metadata)
	}
}

func TestLookupRejectsUnmatchedCandidates(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"data":[
			{"mal_id":1,"title":"Cowboy Bebop","title_english":"Cowboy Bebop","title_japanese":"カウボーイビバップ"},
			{"mal_id":2,"title":"Trigun","title_english":"Trigun","title_japanese":"トライガン"}
		]}`)
	})
	if _, err := c.Lookup(context.Background(), "", "Attack on Titan", domain.MediaSeries, "en-US", ""); err == nil {
		t.Fatal("an unmatched search must error so the chain falls through")
	}
}

func TestSeriesSeasonsCollectsPaginatedEpisodes(t *testing.T) {
	var pages atomic.Int32
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/anime/16498/episodes" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		page := r.URL.Query().Get("page")
		if page == "" || page == "1" {
			pages.Add(1)
			writeJSON(t, w, `{"pagination":{"has_next_page":true},"data":[
				{"mal_id":1,"title":"To You, 2,000 Years From Now","aired":{"date":"2013-04-07"}},
				{"mal_id":2,"title":"That Day","aired":{"date":"2013-04-14"}}]}`)
			return
		}
		if page == "2" {
			pages.Add(1)
			writeJSON(t, w, `{"pagination":{"has_next_page":false},"data":[
				{"mal_id":3,"title":"A Dim Light Amid Despair","aired":{"date":"2013-04-21"}}]}`)
			return
		}
		t.Errorf("unexpected page %q", page)
		writeJSON(t, w, `{"pagination":{"has_next_page":false},"data":[]}`)
	})
	seasons, err := c.SeriesSeasons(context.Background(), "jikan", "16498", "en-US")
	if err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	if seasons.Provider != "jikan" || seasons.ProviderID != "16498" {
		t.Fatalf("season identity not stamped: %+v", seasons)
	}
	if len(seasons.Seasons) != 1 || seasons.Seasons[0].Number != 1 {
		t.Fatalf("MAL entries project to one flat season, got %+v", seasons.Seasons)
	}
	episodes := seasons.Seasons[0].Episodes
	if len(episodes) != 3 {
		t.Fatalf("expected all paginated episodes, got %d", len(episodes))
	}
	for i, episode := range episodes {
		if episode.Number != i+1 {
			t.Fatalf("episodes must be numbered 1..N, got %d at index %d", episode.Number, i)
		}
	}
	if episodes[2].Name != "A Dim Light Amid Despair" || episodes[2].AirDate != "2013-04-21" {
		t.Fatalf("last page lost detail: %+v", episodes[2])
	}
	if pages.Load() != 2 {
		t.Fatalf("expected two page fetches, got %d", pages.Load())
	}
}

func TestSeriesSeasonsCapsPagination(t *testing.T) {
	var pages atomic.Int32
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		number := 1
		if page != "" {
			number, _ = strconv.Atoi(page)
		}
		if number > 40 {
			t.Errorf("pagination ran past the cap to page %d", number)
		}
		pages.Add(1)
		entries := make([]string, 10)
		for i := range 10 {
			entries[i] = fmt.Sprintf(`{"mal_id":%d,"title":"Episode %d","aired":{"date":"2013-04-07"}}`, number*100+i, i+1)
		}
		writeJSON(t, w, `{"pagination":{"has_next_page":true},"data":[`+strings.Join(entries, ",")+`]}`)
	})
	seasons, err := c.SeriesSeasons(context.Background(), "jikan", "16498", "en-US")
	if err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	// Cap is 20 pages; the handler would have flagged page 41.
	if pages.Load() > 20 {
		t.Fatalf("pagination cap exceeded: %d pages", pages.Load())
	}
	if got := len(seasons.Seasons[0].Episodes); got < 200 {
		t.Fatalf("capped fetch should still aggregate every fetched page, got %d episodes", got)
	}
}

func TestSeriesSeasonsRejectsForeignProviders(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("no request may be made for a foreign provider")
	})
	if _, err := c.SeriesSeasons(context.Background(), "tmdb", "16498", "en-US"); err == nil {
		t.Fatal("a foreign provider must be rejected")
	}
	if _, err := c.SeriesSeasons(context.Background(), "jikan", "", "en-US"); err == nil {
		t.Fatal("an empty provider id must be rejected")
	}
}

func writeJSON(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}
