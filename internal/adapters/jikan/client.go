package jikan

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"

	"github.com/mihaiflorentin/torrent-tv/internal/platform/outbound"
)

// OpenArtwork is part of the provider port but MAL serves no images; the
// chain routes every artwork request to the tmdb entry instead.
func (c *Client) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	return nil, "", fmt.Errorf("Jikan does not provide artwork")
}

// Client is the keyless MyAnimeList (Jikan) metadata adapter. MAL has no IMDb
// cross-reference, so lookups match on the parsed release title instead and
// error when nothing matches, letting the chain fall through. MAL orders anime
// as one flat episode list, so SeriesSeasons projects everything onto season 1.
type Client struct {
	base string
	http *http.Client
}

func New() *Client {
	return &Client{base: "https://api.jikan.moe/v4", http: &http.Client{Timeout: 20 * time.Second}}
}

var (
	synopsisTags    = regexp.MustCompile(`<[^>]*>`)
	nonAlphanumeric = regexp.MustCompile(`[^a-z0-9]+`)
)

func stripHTML(value string) string {
	return strings.TrimSpace(html.UnescapeString(synopsisTags.ReplaceAllString(value, "")))
}

// normalizeTitle folds a title to lowercase alphanumeric words so release
// punctuation and bracket noise cannot block a match.
func normalizeTitle(value string) string {
	return strings.TrimSpace(nonAlphanumeric.ReplaceAllString(strings.ToLower(value), " "))
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	resp, err := outbound.Do(ctx, c.http, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		return req, nil
	}, outbound.Policy{Provider: "Jikan", Attempts: 3, MaxInlineDelay: 10 * time.Second})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("Jikan returned HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
}

func (c *Client) Lookup(ctx context.Context, imdbID, title string, kind domain.MediaKind, language, fallback string) (domain.CatalogMetadata, error) {
	_ = imdbID
	_ = kind
	_ = language
	_ = fallback
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return domain.CatalogMetadata{}, fmt.Errorf("a title is required for Jikan matching")
	}
	var search struct {
		Data []struct {
			MalID         int64   `json:"mal_id"`
			Title         string  `json:"title"`
			TitleEnglish  string  `json:"title_english"`
			TitleJapanese string  `json:"title_japanese"`
			Synopsis      string  `json:"synopsis"`
			Score         float64 `json:"score"`
			Year          int     `json:"year"`
			Aired         struct {
				From string `json:"from"`
			} `json:"aired"`
			Genres []struct {
				Name string `json:"name"`
			} `json:"genres"`
		} `json:"data"`
	}
	if err := c.getJSON(ctx, "/anime?q="+url.QueryEscape(trimmed)+"&limit=5", &search); err != nil {
		return domain.CatalogMetadata{}, err
	}
	wanted := normalizeTitle(trimmed)
	for _, candidate := range search.Data {
		for _, name := range []string{candidate.Title, candidate.TitleEnglish, candidate.TitleJapanese} {
			if name == "" || normalizeTitle(name) != wanted {
				continue
			}
			found := candidate
			metadataTitle := found.Title
			if found.TitleEnglish != "" {
				metadataTitle = found.TitleEnglish
			}
			year := found.Year
			if year == 0 && len(found.Aired.From) >= 4 {
				if parsed, err := strconv.Atoi(found.Aired.From[:4]); err == nil {
					year = parsed
				}
			}
			genres := make([]string, 0, len(found.Genres))
			for _, genre := range found.Genres {
				genres = append(genres, genre.Name)
			}
			now := time.Now().UTC()
			return domain.CatalogMetadata{
				Provider:       "jikan",
				ProviderID:     strconv.FormatInt(found.MalID, 10),
				Title:          metadataTitle,
				OriginalTitle:  found.TitleJapanese,
				Overview:       stripHTML(found.Synopsis),
				Genres:         genres,
				Rating:         found.Score,
				RatingProvider: "jikan",
				Year:           year,
				Language:       language,
				FetchedAt:      now,
				ExpiresAt:      now.Add(30 * 24 * time.Hour),
			}, nil
		}
	}
	return domain.CatalogMetadata{}, fmt.Errorf("no Jikan match for %q", trimmed)
}

// maxEpisodePages bounds the episode pagination so a pathological entry
// cannot turn one cache miss into an unbounded request run.
const maxEpisodePages = 20

func (c *Client) SeriesSeasons(ctx context.Context, provider, providerID, language string) (domain.SeriesSeasons, error) {
	if provider != "jikan" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider %q is not served by the Jikan adapter", provider)
	}
	if providerID == "" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider id is unavailable")
	}
	now := time.Now().UTC()
	seasons := domain.SeriesSeasons{
		Provider:   "jikan",
		ProviderID: providerID,
		Language:   language,
		Seasons:    []domain.SeriesSeason{},
		FetchedAt:  now,
		ExpiresAt:  now.Add(30 * 24 * time.Hour),
	}
	episodes := []domain.SeriesEpisode{}
	for page := 1; page <= maxEpisodePages; page++ {
		var result struct {
			Pagination struct {
				HasNextPage bool `json:"has_next_page"`
			} `json:"pagination"`
			Data []struct {
				Title string `json:"title"`
				Aired struct {
					Date string `json:"date"`
				} `json:"aired"`
			} `json:"data"`
		}
		path := "/anime/" + providerID + "/episodes?page=" + strconv.Itoa(page)
		if err := c.getJSON(ctx, path, &result); err != nil {
			return domain.SeriesSeasons{}, err
		}
		for _, entry := range result.Data {
			episodes = append(episodes, domain.SeriesEpisode{
				Number:  len(episodes) + 1,
				Name:    entry.Title,
				AirDate: entry.Aired.Date,
			})
		}
		if !result.Pagination.HasNextPage {
			break
		}
	}
	if len(episodes) > 0 {
		seasons.Seasons = append(seasons.Seasons, domain.SeriesSeason{
			Number:       1,
			Name:         "Episodes",
			EpisodeCount: len(episodes),
			Episodes:     episodes,
		})
	}
	return seasons, nil
}
