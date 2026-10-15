package tmdb

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const fourSeasonShow = `{"genres":[],"seasons":[
	{"season_number":1,"episode_count":1,"name":"S1"},
	{"season_number":2,"episode_count":1,"name":"S2"},
	{"season_number":3,"episode_count":1,"name":"S3"},
	{"season_number":4,"episode_count":1,"name":"S4"}]}`

// rendezvous blocks each caller until want callers are waiting at once, so it
// only releases when requests really overlap.
type rendezvous struct {
	want    int32
	waiting atomic.Int32
	release chan struct{}
	once    sync.Once
}

func newRendezvous(want int) *rendezvous {
	return &rendezvous{want: int32(want), release: make(chan struct{})}
}

func (r *rendezvous) wait() bool {
	if r.waiting.Add(1) >= r.want {
		r.once.Do(func() { close(r.release) })
	}
	select {
	case <-r.release:
		return true
	case <-time.After(3 * time.Second):
		return false
	}
}

func TestSeriesSeasonsFetchesSeasonsAndFallbacksConcurrently(t *testing.T) {
	localized, fallback := newRendezvous(4), newRendezvous(4)
	c, _ := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/3/tv/9" {
			writeJSON(t, w, fourSeasonShow)
			return
		}
		var season int
		fmt.Sscanf(r.URL.Path, "/3/tv/9/season/%d", &season)
		if strings.Contains(r.URL.RawQuery, "en-US") {
			if !fallback.wait() {
				t.Error("fallback season requests did not overlap")
			}
			writeJSON(t, w, fmt.Sprintf(`{"episodes":[{"episode_number":1,"name":"English %d"}]}`, season))
			return
		}
		if !localized.wait() {
			t.Error("localized season requests did not overlap")
		}
		writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":""}]}`)
	}, "key")
	seasons, err := c.SeriesSeasons(context.Background(), "tmdb", "9", "ro-RO")
	if err != nil {
		t.Fatal(err)
	}
	for i, season := range seasons.Seasons {
		if want := fmt.Sprintf("English %d", i+1); season.Episodes[0].Name != want {
			t.Errorf("season %d episode name = %q, want %q (order must be preserved)", i+1, season.Episodes[0].Name, want)
		}
	}
}

func TestSeriesSeasonsSkipsFallbackForEnglishVariantsAndKeepsPlaceholderFallbacksOut(t *testing.T) {
	for _, language := range []string{"en-GB", "en-US"} {
		c, requests := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/3/tv/9" {
				writeJSON(t, w, `{"genres":[],"seasons":[{"season_number":1,"episode_count":1,"name":"S1"}]}`)
				return
			}
			writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":"Episode 1"}]}`)
		}, "key")
		if _, err := c.SeriesSeasons(context.Background(), "tmdb", "9", language); err != nil {
			t.Fatal(err)
		}
		if len(*requests) != 2 {
			t.Errorf("%s: %d requests, want show + one season", language, len(*requests))
		}
	}

	c, _ := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/3/tv/9":
			writeJSON(t, w, `{"genres":[],"seasons":[{"season_number":1,"episode_count":2,"name":"S1"}]}`)
		case strings.Contains(r.URL.RawQuery, "en-US"):
			writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":"Episode 1"},{"episode_number":2,"name":"Real Name"}]}`)
		default:
			writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":"Episodul 1"},{"episode_number":2,"name":""}]}`)
		}
	}, "key")
	seasons, err := c.SeriesSeasons(context.Background(), "tmdb", "9", "ro-RO")
	if err != nil {
		t.Fatal(err)
	}
	got := seasons.Seasons[0].Episodes
	if got[0].Name != "Episodul 1" || got[1].Name != "Real Name" {
		t.Fatalf("names = %q, %q; a placeholder fallback must not replace the localized text", got[0].Name, got[1].Name)
	}
}
