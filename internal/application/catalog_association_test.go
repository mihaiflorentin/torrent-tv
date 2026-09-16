package application

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// aotProviderSeasons mirrors the live Attack on Titan shape: provider seasons
// count episodes per season (25/12/12) while packs commonly number episodes
// absolutely within a season window (S2 = 26-37, S3 = 38-49).
func aotProviderSeasons() domain.SeriesSeasons {
	episodes := func(count int, label string) []domain.SeriesEpisode {
		list := make([]domain.SeriesEpisode, 0, count)
		for i := range count {
			list = append(list, domain.SeriesEpisode{Number: i + 1, Name: label + " " + strconv.Itoa(i+1)})
		}
		return list
	}
	return domain.SeriesSeasons{
		Provider:   "tmdb",
		ProviderID: "51445",
		Language:   "ro-RO",
		Seasons: []domain.SeriesSeason{
			{Number: 1, Name: "Shingeki no Kyojin 1", EpisodeCount: 25, Episodes: episodes(25, "S1")},
			{Number: 2, Name: "Shingeki no Kyojin 2", EpisodeCount: 12, Episodes: episodes(12, "S2")},
			{Number: 3, Name: "Shingeki no Kyojin 3", EpisodeCount: 12, Episodes: episodes(12, "S3")},
		},
	}
}

func seedPackTitle(t *testing.T, repo *sqlite.Repository, packs map[string][]string) string {
	t.Helper()
	ctx := context.Background()
	var releases []domain.TorrentRelease
	manifests := map[string][]domain.TorrentFile{}
	for packName, fileNames := range packs {
		releases = append(releases, domain.TorrentRelease{
			TrackerID: "filelist", TrackerName: "FileList", ProviderID: packName,
			Name: packName, Category: "TV-Series HD", Seeders: 5,
			SizeBytes: int64(len(fileNames)) << 30, FileCount: len(fileNames),
		})
		files := make([]domain.TorrentFile, 0, len(fileNames))
		for i, name := range fileNames {
			files = append(files, domain.TorrentFile{Index: i, Path: name, SizeBytes: 1 << 30, Playable: true})
		}
		manifests[packName] = files
	}
	stored, err := repo.UpsertReleases(ctx, releases)
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	for _, release := range stored {
		if err := repo.SaveTorrentManifest(ctx, domain.TorrentManifest{ReleaseID: release.ID, Files: manifests[release.Name], FetchedAt: time.Now().UTC()}); err != nil {
			t.Fatal(err)
		}
	}
	return titleID
}

func seedProviderMetadata(t *testing.T, repo *sqlite.Repository, titleID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := repo.SaveCatalogMetadata(context.Background(), domain.CatalogMetadata{
		TitleID: titleID, Provider: "tmdb", ProviderID: "51445", Title: "Attack on Titan",
		FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
}

func seasonByNumber(t *testing.T, seasons []domain.CatalogSeason, number int) domain.CatalogSeason {
	t.Helper()
	for _, season := range seasons {
		if season.Number == number {
			return season
		}
	}
	t.Fatalf("no season %d in %#v", number, seasons)
	return domain.CatalogSeason{}
}

func TestAbsolutePackNumbersAlignToProviderSeason(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S2 1080p WEB-DL": {
			"Attack on Titan S2 - 26.mkv", "Attack on Titan S2 - 27.mkv", "Attack on Titan S2 - 37.mkv",
		},
	})
	seedProviderMetadata(t, repo, titleID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	season := seasonByNumber(t, detail.Seasons, 2)
	if season.Title != "Shingeki no Kyojin 2" {
		t.Fatalf("provider season name must win, got %q", season.Title)
		if season.EpisodeCount != 3 || len(season.Episodes) != 3 {
			t.Fatalf("expected three aligned episodes, got %+v", season)
		}
	}
	if season.Episodes[0].Number != 1 || season.Episodes[0].Title != "S2 1" || season.Episodes[0].Season != 2 {
		t.Fatalf("absolute file 26 must align to provider episode 1: %+v", season.Episodes[0])
	}
	if season.Episodes[1].Number != 2 || season.Episodes[1].Title != "S2 2" {
		t.Fatalf("absolute file 27 must align to provider episode 2: %+v", season.Episodes[1])
	}
	if season.Episodes[2].Number != 12 || season.Episodes[2].Title != "S2 12" {
		t.Fatalf("absolute file 37 must align to provider episode 12: %+v", season.Episodes[2])
	}
	if len(season.Unknown) != 0 {
		t.Fatalf("aligned files must not leak into unknown: %+v", season.Unknown)
	}
}

func TestSxxEyyEpisodesMapDirectlyOntoProviderNames(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S02E05 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
	})
	seedProviderMetadata(t, repo, titleID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	season := seasonByNumber(t, detail.Seasons, 2)
	if len(season.Episodes) != 1 || season.Episodes[0].Number != 5 || season.Episodes[0].Title != "S2 5" {
		t.Fatalf("S02E05 must align to provider episode 5: %+v", season.Episodes)
	}
}

