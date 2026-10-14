package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestCatalogFiltersAreCaseInsensitiveAndIndependent(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "filters.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if _, err := r.UpsertReleases(ctx, []domain.TorrentRelease{
		{ID: "filelist:1", TrackerID: "filelist", TrackerName: "FileList", ProviderID: "1", Name: "Film.2024.1080p.WEB-DL.x265.HDR", Category: "Movies HD", CategoryID: "4", BrowseClass: "video", Seeders: 5, UploadedAt: &now},
	}); err != nil {
		t.Fatal(err)
	}
	trackers := []string{"filelist"}
	count := func(q domain.CatalogQuery) int {
		q.TrackerIDs, q.Limit = trackers, 20
		page, err := r.QueryCatalogTitleIDs(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		return len(page.Items)
	}
	if got := count(domain.CatalogQuery{Resolution: "1080P"}); got != 1 {
		t.Fatalf("resolution filter must ignore case, got %d", got)
	}
	if got := count(domain.CatalogQuery{HDR: "hdr", Codec: "X265"}); got != 1 {
		t.Fatalf("hdr and codec filters must ignore case, got %d", got)
	}
	// Two different filters sharing one value must both apply.
	if got := count(domain.CatalogQuery{Category: "Movies HD", Resolution: "Movies HD"}); got != 0 {
		t.Fatalf("both filters must apply independently, got %d", got)
	}
}

func TestQueryJobsSearchTreatsWildcardsLiterally(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	if err := r.SaveJob(ctx, domain.Job{ID: "metadata:abc", Kind: "metadata", State: "queued", Label: "Fetch", DedupeKey: "metadata:abc", UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	for _, search := range []string{"%", "_"} {
		page, err := r.QueryJobs(ctx, search, "", "", "", 0, 20, 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 0 {
			t.Fatalf("search %q must be literal, matched %d jobs", search, len(page.Items))
		}
	}
}
