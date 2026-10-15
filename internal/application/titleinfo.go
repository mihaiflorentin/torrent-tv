package application

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// titleInfoBackoff is how long a failed details fetch is remembered, so a
// struggling provider is not hammered each time the Info panel opens.
const titleInfoBackoff = 10 * time.Minute

// TitleInfo returns the extended description of a title for the Info panel.
// It never fails because details are missing: an unmatched title, a provider
// without a details capability, or a provider outage all degrade to whatever
// the catalog metadata already holds (Available reports whether anything
// useful came back). Provider payloads are cached like series seasons: served
// while fresh, refreshed when expired, kept (stale-if-error) when a refresh
// fails, and failures are negatively cached for ten minutes.
func (s *Service) TitleInfo(ctx context.Context, titleID string) (domain.TitleInfo, error) {
	metadata, err := s.repo.GetCatalogMetadata(ctx, titleID)
	if err != nil || metadata.Provider == "" || metadata.ProviderID == "" {
		return s.degradedTitleInfo(titleID, metadata), nil
	}
	provider, ok := s.metadata.(TitleInfoProvider)
	if s.metadata == nil || !ok {
		return s.degradedTitleInfo(titleID, metadata), nil
	}
	kind := s.titleInfoKind(ctx, titleID, metadata)
	language := s.settings.Get().MetadataLanguage
	cached, cacheErr := s.repo.GetTitleInfo(ctx, metadata.Provider, metadata.ProviderID, kind, language)
	if cacheErr == nil && cached.ExpiresAt.After(time.Now()) {
		if cached.Available {
			return s.presentTitleInfo(titleID, cached, metadata), nil
		}
		return s.degradedTitleInfo(titleID, metadata), nil
	}
	fetched, err := provider.TitleInfo(ctx, metadata.Provider, metadata.ProviderID, kind, language, s.settings.Get().MetadataFallbackLanguage)
	now := time.Now().UTC()
	if err != nil {
		if cacheErr == nil && cached.Available {
			cached.ExpiresAt = now.Add(titleInfoBackoff)
			_ = s.repo.SaveTitleInfo(ctx, cached)
			return s.presentTitleInfo(titleID, cached, metadata), nil
		}
		_ = s.repo.SaveTitleInfo(ctx, domain.TitleInfo{Provider: metadata.Provider, ProviderID: metadata.ProviderID, Kind: kind, Language: language, FetchedAt: now, ExpiresAt: now.Add(titleInfoBackoff)})
		return s.degradedTitleInfo(titleID, metadata), nil
	}
	fetched.Provider, fetched.ProviderID, fetched.Kind, fetched.Language, fetched.Available = metadata.Provider, metadata.ProviderID, kind, language, true
	if fetched.FetchedAt.IsZero() {
		fetched.FetchedAt = now
	}
	if !fetched.ExpiresAt.After(fetched.FetchedAt) {
		fetched.ExpiresAt = fetched.FetchedAt.Add(30 * 24 * time.Hour)
	}
	_ = s.repo.SaveTitleInfo(ctx, fetched)
	return s.presentTitleInfo(titleID, fetched, metadata), nil
}

// titleInfoKind resolves which provider endpoint serves the title: the kind
// the provider matched when known, otherwise the kind parsed from releases.
func (s *Service) titleInfoKind(ctx context.Context, titleID string, metadata domain.CatalogMetadata) domain.MediaKind {
	if metadata.Kind != "" {
		return metadata.Kind
	}
	if sources, err := s.repo.ListCatalogSourcesByTitleIDs(ctx, []string{titleID}, nil); err == nil && len(sources) > 0 {
		return groupCatalog(sources, false)[0].Kind
	}
	return domain.MediaMovie
}

// presentTitleInfo stamps the client-facing fields: the title id, proxied cast
// photo URLs (the provider-relative path stays server side) and any scalar the
// provider omitted but the catalog metadata knows.
func (s *Service) presentTitleInfo(titleID string, info domain.TitleInfo, metadata domain.CatalogMetadata) domain.TitleInfo {
	info.TitleID = titleID
	cast := make([]domain.CastEntry, len(info.Cast))
	for i, member := range info.Cast {
		if member.ImagePath != "" {
			member.ImageURL = "/api/v1/artwork/" + titleID + "/cast-" + strconv.Itoa(i)
		}
		member.ImagePath = ""
		cast[i] = member
	}
	info.Cast = cast
	if info.Overview == "" {
		info.Overview = metadata.Overview
	}
	if info.ReleaseDate == "" {
		info.ReleaseDate = metadata.ReleaseDate
	}
	if info.Rating == 0 {
		info.Rating, info.RatingVotes, info.RatingProvider = metadata.Rating, metadata.RatingVotes, metadata.RatingProvider
	}
	if len(info.Genres) == 0 {
		info.Genres = metadata.Genres
	}
	return info
}

// degradedTitleInfo answers from the catalog metadata alone.
func (s *Service) degradedTitleInfo(titleID string, metadata domain.CatalogMetadata) domain.TitleInfo {
	info := s.presentTitleInfo(titleID, domain.TitleInfo{Provider: metadata.Provider, ProviderID: metadata.ProviderID, Kind: metadata.Kind, Language: metadata.Language}, metadata)
	info.Available = info.Overview != "" || info.ReleaseDate != "" || info.Rating > 0 || len(info.Genres) > 0
	return info
}

// castPhotoPath returns the provider-relative profile image of the index-th
// cast entry of a title's cached details.
func (s *Service) castPhotoPath(ctx context.Context, titleID, kind string) (string, error) {
	index, err := strconv.Atoi(strings.TrimPrefix(kind, "cast-"))
	if err != nil || index < 0 {
		return "", fmt.Errorf("invalid artwork kind")
	}
	metadata, err := s.repo.GetCatalogMetadata(ctx, titleID)
	if err != nil {
		return "", err
	}
	info, err := s.repo.GetTitleInfo(ctx, metadata.Provider, metadata.ProviderID, s.titleInfoKind(ctx, titleID, metadata), s.settings.Get().MetadataLanguage)
	if err != nil {
		return "", err
	}
	if index >= len(info.Cast) || info.Cast[index].ImagePath == "" {
		return "", errors.New("cast photo is unavailable")
	}
	return info.Cast[index].ImagePath, nil
}

// expireTitleInfo drops the cached extended details of a title so the next
// Info panel open re-fetches them; runs inside a forced title refresh.
func (s *Service) expireTitleInfo(titleID string) {
	metadata, err := s.repo.GetCatalogMetadata(context.Background(), titleID)
	if err != nil || metadata.Provider == "" || metadata.ProviderID == "" {
		return
	}
	_ = s.repo.DeleteTitleInfo(context.Background(), metadata.Provider, metadata.ProviderID, s.titleInfoKind(context.Background(), titleID, metadata), s.settings.Get().MetadataLanguage)
}
