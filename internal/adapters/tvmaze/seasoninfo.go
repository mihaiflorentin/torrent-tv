package tvmaze

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

type seasonEntry struct {
	ID           int64  `json:"id"`
	Number       int    `json:"number"`
	Name         string `json:"name"`
	EpisodeOrder int    `json:"episodeOrder"`
	PremiereDate string `json:"premiereDate"`
	Summary      string `json:"summary"`
}

func (c *Client) showSeasons(ctx context.Context, provider, providerID string) ([]seasonEntry, error) {
	if provider != "tvmaze" {
		return nil, fmt.Errorf("provider %q is not served by the TVmaze adapter", provider)
	}
	if providerID == "" {
		return nil, fmt.Errorf("provider id is unavailable")
	}
	var seasons []seasonEntry
	if err := c.getJSON(ctx, "/shows/"+url.PathEscape(providerID)+"/seasons", &seasons); err != nil {
		return nil, err
	}
	return seasons, nil
}

// SeasonList returns the seasons of one TVmaze show. TVmaze images are not
// proxied, so seasons carry no poster and clients fall back to a numbered tile.
func (c *Client) SeasonList(ctx context.Context, provider, providerID, language, fallback string) (domain.TitleSeasons, error) {
	_ = fallback
	entries, err := c.showSeasons(ctx, provider, providerID)
	if err != nil {
		return domain.TitleSeasons{}, err
	}
	now := time.Now().UTC()
	list := domain.TitleSeasons{Provider: "tvmaze", ProviderID: providerID, Language: language, Seasons: []domain.SeasonSummary{}, Available: len(entries) > 0, FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour)}
	for _, entry := range entries {
		list.Seasons = append(list.Seasons, domain.SeasonSummary{
			Number: entry.Number, Name: seasonName(entry), AirDate: validDate(entry.PremiereDate),
			EpisodeCount: entry.EpisodeOrder, Overview: strings.TrimSpace(stripHTML(entry.Summary)),
		})
	}
	return list, nil
}

func seasonName(entry seasonEntry) string {
	if name := strings.TrimSpace(entry.Name); name != "" {
		return name
	}
	return fmt.Sprintf("Season %d", entry.Number)
}

// SeasonDetail returns one season of a TVmaze show with its episodes (two
// requests: the season list to resolve the season id, then the episodes).
// TVmaze guest cast needs one request per episode and is skipped; the
// season carries no cast and episodes no stills (images are not proxied).
func (c *Client) SeasonDetail(ctx context.Context, provider, providerID string, season int, language, fallback string) (domain.SeasonInfo, error) {
	_ = fallback
	entries, err := c.showSeasons(ctx, provider, providerID)
	if err != nil {
		return domain.SeasonInfo{}, err
	}
	var found *seasonEntry
	for i := range entries {
		if entries[i].Number == season {
			found = &entries[i]
		}
	}
	if found == nil {
		return domain.SeasonInfo{}, fmt.Errorf("season %d is not listed by TVmaze", season)
	}
	var episodes []struct {
		Number  int    `json:"number"`
		Name    string `json:"name"`
		Airdate string `json:"airdate"`
		Runtime int    `json:"runtime"`
		Summary string `json:"summary"`
		Rating  struct {
			Average float64 `json:"average"`
		} `json:"rating"`
	}
	if err := c.getJSON(ctx, "/seasons/"+strconv.FormatInt(found.ID, 10)+"/episodes", &episodes); err != nil {
		return domain.SeasonInfo{}, err
	}
	now := time.Now().UTC()
	info := domain.SeasonInfo{
		Provider: "tvmaze", ProviderID: providerID, Language: language, Number: season, Name: seasonName(*found),
		Overview: strings.TrimSpace(stripHTML(found.Summary)), AirDate: validDate(found.PremiereDate),
		Episodes: []domain.EpisodeInfo{}, Available: true, FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
	}
	for _, episode := range episodes {
		if episode.Number <= 0 {
			continue // specials carry no episode number
		}
		info.Episodes = append(info.Episodes, domain.EpisodeInfo{
			Number: episode.Number, Name: strings.TrimSpace(episode.Name), AirDate: validDate(episode.Airdate), Runtime: episode.Runtime,
			Rating: episode.Rating.Average, Overview: strings.TrimSpace(stripHTML(episode.Summary)),
		})
	}
	return info, nil
}
