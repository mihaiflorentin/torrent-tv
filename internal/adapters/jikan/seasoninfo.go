package jikan

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// MAL orders an anime as one flat episode list, so the season list is a
// single season and season 1 carries every episode.

func animePreconditions(provider, providerID string, season int) error {
	if provider != "jikan" {
		return fmt.Errorf("provider %q is not served by the Jikan adapter", provider)
	}
	if providerID == "" {
		return fmt.Errorf("provider id is unavailable")
	}
	if season != 1 {
		return fmt.Errorf("MyAnimeList lists one season")
	}
	return nil
}

type listedEpisode struct {
	ID     int     `json:"mal_id"`
	Title  string  `json:"title"`
	Aired  string  `json:"aired"`
	Score  float64 `json:"score"`
	Filler bool    `json:"filler"`
	Recap  bool    `json:"recap"`
}

// listEpisodes pages the episode list, bounded by maxEpisodePages.
func (c *Client) listEpisodes(ctx context.Context, providerID string) ([]listedEpisode, error) {
	var all []listedEpisode
	for page := 1; page <= maxEpisodePages; page++ {
		var result struct {
			Pagination struct {
				HasNextPage bool `json:"has_next_page"`
			} `json:"pagination"`
			Data []listedEpisode `json:"data"`
		}
		if err := c.getJSON(ctx, "/anime/"+url.PathEscape(providerID)+"/episodes?page="+strconv.Itoa(page), &result); err != nil {
			return nil, err
		}
		all = append(all, result.Data...)
		if !result.Pagination.HasNextPage {
			break
		}
	}
	return all, nil
}

// SeasonList returns the single season of a MAL entry, sized by its episode list.
func (c *Client) SeasonList(ctx context.Context, provider, providerID, language, fallback string) (domain.TitleSeasons, error) {
	_ = fallback
	if err := animePreconditions(provider, providerID, 1); err != nil {
		return domain.TitleSeasons{}, err
	}
	episodes, err := c.listEpisodes(ctx, providerID)
	if err != nil {
		return domain.TitleSeasons{}, err
	}
	list := domain.TitleSeasons{Provider: "jikan", ProviderID: providerID, Language: language, Seasons: []domain.SeasonSummary{}, Available: len(episodes) > 0}
	if len(episodes) > 0 {
		list.Seasons = append(list.Seasons, domain.SeasonSummary{Number: 1, Name: "Episodes", AirDate: datePart(episodes[0].Aired), EpisodeCount: len(episodes)})
	}
	return list, nil
}

// SeasonDetail returns the episode list of a MAL entry: title, air date,
// score, filler and recap flags. Synopsis and duration need one request per
// episode, so episodes are marked LazyDetail and EpisodeDetail fills them when
// an episode is opened (which keeps within the Jikan rate limit).
func (c *Client) SeasonDetail(ctx context.Context, provider, providerID string, season int, language, fallback string) (domain.SeasonInfo, error) {
	_ = fallback
	if err := animePreconditions(provider, providerID, season); err != nil {
		return domain.SeasonInfo{}, err
	}
	episodes, err := c.listEpisodes(ctx, providerID)
	if err != nil {
		return domain.SeasonInfo{}, err
	}
	info := domain.SeasonInfo{Provider: "jikan", ProviderID: providerID, Language: language, Number: 1, Name: "Episodes", Episodes: []domain.EpisodeInfo{}, Available: true}
	for i, episode := range episodes {
		number := episode.ID
		if number <= 0 {
			number = i + 1
		}
		info.Episodes = append(info.Episodes, domain.EpisodeInfo{
			Number: number, Name: strings.TrimSpace(episode.Title), AirDate: datePart(episode.Aired),
			Rating: episode.Score, Filler: episode.Filler, Recap: episode.Recap, LazyDetail: true,
		})
	}
	if len(info.Episodes) > 0 {
		info.AirDate = info.Episodes[0].AirDate
	}
	return info, nil
}

// EpisodeDetail returns the synopsis, duration and air date of one MAL episode.
func (c *Client) EpisodeDetail(ctx context.Context, provider, providerID string, season, episode int, language string) (domain.EpisodeInfo, error) {
	_ = language
	if err := animePreconditions(provider, providerID, season); err != nil {
		return domain.EpisodeInfo{}, err
	}
	var result struct {
		Data struct {
			Title    string `json:"title"`
			Aired    string `json:"aired"`
			Duration int    `json:"duration"`
			Synopsis string `json:"synopsis"`
		} `json:"data"`
	}
	if err := c.getJSON(ctx, "/anime/"+url.PathEscape(providerID)+"/episodes/"+strconv.Itoa(episode), &result); err != nil {
		return domain.EpisodeInfo{}, err
	}
	return domain.EpisodeInfo{
		Number: episode, Name: strings.TrimSpace(result.Data.Title), AirDate: datePart(result.Data.Aired),
		Runtime: (result.Data.Duration + 59) / 60, Overview: stripHTML(result.Data.Synopsis),
	}, nil
}
