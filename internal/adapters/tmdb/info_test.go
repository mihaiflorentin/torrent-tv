package tmdb

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

const movieDetailsJSON = `{
 "id": 603, "title": "The Matrix", "tagline": "Welcome to the Real World.", "overview": "A hacker learns the truth.",
 "release_date": "1999-03-30", "runtime": 136, "vote_average": 8.2, "vote_count": 25000, "status": "Released",
 "original_language": "en",
 "genres": [{"name":"Action"},{"name":"Science Fiction"}],
 "production_countries": [{"iso_3166_1":"US","name":"United States of America"}],
 "credits": {
  "cast": [{"name":"Keanu Reeves","character":"Neo","profile_path":"/neo.jpg","order":0},{"name":"No Photo","character":"","profile_path":null,"order":1}],
  "crew": [{"name":"Lana Wachowski","job":"Director"},{"name":"Someone","job":"Gaffer"},{"name":"Lilly Wachowski","job":"Director"}]
 },
 "release_dates": {"results":[
  {"iso_3166_1":"DE","release_dates":[{"certification":"16"}]},
  {"iso_3166_1":"US","release_dates":[{"certification":""},{"certification":"R"}]}]}
}`

func TestTitleInfoMovieMapsDetailsAndCredits(t *testing.T) {
	var got *http.Request
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		got = r
		writeJSON(t, w, movieDetailsJSON)
	}, "key")
	info, err := c.TitleInfo(context.Background(), "tmdb", "603", domain.MediaMovie, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.URL.Path != "/3/movie/603" || !strings.Contains(got.URL.Query().Get("append_to_response"), "credits") {
		t.Fatalf("expected one movie request with credits appended, got %s?%s", got.URL.Path, got.URL.RawQuery)
	}
	if info.Tagline != "Welcome to the Real World." || info.Overview != "A hacker learns the truth." || info.RuntimeMinutes != 136 {
		t.Fatalf("basic fields wrong: %+v", info)
	}
	if info.Rating != 8.2 || info.RatingVotes != 25000 || info.RatingProvider != "tmdb" {
		t.Fatalf("rating wrong: %+v", info)
	}
	if len(info.Cast) != 2 || info.Cast[0].Name != "Keanu Reeves" || info.Cast[0].Character != "Neo" || info.Cast[0].ImagePath != "/neo.jpg" || info.Cast[1].ImagePath != "" {
		t.Fatalf("cast wrong: %+v", info.Cast)
	}
	if len(info.Directors) != 2 || info.Directors[0] != "Lana Wachowski" {
		t.Fatalf("directors wrong: %v", info.Directors)
	}
	if info.Certification != "R" || len(info.Countries) != 1 || info.Countries[0] != "United States of America" || info.OriginalLanguage != "en" {
		t.Fatalf("facts wrong: %+v", info)
	}
	if info.Kind != domain.MediaMovie || info.Provider != "tmdb" || info.ProviderID != "603" || info.ReleaseDate != "1999-03-30" {
		t.Fatalf("identity/date wrong: %+v", info)
	}
	if len(info.Genres) != 2 {
		t.Fatalf("genres wrong: %v", info.Genres)
	}
}

func TestTitleInfoSeriesUsesTVEndpointAndCreators(t *testing.T) {
	var path string
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		writeJSON(t, w, `{"id":1,"name":"Show","overview":"O","first_air_date":"2019-01-02","last_air_date":"2022-05-06","status":"Ended",
 "episode_run_time":[45,50],"number_of_seasons":4,"number_of_episodes":40,"created_by":[{"name":"Jane Roe"}],
 "origin_country":["GB"],"content_ratings":{"results":[{"iso_3166_1":"US","rating":"TV-MA"}]},
 "credits":{"cast":[{"name":"A","character":"B"}],"crew":[]}}`)
	}, "key")
	info, err := c.TitleInfo(context.Background(), "tmdb", "1", domain.MediaSeries, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/3/tv/1" {
		t.Fatalf("path %s", path)
	}
	if info.ReleaseDate != "2019-01-02" || info.LastAirDate != "2022-05-06" || info.Status != "Ended" || info.RuntimeMinutes != 45 ||
		info.Seasons != 4 || info.Episodes != 40 || len(info.Creators) != 1 || info.Certification != "TV-MA" {
		t.Fatalf("series fields wrong: %+v", info)
	}
}

func TestTitleInfoFillsEmptyTextFromFallbackLanguage(t *testing.T) {
	var languages []string
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		lang := r.URL.Query().Get("language")
		languages = append(languages, lang)
		if lang == "ro-RO" {
			writeJSON(t, w, `{"id":1,"title":"Titlu","overview":"","tagline":"","credits":{"cast":[{"name":"A","character":"B"}]}}`)
			return
		}
		writeJSON(t, w, `{"id":1,"title":"Title","overview":"English story","tagline":"English tagline"}`)
	}, "key")
	info, err := c.TitleInfo(context.Background(), "tmdb", "1", domain.MediaMovie, "ro-RO", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	if info.Overview != "English story" || info.Tagline != "English tagline" || len(info.Cast) != 1 || len(languages) != 2 {
		t.Fatalf("fallback not applied: %+v languages=%v", info, languages)
	}
}

func TestTitleInfoCapsCastAndRejectsForeignProvider(t *testing.T) {
	cast := strings.Repeat(`{"name":"X","character":"Y"},`, 30)
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, `{"id":1,"title":"T","credits":{"cast":[`+strings.TrimSuffix(cast, ",")+`]}}`)
	}, "key")
	info, err := c.TitleInfo(context.Background(), "tmdb", "1", domain.MediaMovie, "en-US", "")
	if err != nil || len(info.Cast) != domain.MaxCastEntries {
		t.Fatalf("cast must be capped at %d: %v %d", domain.MaxCastEntries, err, len(info.Cast))
	}
	if _, err := c.TitleInfo(context.Background(), "tvmaze", "1", domain.MediaMovie, "en-US", ""); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}
