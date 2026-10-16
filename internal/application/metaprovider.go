package application

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// ProviderEntry names one metadata provider available to the chain.
type ProviderEntry struct {
	ID       string
	Provider MetadataProvider
}

// NewMetadataChain composes providers into a priority-ordered chain. order
// supplies the configured provider priority (ids, most preferred first) and is
// read on every call so settings changes apply without a restart; only listed
// ids are consulted. Lookup returns the first provider's success stamped with
// that provider's id, or the joined failures when every listed provider
// errors. SeriesSeasons routes to the named provider. Artwork always comes
// from the "tmdb" entry, the only provider serving images.
func NewMetadataChain(entries []ProviderEntry, order func() []string) MetadataProvider {
	byID := make(map[string]MetadataProvider, len(entries))
	for _, entry := range entries {
		if entry.ID == "" || entry.Provider == nil {
			continue
		}
		if _, exists := byID[entry.ID]; exists {
			continue
		}
		byID[entry.ID] = entry.Provider
	}
	return &metadataChain{byID: byID, order: order}
}

type metadataChain struct {
	byID  map[string]MetadataProvider
	order func() []string
}

func (c *metadataChain) Lookup(ctx context.Context, imdbID, title string, kind domain.MediaKind, language, fallback string) (domain.CatalogMetadata, error) {
	var errs []error
	queried := 0
	for _, id := range c.priority() {
		provider := c.byID[id]
		queried++
		metadata, err := provider.Lookup(ctx, imdbID, title, kind, language, fallback)
		if err == nil {
			if metadata.Provider == "" {
				metadata.Provider = id
			}
			return metadata, nil
		}
		errs = append(errs, fmt.Errorf("%s: %w", id, err))
	}
	if queried == 0 {
		return domain.CatalogMetadata{}, errors.New("no metadata providers are configured or available")
	}
	return domain.CatalogMetadata{}, errors.Join(errs...)
}

func (c *metadataChain) SeriesSeasons(ctx context.Context, provider, providerID, language string) (domain.SeriesSeasons, error) {
	entry, ok := c.byID[provider]
	if !ok {
		return domain.SeriesSeasons{}, fmt.Errorf("unknown metadata provider %q", provider)
	}
	return entry.SeriesSeasons(ctx, provider, providerID, language)
}

// TitleInfo routes an extended-details request to the named provider; a
// provider that does not implement the capability reports an error so callers
// degrade to cached metadata.
func (c *metadataChain) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	entry, ok := c.byID[provider]
	if !ok {
		return domain.TitleInfo{}, fmt.Errorf("unknown metadata provider %q", provider)
	}
	details, ok := entry.(TitleInfoProvider)
	if !ok {
		return domain.TitleInfo{}, fmt.Errorf("metadata provider %q does not serve title details", provider)
	}
	return details.TitleInfo(ctx, provider, providerID, kind, language, fallback)
}

func (c *metadataChain) SeasonList(ctx context.Context, provider, providerID, language, fallback string) (domain.TitleSeasons, error) {
	entry, ok := c.byID[provider]
	if !ok {
		return domain.TitleSeasons{}, fmt.Errorf("unknown metadata provider %q", provider)
	}
	details, ok := entry.(SeasonInfoProvider)
	if !ok {
		return domain.TitleSeasons{}, fmt.Errorf("metadata provider %q does not serve season details", provider)
	}
	return details.SeasonList(ctx, provider, providerID, language, fallback)
}

func (c *metadataChain) SeasonDetail(ctx context.Context, provider, providerID string, season int, language, fallback string) (domain.SeasonInfo, error) {
	entry, ok := c.byID[provider]
	if !ok {
		return domain.SeasonInfo{}, fmt.Errorf("unknown metadata provider %q", provider)
	}
	details, ok := entry.(SeasonInfoProvider)
	if !ok {
		return domain.SeasonInfo{}, fmt.Errorf("metadata provider %q does not serve season details", provider)
	}
	return details.SeasonDetail(ctx, provider, providerID, season, language, fallback)
}

func (c *metadataChain) EpisodeDetail(ctx context.Context, provider, providerID string, season, episode int, language string) (domain.EpisodeInfo, error) {
	entry, ok := c.byID[provider]
	if !ok {
		return domain.EpisodeInfo{}, fmt.Errorf("unknown metadata provider %q", provider)
	}
	details, ok := entry.(EpisodeDetailProvider)
	if !ok {
		return domain.EpisodeInfo{}, fmt.Errorf("metadata provider %q does not serve episode details", provider)
	}
	return details.EpisodeDetail(ctx, provider, providerID, season, episode, language)
}

func (c *metadataChain) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	entry, ok := c.byID["tmdb"]
	if !ok {
		return nil, "", errors.New("no artwork provider is configured")
	}
	return entry.OpenArtwork(ctx, path, kind)
}

// priority resolves the configured order to the entries that exist, keeping
// the configured order and dropping duplicates.
func (c *metadataChain) priority() []string {
	if c.order == nil {
		return nil
	}
	configured := c.order()
	priority := make([]string, 0, len(configured))
	seen := make(map[string]bool, len(configured))
	for _, id := range configured {
		if _, ok := c.byID[id]; ok && !seen[id] {
			seen[id] = true
			priority = append(priority, id)
		}
	}
	return priority
}
