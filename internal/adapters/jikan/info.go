package jikan

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

var durationMinutes = regexp.MustCompile(`(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?`)

// TitleInfo returns the extended description of one MAL entry from the full
// endpoint, plus top-billed characters from a second best-effort request: a
// characters failure leaves the cast empty instead of failing the call. MAL
// images are not proxied, so cast photos are omitted.
func (c *Client) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	_, _ = kind, fallback
	if provider != "jikan" {
		return domain.TitleInfo{}, fmt.Errorf("provider %q is not served by the Jikan adapter", provider)
	}
	if providerID == "" {
		return domain.TitleInfo{}, fmt.Errorf("provider id is unavailable")
	}
	var full struct {
		Data struct {
			Synopsis string  `json:"synopsis"`
			Score    float64 `json:"score"`
			Votes    int     `json:"scored_by"`
			Episodes int     `json:"episodes"`
			Status   string  `json:"status"`
			Duration string  `json:"duration"`
			Rating   string  `json:"rating"`
			Aired    struct {
				From string `json:"from"`
				To   string `json:"to"`
			} `json:"aired"`
			Genres []struct {
				Name string `json:"name"`
			} `json:"genres"`
		} `json:"data"`
	}
	if err := c.getJSON(ctx, "/anime/"+url.PathEscape(providerID)+"/full", &full); err != nil {
		return domain.TitleInfo{}, err
	}
	now := time.Now().UTC()
	data := full.Data
	info := domain.TitleInfo{
		Provider:         "jikan",
		ProviderID:       providerID,
		Kind:             kind,
		Language:         language,
		Overview:         stripHTML(data.Synopsis),
		ReleaseDate:      datePart(data.Aired.From),
		LastAirDate:      datePart(data.Aired.To),
		Status:           data.Status,
		RuntimeMinutes:   parseDuration(data.Duration),
		Rating:           data.Score,
		RatingVotes:      data.Votes,
		Episodes:         data.Episodes,
		Certification:    data.Rating,
		OriginalLanguage: "Japanese",
		Available:        true,
		FetchedAt:        now,
		ExpiresAt:        now.Add(30 * 24 * time.Hour),
	}
	if info.Rating > 0 {
		info.RatingProvider = "jikan"
	}
	for _, genre := range data.Genres {
		info.Genres = append(info.Genres, genre.Name)
	}
	var characters struct {
		Data []struct {
			Character struct {
				Name string `json:"name"`
			} `json:"character"`
			VoiceActors []struct {
				Person struct {
					Name string `json:"name"`
				} `json:"person"`
				Language string `json:"language"`
			} `json:"voice_actors"`
		} `json:"data"`
	}
	if err := c.getJSON(ctx, "/anime/"+url.PathEscape(providerID)+"/characters", &characters); err == nil {
		for _, entry := range characters.Data {
			if len(info.Cast) >= domain.MaxCastEntries {
				break
			}
			actor := ""
			for _, voice := range entry.VoiceActors {
				if strings.EqualFold(voice.Language, "Japanese") {
					actor = voice.Person.Name
					break
				}
			}
			switch {
			case actor != "":
				info.Cast = append(info.Cast, domain.CastEntry{Name: actor, Character: entry.Character.Name})
			case entry.Character.Name != "":
				info.Cast = append(info.Cast, domain.CastEntry{Name: entry.Character.Name})
			}
		}
	}
	return info, nil
}

func datePart(value string) string {
	if len(value) < 10 {
		return ""
	}
	if _, err := time.Parse("2006-01-02", value[:10]); err != nil {
		return ""
	}
	return value[:10]
}

// parseDuration reads MAL durations such as "24 min per ep" or "1 hr 55 min".
func parseDuration(value string) int {
	match := durationMinutes.FindStringSubmatch(value)
	if match == nil {
		return 0
	}
	hours, _ := strconv.Atoi(match[1])
	minutes, _ := strconv.Atoi(match[2])
	return hours*60 + minutes
}
