package tvmaze

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// TitleInfo returns the extended description of one TVmaze show with the cast
// embedded in the same request. TVmaze publishes no tagline, director or
// certification, and its image hosts are not proxied, so cast photos are
// omitted and clients fall back to initials.
func (c *Client) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	_, _ = kind, fallback
	if provider != "tvmaze" {
		return domain.TitleInfo{}, fmt.Errorf("provider %q is not served by the TVmaze adapter", provider)
	}
	if providerID == "" {
		return domain.TitleInfo{}, fmt.Errorf("provider id is unavailable")
	}
	var show struct {
		Name           string   `json:"name"`
		Summary        string   `json:"summary"`
		Premiered      string   `json:"premiered"`
		Ended          string   `json:"ended"`
		Status         string   `json:"status"`
		Runtime        int      `json:"runtime"`
		AverageRuntime int      `json:"averageRuntime"`
		Language       string   `json:"language"`
		Genres         []string `json:"genres"`
		Rating         struct {
			Average float64 `json:"average"`
		} `json:"rating"`
		Network struct {
			Country struct {
				Name string `json:"name"`
			} `json:"country"`
		} `json:"network"`
		WebChannel struct {
			Country struct {
				Name string `json:"name"`
			} `json:"country"`
		} `json:"webChannel"`
		Embedded struct {
			Cast []struct {
				Person struct {
					Name string `json:"name"`
				} `json:"person"`
				Character struct {
					Name string `json:"name"`
				} `json:"character"`
			} `json:"cast"`
		} `json:"_embedded"`
	}
	if err := c.getJSON(ctx, "/shows/"+url.PathEscape(providerID)+"?embed=cast", &show); err != nil {
		return domain.TitleInfo{}, err
	}
	now := time.Now().UTC()
	info := domain.TitleInfo{
		Provider:         "tvmaze",
		ProviderID:       providerID,
		Kind:             domain.MediaSeries,
		Language:         language,
		Overview:         strings.TrimSpace(stripHTML(show.Summary)),
		ReleaseDate:      validDate(show.Premiered),
		LastAirDate:      validDate(show.Ended),
		Status:           show.Status,
		RuntimeMinutes:   show.AverageRuntime,
		Rating:           show.Rating.Average,
		Genres:           show.Genres,
		OriginalLanguage: show.Language,
		Available:        true,
		FetchedAt:        now,
		ExpiresAt:        now.Add(30 * 24 * time.Hour),
	}
	if info.RuntimeMinutes == 0 {
		info.RuntimeMinutes = show.Runtime
	}
	if info.Rating > 0 {
		info.RatingProvider = "tvmaze"
	}
	for _, country := range []string{show.Network.Country.Name, show.WebChannel.Country.Name} {
		if country != "" {
			info.Countries = append(info.Countries, country)
			break
		}
	}
	for _, member := range show.Embedded.Cast {
		if len(info.Cast) >= domain.MaxCastEntries {
			break
		}
		if member.Person.Name != "" {
			info.Cast = append(info.Cast, domain.CastEntry{Name: member.Person.Name, Character: member.Character.Name})
		}
	}
	return info, nil
}

func validDate(value string) string {
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}
