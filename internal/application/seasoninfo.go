package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// seasonInfoTTL is how long a provider season payload is served before it is
// refreshed, the same as the title info cache.
const seasonInfoTTL = 30 * 24 * time.Hour

// seasonResult is one shared fetch outcome: payload is the marshalled provider
// document, usable reports whether it is real (or stale-cached) rather than a
// degrade.
type seasonResult struct {
	payload []byte
	usable  bool
}

// seasonPayload serves one cached provider season document (the season list
// when season is domain.SeasonListKey) with the title info cache rules: fresh
// rows are served, expired rows are refreshed, a failed refresh keeps the
// stale row (stale-if-error), failures are negatively cached for ten minutes
// and a cancellation is never cached. ok is false when nothing usable exists.
func (s *Service) seasonPayload(ctx context.Context, metadata domain.CatalogMetadata, season int, fetch func(context.Context, SeasonInfoProvider, string, string) ([]byte, error)) ([]byte, bool) {
	provider, ok := s.metadata.(SeasonInfoProvider)
	if s.metadata == nil || !ok {
		return nil, false
	}
	settings := s.settings.Get()
	language := settings.MetadataLanguage
	cached, cacheErr := s.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, season, language)
	if cacheErr == nil && cached.ExpiresAt.After(time.Now()) {
		return cached.Payload, cached.Available
	}
	haveCached := cacheErr == nil && cached.Available
	key := "season\x00" + metadata.Provider + "\x00" + metadata.ProviderID + "\x00" + strconv.Itoa(season) + "\x00" + language
	result, ok := s.seasonFlights.do(ctx, &s.titleInfoMu, key, func(fetchCtx context.Context) seasonResult {
		payload, err := fetch(fetchCtx, provider, language, settings.MetadataFallbackLanguage)
		now := time.Now().UTC()
		entry := domain.SeasonCacheEntry{Provider: metadata.Provider, ProviderID: metadata.ProviderID, Season: season, Language: language, FetchedAt: now}
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return seasonResult{payload: cached.Payload, usable: haveCached}
			}
			entry.ExpiresAt = now.Add(titleInfoBackoff)
			if haveCached {
				entry.Available, entry.Payload, entry.FetchedAt = true, cached.Payload, cached.FetchedAt
				_ = s.repo.SaveSeasonCache(fetchCtx, entry)
				return seasonResult{payload: cached.Payload, usable: true}
			}
			entry.Payload = []byte("null")
			_ = s.repo.SaveSeasonCache(fetchCtx, entry)
			return seasonResult{}
		}
		entry.Available, entry.Payload, entry.ExpiresAt = true, payload, now.Add(seasonInfoTTL)
		_ = s.repo.SaveSeasonCache(fetchCtx, entry)
		return seasonResult{payload: payload, usable: true}
	})
	if !ok || !result.usable {
		return nil, false
	}
	return result.payload, true
}

// seriesMetadata resolves the matched provider identity of a series title. ok
// is false for movies and unmatched titles, which have no seasons.
func (s *Service) seriesMetadata(ctx context.Context, titleID string) (domain.CatalogMetadata, bool) {
	metadata, err := s.repo.GetCatalogMetadata(ctx, titleID)
	if err != nil || metadata.Provider == "" || metadata.ProviderID == "" {
		return metadata, false
	}
	return metadata, s.titleInfoKind(ctx, titleID, metadata) == domain.MediaSeries
}

// TitleSeasons returns the season list of a series for the Info panel. Like
// TitleInfo it never fails because details are missing: movies, unmatched
// titles and provider outages answer Available=false with no seasons.
func (s *Service) TitleSeasons(ctx context.Context, titleID string) (domain.TitleSeasons, error) {
	empty := domain.TitleSeasons{TitleID: titleID, Seasons: []domain.SeasonSummary{}}
	metadata, ok := s.seriesMetadata(ctx, titleID)
	if !ok {
		return empty, nil
	}
	payload, ok := s.seasonPayload(ctx, metadata, domain.SeasonListKey, func(fetchCtx context.Context, provider SeasonInfoProvider, language, fallback string) ([]byte, error) {
		list, err := provider.SeasonList(fetchCtx, metadata.Provider, metadata.ProviderID, language, fallback)
		if err != nil {
			return nil, err
		}
		if len(list.Seasons) == 0 {
			return nil, errors.New("provider listed no seasons")
		}
		return json.Marshal(list)
	})
	if !ok {
		return empty, nil
	}
	var list domain.TitleSeasons
	if err := json.Unmarshal(payload, &list); err != nil || len(list.Seasons) == 0 {
		return empty, nil
	}
	list.TitleID, list.Provider, list.ProviderID, list.Language, list.Available = titleID, metadata.Provider, metadata.ProviderID, s.settings.Get().MetadataLanguage, true
	for i := range list.Seasons {
		if list.Seasons[i].PosterPath != "" {
			list.Seasons[i].PosterURL = seasonArtworkURL(titleID, list.Seasons[i].Number, "poster")
		}
		list.Seasons[i].PosterPath = ""
	}
	return list, nil
}

