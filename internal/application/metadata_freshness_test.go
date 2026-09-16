package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// TestEnsureMetadataSkipsFreshKeylessProviderRows pins the cache-freshness
// gate: a complete provider row counts as fresh even when the provider never
// reports rating votes (TVmaze and Jikan do not), otherwise every title
// detail view would requeue a metadata lookup for the full cache lifetime.
func TestEnsureMetadataSkipsFreshKeylessProviderRows(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	release := domain.TorrentRelease{
		TrackerID: "filelist", TrackerName: "FileList", ProviderID: "aot-e5",
		Name: "Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP", Category: "TV-Series HD",
		IMDbID: "tt0773295", Seeders: 5, SizeBytes: 1 << 30,
	}
	stored, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{release})
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tvmaze"})

	now := time.Now().UTC()
	fresh := domain.CatalogMetadata{
		TitleID: titleID, Provider: "tvmaze", ProviderID: "169", Title: "Attack on Titan",
		Year: 2013, Rating: 8.7, FetchedAt: now, ExpiresAt: now.Add(24 * time.Hour),
	}
	if err := repo.SaveCatalogMetadata(ctx, fresh); err != nil {
		t.Fatal(err)
	}
	if queued := service.ensureMetadata(ctx, []string{titleID}, false); queued != 0 {
		t.Fatalf("a fresh keyless-provider row must not requeue metadata, got %d jobs", queued)
	}

	fresh.ExpiresAt = now.Add(-time.Hour)
	if err := repo.SaveCatalogMetadata(ctx, fresh); err != nil {
		t.Fatal(err)
	}
	if queued := service.ensureMetadata(ctx, []string{titleID}, false); queued != 1 {
		t.Fatalf("an expired row must requeue metadata, got %d jobs", queued)
	}
}
