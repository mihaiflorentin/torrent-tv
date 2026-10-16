package jikan

import (
	"context"
	"net/http"
	"testing"
)

func episodesHandler(t *testing.T, calls *[]string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*calls = append(*calls, r.URL.RequestURI())
		switch r.URL.Path {
		case "/anime/16498/episodes":
			if r.URL.Query().Get("page") == "2" {
				_, _ = w.Write([]byte(`{"pagination":{"has_next_page":false},"data":[{"mal_id":3,"title":"Third","aired":"2013-04-21T00:00:00+00:00","score":4.5,"filler":false,"recap":true}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"pagination":{"has_next_page":true},"data":[
 {"mal_id":1,"title":"To You, in 2000 Years","aired":"2013-04-07T00:00:00+00:00","score":4.9,"filler":false,"recap":false},
 {"mal_id":2,"title":"That Day","aired":null,"score":null,"filler":true,"recap":false}]}`))
		case "/anime/16498/episodes/1":
			_, _ = w.Write([]byte(`{"data":{"mal_id":1,"title":"To You, in 2000 Years","aired":"2013-04-07T00:00:00+00:00","duration":1440,"synopsis":"Eren <i>sees</i> the wall."}}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	}
}

func TestSeasonListIsOneSeasonSizedByEpisodes(t *testing.T) {
	var calls []string
	c := infoClient(t, episodesHandler(t, &calls))
	list, err := c.SeasonList(context.Background(), "jikan", "16498", "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Seasons) != 1 || list.Seasons[0].Number != 1 || list.Seasons[0].EpisodeCount != 3 || list.Seasons[0].AirDate != "2013-04-07" || len(calls) != 2 {
		t.Fatalf("unexpected list %+v calls=%v", list, calls)
	}
}

func TestSeasonDetailMapsEpisodeFlagsAndMarksSynopsisLazy(t *testing.T) {
	var calls []string
	c := infoClient(t, episodesHandler(t, &calls))
	info, err := c.SeasonDetail(context.Background(), "jikan", "16498", 1, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Episodes) != 3 {
		t.Fatalf("episodes must page: %+v", info.Episodes)
	}
	one, two, three := info.Episodes[0], info.Episodes[1], info.Episodes[2]
	if one.Number != 1 || one.Name != "To You, in 2000 Years" || one.AirDate != "2013-04-07" || one.Rating != 4.9 || !one.LazyDetail {
		t.Fatalf("episode 1 wrong: %+v", one)
	}
	if !two.Filler || two.AirDate != "" || !three.Recap {
		t.Fatalf("flags wrong: %+v %+v", two, three)
	}
	if _, err := c.SeasonDetail(context.Background(), "jikan", "16498", 2, "en-US", ""); err == nil {
		t.Fatal("MAL lists one season only")
	}
}

func TestEpisodeDetailReadsSynopsisAndDuration(t *testing.T) {
	var calls []string
	c := infoClient(t, episodesHandler(t, &calls))
	episode, err := c.EpisodeDetail(context.Background(), "jikan", "16498", 1, 1, "en-US")
	if err != nil {
		t.Fatal(err)
	}
	if episode.Overview != "Eren sees the wall." || episode.Runtime != 24 || episode.AirDate != "2013-04-07" || episode.Number != 1 {
		t.Fatalf("episode detail wrong: %+v", episode)
	}
	if _, err := c.EpisodeDetail(context.Background(), "tmdb", "1", 1, 1, "en-US"); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}