// SeasonInfo returns one season of a series with its cast and episodes.
func (s *Service) SeasonInfo(ctx context.Context, titleID string, season int) (domain.SeasonInfo, error) {
	empty := domain.SeasonInfo{TitleID: titleID, Number: season, Episodes: []domain.EpisodeInfo{}}
	if season < 0 {
		return empty, fmt.Errorf("invalid season number")
	}
	metadata, ok := s.seriesMetadata(ctx, titleID)
	if !ok {
		return empty, nil
	}
	info, ok := s.loadSeason(ctx, metadata, season)
	if !ok {
		return empty, nil
	}
	return presentSeasonInfo(titleID, info), nil
}

// loadSeason returns the cached or freshly fetched season document.
func (s *Service) loadSeason(ctx context.Context, metadata domain.CatalogMetadata, season int) (domain.SeasonInfo, bool) {
	payload, ok := s.seasonPayload(ctx, metadata, season, func(fetchCtx context.Context, provider SeasonInfoProvider, language, fallback string) ([]byte, error) {
		detail, err := provider.SeasonDetail(fetchCtx, metadata.Provider, metadata.ProviderID, season, language, fallback)
		if err != nil {
			return nil, err
		}
		if len(detail.Episodes) == 0 && detail.Overview == "" && len(detail.Cast) == 0 {
			return nil, errors.New("provider described no season details")
		}
		return json.Marshal(detail)
	})
	if !ok {
		return domain.SeasonInfo{}, false
	}
	var info domain.SeasonInfo
	if err := json.Unmarshal(payload, &info); err != nil {
		return domain.SeasonInfo{}, false
	}
	info.Provider, info.ProviderID, info.Language, info.Number, info.Available = metadata.Provider, metadata.ProviderID, s.settings.Get().MetadataLanguage, season, true
	if info.Episodes == nil {
		info.Episodes = []domain.EpisodeInfo{}
	}
	return info, true
}

// SeasonEpisode returns one episode of a season. Providers whose season
// payload omits episode text (Jikan) are asked once for the missing synopsis;
// the answer is stored in the season cache. found is false when the season or
// the episode is unknown.
func (s *Service) SeasonEpisode(ctx context.Context, titleID string, season, episode int) (info domain.EpisodeInfo, found bool, err error) {
	if season < 0 || episode < 0 {
		return domain.EpisodeInfo{}, false, fmt.Errorf("invalid season or episode number")
	}
	metadata, ok := s.seriesMetadata(ctx, titleID)
	if !ok {
		return domain.EpisodeInfo{}, false, nil
	}
	loaded, ok := s.loadSeason(ctx, metadata, season)
	if !ok {
		return domain.EpisodeInfo{}, false, nil
	}
	index := -1
	for i, candidate := range loaded.Episodes {
		if candidate.Number == episode {
			index = i
			break
		}
	}
	if index < 0 {
		return domain.EpisodeInfo{}, false, nil
	}
	if loaded.Episodes[index].LazyDetail {
		if lazy, ok := s.metadata.(EpisodeDetailProvider); ok {
			fetchCtx, cancel := context.WithTimeout(ctx, titleInfoFetchTimeout)
			detail, fetchErr := lazy.EpisodeDetail(fetchCtx, metadata.Provider, metadata.ProviderID, season, episode, s.settings.Get().MetadataLanguage)
			cancel()
			if fetchErr == nil {
				loaded.Episodes[index] = mergeEpisode(loaded.Episodes[index], detail)
				s.storeEpisode(ctx, metadata, season, loaded.Episodes[index])
			}
		}
	}
	presented := presentSeasonInfo(titleID, loaded)
	return presented.Episodes[index], true, nil
}

func mergeEpisode(base, detail domain.EpisodeInfo) domain.EpisodeInfo {
	if detail.Name != "" && base.Name == "" {
		base.Name = detail.Name
	}
	if detail.Overview != "" {
		base.Overview = detail.Overview
	}
	if detail.Runtime > 0 {
		base.Runtime = detail.Runtime
	}
	if detail.AirDate != "" && base.AirDate == "" {
		base.AirDate = detail.AirDate
	}
	base.LazyDetail = false
	return base
}

