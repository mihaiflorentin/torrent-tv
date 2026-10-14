package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// deletingEngine removes the download row while Downloads() is mid-flight in
// the slow engine call, the way a concurrent DELETE /downloads/{id} would.
type deletingEngine struct {
	TorrentEngine
	onStatus func()
}

func (e *deletingEngine) Status(context.Context, string) (domain.DownloadStatus, error) {
	e.onStatus()
	return domain.DownloadStatus{State: "downloading", Progress: 0.5}, nil
}

func (e *deletingEngine) Files(context.Context, string) ([]domain.TorrentFile, error) {
	return nil, nil
}

func TestDownloadsTelemetryDoesNotResurrectDeletedRow(t *testing.T) {
	repo, settings := retryHarness(t)
	ctx := context.Background()
	release := domain.TorrentRelease{ID: "filelist:release", TrackerID: "filelist", TrackerName: "FileList", ProviderID: "release", Name: "Show.S01E02.1080p.WEB-DL", Category: "Series"}
	if _, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{release}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := repo.SaveDownload(ctx, domain.Download{ID: "episode", ReleaseID: release.ID, EngineID: "native:deadhash", FilePath: "Show.S01E02.mkv", State: "downloading", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	engine := &deletingEngine{onStatus: func() { _ = repo.DeleteDownload(ctx, "episode") }}
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "native:", engine), repo, settings)
	if _, err := service.Downloads(ctx); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.ListDownloads(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("deleted row was resurrected by telemetry upsert: %+v", rows)
	}
}
