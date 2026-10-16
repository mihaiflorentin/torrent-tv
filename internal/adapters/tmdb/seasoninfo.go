package tmdb

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// maxSeasonCast bounds the season cast list.
const maxSeasonCast = 20

// SeasonList returns the seasons of one TMDB series from the series details
// endpoint, which already embeds the per-season summaries.
func (c *Client) SeasonList(ctx context.Context, provider, providerID, language, fallback string) (domain.TitleSeasons, error) {
	if err := c.seasonPreconditions(provider, providerID); err != nil {
		return domain.TitleSeasons{}, err
	}
	var show struct {
		Seasons []struct {
			Number       int    `json:"season_number"`
			Name         string `json:"name"`
			AirDate      string `json:"air_date"`
			EpisodeCount int    `json:"episode_count"`
			Overview     string `json:"overview"`
			PosterPath   string `json:"poster_path"`
		} `json:"seasons"`
	}
	if err := c.getJSON(ctx, "/3/tv/"+url.PathEscape(providerID)+"?language="+url.QueryEscape(language), &show); err != nil {
		return domain.TitleSeasons{}, err
	}
	now := time.Now().UTC()
	list := domain.TitleSeasons{Provider: "tmdb", ProviderID: providerID, Language: language, Seasons: []domain.SeasonSummary{}, Available: len(show.Seasons) > 0, FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour)}
	for _, season := range show.Seasons {
		name := strings.TrimSpace(season.Name)
		if name == "" {
			name = fmt.Sprintf("Season %d", season.Number)
		}
		list.Seasons = append(list.Seasons, domain.SeasonSummary{
			Number: season.Number, Name: name, AirDate: normalizeDate(season.AirDate), EpisodeCount: season.EpisodeCount,
			Overview: strings.TrimSpace(season.Overview), PosterPath: season.PosterPath,
		})
	}
	return list, nil
}

func (c *Client) seasonPreconditions(provider, providerID string) error {
	if provider != "tmdb" {
		return fmt.Errorf("provider %q is not served by the TMDB adapter", provider)
	}
	if providerID == "" {
		return fmt.Errorf("provider id is unavailable")
	}
	if c.apiKey() == "" {
		return fmt.Errorf("TMDB API key is not configured")
	}
	return nil
}

type seasonResponse struct {
	Name             string `json:"name"`
	Overview         string `json:"overview"`
	AirDate          string `json:"air_date"`
	PosterPath       string `json:"poster_path"`
	AggregateCredits struct {
		Cast []struct {
			Name        string `json:"name"`
			ProfilePath string `json:"profile_path"`
			Roles       []struct {
				Character string `json:"character"`
			} `json:"roles"`
		} `json:"cast"`
	} `json:"aggregate_credits"`
	Episodes []struct {
		Number      int     `json:"episode_number"`
		Name        string  `json:"name"`
		AirDate     string  `json:"air_date"`
		Runtime     int     `json:"runtime"`
		VoteAverage float64 `json:"vote_average"`
		VoteCount   int     `json:"vote_count"`
		Overview    string  `json:"overview"`
		StillPath   string  `json:"still_path"`
		Crew        []struct {
			Name string `json:"name"`
			Job  string `json:"job"`
		} `json:"crew"`
		GuestStars []struct {
			Name        string `json:"name"`
			Character   string `json:"character"`
			ProfilePath string `json:"profile_path"`
		} `json:"guest_stars"`
	} `json:"episodes"`
}

// SeasonDetail returns one season in a single request: the episodes (with
// crew and guest stars) and the season's aggregate cast ride append_to_response.
// Episode text the requested language lacks is filled from the fallback
// language with one extra request, which failing never fails the call.
func (c *Client) SeasonDetail(ctx context.Context, provider, providerID string, season int, language, fallback string) (domain.SeasonInfo, error) {
	if err := c.seasonPreconditions(provider, providerID); err != nil {
		return domain.SeasonInfo{}, err
	}
	base := "/3/tv/" + url.PathEscape(providerID) + "/season/" + strconv.Itoa(season) + "?language="
	var detail seasonResponse
	if err := c.getJSON(ctx, base+url.QueryEscape(language)+"&append_to_response=aggregate_credits", &detail); err != nil {
		return domain.SeasonInfo{}, err
	}
	missing := detail.Overview == ""
	for _, episode := range detail.Episodes {
		if episode.Overview == "" || strings.TrimSpace(episode.Name) == "" {
			missing = true
		}
	}
	if missing && fallback != "" && fallback != language {
		var other seasonResponse
		if err := c.getJSON(ctx, base+url.QueryEscape(fallback), &other); err == nil {
			if detail.Overview == "" {
				detail.Overview = other.Overview
			}
			for i := range detail.Episodes {
				for _, candidate := range other.Episodes {
					if candidate.Number != detail.Episodes[i].Number {
						continue
					}
					if detail.Episodes[i].Overview == "" {
						detail.Episodes[i].Overview = candidate.Overview
					}
					if strings.TrimSpace(detail.Episodes[i].Name) == "" {
						detail.Episodes[i].Name = candidate.Name
					}
				}
			}
		}
	}
	now := time.Now().UTC()
	info := domain.SeasonInfo{
		Provider: "tmdb", ProviderID: providerID, Language: language, Number: season,
		Name: strings.TrimSpace(detail.Name), Overview: strings.TrimSpace(detail.Overview), AirDate: normalizeDate(detail.AirDate),
		PosterPath: detail.PosterPath, Episodes: []domain.EpisodeInfo{}, Available: true,
		FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
	}
	for _, member := range detail.AggregateCredits.Cast {
		if len(info.Cast) >= maxSeasonCast {
			break
		}
		if strings.TrimSpace(member.Name) == "" {
			continue
		}
		var characters []string
		for _, role := range member.Roles {
			if role.Character != "" && len(characters) < 2 {
				characters = append(characters, role.Character)
			}
		}
		info.Cast = append(info.Cast, domain.CastEntry{Name: member.Name, Character: strings.Join(characters, " / "), ImagePath: member.ProfilePath})
	}
	for _, episode := range detail.Episodes {
		entry := domain.EpisodeInfo{
			Number: episode.Number, Name: strings.TrimSpace(episode.Name), AirDate: normalizeDate(episode.AirDate), Runtime: episode.Runtime,
			Rating: episode.VoteAverage, VoteCount: episode.VoteCount, Overview: strings.TrimSpace(episode.Overview), StillPath: episode.StillPath,
		}
		for _, member := range episode.Crew {
			if member.Name == "" {
				continue
			}
			switch member.Job {
			case "Director":
				entry.Directors = appendUnique(entry.Directors, member.Name)
			case "Writer", "Screenplay", "Teleplay", "Story", "Creator":
				entry.Writers = appendUnique(entry.Writers, member.Name)
			}
		}
		for _, guest := range episode.GuestStars {
			if len(entry.GuestStars) >= domain.MaxGuestStars {
				break
			}
			if strings.TrimSpace(guest.Name) != "" {
				entry.GuestStars = append(entry.GuestStars, domain.CastEntry{Name: guest.Name, Character: guest.Character, ImagePath: guest.ProfilePath})
			}
		}
		info.Episodes = append(info.Episodes, entry)
	}
	return info, nil
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
