package application

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

func newRemoveFileHarness(t *testing.T) (*Service, *sqlite.Repository, *removeEngine, context.Context) {
	t.Helper()
	dir := t.TempDir()
	repo, err := sqlite.Open(filepath.Join(dir, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { repo.Close() })
	settings, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	engine := &removeEngine{}
	ctx := context.Background()
	return NewService(nil, singleEngineSet(t, "qb:", engine), repo, settings), repo, engine, ctx
}

func savePackRows(t *testing.T, repo *sqlite.Repository, releaseID string, engineID string, leasedID string) {
	t.Helper()
	now := time.Now().UTC()
	rows := []domain.Download{
		{ID: "ep1", ReleaseID: releaseID, EngineID: engineID, FileIndex: 0, FilePath: "S01.E01.mkv", State: "complete", CreatedAt: now, UpdatedAt: now},
		{ID: "ep2", ReleaseID: releaseID, EngineID: engineID, FileIndex: 1, FilePath: "S01.E02.mkv", State: "complete", CreatedAt: now, UpdatedAt: now},
		{ID: "ep3", ReleaseID: releaseID, EngineID: engineID, FileIndex: 2, FilePath: "S01.E03.mkv", State: "complete", CreatedAt: now, UpdatedAt: now},
	}
	if leasedID != "" {
		rows = append(rows, domain.Download{ID: leasedID, ReleaseID: releaseID, EngineID: engineID, FileIndex: 3, FilePath: "S01.E04.mkv", State: "complete", Leased: true, CreatedAt: now, UpdatedAt: now})
	}
	for _, row := range rows {
		if err := repo.SaveDownload(context.Background(), row); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRemoveFileKeepsTorrentWhileRowsRemain(t *testing.T) {
	service, repo, engine, ctx := newRemoveFileHarness(t)
	savePackRows(t, repo, "filelist:pack", "qb:hash", "")

	if err := service.Manage(ctx, "ep2", "remove-file", false); err != nil {
		t.Fatalf("remove-file failed: %v", err)
	}
	if _, err := repo.GetDownload(ctx, "ep2"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("removed row survived: %v", err)
	}
	for _, kept := range []string{"ep1", "ep3"} {
		if _, err := repo.GetDownload(ctx, kept); err != nil {
			t.Fatalf("sibling row %s lost: %v", kept, err)
		}
	}
	if engine.deleteFiles {
		t.Fatal("torrent was removed while sibling rows remain")
	}
}

func TestRemoveFileLastRowRemovesTorrent(t *testing.T) {
	service, repo, engine, ctx := newRemoveFileHarness(t)
	savePackRows(t, repo, "filelist:pack", "qb:hash", "")

	for _, id := range []string{"ep1", "ep2", "ep3"} {
		if err := service.Manage(ctx, id, "remove-file", false); err != nil {
			t.Fatalf("remove-file %s failed: %v", id, err)
		}
	}
	if !engine.deleteFiles {
		t.Fatal("engine.Remove was not called for the emptied route")
	}
	remaining, err := repo.ListDownloads(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range remaining {
		if item.EngineID == "qb:hash" {
			t.Fatalf("row survived emptied-route removal: %#v", item)
		}
	}
}

func TestRemoveFileRejectsLeasedRow(t *testing.T) {
	service, repo, engine, ctx := newRemoveFileHarness(t)
	savePackRows(t, repo, "filelist:pack", "qb:hash", "ep4")

	if err := service.Manage(ctx, "ep4", "remove-file", false); err == nil {
		t.Fatal("leased row removal should be rejected")
	}
	if engine.deleteFiles {
		t.Fatal("rejected removal must not touch the engine")
	}
	if _, err := repo.GetDownload(ctx, "ep4"); err != nil {
		t.Fatalf("leased row must survive rejection: %v", err)
	}
}
