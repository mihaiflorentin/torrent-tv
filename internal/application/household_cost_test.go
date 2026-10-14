package application

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

type countingHouseholdRepo struct {
	Repository
	listDownloads, listPlayback, getRelease int
}

func (c *countingHouseholdRepo) ListDownloads(ctx context.Context) ([]domain.Download, error) {
	c.listDownloads++
	return c.Repository.ListDownloads(ctx)
}

func (c *countingHouseholdRepo) ListPlayback(ctx context.Context, profile string) ([]domain.PlaybackState, error) {
	c.listPlayback++
	return c.Repository.ListPlayback(ctx, profile)
}

func (c *countingHouseholdRepo) GetRelease(ctx context.Context, id string) (domain.TorrentRelease, error) {
	c.getRelease++
	return c.Repository.GetRelease(ctx, id)
}

// HouseholdState must not re-read the whole library once per playback row,
// nor build items for rows the display caps will discard.
func TestHouseholdStateCostDoesNotGrowPerPlaybackRow(t *testing.T) {
	repo, settings := retryHarness(t)
	ctx := context.Background()
	const rows = 120
	now := time.Now().UTC()
	for i := 0; i < rows; i++ {
		release := domain.TorrentRelease{ID: fmt.Sprintf("filelist:r%d", i), TrackerID: "filelist", TrackerName: "FileList", ProviderID: fmt.Sprintf("r%d", i), Name: fmt.Sprintf("Movie%c%c.%d.1080p.WEB-DL", 'A'+i/26, 'a'+i%26, 1990+i%30), Category: "Movies"}
		if _, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{release}); err != nil {
			t.Fatal(err)
		}
		id := fmt.Sprintf("source%d", i)
		if err := repo.SaveDownload(ctx, domain.Download{ID: id, ReleaseID: release.ID, EngineID: "qb:h", FilePath: "m.mkv", State: "complete", CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
		if err := repo.SavePlayback(ctx, domain.PlaybackState{ProfileID: householdProfile, SourceID: id, ReleaseID: release.ID, FilePath: "m.mkv", PositionMS: 950, DurationMS: 1000, Watched: true, UpdatedAt: now.Add(time.Duration(i) * time.Second)}); err != nil {
			t.Fatal(err)
		}
	}
	counting := &countingHouseholdRepo{Repository: repo}
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "qb:", &streamingEngine{}), counting, settings)
	t.Cleanup(func() { _ = service.Close(ctx) })

	state, err := service.HouseholdState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Recent) != 30 || len(state.Watched) != 50 {
		t.Fatalf("display caps changed: recent=%d watched=%d", len(state.Recent), len(state.Watched))
	}
	if counting.listDownloads > 3 || counting.listPlayback > 3 {
		t.Fatalf("library re-read per row: ListDownloads=%d ListPlayback=%d", counting.listDownloads, counting.listPlayback)
	}
	if counting.getRelease > 60 {
		t.Fatalf("items built for rows the caps discard: GetRelease=%d", counting.getRelease)
	}
}