func TestMixedNumberingSchemesMergeAsVersions(t *testing.T) {
	service, repo := projectionHarness(t)
	relative := make([]string, 0, 12)
	absolute := make([]string, 0, 12)
	for i := range 12 {
		relative = append(relative, "Attack on Titan S3 - "+twoDigits(i+1)+".mkv")
		absolute = append(absolute, "Attack on Titan S3 - "+twoDigits(38+i)+".mkv")
	}
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S3 1080p WEB-DL Erai":  relative,
		"Attack on Titan S3 720p WEBRip Horrib": absolute,
	})
	seedProviderMetadata(t, repo, titleID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	season := seasonByNumber(t, detail.Seasons, 3)
	if len(season.Episodes) != 12 {
		t.Fatalf("both schemes must collapse onto one provider-relative list, got %d episodes", len(season.Episodes))
	}
	if len(season.Episodes[0].Sources) < 2 {
		t.Fatalf("S3E1 must carry a source per scheme, got %+v", season.Episodes[0])
	}
	if season.Episodes[0].SourceCount != 2 {
		t.Fatalf("source count must count versions, got %d", season.Episodes[0].SourceCount)
	}
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func TestUnmappableNumbersLandInSeasonUnknownGroup(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S2 1080p WEB-DL": {
			"Attack on Titan S2 - 26.mkv",
			"Attack on Titan S2 - 99.mkv",
			"Attack on Titan S2 - 99v2.mkv",
		},
	})
	seedProviderMetadata(t, repo, titleID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	season := seasonByNumber(t, detail.Seasons, 2)
	if len(season.Unknown) != 1 {
		t.Fatalf("unmappable files must land in the unknown group, got %+v", season.Unknown)
	}
	if season.Unknown[0].Number != 99 || season.Unknown[0].Season != 2 {
		t.Fatalf("unknown episodes keep file numbering: %+v", season.Unknown[0])
	}
	if season.Unknown[0].SourceCount != 2 || len(season.Unknown[0].Sources) != 2 {
		t.Fatalf("99v2 is another version of 99 and must merge, got %+v", season.Unknown[0])
	}
	if season.Unknown[0].Number != 99 || season.Unknown[0].Season != 2 {
		t.Fatalf("unknown episodes keep file numbering: %+v", season.Unknown[0])
	}
	if season.Unknown[0].Title != "Episode 99" {
		t.Fatalf("unknown episode title falls back to today's derivation, got %q", season.Unknown[0].Title)
	}
}

func TestNilProviderKeepsTorrentOnlyShape(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S2 1080p WEB-DL": {
			"Attack on Titan S2 - 26.mkv", "Attack on Titan S2 - 27.mkv",
		},
	})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	season := seasonByNumber(t, detail.Seasons, 2)
	if season.Title != "Season 2" {
		t.Fatalf("torrent-only rendering keeps today's season title, got %q", season.Title)
	}
	if len(season.Episodes) != 2 || season.Episodes[0].Number != 26 || season.Episodes[1].Number != 27 {
		t.Fatalf("torrent-only rendering keeps absolute numbers, got %+v", season.Episodes)
	}
	if season.Unknown != nil {
		t.Fatalf("torrent-only rendering must leave the unknown group nil, got %+v", season.Unknown)
	}
}

func TestProviderSeasonsCacheSurvivesAndExpires(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S2 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
	})
	seedProviderMetadata(t, repo, titleID)
	provider := &stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()}
	service.SetMetadataProvider(provider)

	ctx := context.Background()
	if _, err := service.CatalogDetail(ctx, titleID); err != nil {
		t.Fatal(err)
	}
	if provider.seasonCalls != 1 {
		t.Fatalf("first read must reach the provider, got %d calls", provider.seasonCalls)
	}
	if _, err := service.CatalogDetail(ctx, titleID); err != nil {
		t.Fatal(err)
	}
	if provider.seasonCalls != 1 {
		t.Fatalf("cached seasons must not re-hit the provider, got %d calls", provider.seasonCalls)
	}
	cached, err := repo.GetSeriesSeasons(ctx, "tmdb", "51445", "ro-RO")
	if err != nil || cached.ProviderID != "51445" || len(cached.Seasons) != 3 {
		t.Fatalf("seasons were not persisted for caching: %+v %v", cached, err)
	}

	// A provider failure inside the freshness window falls back to the cache;
	// outside it, the failure is surfaced and negatively cached.
	stale, err := repo.GetSeriesSeasons(ctx, "tmdb", "51445", "ro-RO")
	if err != nil {
		t.Fatal(err)
	}
	stale.ExpiresAt = time.Now().UTC().Add(-time.Hour)
	if err := repo.SaveSeriesSeasons(ctx, stale); err != nil {
		t.Fatal(err)
	}
	provider.seasonErr = context.DeadlineExceeded
	if _, err := service.CatalogDetail(ctx, titleID); err != nil {
		t.Fatalf("catalog reads must survive a provider outage: %v", err)
	}
	if provider.seasonCalls != 2 {
		t.Fatalf("stale cache must re-attempt the provider, got %d calls", provider.seasonCalls)
	}
}
