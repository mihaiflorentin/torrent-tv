package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// A failed refresh of an expired row must not wipe the poster, overview and
// provider identity the row already holds.
func TestFailedMetadataRefreshKeepsExistingMetadata(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	stored, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{{
		TrackerID: "filelist", TrackerName: "FileList", ProviderID: "aot-e5",
		Name: "Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP", Category: "TV-Series HD",
		IMDbID: "tt0773295", Seeders: 5, SizeBytes: 1 << 30,
	}})
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	provider := &stubMetaProvider{id: "tmdb", lookupErr: errors.New("429 too many requests")}
	service.SetMetadataProvider(provider)
	now := time.Now().UTC()
	if err := repo.SaveCatalogMetadata(ctx, domain.CatalogMetadata{
		TitleID: titleID, Provider: "tmdb", ProviderID: "51445", Title: "Attack on Titan", Year: 2013,
		Overview: "Giants.", PosterPath: "/p.jpg", FetchedAt: now.Add(-40 * 24 * time.Hour), ExpiresAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if queued := service.ensureMetadata(ctx, []string{titleID}, false); queued != 1 {
		t.Fatalf("expired row must queue, got %d", queued)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		m, err := repo.GetCatalogMetadata(ctx, titleID)
		if err == nil && m.LastError != "" {
			if m.ProviderID != "51445" || m.PosterPath != "/p.jpg" || m.Overview != "Giants." || m.Title != "Attack on Titan" {
				t.Fatalf("failed refresh wiped metadata: %+v", m)
			}
			if !m.ExpiresAt.After(time.Now()) {
				t.Fatalf("failure must back off, expires %v", m.ExpiresAt)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("refresh never recorded its failure")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Rows that failed recently (negative cache) are not re-queued before the
// backoff elapses.
func TestEnsureMetadataHonoursNegativeCache(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	stored, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{{
		TrackerID: "filelist", TrackerName: "FileList", ProviderID: "x1",
		Name: "Some.Obscure.Show.S01E01.1080p.WEB-DL-GROUP", Category: "TV-Series HD",
		IMDbID: "tt9999999", Seeders: 5, SizeBytes: 1 << 30,
	}})
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb"})
	now := time.Now().UTC()
	if err := repo.SaveCatalogMetadata(ctx, domain.CatalogMetadata{
		TitleID: titleID, Provider: "tmdb", FetchedAt: now, ExpiresAt: now.Add(10 * time.Minute), LastError: "no match",
	}); err != nil {
		t.Fatal(err)
	}
	if queued := service.ensureMetadata(ctx, []string{titleID}, false); queued != 0 {
		t.Fatalf("negative-cached row must not requeue, got %d", queued)
	}
	if queued := service.ensureMetadata(ctx, []string{titleID}, true); queued != 1 {
		t.Fatalf("force must bypass the negative cache, got %d", queued)
	}
}

func seasonsCacheHarness(t *testing.T) (*Service, *stubMetaProvider) {
	service, _ := refreshHarness(t)
	provider := &stubMetaProvider{id: "tmdb", seasonErr: errors.New("boom")}
	service.SetMetadataProvider(provider)
	return service, provider
}

func TestSeriesSeasonsNegativeCacheIsHonoured(t *testing.T) {
	service, provider := seasonsCacheHarness(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := service.seriesSeasons(ctx, "tmdb", "1"); err == nil {
			t.Fatal("expected provider error")
		}
	}
	if provider.seasonCalls != 1 {
		t.Fatalf("failure must be negatively cached, provider called %d times", provider.seasonCalls)
	}
}

func TestSeriesSeasonsFailureKeepsStaleGoodCache(t *testing.T) {
	service, provider := seasonsCacheHarness(t)
	ctx := context.Background()
	now := time.Now().UTC()
	language := service.settings.Get().MetadataLanguage
	if err := service.repo.SaveSeriesSeasons(ctx, domain.SeriesSeasons{
		Provider: "tmdb", ProviderID: "1", Language: language,
		Seasons:   []domain.SeriesSeason{{Number: 1, EpisodeCount: 10}},
		FetchedAt: now.Add(-40 * 24 * time.Hour), ExpiresAt: now.Add(-time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	got, err := service.seriesSeasons(ctx, "tmdb", "1")
	if err != nil || len(got.Seasons) != 1 {
		t.Fatalf("stale payload should serve while the provider fails: %v %+v", err, got)
	}
	cached, err := service.repo.GetSeriesSeasons(ctx, "tmdb", "1", language)
	if err != nil || len(cached.Seasons) != 1 {
		t.Fatalf("good payload overwritten: %v %+v", err, cached)
	}
	if _, err := service.seriesSeasons(ctx, "tmdb", "1"); err != nil || provider.seasonCalls != 1 {
		t.Fatalf("backoff should hold: err=%v calls=%d", err, provider.seasonCalls)
	}
}
