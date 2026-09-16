package tvmaze

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
	"github.com/mihaiflorentin/torrent-tv/internal/platform/outbound"
)

// OpenArtwork is part of the provider port but TVmaze serves no images; the
// chain routes every artwork request to the tmdb entry instead.
func (c *Client) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	return nil, "", fmt.Errorf("TVmaze does not provide artwork")
}

// Client is the keyless TVmaze metadata adapter. TVmaze serves television
// only, so movie lookups fail through to the next chain entry.
type Client struct {
	base string
	http *http.Client
}

func New() *Client {
	return &Client{base: "https://api.tvmaze.com", http: &http.Client{Timeout: 20 * time.Second}}
}

var summaryTags = regexp.MustCompile(`<[^>]*>`)

func stripHTML(value string) string {
	return html.UnescapeString(summaryTags.ReplaceAllString(value, ""))
}

type httpStatusError struct{ status int }

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("TVmaze returned HTTP %d", e.status)
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	resp, err := outbound.Do(ctx, c.http, func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		return req, nil
	}, outbound.Policy{Provider: "TVmaze", Attempts: 3, MaxInlineDelay: 10 * time.Second})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return &httpStatusError{status: resp.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
}

func (c *Client) Lookup(ctx context.Context, imdbID, title string, kind domain.MediaKind, language, fallback string) (domain.CatalogMetadata, error) {
	_ = title
	if kind == domain.MediaMovie {
		return domain.CatalogMetadata{}, fmt.Errorf("TVmaze catalogs television only")
	}
	if imdbID == "" {
		return domain.CatalogMetadata{}, fmt.Errorf("IMDb id is unavailable")
	}
	var show struct {
		ID        int64    `json:"id"`
		Name      string   `json:"name"`
		Summary   string   `json:"summary"`
		Premiered string   `json:"premiered"`
		Genres    []string `json:"genres"`
		Rating    struct {
			Average float64 `json:"average"`
		} `json:"rating"`
	}
	if err := c.getJSON(ctx, "/lookup/shows?imdb="+imdbID, &show); err != nil {
		var status *httpStatusError
		if errors.As(err, &status) && status.status == http.StatusNotFound {
			return domain.CatalogMetadata{}, fmt.Errorf("no TVmaze match for %s", imdbID)
		}
		return domain.CatalogMetadata{}, err
	}
	if show.ID == 0 {
		return domain.CatalogMetadata{}, fmt.Errorf("no TVmaze match for %s", imdbID)
	}
	now := time.Now().UTC()
	year := 0
	if len(show.Premiered) >= 4 {
		if parsed, err := strconv.Atoi(show.Premiered[:4]); err == nil {
			year = parsed
		}
	}
	return domain.CatalogMetadata{
		Provider:       "tvmaze",
		ProviderID:     strconv.FormatInt(show.ID, 10),
		Title:          show.Name,
		Overview:       stripHTML(show.Summary),
		Genres:         show.Genres,
		Rating:         show.Rating.Average,
		RatingProvider: "tvmaze",
		Year:           year,
		Language:       language,
		FetchedAt:      now,
		ExpiresAt:      now.Add(30 * 24 * time.Hour),
	}, nil
}

func (c *Client) SeriesSeasons(ctx context.Context, provider, providerID, language string) (domain.SeriesSeasons, error) {
	if provider != "tvmaze" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider %q is not served by the TVmaze adapter", provider)
	}
	if providerID == "" {
		return domain.SeriesSeasons{}, fmt.Errorf("provider id is unavailable")
	}
	var showSeasons []struct {
		ID           int64 `json:"id"`
		Number       int   `json:"number"`
		EpisodeOrder int   `json:"episodeOrder"`
		EpisodeCount int   `json:"episodeCount"`
	}
	if err := c.getJSON(ctx, "/shows/"+providerID+"/seasons", &showSeasons); err != nil {
		return domain.SeriesSeasons{}, err
	}
	now := time.Now().UTC()
	seasons := domain.SeriesSeasons{
		Provider:   "tvmaze",
		ProviderID: providerID,
		Language:   language,
		Seasons:    []domain.SeriesSeason{},
		FetchedAt:  now,
		ExpiresAt:  now.Add(30 * 24 * time.Hour),
	}
	for _, entry := range showSeasons {
		var episodes []struct {
			Number  int    `json:"number"`
			Name    string `json:"name"`
			Airdate string `json:"airdate"`
		}
		if err := c.getJSON(ctx, "/seasons/"+strconv.FormatInt(entry.ID, 10)+"/episodes", &episodes); err != nil {
			return domain.SeriesSeasons{}, err
		}
		// The count must describe the episode list this cache entry ships; a
		// declared order count is only the fallback when the list came back
		// empty.
		count := len(episodes)
		if count == 0 {
			count = max(entry.EpisodeOrder, entry.EpisodeCount)
		}
		expanded := domain.SeriesSeason{
			Number:       entry.Number,
			EpisodeCount: count,
			Episodes:     []domain.SeriesEpisode{},
		}
		for _, episode := range episodes {
			expanded.Episodes = append(expanded.Episodes, domain.SeriesEpisode{Number: episode.Number, Name: episode.Name, AirDate: episode.Airdate})
		}
		seasons.Seasons = append(seasons.Seasons, expanded)
	}
	return seasons, nil
}
