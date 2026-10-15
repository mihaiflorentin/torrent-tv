package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestCatalogDetailCarriesEpisodeAirDatesAndTitleReleaseDate(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S02E05 1080p WEB-DL": {"Attack.on.Titan.S02E05.1080p.WEB-DL-GROUP.mkv"},
	})
	now := time.Now().UTC()
	if err := repo.SaveCatalogMetadata(context.Background(), domain.CatalogMetadata{
		TitleID: titleID, Provider: "tmdb", ProviderID: "51445", Title: "Attack on Titan", Year: 2013, ReleaseDate: "2013-04-07",
		FetchedAt: now, ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	seasons := aotProviderSeasons()
	seasons.Seasons[1].Episodes[4].AirDate = "2017-05-06"
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: seasons})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Title.ReleaseDate != "2013-04-07" {
		t.Fatalf("title release date missing: %q", detail.Title.ReleaseDate)
	}
	season := seasonByNumber(t, detail.Seasons, 2)
	if len(season.Episodes) != 1 || season.Episodes[0].AirDate != "2017-05-06" {
		t.Fatalf("episode air date missing: %+v", season.Episodes)
	}
}
