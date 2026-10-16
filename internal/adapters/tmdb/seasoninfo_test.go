package tmdb

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

const showWithSeasonsJSON = `{"id":1399,"seasons":[
 {"season_number":0,"name":"Specials","air_date":"2010-12-05","episode_count":3,"overview":"","poster_path":null},
 {"season_number":1,"name":"Season 1","air_date":"2011-04-17","episode_count":10,"overview":"Winter is coming.","poster_path":"/s1.jpg"},
 {"season_number":2,"name":"","air_date":"bogus","episode_count":10,"overview":"","poster_path":"/s2.jpg"}]}`

func TestSeasonListMapsSeasonsAndNormalizesDates(t *testing.T) {
	var path string
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		writeJSON(t, w, showWithSeasonsJSON)
	}, "key")
	list, err := c.SeasonList(context.Background(), "tmdb", "1399", "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/3/tv/1399" || len(list.Seasons) != 3 || !list.Available {
		t.Fatalf("unexpected list %s %+v", path, list)
	}
	s1 := list.Seasons[1]
	if s1.Number != 1 || s1.Name != "Season 1" || s1.AirDate != "2011-04-17" || s1.EpisodeCount != 10 || s1.PosterPath != "/s1.jpg" || s1.Overview != "Winter is coming." {
		t.Fatalf("season 1 wrong: %+v", s1)
	}
	if list.Seasons[2].Name != "Season 2" || list.Seasons[2].AirDate != "" {
		t.Fatalf("blank name and bad date must be repaired: %+v", list.Seasons[2])
	}
	if _, err := c.SeasonList(context.Background(), "tvmaze", "1", "en-US", ""); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}

const seasonDetailJSON = `{"name":"Season 1","overview":"The first season.","air_date":"2011-04-17","poster_path":"/s1.jpg",
 "aggregate_credits":{"cast":[
  {"name":"Sean Bean","profile_path":"/sean.jpg","roles":[{"character":"Ned Stark","episode_count":9},{"character":"Ghost","episode_count":1},{"character":"Third","episode_count":1}]},
  {"name":"  ","profile_path":null,"roles":[]}]},
 "episodes":[
  {"episode_number":1,"name":"Winter Is Coming","air_date":"2011-04-17","runtime":62,"vote_average":8.1,"vote_count":120,"overview":"Ned travels.","still_path":"/e1.jpg",
   "crew":[{"name":"Tim Van Patten","job":"Director"},{"name":"David Benioff","job":"Writer"},{"name":"D. B. Weiss","job":"Teleplay"},{"name":"David Benioff","job":"Story"},{"name":"Gaffer","job":"Gaffer"}],
   "guest_stars":[{"name":"Guest One","character":"Herald","profile_path":"/g1.jpg"},{"name":"Guest Two","character":"","profile_path":null}]},
  {"episode_number":2,"name":"","air_date":"2011-04-24","runtime":null,"vote_average":0,"vote_count":0,"overview":"","still_path":null,"crew":[],"guest_stars":[]}]}`

func TestSeasonDetailMapsEpisodesCrewGuestsAndCast(t *testing.T) {
	var requests []string
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.String())
		writeJSON(t, w, seasonDetailJSON)
	}, "key")
	info, err := c.SeasonDetail(context.Background(), "tmdb", "1399", 1, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || !strings.HasPrefix(requests[0], "/3/tv/1399/season/1?") || !strings.Contains(requests[0], "append_to_response=aggregate_credits") {
		t.Fatalf("expected one season request with credits appended, got %v", requests)
	}
	if info.Name != "Season 1" || info.Overview != "The first season." || info.AirDate != "2011-04-17" || info.PosterPath != "/s1.jpg" || info.Number != 1 {
		t.Fatalf("season fields wrong: %+v", info)
	}
	if len(info.Cast) != 1 || info.Cast[0].Name != "Sean Bean" || info.Cast[0].Character != "Ned Stark / Ghost" || info.Cast[0].ImagePath != "/sean.jpg" {
		t.Fatalf("season cast wrong: %+v", info.Cast)
	}
	if len(info.Episodes) != 2 {
		t.Fatalf("episodes: %+v", info.Episodes)
	}
	e := info.Episodes[0]
	if e.Number != 1 || e.Name != "Winter Is Coming" || e.Runtime != 62 || e.Rating != 8.1 || e.VoteCount != 120 || e.StillPath != "/e1.jpg" || e.Overview != "Ned travels." {
		t.Fatalf("episode fields wrong: %+v", e)
	}
	if len(e.Directors) != 1 || e.Directors[0] != "Tim Van Patten" || len(e.Writers) != 2 || e.Writers[0] != "David Benioff" || e.Writers[1] != "D. B. Weiss" {
		t.Fatalf("crew wrong: directors=%v writers=%v", e.Directors, e.Writers)
	}
	if len(e.GuestStars) != 2 || e.GuestStars[0].Character != "Herald" || e.GuestStars[0].ImagePath != "/g1.jpg" || e.GuestStars[1].ImagePath != "" {
		t.Fatalf("guest stars wrong: %+v", e.GuestStars)
	}
}

func TestSeasonDetailFillsBlankTextFromFallbackLanguage(t *testing.T) {
	var languages []string
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		lang := r.URL.Query().Get("language")
		languages = append(languages, lang)
		if lang == "ro-RO" {
			writeJSON(t, w, `{"name":"Sezonul 1","overview":"","episodes":[{"episode_number":1,"name":"Ep","overview":""}]}`)
			return
		}
		writeJSON(t, w, `{"overview":"English season.","episodes":[{"episode_number":1,"name":"Eng","overview":"English episode."}]}`)
	}, "key")
	info, err := c.SeasonDetail(context.Background(), "tmdb", "1", 1, "ro-RO", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	if info.Overview != "English season." || info.Episodes[0].Overview != "English episode." || info.Episodes[0].Name != "Ep" || len(languages) != 2 {
		t.Fatalf("fallback not applied: %+v languages=%v", info, languages)
	}
}

func TestSeasonDetailCapsGuestStarsAndRequiresKey(t *testing.T) {
	guests := strings.TrimSuffix(strings.Repeat(`{"name":"G","character":"C"},`, 30), ",")
	c, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, `{"episodes":[{"episode_number":1,"name":"E","guest_stars":[`+guests+`]}]}`)
	}, "key")
	info, err := c.SeasonDetail(context.Background(), "tmdb", "1", 1, "en-US", "")
	if err != nil || len(info.Episodes[0].GuestStars) != 12 {
		t.Fatalf("guest stars must be capped at 12: %v %d", err, len(info.Episodes[0].GuestStars))
	}
	keyless, _ := newLookupTestClient(t, func(w http.ResponseWriter, r *http.Request) { t.Error("must not call without a key") }, "")
	if _, err := keyless.SeasonDetail(context.Background(), "tmdb", "1", 1, "en-US", ""); err == nil {
		t.Fatal("missing API key must fail")
	}
}
