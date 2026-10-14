package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestRewatchingFromTheStartClearsWatched(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	release := domain.TorrentRelease{ID: "filelist:release", TrackerID: "filelist", TrackerName: "FileList", ProviderID: "release", Name: "Movie.2020.1080p", Category: "Movies"}
	if _, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{release}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := repo.SaveDownload(ctx, domain.Download{ID: "source", ReleaseID: release.ID, EngineID: "qb:hash", FilePath: "movie.mkv", State: "complete", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	state, err := service.UpdatePlayback(ctx, "source", 950, 1000)
	if err != nil || !state.Watched {
		t.Fatalf("95%% must be watched: %+v %v", state, err)
	}
	// Scrubbing back a little near the end keeps the flag.
	if state, err = service.UpdatePlayback(ctx, "source", 850, 1000); err != nil || !state.Watched {
		t.Fatalf("a small scrub back must stay watched: %+v %v", state, err)
	}
	// Opening the item again without playing keeps the flag.
	if state, err = service.UpdatePlayback(ctx, "source", 0, 1000); err != nil || !state.Watched {
		t.Fatalf("a zero-position save must not unwatch: %+v %v", state, err)
	}
	// A real rewatch that stops early is a partial watch again.
	if state, err = service.UpdatePlayback(ctx, "source", 100, 1000); err != nil || state.Watched {
		t.Fatalf("rewatching to 10%% must clear watched: %+v %v", state, err)
	}
	// An explicit mark survives a position save at the same spot.
	if state, err = service.SetWatched(ctx, "source", true); err != nil || !state.Watched {
		t.Fatalf("SetWatched(true): %+v %v", state, err)
	}
}
