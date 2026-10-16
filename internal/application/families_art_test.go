package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func moviesArt(t *testing.T, f familyFixture) domain.FamilyArt {
	t.Helper()
	items, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return familyByKey(t, items, "movies").Art
}

func setQuarter(f familyFixture, year int, month time.Month) {
	f.service.familyNow = func() time.Time { return time.Date(year, month, 15, 9, 0, 0, 0, time.UTC) }
	f.service.invalidateFamilies()
}

func TestFamilyArtPickIsKeptForTheWholeQuarterWhenCandidatesReshuffle(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	setQuarter(f, 2026, time.November)
	first := moviesArt(t, f)
	// New titles with art and a better rating change the ranked candidate list; several are added so at least
	// one reshuffle would move the pick if it were recomputed instead of remembered.
	ctx := context.Background()
	now := time.Now().UTC()
	for i, name := range []string{"Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"} {
		stored, err := f.repo.UpsertReleases(ctx, []domain.TorrentRelease{{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "x" + name, Name: name + ".Film.2023.1080p.WEB-DL", Category: "Movies HD", Seeders: 50 + i, UploadedAt: &now}})
		if err != nil {
			t.Fatal(err)
		}
		id := projectedTitleOf(t, f.repo, stored[0].ID)
		if err := f.repo.SaveCatalogMetadata(ctx, domain.CatalogMetadata{TitleID: id, Provider: "tmdb", Title: name, Rating: 9, BackdropPath: "/b.jpg", FetchedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
			t.Fatal(err)
		}
		f.service.invalidateFamilies()
		if got := moviesArt(t, f); got.TitleID != first.TitleID {
			t.Fatalf("art moved inside the quarter after adding %s: %s -> %s", name, first.TitleID, got.TitleID)
		}
	}
}

func TestFamilyArtPickSurvivesARestart(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	setQuarter(f, 2026, time.November)
	first := moviesArt(t, f)
	other := f.ids["m1"]
	if first.TitleID == other {
		other = f.ids["m2"]
	}
	// Persisted: a new service over the same database reads the stored pick instead of drawing again.
	if err := f.repo.SaveFamilyArtPick(context.Background(), "movies", "2026-Q4", other); err != nil {
		t.Fatal(err)
	}
	fresh := NewService(dualTrackerRegistry(t), singleEngineSet(t, "qb:", &streamingEngine{}), f.repo, f.service.settings)
	fresh.familyNow = f.service.familyNow
	items, err := fresh.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := familyByKey(t, items, "movies").Art.TitleID; got != other {
		t.Fatalf("stored pick %s was ignored, got %s", other, got)
	}
}

func TestFamilyArtRepicksNextQuarterAndKeepsTheOldRecord(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	setQuarter(f, 2026, time.November)
	q4 := moviesArt(t, f)
	seen := map[string]bool{q4.TitleID: true}
	for _, quarter := range []struct {
		year  int
		month time.Month
	}{{2027, time.February}, {2027, time.May}, {2027, time.August}, {2027, time.November}, {2028, time.February}, {2028, time.May}} {
		setQuarter(f, quarter.year, quarter.month)
		seen[moviesArt(t, f).TitleID] = true
	}
	if len(seen) != 2 {
		t.Fatalf("art should rotate across quarters, saw %v", seen)
	}
	stored, err := f.repo.FamilyArtPick(context.Background(), "movies", "2026-Q4")
	if err != nil || stored != q4.TitleID {
		t.Fatalf("2026-Q4 record = %q, %v; want %s", stored, err, q4.TitleID)
	}
	setQuarter(f, 2026, time.December)
	if got := moviesArt(t, f); got.TitleID != q4.TitleID {
		t.Fatalf("returning to the quarter changed the pick: %s vs %s", got.TitleID, q4.TitleID)
	}
}

func TestFamilyArtRepicksWhenTheStoredTitleLosesItsArt(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	setQuarter(f, 2026, time.November)
	first := moviesArt(t, f)
	now := time.Now().UTC()
	if err := f.repo.SaveCatalogMetadata(context.Background(), domain.CatalogMetadata{TitleID: first.TitleID, Provider: "tmdb", Title: "Gone", FetchedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	f.service.invalidateFamilies()
	got := moviesArt(t, f)
	if got.Source != "catalog" || got.TitleID == first.TitleID || got.TitleID == "" {
		t.Fatalf("a title without art must be replaced, got %+v (was %s)", got, first.TitleID)
	}
	stored, _ := f.repo.FamilyArtPick(context.Background(), "movies", "2026-Q4")
	if stored != got.TitleID {
		t.Fatalf("replacement was not persisted: %q vs %q", stored, got.TitleID)
	}
}

func TestFamilyArtFallsBackToBundledWhenTheOnlyArtTitleLosesIt(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop"})
	setQuarter(f, 2026, time.November)
	if first := moviesArt(t, f); first.Source != "catalog" {
		t.Fatalf("expected catalog art, got %+v", first)
	}
	now := time.Now().UTC()
	if err := f.repo.SaveCatalogMetadata(context.Background(), domain.CatalogMetadata{TitleID: f.ids["m1"], Provider: "tmdb", FetchedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	f.service.invalidateFamilies()
	if got := moviesArt(t, f); got.Source != "bundled" {
		t.Fatalf("got %+v", got)
	}
}

// quietTracker answers every listing with nothing, so a sync completes without touching the seeded rows.
type quietTracker struct{ openCatalog }

func (quietTracker) Latest(context.Context) ([]domain.TorrentRelease, error) { return nil, nil }
func (quietTracker) Category(context.Context, string) ([]domain.TorrentRelease, error) {
	return nil, nil
}

func TestSyncRefreshesFamilyCountsButKeepsTheArtPick(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	f.service = NewService(testRegistry(quietTracker{}), singleEngineSet(t, "qb:", &streamingEngine{}), f.repo, f.service.settings)
	setQuarter(f, 2026, time.November)
	ctx := context.Background()
	before, err := f.service.CatalogFamilies(ctx)
	if err != nil {
		t.Fatal(err)
	}
	movies := familyByKey(t, before, "movies")
	now := time.Now().UTC()
	if _, err := f.repo.UpsertReleases(ctx, []domain.TorrentRelease{{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "late", Name: "Late.Film.2025.1080p.WEB-DL", Category: "Movies HD", Seeders: 3, UploadedAt: &now}}); err != nil {
		t.Fatal(err)
	}
	cached, _ := f.service.CatalogFamilies(ctx)
	if familyByKey(t, cached, "movies").Count != movies.Count {
		t.Fatal("the family cache should still answer until a sync completes")
	}
	job, err := f.service.SyncCatalog("latest")
	if err != nil {
		t.Fatal(err)
	}
	waitForJobTerminal(t, f.service, job.ID)
	after, err := f.service.CatalogFamilies(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := familyByKey(t, after, "movies")
	if got.Count != movies.Count+1 {
		t.Fatalf("count after sync = %d, want %d", got.Count, movies.Count+1)
	}
	if got.Art.TitleID != movies.Art.TitleID {
		t.Fatalf("a sync must not change the art pick: %s -> %s", movies.Art.TitleID, got.Art.TitleID)
	}
}

func TestRankFamilyArtOrdersByRatingThenSeedersThenID(t *testing.T) {
	titles := map[string]*familyTitle{
		"a": {id: "a", rating: 7, seeders: 1, artKind: "poster"},
		"b": {id: "b", rating: 7, seeders: 50, artKind: "poster"},
		"c": {id: "c", rating: 9, seeders: 0, artKind: "poster"},
		"d": {id: "d", seeders: 5, artKind: "poster"},
		"e": {id: "e", seeders: 80, artKind: "backdrop"},
		"f": {id: "f", rating: 9, seeders: 0, artKind: "poster"},
		"g": {id: "g", rating: 10, seeders: 999},
	}
	got := rankFamilyArt(titles)
	want := []string{"c", "f", "b", "a", "e", "d"}
	if len(got) != len(want) {
		t.Fatalf("ranking = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ranking = %v, want %v", got, want)
		}
	}
}

func TestRankFamilyArtKeepsOnlyTheTenBest(t *testing.T) {
	titles := map[string]*familyTitle{}
	for i := 0; i < 15; i++ {
		id := string(rune('a' + i))
		titles[id] = &familyTitle{id: id, rating: 5, seeders: i, artKind: "poster"}
	}
	got := rankFamilyArt(titles)
	if len(got) != familyArtPool || got[0] != "o" || got[familyArtPool-1] != "f" {
		t.Fatalf("pool = %v", got)
	}
}
