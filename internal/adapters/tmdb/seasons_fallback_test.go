package tmdb

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// Untranslated episode names (empty or "Episode N" placeholders) fall back to
// en-US for just those episodes, like Lookup does for titles.
func TestSeriesSeasonsFillsUntranslatedEpisodeNamesFromEnglish(t *testing.T) {
	c, requests := newSeasonsTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/3/tv/9":
			writeJSON(t, w, `{"genres":[],"seasons":[{"season_number":1,"episode_count":3,"name":"Sezonul 1"}]}`)
		case r.URL.Path == "/3/tv/9/season/1" && strings.Contains(r.URL.RawQuery, "ro-RO"):
			writeJSON(t, w, `{"episodes":[
				{"episode_number":1,"name":"Pilot tradus"},
				{"episode_number":2,"name":""},
				{"episode_number":3,"name":"Episodul 3"}]}`)
		case r.URL.Path == "/3/tv/9/season/1" && strings.Contains(r.URL.RawQuery, "en-US"):
			writeJSON(t, w, `{"episodes":[
				{"episode_number":1,"name":"Pilot"},
				{"episode_number":2,"name":"The Second One"},
				{"episode_number":3,"name":"The Third One"}]}`)
		default:
			t.Errorf("unexpected request %s?%s", r.URL.Path, r.URL.RawQuery)
			writeJSON(t, w, `{}`)
		}
	}, "key")
	seasons, err := c.SeriesSeasons(context.Background(), "tmdb", "9", "ro-RO")
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, episode := range seasons.Seasons[0].Episodes {
		names = append(names, episode.Name)
	}
	if strings.Join(names, "|") != "Pilot tradus|The Second One|The Third One" {
		t.Fatalf("names = %v", names)
	}
	if len(*requests) != 3 {
		t.Fatalf("expected show, ro-RO season and one en-US season fetch, got %d", len(*requests))
	}
}
