package tmdb

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

type namedEntry struct {
	Name string `json:"name"`
}

type detailsResponse struct {
	ID               int64        `json:"id"`
	Tagline          string       `json:"tagline"`
	Overview         string       `json:"overview"`
	ReleaseDate      string       `json:"release_date"`
	FirstAirDate     string       `json:"first_air_date"`
	LastAirDate      string       `json:"last_air_date"`
	Status           string       `json:"status"`
	Runtime          int          `json:"runtime"`
	EpisodeRunTime   []int        `json:"episode_run_time"`
	VoteAverage      float64      `json:"vote_average"`
	VoteCount        int          `json:"vote_count"`
	OriginalLanguage string       `json:"original_language"`
	NumberOfSeasons  int          `json:"number_of_seasons"`
	NumberOfEpisodes int          `json:"number_of_episodes"`
	OriginCountry    []string     `json:"origin_country"`
	Genres           []namedEntry `json:"genres"`
	CreatedBy        []namedEntry `json:"created_by"`
	Countries        []namedEntry `json:"production_countries"`
	Credits          struct {
		Cast []struct {
			Name        string `json:"name"`
			Character   string `json:"character"`
			ProfilePath string `json:"profile_path"`
		} `json:"cast"`
		Crew []struct {
			Name string `json:"name"`
			Job  string `json:"job"`
		} `json:"crew"`
	} `json:"credits"`
	ReleaseDates struct {
		Results []struct {
			Region string `json:"iso_3166_1"`
			Dates  []struct {
				Certification string `json:"certification"`
			} `json:"release_dates"`
		} `json:"results"`
	} `json:"release_dates"`
	ContentRatings struct {
		Results []struct {
			Region string `json:"iso_3166_1"`
			Rating string `json:"rating"`
		} `json:"results"`
	} `json:"content_ratings"`
}

// TitleInfo returns the extended description of one TMDB movie or series in a
// single request (credits and certifications ride append_to_response). Text
// the requested language lacks is filled from the fallback language with one
// extra lightweight request; that request failing never fails the call.
func (c *Client) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	if provider != "tmdb" {
		return domain.TitleInfo{}, fmt.Errorf("provider %q is not served by the TMDB adapter", provider)
	}
	if providerID == "" {
		return domain.TitleInfo{}, fmt.Errorf("provider id is unavailable")
	}
	if c.apiKey() == "" {
		return domain.TitleInfo{}, fmt.Errorf("TMDB API key is not configured")
	}
	kindPath, extras := "movie", "credits,release_dates"
	if kind == domain.MediaSeries {
		kindPath, extras = "tv", "credits,content_ratings"
	}
	base := "/3/" + kindPath + "/" + url.PathEscape(providerID) + "?language="
	var details detailsResponse
	if err := c.getJSON(ctx, base+url.QueryEscape(language)+"&append_to_response="+extras, &details); err != nil {
		return domain.TitleInfo{}, err
	}
	if details.Overview == "" || details.Tagline == "" {
		if fallback != "" && fallback != language {
			var other detailsResponse
			if err := c.getJSON(ctx, base+url.QueryEscape(fallback), &other); err == nil {
				if details.Overview == "" {
					details.Overview = other.Overview
				}
				if details.Tagline == "" {
					details.Tagline = other.Tagline
				}
			}
		}
	}
	info := domain.TitleInfo{
		Provider:         "tmdb",
		ProviderID:       providerID,
		Kind:             kind,
		Language:         language,
		Tagline:          strings.TrimSpace(details.Tagline),
		Overview:         strings.TrimSpace(details.Overview),
		ReleaseDate:      normalizeDate(firstNonEmpty(details.ReleaseDate, details.FirstAirDate)),
		LastAirDate:      normalizeDate(details.LastAirDate),
		Status:           details.Status,
		RuntimeMinutes:   details.Runtime,
		Rating:           details.VoteAverage,
		RatingVotes:      details.VoteCount,
		OriginalLanguage: details.OriginalLanguage,
		Seasons:          details.NumberOfSeasons,
		Episodes:         details.NumberOfEpisodes,
		Available:        true,
	}
	if info.Rating > 0 {
		info.RatingProvider = "tmdb"
	}
	if info.RuntimeMinutes == 0 && len(details.EpisodeRunTime) > 0 {
		info.RuntimeMinutes = details.EpisodeRunTime[0]
	}
	for _, genre := range details.Genres {
		info.Genres = append(info.Genres, genre.Name)
	}
	for _, creator := range details.CreatedBy {
		info.Creators = append(info.Creators, creator.Name)
	}
	for _, country := range details.Countries {
		info.Countries = append(info.Countries, country.Name)
	}
	if len(info.Countries) == 0 {
		info.Countries = append(info.Countries, details.OriginCountry...)
	}
	for _, member := range details.Credits.Cast {
		if len(info.Cast) >= domain.MaxCastEntries {
			break
		}
		if strings.TrimSpace(member.Name) == "" {
			continue
		}
		info.Cast = append(info.Cast, domain.CastEntry{Name: member.Name, Character: member.Character, ImagePath: member.ProfilePath})
	}
	for _, member := range details.Credits.Crew {
		if member.Job == "Director" && member.Name != "" {
			info.Directors = append(info.Directors, member.Name)
		}
	}
	info.Certification = certification(details, language)
	now := time.Now().UTC()
	info.FetchedAt, info.ExpiresAt = now, now.Add(30*24*time.Hour)
	return info, nil
}

func certification(details detailsResponse, language string) string {
	regions := []string{"US"}
	if parts := strings.Split(language, "-"); len(parts) == 2 && len(parts[1]) == 2 {
		regions = []string{strings.ToUpper(parts[1]), "US"}
	}
	for _, region := range regions {
		for _, entry := range details.ReleaseDates.Results {
			if entry.Region != region {
				continue
			}
			for _, date := range entry.Dates {
				if date.Certification != "" {
					return date.Certification
				}
			}
		}
		for _, entry := range details.ContentRatings.Results {
			if entry.Region == region && entry.Rating != "" {
				return entry.Rating
			}
		}
	}
	return ""
}

// normalizeDate keeps only well-formed YYYY-MM-DD values.
func normalizeDate(value string) string {
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
