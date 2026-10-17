package application

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// seedSyntheticCatalog stores n titles spread over the tracker categories the
// production catalog has, a third of them with a second release, and gives
// most of them artwork and a rating.
func seedSyntheticCatalog(tb testing.TB, n int) *Service {
	tb.Helper()
	service, repo := projectionHarness(tb)
	ctx := context.Background()
	categories := []string{"Movies HD", "Movies Blu-Ray", "Movies 4K", "Movies DVD-RO", "TV-Series HD", "TV-Series SD", "Anime", "Cartoons", "Documentary", "Sport", "Videoclip", "Misc"}
	now := time.Now().UTC()
	var batch []domain.TorrentRelease
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if _, err := repo.UpsertReleases(ctx, batch); err != nil {
			tb.Fatal(err)
		}
		batch = batch[:0]
	}
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("Synthetic.Title.%05d.%d.1080p.WEB-DL", i, 1980+i%45)
		uploaded := now.Add(-time.Duration(i) * time.Minute)
		batch = append(batch, domain.TorrentRelease{TrackerID: "filelist", TrackerName: "FileList", ProviderID: fmt.Sprintf("r%d", i), Name: name, Category: categories[i%len(categories)], Seeders: 1 + i%40, UploadedAt: &uploaded})
		if i%3 == 0 {
			batch = append(batch, domain.TorrentRelease{TrackerID: "filelist", TrackerName: "FileList", ProviderID: fmt.Sprintf("s%d", i), Name: name[:len(name)-6] + "BluRay", Category: categories[(i+1)%len(categories)], Seeders: 1 + i%7, UploadedAt: &uploaded})
		}
		if len(batch) >= 500 {
			flush()
		}
	}
	flush()
	rows, err := repo.CatalogFamilyRows(ctx, service.eligibleTrackerIDs())
	if err != nil {
		tb.Fatal(err)
	}
	seen := map[string]bool{}
	for _, row := range rows {
		if seen[row.TitleID] {
			continue
		}
		seen[row.TitleID] = true
		k := len(seen)
		if k%5 == 0 {
			continue
		}
		meta := domain.CatalogMetadata{TitleID: row.TitleID, Provider: "tmdb", Title: "T " + row.TitleID, Rating: float64(k%90) / 10, PosterPath: "/p.jpg", FetchedAt: now, ExpiresAt: now.Add(time.Hour)}
		if k%2 == 0 {
			meta.BackdropPath = "/b.jpg"
		}
		if err := repo.SaveCatalogMetadata(ctx, meta); err != nil {
			tb.Fatal(err)
		}
	}
	return service
}

// BenchmarkCatalogFamiliesCold times one uncached CatalogFamilies computation
// over ~10k titles with every family art pick already stored, the steady
// state once a quarter's picks exist.
func BenchmarkCatalogFamiliesCold(b *testing.B) {
	service := seedSyntheticCatalog(b, 10000)
	ctx := context.Background()
	if _, err := service.CatalogFamilies(ctx); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		service.invalidateFamilies()
		if _, err := service.CatalogFamilies(ctx); err != nil {
			b.Fatal(err)
		}
	}
}

// TestCatalogFamiliesColdBudget guards the first (cold) computation on a 10k
// catalog, which also draws and stores every art pick, far below the 21 s the
// per-family queries took on the Pi.
func TestCatalogFamiliesColdBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("seeds 10k titles")
	}
	service := seedSyntheticCatalog(t, 10000)
	start := time.Now()
	items, err := service.CatalogFamilies(context.Background())
	took := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("cold CatalogFamilies over 10k titles: %v (%d families)", took, len(items))
	// Shared CI runners are several times slower than a dev machine and noisy;
	// there the budget only catches a return to per-family queries (~20 s).
	budget := 2 * time.Second
	if os.Getenv("CI") != "" {
		budget = 8 * time.Second
	}
	if took > budget {
		t.Fatalf("cold computation took %v; budget is %v", took, budget)
	}
}