// storeEpisode writes an enriched episode back into the cached season row,
// keeping the row's expiry.
func (s *Service) storeEpisode(ctx context.Context, metadata domain.CatalogMetadata, season int, episode domain.EpisodeInfo) {
	s.titleInfoMu.Lock()
	defer s.titleInfoMu.Unlock()
	language := s.settings.Get().MetadataLanguage
	entry, err := s.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, season, language)
	if err != nil || !entry.Available {
		return
	}
	var stored domain.SeasonInfo
	if json.Unmarshal(entry.Payload, &stored) != nil {
		return
	}
	for i := range stored.Episodes {
		if stored.Episodes[i].Number == episode.Number {
			stored.Episodes[i] = episode
		}
	}
	payload, err := json.Marshal(stored)
	if err != nil {
		return
	}
	entry.Payload = payload
	_ = s.repo.SaveSeasonCache(ctx, entry)
}

func seasonArtworkURL(titleID string, season int, rest string) string {
	return "/api/v1/artwork/" + titleID + "/season-" + strconv.Itoa(season) + "-" + rest
}

// presentSeasonInfo stamps the client-facing proxy URLs and hides every
// provider-relative image path.
func presentSeasonInfo(titleID string, info domain.SeasonInfo) domain.SeasonInfo {
	info.TitleID = titleID
	if info.PosterPath != "" {
		info.PosterURL = seasonArtworkURL(titleID, info.Number, "poster")
	}
	info.PosterPath = ""
	info.Cast = presentCast(info.Cast, func(i int) string { return seasonArtworkURL(titleID, info.Number, "cast-"+strconv.Itoa(i)) })
	episodes := make([]domain.EpisodeInfo, len(info.Episodes))
	for i, episode := range info.Episodes {
		number := episode.Number
		if episode.StillPath != "" {
			episode.StillURL = seasonArtworkURL(titleID, info.Number, "still-"+strconv.Itoa(number))
		}
		episode.StillPath = ""
		episode.GuestStars = presentCast(episode.GuestStars, func(g int) string {
			return seasonArtworkURL(titleID, info.Number, "guest-"+strconv.Itoa(number)+"-"+strconv.Itoa(g))
		})
		episodes[i] = episode
	}
	info.Episodes = episodes
	return info
}

func presentCast(cast []domain.CastEntry, url func(int) string) []domain.CastEntry {
	if len(cast) == 0 {
		return cast
	}
	out := make([]domain.CastEntry, len(cast))
	for i, member := range cast {
		if member.ImagePath != "" {
			member.ImageURL = url(i)
		}
		member.ImagePath = ""
		out[i] = member
	}
	return out
}

var seasonImageKind = regexp.MustCompile(`^season-(\d+)-(?:(poster)|cast-(\d+)|still-(\d+)|guest-(\d+)-(\d+))$`)

// seasonImagePath resolves a season artwork kind (season-N-poster,
// season-N-cast-I, season-N-still-E, season-N-guest-E-I) to the
// provider-relative image path and the TMDB image size class to fetch. Only
// paths already stored from a provider answer can be served, so the proxy
// never fetches an arbitrary URL.
func (s *Service) seasonImagePath(ctx context.Context, titleID, kind string) (string, string, error) {
	match := seasonImageKind.FindStringSubmatch(kind)
	if match == nil {
		return "", "", fmt.Errorf("invalid artwork kind")
	}
	season, _ := strconv.Atoi(match[1])
	metadata, err := s.repo.GetCatalogMetadata(ctx, titleID)
	if err != nil {
		return "", "", err
	}
	language := s.settings.Get().MetadataLanguage
	var detail domain.SeasonInfo
	if entry, err := s.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, season, language); err == nil && entry.Available {
		_ = json.Unmarshal(entry.Payload, &detail)
	}
	pick := func(list []domain.CastEntry, index string) string {
		i, err := strconv.Atoi(index)
		if err != nil || i < 0 || i >= len(list) {
			return ""
		}
		return list[i].ImagePath
	}
	var path, fetchKind string
	switch {
	case match[2] != "":
		path, fetchKind = detail.PosterPath, "poster"
		if path == "" {
			if entry, err := s.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, domain.SeasonListKey, language); err == nil && entry.Available {
				var list domain.TitleSeasons
				if json.Unmarshal(entry.Payload, &list) == nil {
					for _, candidate := range list.Seasons {
						if candidate.Number == season {
							path = candidate.PosterPath
						}
					}
				}
			}
		}
	case match[3] != "":
		path, fetchKind = pick(detail.Cast, match[3]), "profile"
	default:
		episodeNumber, _ := strconv.Atoi(firstNonEmptyString(match[4], match[5]))
		for _, episode := range detail.Episodes {
			if episode.Number != episodeNumber {
				continue
			}
			if match[4] != "" {
				path, fetchKind = episode.StillPath, "still"
			} else {
				path, fetchKind = pick(episode.GuestStars, match[6]), "profile"
			}
		}
	}
	if path == "" {
		return "", "", errors.New("season artwork is unavailable")
	}
	return path, fetchKind, nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
