package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestSeasonCacheRoundTripKeysByLanguageAndSeasonAndDeletes(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	save := func(season int, language, payload string, available bool) {
		t.Helper()
		if err := r.SaveSeasonCache(ctx, domain.SeasonCacheEntry{Provider: "tmdb", ProviderID: "1", Season: season, Language: language, Available: available, Payload: []byte(payload), FetchedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
			t.Fatal(err)
		}
	}
	save(domain.SeasonListKey, "en-US", `{"list":true}`, true)
	save(0, "en-US", `{"specials":true}`, true)
	save(1, "en-US", `{"s":1}`, true)
	save(1, "ro-RO", `null`, false)
	got, err := r.GetSeasonCache(ctx, "tmdb", "1", 1, "en-US")
	if err != nil || string(got.Payload) != `{"s":1}` || !got.Available || !got.ExpiresAt.After(now) {
		t.Fatalf("season row wrong: %+v %v", got, err)
	}
	if got, _ := r.GetSeasonCache(ctx, "tmdb", "1", 1, "ro-RO"); got.Available {
		t.Fatal("negative row must keep available=false")
	}
	save(1, "en-US", `{"s":"updated"}`, true)
	if got, _ := r.GetSeasonCache(ctx, "tmdb", "1", 1, "en-US"); string(got.Payload) != `{"s":"updated"}` {
		t.Fatalf("upsert must replace the payload: %s", got.Payload)
	}
	if got, err := r.GetSeasonCache(ctx, "tmdb", "1", domain.SeasonListKey, "en-US"); err != nil || string(got.Payload) != `{"list":true}` {
		t.Fatalf("list row must not collide with season rows: %+v %v", got, err)
	}
	if err := r.DeleteSeasonCache(ctx, "tmdb", "1", "en-US"); err != nil {
		t.Fatal(err)
	}
	for _, season := range []int{domain.SeasonListKey, 0, 1} {
		if _, err := r.GetSeasonCache(ctx, "tmdb", "1", season, "en-US"); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("season %d must be gone, got %v", season, err)
		}
	}
	if _, err := r.GetSeasonCache(ctx, "tmdb", "1", 1, "ro-RO"); err != nil {
		t.Fatalf("other languages must survive a delete: %v", err)
	}
}
