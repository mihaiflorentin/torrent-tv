package application

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

type stubMetaProvider struct {
	id          string
	metadata    domain.CatalogMetadata
	lookupErr   error
	lookups     int
	seasons     domain.SeriesSeasons
	seasonErr   error
	seasonCalls int
}

func (p *stubMetaProvider) Lookup(ctx context.Context, imdbID, title string, kind domain.MediaKind, language, fallback string) (domain.CatalogMetadata, error) {
	p.lookups++
	if p.lookupErr != nil {
		return domain.CatalogMetadata{}, p.lookupErr
	}
	return p.metadata, nil
}

func (p *stubMetaProvider) SeriesSeasons(ctx context.Context, provider, providerID, language string) (domain.SeriesSeasons, error) {
	p.seasonCalls++
	if p.seasonErr != nil {
		return domain.SeriesSeasons{}, p.seasonErr
	}
	return p.seasons, nil
}

func (p *stubMetaProvider) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	return nil, "", errors.New("artwork unavailable")
}

func chainEntries(providers ...*stubMetaProvider) []ProviderEntry {
	entries := make([]ProviderEntry, 0, len(providers))
	for _, p := range providers {
		entries = append(entries, ProviderEntry{ID: p.id, Provider: p})
	}
	return entries
}

func TestMetadataChainFirstSuccessWins(t *testing.T) {
	first := &stubMetaProvider{id: "tmdb", metadata: domain.CatalogMetadata{Title: "From TMDB", ProviderID: "9"}}
	second := &stubMetaProvider{id: "tvmaze", metadata: domain.CatalogMetadata{Title: "From TVmaze"}}
	chain := NewMetadataChain(chainEntries(first, second), func() []string { return []string{"tmdb", "tvmaze"} })
	metadata, err := chain.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "ro-RO", "en-US")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if metadata.Title != "From TMDB" {
		t.Fatalf("expected first provider result, got %q", metadata.Title)
	}
	if metadata.Provider != "tmdb" {
		t.Fatalf("expected provider stamped tmdb, got %q", metadata.Provider)
	}
	if second.lookups != 0 {
		t.Fatalf("second provider consulted %d times, want 0", second.lookups)
	}
}

func TestMetadataChainFallsThroughOnFailure(t *testing.T) {
	first := &stubMetaProvider{id: "tmdb", lookupErr: errors.New("key missing")}
	second := &stubMetaProvider{id: "tvmaze", metadata: domain.CatalogMetadata{Title: "From TVmaze", ProviderID: "1"}}
	chain := NewMetadataChain(chainEntries(first, second), func() []string { return []string{"tmdb", "tvmaze"} })
	metadata, err := chain.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "ro-RO", "en-US")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if metadata.Title != "From TVmaze" || metadata.Provider != "tvmaze" {
		t.Fatalf("expected TVmaze fallback result, got %+v", metadata)
	}
	if first.lookups != 1 || second.lookups != 1 {
		t.Fatalf("unexpected call counts first=%d second=%d", first.lookups, second.lookups)
	}
}

func TestMetadataChainUnlistedProviderNotConsulted(t *testing.T) {
	first := &stubMetaProvider{id: "tmdb", lookupErr: errors.New("down")}
	second := &stubMetaProvider{id: "tvmaze", metadata: domain.CatalogMetadata{Title: "From TVmaze"}}
	chain := NewMetadataChain(chainEntries(first, second), func() []string { return []string{"tmdb"} })
	if _, err := chain.Lookup(context.Background(), "tt0773295", "Attack on Titan", domain.MediaSeries, "ro-RO", "en-US"); err == nil {
		t.Fatalf("expected error when the only listed provider fails")
	}
	if second.lookups != 0 {
		t.Fatalf("unlisted provider consulted %d times, want 0", second.lookups)
	}
}

func TestMetadataChainAllProvidersFail(t *testing.T) {
	first := &stubMetaProvider{id: "tmdb", lookupErr: errors.New("key missing")}
	second := &stubMetaProvider{id: "tvmaze", lookupErr: errors.New("no match")}
	chain := NewMetadataChain(chainEntries(first, second), func() []string { return []string{"tmdb", "tvmaze"} })
	_, err := chain.Lookup(context.Background(), "tt0000000", "Unknown", domain.MediaSeries, "ro-RO", "en-US")
	if err == nil {
		t.Fatalf("expected joined error when every provider fails")
	}
	for _, want := range []string{"tmdb", "tvmaze", "key missing", "no match"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("joined error %q does not mention %q", err.Error(), want)
		}
	}
}

func TestMetadataChainSeriesSeasonsRoutesToNamedProvider(t *testing.T) {
	tmdb := &stubMetaProvider{id: "tmdb", seasons: domain.SeriesSeasons{Provider: "tmdb"}}
	tvmaze := &stubMetaProvider{id: "tvmaze", seasons: domain.SeriesSeasons{Provider: "tvmaze"}}
	chain := NewMetadataChain(chainEntries(tmdb, tvmaze), func() []string { return []string{"tmdb", "tvmaze"} })
	seasons, err := chain.SeriesSeasons(context.Background(), "tvmaze", "42", "en-US")
	if err != nil {
		t.Fatalf("SeriesSeasons returned error: %v", err)
	}
	if seasons.Provider != "tvmaze" {
		t.Fatalf("expected tvmaze seasons, got provider %q", seasons.Provider)
	}
	if tmdb.seasonCalls != 0 {
		t.Fatalf("tmdb consulted %d times, want 0", tmdb.seasonCalls)
	}
	if _, err := chain.SeriesSeasons(context.Background(), "unknown", "42", "en-US"); err == nil {
		t.Fatalf("expected error for unknown provider")
	}
}

func TestMetadataChainArtworkComesFromTMDB(t *testing.T) {
	tmdb := &stubMetaProvider{id: "tmdb"}
	tvmaze := &stubMetaProvider{id: "tvmaze"}
	chain := NewMetadataChain(chainEntries(tmdb, tvmaze), func() []string { return []string{"tvmaze", "tmdb"} })
	if _, _, err := chain.OpenArtwork(context.Background(), "/p.jpg", "poster"); err == nil {
		t.Fatalf("stub artwork should fail, but delegation target must be tmdb")
	}
	if tvmaze.seasonCalls != 0 || tvmaze.lookups != 0 {
		t.Fatalf("tvmaze must never receive artwork calls")
	}
	chain = NewMetadataChain(chainEntries(tvmaze), func() []string { return []string{"tvmaze"} })
	if _, _, err := chain.OpenArtwork(context.Background(), "/p.jpg", "poster"); err == nil {
		t.Fatalf("expected error when no tmdb entry exists")
	}
}
