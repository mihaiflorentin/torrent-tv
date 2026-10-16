package application

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

type familyFixture struct {
	service *Service
	repo    *sqlite.Repository
	ids     map[string]string // release provider id -> title id
}

// seedFamilies stores a small catalog across families. withArt gives the
// listed provider ids TMDB artwork.
func seedFamilies(t *testing.T, withArt map[string]string) familyFixture {
	t.Helper()
	service, repo := projectionHarness(t)
	ctx := context.Background()
	now := time.Now().UTC()
	releases := []domain.TorrentRelease{
		{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m1", Name: "Alpha.Film.2020.1080p.WEB-DL", Category: "Movies HD", Seeders: 9, UploadedAt: ptrTime(now.Add(-3 * time.Hour))},
		{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m2", Name: "Bravo.Film.2021.1080p.WEB-DL", Category: "Movies Blu-Ray", Seeders: 5, UploadedAt: ptrTime(now.Add(-2 * time.Hour))},
		{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m3", Name: "Charlie.Film.2022.2160p.WEB-DL", Category: "Movies 4K", Seeders: 5, UploadedAt: ptrTime(now.Add(-1 * time.Hour))},
		{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "a1", Name: "Hidden.Song.2020.FLAC", Category: "FLAC", Seeders: 5, UploadedAt: ptrTime(now)},
		{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "c1", Name: "Hidden.Cam.2024.CAM", Category: "CAM/TS", Seeders: 5, UploadedAt: ptrTime(now)},
	}
	stored, err := repo.UpsertReleases(ctx, releases)
	if err != nil {
		t.Fatal(err)
	}
	fixture := familyFixture{service: service, repo: repo, ids: map[string]string{}}
	for _, release := range stored {
		fixture.ids[release.ProviderID] = projectedTitleOf(t, repo, release.ID)
	}
	for providerID, kind := range withArt {
		meta := domain.CatalogMetadata{TitleID: fixture.ids[providerID], Provider: "tmdb", Title: "Art " + providerID, Rating: 7, FetchedAt: now, ExpiresAt: now.Add(time.Hour)}
		if kind == "backdrop" {
			meta.BackdropPath = "/b.jpg"
			meta.PosterPath = "/p.jpg"
		} else {
			meta.PosterPath = "/p.jpg"
		}
		if err := repo.SaveCatalogMetadata(ctx, meta); err != nil {
			t.Fatal(err)
		}
	}
	return fixture
}

func ptrTime(t time.Time) *time.Time { return &t }

func familyByKey(t *testing.T, items []domain.FamilySummary, key string) domain.FamilySummary {
	t.Helper()
	for _, item := range items {
		if item.Key == key {
			return item
		}
	}
	t.Fatalf("family %q missing from %+v", key, items)
	return domain.FamilySummary{}
}

func TestCatalogFamiliesGroupsCountsAndHidesAudioAndCam(t *testing.T) {
	f := seedFamilies(t, nil)
	items, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	keys := []string{}
	for _, item := range items {
		keys = append(keys, item.Key)
	}
	if strings.Join(keys, ",") != "movies,uhd" {
		t.Fatalf("families = %v; audio and CAM/TS must be hidden and empty families omitted", keys)
	}
	movies := familyByKey(t, items, "movies")
	if movies.Count != 2 || strings.Join(movies.Categories, "|") != "Movies Blu-Ray|Movies HD" {
		t.Fatalf("movies = %+v", movies)
	}
	if movies.NewestTitle != "Bravo Film" {
		t.Fatalf("newest = %q", movies.NewestTitle)
	}
}

func TestCatalogFamiliesFallBackToBundledArtWhenNoTitleHasArt(t *testing.T) {
	f := seedFamilies(t, nil)
	items, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Art.Source != "bundled" || item.Art.URL != "/api/v1/catalog/families/"+item.Key+"/art.svg" {
			t.Fatalf("%s art = %+v", item.Key, item.Art)
		}
	}
}

func TestCatalogFamiliesUseBackdropThenPosterOfATitleWithArt(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop"})
	items, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	movies := familyByKey(t, items, "movies")
	want := "/api/v1/artwork/" + f.ids["m1"] + "/backdrop"
	if movies.Art.Source != "catalog" || movies.Art.URL != want || movies.Art.TitleID != f.ids["m1"] {
		t.Fatalf("movies art = %+v; want %s", movies.Art, want)
	}
	if got := familyByKey(t, items, "uhd").Art.Source; got != "bundled" {
		t.Fatalf("uhd has no art and must use bundled artwork, got %s", got)
	}

	poster := seedFamilies(t, map[string]string{"m2": "poster"})
	items, err = poster.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := familyByKey(t, items, "movies").Art.URL; got != "/api/v1/artwork/"+poster.ids["m2"]+"/poster" {
		t.Fatalf("poster fallback = %s", got)
	}
}

func TestCatalogFamilyArtRotatesByQuarterButIsStableWithinOne(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop", "m2": "backdrop"})
	at := func(year int, month time.Month) string {
		f.service.familyNow = func() time.Time { return time.Date(year, month, 15, 9, 0, 0, 0, time.UTC) }
		f.service.invalidateFamilies()
		items, err := f.service.CatalogFamilies(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return familyByKey(t, items, "movies").Art.TitleID
	}
	first := at(2026, time.November)
	if again := at(2026, time.December); again != first {
		t.Fatalf("art changed inside a quarter: %s vs %s", first, again)
	}
	seen := map[string]bool{first: true}
	for year := 2027; year < 2032; year++ {
		for _, month := range []time.Month{time.February, time.May, time.August, time.November} {
			seen[at(year, month)] = true
		}
	}
	if len(seen) != 2 {
		t.Fatalf("rotation should visit both candidates over the years, saw %v", seen)
	}
}

func TestCatalogTitlesFilterByFamilyAndSubCategory(t *testing.T) {
	f := seedFamilies(t, nil)
	ctx := context.Background()
	page, err := f.service.CatalogTitles(ctx, domain.CatalogQuery{Family: "movies", Limit: 24})
	if err != nil || page.Total != 2 {
		t.Fatalf("family page = %+v, %v", page, err)
	}
	page, err = f.service.CatalogTitles(ctx, domain.CatalogQuery{Family: "movies", Category: "Movies HD", Limit: 24})
	if err != nil || page.Total != 1 {
		t.Fatalf("sub-category page = %+v, %v", page, err)
	}
	page, err = f.service.CatalogTitles(ctx, domain.CatalogQuery{Family: "romanian", Limit: 24})
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("empty family must be an empty page, got %+v, %v", page, err)
	}
	if _, err = f.service.CatalogTitles(ctx, domain.CatalogQuery{Family: "bogus", Limit: 24}); err == nil {
		t.Fatal("unknown family must be an error")
	}
}

func libraryItem(sourceID, titleID, name, category string, updated time.Time, art string, rating float64) domain.HouseholdItem {
	title := &domain.CatalogTitle{ID: titleID, Title: name, Rating: rating}
	if art != "" {
		title.BackdropURL = "/api/v1/artwork/" + titleID + "/" + art
	}
	return domain.HouseholdItem{
		Release:       domain.TorrentRelease{ID: "r-" + sourceID, Name: name + ".1080p", Category: category},
		Catalog:       title,
		PlaybackState: domain.PlaybackState{SourceID: sourceID, UpdatedAt: updated},
		TitleID:       titleID,
	}
}

func TestLibraryFamiliesCountTitlesOnceAndHideAudio(t *testing.T) {
	now := time.Date(2026, time.October, 17, 12, 0, 0, 0, time.UTC)
	items := []domain.HouseholdItem{
		libraryItem("s1", "t1", "Alpha", "Movies HD", now.Add(-2*time.Hour), "", 0),
		libraryItem("s2", "t1", "Alpha", "Movies Blu-Ray", now.Add(-3*time.Hour), "", 0),
		libraryItem("s3", "t2", "Bravo", "Movies HD", now.Add(-1*time.Hour), "", 0),
		libraryItem("s4", "t3", "Song", "FLAC", now, "", 0),
		libraryItem("s5", "t4", "Show", "TV-Series HD", now.Add(-5*time.Hour), "", 0),
	}
	families := LibraryFamilies(items, "2026-Q4")
	if len(families) != 2 || families[0].Key != "movies" || families[1].Key != "series" {
		t.Fatalf("families = %+v", families)
	}
	if families[0].Count != 2 || families[0].NewestTitle != "Bravo" || strings.Join(families[0].Categories, "|") != "Movies Blu-Ray|Movies HD" {
		t.Fatalf("movies = %+v", families[0])
	}
}

func TestLibraryFamiliesUseTitleArtElseBundled(t *testing.T) {
	now := time.Now()
	items := []domain.HouseholdItem{
		libraryItem("s1", "t1", "Alpha", "Movies HD", now, "backdrop", 8),
		libraryItem("s2", "t2", "Show", "TV-Series HD", now, "", 0),
	}
	families := LibraryFamilies(items, "2026-Q4")
	if families[0].Art.Source != "catalog" || families[0].Art.URL != "/api/v1/artwork/t1/backdrop" {
		t.Fatalf("movies art = %+v", families[0].Art)
	}
	if families[1].Art.Source != "bundled" || families[1].Art.URL != "/api/v1/catalog/families/series/art.svg" {
		t.Fatalf("series art = %+v", families[1].Art)
	}
}

func TestLibraryFamilyItemsFilterByFamilyAndCategory(t *testing.T) {
	now := time.Now()
	items := []domain.HouseholdItem{
		libraryItem("s1", "t1", "Alpha", "Movies HD", now.Add(-time.Hour), "", 0),
		libraryItem("s2", "t2", "Bravo", "Movies 4K", now, "", 0),
		libraryItem("s3", "t3", "Charlie", "Movies Blu-Ray", now.Add(-2*time.Hour), "", 0),
	}
	got := LibraryFamilyItems(items, "movies", "")
	if len(got) != 2 || got[0].TitleID != "t1" {
		t.Fatalf("movies items = %+v", got)
	}
	if got := LibraryFamilyItems(items, "uhd", "Movies 4K"); len(got) != 1 || got[0].TitleID != "t2" {
		t.Fatalf("uhd items = %+v", got)
	}
	if got := LibraryFamilyItems(items, "movies", "Movies 4K"); len(got) != 0 {
		t.Fatalf("category outside the family leaked: %+v", got)
	}
}
