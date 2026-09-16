package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// refreshHarness wires a service whose single tracker answers searches with
// no results, so runTitleRefresh can be exercised synchronously end to end.
func refreshHarness(t *testing.T) (*Service, *sqlite.Repository) {
	t.Helper()
	repo, settings := retryHarness(t)
	reg, err := NewTrackerRegistry([]TrackerRegistration{fakeRegistration(newFakeTracker("filelist", "FileList", nil))})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(reg, singleEngineSet(t, "qb:", &streamingEngine{}), repo, settings)
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	return service, repo
}

func TestTitleRefreshForceBypassesOneHourDedupe(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S2 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
	})
	if err := repo.RecordSync(ctx, "catalog-title-refresh:"+titleID, 3, nil); err != nil {
		t.Fatal(err)
	}
	job, err := service.QueueTitleRefresh(ctx, titleID, "Attack on Titan", false)
	if err != nil {
		t.Fatal(err)
	}
	if job.State != "completed" || job.Label != "Title was refreshed less than one hour ago" {
		t.Fatalf("non-force refresh inside the window must be deduped, got %+v", job)
	}
	job, err = service.QueueTitleRefresh(ctx, titleID, "Attack on Titan", true)
	if err != nil {
		t.Fatal(err)
	}
	if job.State != "queued" {
		t.Fatalf("force must bypass the one-hour dedupe, got state %q label %q", job.State, job.Label)
	}
	if job.Attempt != 1 {
		t.Fatalf("forced refresh must bump the attempt, got %d", job.Attempt)
	}
}

func TestTitleRefreshForceExpiresProviderSeasons(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	seedSeasons := func(t *testing.T, repo *sqlite.Repository, titleID string) {
		t.Helper()
		if err := repo.SaveSeriesSeasons(ctx, domain.SeriesSeasons{
			Provider: "tmdb", ProviderID: "51445", Language: "ro-RO",
			Seasons:   []domain.SeriesSeason{{Number: 2, EpisodeCount: 12}},
			FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
		}); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("force deletes the cached seasons", func(t *testing.T) {
		service, repo := refreshHarness(t)
		titleID := seedPackTitle(t, repo, map[string][]string{
			"Attack on Titan S2 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
		})
		seedProviderMetadata(t, repo, titleID)
		seedSeasons(t, repo, titleID)

		service.runTitleRefresh(titleRefreshRequest{TitleID: titleID, Query: "Attack on Titan", Force: true})
		if _, err := repo.GetSeriesSeasons(ctx, "tmdb", "51445", "ro-RO"); err == nil {
			t.Fatal("a forced refresh must expire the cached provider seasons")
		}
	})

	t.Run("non-force keeps the cached seasons", func(t *testing.T) {
		service, repo := refreshHarness(t)
		titleID := seedPackTitle(t, repo, map[string][]string{
			"Attack on Titan S2 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
		})
		seedProviderMetadata(t, repo, titleID)
		seedSeasons(t, repo, titleID)

		service.runTitleRefresh(titleRefreshRequest{TitleID: titleID, Query: "Attack on Titan"})
		if _, err := repo.GetSeriesSeasons(ctx, "tmdb", "51445", "ro-RO"); err != nil {
			t.Fatalf("a plain refresh must keep the cached provider seasons: %v", err)
		}
	})
}
