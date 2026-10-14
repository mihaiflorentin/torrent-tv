package application

import (
	"context"
	"testing"
)

// A file claiming a season the provider does not have, or an episode past
// the provider's (possibly stale) count, must not be remapped into another
// season and merged with that season's real sources.
func TestAlignmentNeverMovesAFileIntoAnotherSeason(t *testing.T) {
	service, repo := projectionHarness(t)
	titleID := seedPackTitle(t, repo, map[string][]string{
		"Attack on Titan S01-S04 1080p WEB-DL": {
			"Attack.on.Titan.S01E05.1080p.WEB-DL-GRP.mkv",
			"Attack.on.Titan.S04E05.1080p.WEB-DL-GRP.mkv",
			"Attack.on.Titan.S03E14.1080p.WEB-DL-GRP.mkv",
		},
	})
	seedProviderMetadata(t, repo, titleID)
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb", seasons: aotProviderSeasons()})

	detail, err := service.CatalogDetail(context.Background(), titleID)
	if err != nil {
		t.Fatal(err)
	}
	s1 := seasonByNumber(t, detail.Seasons, 1)
	if len(s1.Episodes) != 1 || s1.Episodes[0].SourceCount != 1 {
		t.Fatalf("season 1 must keep only its own episode: %+v", s1)
	}
	s4 := seasonByNumber(t, detail.Seasons, 4)
	if len(s4.Unknown) != 1 || s4.Unknown[0].Season != 4 || len(s4.Episodes) != 0 {
		t.Fatalf("a season the provider lacks keeps its files as unknown: %+v", s4)
	}
	s3 := seasonByNumber(t, detail.Seasons, 3)
	if len(s3.Unknown) != 1 || s3.Unknown[0].Number != 14 {
		t.Fatalf("an episode past the provider count stays in its own season's unknown group: %+v", s3)
	}
}
