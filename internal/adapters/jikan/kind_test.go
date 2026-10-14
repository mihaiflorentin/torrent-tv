package jikan

import (
	"context"
	"net/http"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// A live-action film that shares an anime series title must not take the
// anime's synopsis; kind has to agree with the MAL entry type.
func TestLookupRequiresKindToAgreeWithEntryType(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"data":[
			{"mal_id":1,"type":"TV","title":"Death Note","title_english":"Death Note","year":2006},
			{"mal_id":2,"type":"Movie","title":"Death Note","title_english":"Death Note","year":2017}
		]}`)
	})
	movie, err := c.Lookup(context.Background(), "", "Death Note", domain.MediaMovie, "en-US", "")
	if err != nil || movie.ProviderID != "2" {
		t.Fatalf("a movie lookup must pick the Movie entry, got %+v %v", movie, err)
	}
	series, err := c.Lookup(context.Background(), "", "Death Note", domain.MediaSeries, "en-US", "")
	if err != nil || series.ProviderID != "1" {
		t.Fatalf("a series lookup must pick the TV entry, got %+v %v", series, err)
	}

	seriesOnly := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, `{"data":[{"mal_id":1,"type":"TV","title":"Dune","title_english":"Dune","year":2001}]}`)
	})
	if _, err := seriesOnly.Lookup(context.Background(), "", "Dune", domain.MediaMovie, "en-US", ""); err == nil {
		t.Fatal("a live-action movie must not match an anime TV series of the same title")
	}
}
