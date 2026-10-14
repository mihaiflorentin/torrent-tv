package tmdb

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// maxSeasonFetches bounds the per-show season expansion so one cache miss
// cannot turn into an unbounded request run against the API.
const maxSeasonFetches = 30

// SeriesSeasons returns the provider canonical season/episode structure for a
// TMDB series id, localized to the requested language.
func (c *Client) SeriesSeasons(ctx context.Context, provider, providerID, language string) (domain.SeriesSeasons, error) {
	if provider != "tmdb" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider %q is not served by the TMDB adapter", provider)
	}
	if providerID == "" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider id is unavailable")
	}
	var show struct {
		Genres []struct {
			Name string `json:"name"`
		} `json:"genres"`
		Seasons []struct {
			SeasonNumber int    `json:"season_number"`
			EpisodeCount int    `json:"episode_count"`
			Name         string `json:"name"`
		} `json:"seasons"`
	}
	if err := c.getJSON(ctx, "/3/tv/"+url.PathEscape(providerID)+"?language="+url.QueryEscape(language), &show); err != nil {
		return domain.SeriesSeasons{}, err
	}
	now := time.Now().UTC()
	seasons := domain.SeriesSeasons{
		Provider:   "tmdb",
		ProviderID: providerID,
		Language:   language,
		Genres:     []string{},
		Seasons:    []domain.SeriesSeason{},
		FetchedAt:  now,
		ExpiresAt:  now.Add(30 * 24 * time.Hour),
	}
	for _, genre := range show.Genres {
		seasons.Genres = append(seasons.Genres, genre.Name)
	}
	fetches := 0
	for _, entry := range show.Seasons {
		if entry.EpisodeCount <= 0 {
			continue
		}
		if fetches >= maxSeasonFetches {
			break
		}
		fetches++
		var season struct {
			Episodes []struct {
				EpisodeNumber int    `json:"episode_number"`
				Name          string `json:"name"`
				AirDate       string `json:"air_date"`
			} `json:"episodes"`
		}
		path := fmt.Sprintf("/3/tv/%s/season/%d?language=%s", url.PathEscape(providerID), entry.SeasonNumber, url.QueryEscape(language))
		if err := c.getJSON(ctx, path, &season); err != nil {
			return domain.SeriesSeasons{}, err
		}
		expanded := domain.SeriesSeason{
			Number:       entry.SeasonNumber,
			Name:         entry.Name,
			EpisodeCount: entry.EpisodeCount,
			Episodes:     []domain.SeriesEpisode{},
		}
		for _, episode := range season.Episodes {
			expanded.Episodes = append(expanded.Episodes, domain.SeriesEpisode{Number: episode.EpisodeNumber, Name: episode.Name, AirDate: episode.AirDate})
		}
		c.fillUntranslatedNames(ctx, providerID, entry.SeasonNumber, language, expanded.Episodes)
		seasons.Seasons = append(seasons.Seasons, expanded)
	}
	return seasons, nil
}

// seasonsFallbackLanguage supplies names TMDB has not translated, mirroring
// the title fallback in Lookup.
const seasonsFallbackLanguage = "en-US"

// untranslatedName matches the generic "Episode N" placeholders TMDB serves
// when a translation is missing (Episode, Episod, Episodul, ...).
var untranslatedName = regexp.MustCompile(`(?i)^\s*(?:episod\w*|épisode|folge|capítulo)\s+\d+\s*$`)

// fillUntranslatedNames replaces empty or placeholder episode names with the
// fallback language's, costing one extra season request only when a name is
// actually missing. It is best effort: a failed fallback keeps the localized
// payload.
func (c *Client) fillUntranslatedNames(ctx context.Context, providerID string, seasonNumber int, language string, episodes []domain.SeriesEpisode) {
	if strings.EqualFold(language, seasonsFallbackLanguage) {
		return
	}
	missing := false
	for _, episode := range episodes {
		if strings.TrimSpace(episode.Name) == "" || untranslatedName.MatchString(episode.Name) {
			missing = true
			break
		}
	}
	if !missing {
		return
	}
	var fallback struct {
		Episodes []struct {
			EpisodeNumber int    `json:"episode_number"`
			Name          string `json:"name"`
		} `json:"episodes"`
	}
	path := fmt.Sprintf("/3/tv/%s/season/%d?language=%s", url.PathEscape(providerID), seasonNumber, url.QueryEscape(seasonsFallbackLanguage))
	if err := c.getJSON(ctx, path, &fallback); err != nil {
		return
	}
	english := make(map[int]string, len(fallback.Episodes))
	for _, episode := range fallback.Episodes {
		english[episode.EpisodeNumber] = episode.Name
	}
	for i := range episodes {
		if name := strings.TrimSpace(episodes[i].Name); name == "" || untranslatedName.MatchString(name) {
			if replacement := english[episodes[i].Number]; replacement != "" {
				episodes[i].Name = replacement
			}
		}
	}
}
