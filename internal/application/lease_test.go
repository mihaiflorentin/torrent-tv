package application

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// saveStreamableDownload stores a completed local file so Acquire needs no
// engine round trip.
func saveStreamableDownload(t *testing.T, repo *sqlite.Repository, id string) domain.Download {
	t.Helper()
	path := filepath.Join(t.TempDir(), id+".mkv")
	if err := os.WriteFile(path, []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	row := domain.Download{ID: id, ReleaseID: "filelist:" + id, EngineID: "qb:" + id, FilePath: id + ".mkv", AbsolutePath: path, SizeBytes: 5, State: "pausedUP", Progress: 1, CreatedAt: now, UpdatedAt: now}
	if err := repo.SaveDownload(context.Background(), row); err != nil {
		t.Fatal(err)
	}
	return row
}

func persistedLease(t *testing.T, repo *sqlite.Repository, id string) bool {
	t.Helper()
	row, err := repo.GetDownload(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row.Leased
}

func TestLeaseHeldUntilLastStreamReleases(t *testing.T) {
	service, repo, _, ctx := newRemoveFileHarness(t)
	saveStreamableDownload(t, repo, "movie")

	for i := 0; i < 2; i++ {
		if _, err := service.Acquire(ctx, "movie"); err != nil {
			t.Fatal(err)
		}
	}
	service.Release("movie")
	if !persistedLease(t, repo, "movie") {
		t.Fatal("lease dropped while a stream is still active")
	}
	service.Release("movie")
	if persistedLease(t, repo, "movie") {
		t.Fatal("lease kept after the last stream released")
	}
}

// pollEngine answers the Status and Files calls a Downloads poll makes.
type pollEngine struct {
	TorrentEngine
}

func (pollEngine) Status(_ context.Context, hash string) (domain.DownloadStatus, error) {
	return domain.DownloadStatus{Hash: hash, State: "pausedUP", Progress: 1, TotalBytes: 5}, nil
}

func (pollEngine) Files(context.Context, string) ([]domain.TorrentFile, error) {
	return nil, nil
}

func TestSaveDownloadNeverOverwritesLease(t *testing.T) {
	repo, settings := retryHarness(t)
	ctx := context.Background()
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "qb:", pollEngine{}), repo, settings)
	row := saveStreamableDownload(t, repo, "movie")
	if _, err := service.Acquire(ctx, "movie"); err != nil {
		t.Fatal(err)
	}

	row.Leased = false
	if err := repo.SaveDownload(ctx, row); err != nil {
		t.Fatal(err)
	}
	if !persistedLease(t, repo, "movie") {
		t.Fatal("general save cleared a live lease")
	}
	if _, err := service.Downloads(ctx); err != nil {
		t.Fatal(err)
	}
	if !persistedLease(t, repo, "movie") {
		t.Fatal("download listing cleared a live lease")
	}
}

func TestResetLeasesClearsStaleLeasesAtStartup(t *testing.T) {
	service, repo, _, ctx := newRemoveFileHarness(t)
	row := saveStreamableDownload(t, repo, "movie")
	if err := repo.SetLease(ctx, row.ID, true); err != nil {
		t.Fatal(err)
	}

	if err := service.ResetLeases(ctx); err != nil {
		t.Fatal(err)
	}
	if persistedLease(t, repo, "movie") {
		t.Fatal("stale lease survived the startup reset")
	}
	if err := service.Manage(ctx, "movie", "remove", false); err != nil {
		t.Fatalf("stale lease still blocks removal: %v", err)
	}
}

func TestLeasedDownloadIsNotEvictedAndBlocksRemoval(t *testing.T) {
	repo, settings := retryHarness(t)
	retentionSettings(t, settings, 1, 0)
	engine := &retentionEngine{status: map[string]domain.DownloadStatus{
		"watching": {Hash: "watching", State: "pausedUP", Progress: 1, TotalBytes: 600 << 20},
		"spare":    {Hash: "spare", State: "pausedUP", Progress: 1, TotalBytes: 600 << 20},
	}}
	base := time.Now().UTC().Add(-3 * time.Hour)
	// The streamed row is the oldest, so it would be the victim without a lease.
	watching := saveStreamableDownload(t, repo, "watching")
	watching.EngineID = "qb:watching"
	watching.UpdatedAt = base
	if err := repo.SaveDownload(context.Background(), watching); err != nil {
		t.Fatal(err)
	}
	seedRetentionDownload(t, repo, "spare", "spare-release", "qb:spare", base.Add(time.Hour), false, 1)
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "qb:", engine), repo, settings)

	if _, err := service.Acquire(context.Background(), "watching"); err != nil {
		t.Fatal(err)
	}
	if err := service.Manage(context.Background(), "watching", "remove", false); err == nil {
		t.Fatal("removal of a leased download must be rejected")
	}
	if _, err := service.RunRetention(); err != nil {
		t.Fatal(err)
	}
	if len(engine.removed) != 1 || engine.removed[0] != "spare" {
		t.Fatalf("leased download was evicted: %v", engine.removed)
	}
}
