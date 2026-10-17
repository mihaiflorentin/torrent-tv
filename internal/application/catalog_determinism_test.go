package application

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func determinismSource(id, name string, uploaded int, fileIndex *int) domain.CatalogSource {
	at := time.Unix(int64(1_700_000_000+uploaded), 0).UTC()
	release := domain.TorrentRelease{ID: id, Name: name, UploadedAt: &at}
	source := domain.CatalogSource{Release: release, Parsed: domain.ParseRelease(release), FileIndex: fileIndex}
	if fileIndex != nil {
		source.FilePath = name
	}
	return source
}

func southParkFixture() (map[seasonEpisodeKey][]domain.CatalogSource, map[int][]domain.CatalogSource, *domain.SeriesSeasons) {
	episodes := map[seasonEpisodeKey][]domain.CatalogSource{}
	packs := map[int][]domain.CatalogSource{}
	provider := &domain.SeriesSeasons{Seasons: []domain.SeriesSeason{{Number: 0, EpisodeCount: 3}}}
	for season, count := range map[int]int{1: 13, 2: 18, 3: 17} {
		provider.Seasons = append(provider.Seasons, domain.SeriesSeason{Number: season, EpisodeCount: count})
	}
	// Provider order must be canonical for absolute numbering.
	provider.Seasons = []domain.SeriesSeason{{Number: 0, EpisodeCount: 3}, {Number: 1, EpisodeCount: 13}, {Number: 2, EpisodeCount: 18}, {Number: 3, EpisodeCount: 17}}
	for season := 1; season <= 3; season++ {
		for pack := 0; pack < 6; pack++ {
			pk := determinismSource(fmt.Sprintf("pack:%d:%d", season, pack), fmt.Sprintf("South.Park.S%02d.2160p.WEB-DL-G%d", season, pack), pack%3, nil)
			packs[season] = append(packs[season], pk)
			for ep := 1; ep <= provider.Seasons[season].EpisodeCount; ep++ {
				index := ep - 1
				file := determinismSource(pk.Release.ID, fmt.Sprintf("South.Park.S%02dE%02d.2160p.mkv", season, ep), pack%3, &index)
				key := seasonEpisodeKey{season, ep}
				episodes[key] = append(episodes[key], file)
			}
		}
	}
	for i := 0; i < 5; i++ {
		special := determinismSource(fmt.Sprintf("piratebay:%d", i), "South.Park.S00E43.Post.Covid.1080p.PMTP.WEBRip.x264-NTb", i%2, nil)
		key := seasonEpisodeKey{0, 43}
		episodes[key] = append(episodes[key], special)
	}
	return episodes, packs, provider
}

func TestBuildSeasonsExplicitSpecialIsNeverAbsoluteAligned(t *testing.T) {
	episodes, packs, provider := southParkFixture()
	for run := 0; run < 50; run++ {
		seasons := buildSeasons(episodes, packs, provider)
		for _, season := range seasons {
			if season.Number == 0 {
				if len(season.Unknown) != 1 || season.Unknown[0].Number != 43 || len(season.Unknown[0].Sources) != 5 {
					t.Fatalf("season 0 unknown = %+v", season.Unknown)
				}
				continue
			}
			for _, episode := range season.Episodes {
				for _, source := range episode.Sources {
					if source.Parsed.EpisodeStart == 43 {
						t.Fatalf("S00E43 attached to S%02dE%02d", season.Number, episode.Number)
					}
					if source.Parsed.SeasonStart != season.Number || source.Parsed.EpisodeStart != episode.Number {
						t.Fatalf("S%02dE%02d holds %s", season.Number, episode.Number, source.Release.Name)
					}
				}
			}
		}
	}
}

func TestBuildSeasonsIsByteIdenticalAcrossRuns(t *testing.T) {
	episodes, packs, provider := southParkFixture()
	for _, withProvider := range []*domain.SeriesSeasons{provider, nil} {
		var first []byte
		for run := 0; run < 50; run++ {
			body, err := json.Marshal(buildSeasons(episodes, packs, withProvider))
			if err != nil {
				t.Fatal(err)
			}
			if run == 0 {
				first = body
			} else if string(first) != string(body) {
				t.Fatalf("run %d differs (provider=%v)", run, withProvider != nil)
			}
		}
	}
}

func TestBuildSeasonsMergedKeysAreDeterministic(t *testing.T) {
	// Unseasoned absolute numbers fold into the same provider episode as an
	// explicit S01E05 release; the merge must not depend on map order.
	provider := &domain.SeriesSeasons{Seasons: []domain.SeriesSeason{{Number: 1, EpisodeCount: 12}, {Number: 2, EpisodeCount: 12}}}
	episodes := map[seasonEpisodeKey][]domain.CatalogSource{
		{1, 5}:  {determinismSource("a", "Show.S01E05.1080p-A", 1, nil)},
		{0, 5}:  {determinismSource("b", "Show.E05.1080p-B", 2, nil)},
		{2, 5}:  {determinismSource("c", "Show.S02E05.1080p-C", 3, nil)},
		{0, 17}: {determinismSource("d", "Show.E17.1080p-D", 4, nil)},
	}
	var first []byte
	for run := 0; run < 50; run++ {
		body, _ := json.Marshal(buildSeasons(episodes, nil, provider))
		if run == 0 {
			first = body
		} else if string(first) != string(body) {
			t.Fatalf("run %d differs", run)
		}
	}
}
