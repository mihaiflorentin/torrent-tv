package tvmaze

import (
	"context"
	"net/http"
	"testing"
)

const tvmazeSeasonsJSON = `[
 {"id":9001,"number":1,"name":"","episodeOrder":10,"premiereDate":"2013-04-07","summary":"<p>First &amp; best.</p>","image":{"medium":"http://static.tvmaze.com/x.jpg"}},
 {"id":9002,"number":2,"name":"The Return","episodeOrder":null,"premiereDate":null,"summary":null}]`

func TestSeasonListMapsSeasonsWithoutPosters(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/shows/169/seasons" {
			t.Errorf("unexpected request %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(tvmazeSeasonsJSON))
	})
	list, err := c.SeasonList(context.Background(), "tvmaze", "169", "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Seasons) != 2 || !list.Available {
		t.Fatalf("unexpected list %+v", list)
	}
	first, second := list.Seasons[0], list.Seasons[1]
	if first.Name != "Season 1" || first.EpisodeCount != 10 || first.AirDate != "2013-04-07" || first.Overview != "First & best." || first.PosterPath != "" {
		t.Fatalf("season 1 wrong (images must not be proxied): %+v", first)
	}
	if second.Name != "The Return" || second.EpisodeCount != 0 || second.AirDate != "" {
		t.Fatalf("season 2 wrong: %+v", second)
	}
	if _, err := c.SeasonList(context.Background(), "tmdb", "1", "en-US", ""); err == nil {
		t.Fatal("foreign provider must be rejected")
	}
}

func TestSeasonDetailResolvesSeasonIDAndMapsEpisodes(t *testing.T) {
	var paths []string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/shows/169/seasons":
			_, _ = w.Write([]byte(tvmazeSeasonsJSON))
		case "/seasons/9001/episodes":
			_, _ = w.Write([]byte(`[
 {"id":1,"number":1,"name":" Pilot ","airdate":"2013-04-07","runtime":24,"summary":"<p>It <b>begins</b>.</p>","rating":{"average":8.4}},
 {"id":2,"number":null,"name":"Special","airdate":"2013-05-01","runtime":10,"summary":null,"rating":{"average":null}},
 {"id":3,"number":2,"name":"Second","airdate":"","runtime":null,"summary":null,"rating":{"average":null}}]`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
		}
	})
	info, err := c.SeasonDetail(context.Background(), "tvmaze", "169", 1, "en-US", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 || info.Name != "Season 1" || info.Overview != "First & best." || info.Number != 1 {
		t.Fatalf("season wrong: %v %+v", paths, info)
	}
	if len(info.Episodes) != 2 {
		t.Fatalf("specials without a number must be skipped: %+v", info.Episodes)
	}
	e := info.Episodes[0]
	if e.Number != 1 || e.Name != "Pilot" || e.AirDate != "2013-04-07" || e.Runtime != 24 || e.Rating != 8.4 || e.Overview != "It begins." || e.StillPath != "" {
		t.Fatalf("episode wrong: %+v", e)
	}
	if info.Episodes[1].AirDate != "" || info.Episodes[1].Runtime != 0 {
		t.Fatalf("missing values must stay empty: %+v", info.Episodes[1])
	}
	if _, err := c.SeasonDetail(context.Background(), "tvmaze", "169", 7, "en-US", ""); err == nil {
		t.Fatal("an unlisted season must fail so the service degrades")
	}
}
