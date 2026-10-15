package tmdb

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// maxSeasonFetches bounds the per-show season expansion so one cache miss
// cannot turn into an unbounded request run against the API.
const maxSeasonFetches = 30

// seasonFetchConcurrency bounds the parallel season requests.
const seasonFetchConcurrency = 4

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
	type entryRef struct {
		number, count int
		name          string
	}
	entries := make([]entryRef, 0, len(show.Seasons))
	for _, entry := range show.Seasons {
		if entry.EpisodeCount <= 0 {
			continue
		}
		if len(entries) >= maxSeasonFetches {
			break
		}
		entries = append(entries, entryRef{entry.SeasonNumber, entry.EpisodeCount, entry.Name})
	}
	expanded := make([]domain.SeriesSeason, len(entries))
	err := runBounded(ctx, len(entries), func(i int) error {
		var season struct {
			Episodes []struct {
				EpisodeNumber int    `json:"episode_number"`
				Name          string `json:"name"`
				AirDate       string `json:"air_date"`
			} `json:"episodes"`
		}
		path := fmt.Sprintf("/3/tv/%s/season/%d?language=%s", url.PathEscape(providerID), entries[i].number, url.QueryEscape(language))
		if err := c.getJSON(ctx, path, &season); err != nil {
			return err
		}
		out := domain.SeriesSeason{
			Number:       entries[i].number,
			Name:         entries[i].name,
			EpisodeCount: entries[i].count,
			Episodes:     []domain.SeriesEpisode{},
		}
		for _, episode := range season.Episodes {
			out.Episodes = append(out.Episodes, domain.SeriesEpisode{Number: episode.EpisodeNumber, Name: episode.Name, AirDate: episode.AirDate})
		}
		expanded[i] = out
		return nil
	})
	if err != nil {
		return domain.SeriesSeasons{}, err
	}
	// Fallback requests are issued only for seasons that still miss a name.
	needing := []int{}
	if !englishLanguage(language) {
		for i := range expanded {
			if hasUntranslatedName(expanded[i].Episodes) {
				needing = append(needing, i)
			}
		}
	}
	if err := runBounded(ctx, len(needing), func(n int) error {
		i := needing[n]
		c.fillUntranslatedNames(ctx, providerID, expanded[i].Number, expanded[i].Episodes)
		return nil
	}); err != nil {
		return domain.SeriesSeasons{}, err
	}
	seasons.Seasons = append(seasons.Seasons, expanded...)
	return seasons, nil
}

// runBounded runs fn(0..n-1) with at most seasonFetchConcurrency in flight
// and returns the first error, skipping work that has not started by then.
// A cancelled parent context is an error too: skipped items leave zero values
// behind, so the caller must not treat the run as complete.
func runBounded(parent context.Context, n int, fn func(int) error) error {
	var (
		wg    sync.WaitGroup
		once  sync.Once
		first error
	)
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	sem := make(chan struct{}, seasonFetchConcurrency)
	for i := 0; i < n; i++ {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			i = n
			continue
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			if ctx.Err() != nil {
				return
			}
			if err := fn(i); err != nil {
				once.Do(func() { first = err; cancel() })
			}
		}(i)
	}
	wg.Wait()
	if first != nil {
		return first
	}
	return parent.Err()
}

// seasonsFallbackLanguage supplies names TMDB has not translated, mirroring
// the title fallback in Lookup.
const seasonsFallbackLanguage = "en-US"

// untranslatedName matches the generic "Episode N" placeholders TMDB serves
// when a translation is missing (Episode, Episod, Episodul, ...).
var untranslatedName = regexp.MustCompile(`(?i)^\s*(?:episod\w*|épisode|folge|capítulo)\s+\d+\s*$`)

// englishLanguage reports whether the requested language already is the
// fallback language or a variant of it, where a second request adds nothing.
func englishLanguage(language string) bool {
	language = strings.ToLower(language)
	return language == "en" || strings.HasPrefix(language, "en-")
}

func isUntranslated(name string) bool {
	return strings.TrimSpace(name) == "" || untranslatedName.MatchString(name)
}

func hasUntranslatedName(episodes []domain.SeriesEpisode) bool {
	for _, episode := range episodes {
		if isUntranslated(episode.Name) {
			return true
		}
	}
	return false
}

// fillUntranslatedNames replaces empty or placeholder episode names with the
// fallback language's. The caller only invokes it for a season that has such a
// name. It is best effort: a failed fallback keeps the localized payload, and
// a fallback name that is itself a placeholder is not used.
func (c *Client) fillUntranslatedNames(ctx context.Context, providerID string, seasonNumber int, episodes []domain.SeriesEpisode) {
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
		if isUntranslated(episodes[i].Name) {
			if replacement := english[episodes[i].Number]; !isUntranslated(replacement) {
				episodes[i].Name = replacement
			}
		}
	}
}
