package application

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// seasonStubProvider serves season lists and details and counts calls.
type seasonStubProvider struct {
	infoStubProvider
	list         domain.TitleSeasons
	detail       domain.SeasonInfo
	episode      domain.EpisodeInfo
	err          error
	episodeErr   error
	listCalls    atomic.Int32
	detailCalls  atomic.Int32
	episodeCalls atomic.Int32
	gate         chan struct{}
}

func (p *seasonStubProvider) SeasonList(ctx context.Context, provider, providerID, language, fallback string) (domain.TitleSeasons, error) {
	p.listCalls.Add(1)
	if p.err != nil {
		return domain.TitleSeasons{}, p.err
	}
	return p.list, nil
}

func (p *seasonStubProvider) SeasonDetail(ctx context.Context, provider, providerID string, season int, language, fallback string) (domain.SeasonInfo, error) {
	p.detailCalls.Add(1)
	if p.gate != nil {
		select {
		case <-p.gate:
		case <-ctx.Done():
			return domain.SeasonInfo{}, ctx.Err()
		}
	}
	if p.err != nil {
		return domain.SeasonInfo{}, p.err
	}
	return p.detail, nil
}

func (p *seasonStubProvider) EpisodeDetail(ctx context.Context, provider, providerID string, season, episode int, language string) (domain.EpisodeInfo, error) {
	p.episodeCalls.Add(1)
	if p.episodeErr != nil {
		return domain.EpisodeInfo{}, p.episodeErr
	}
	return p.episode, nil
}

func goodSeasons() domain.TitleSeasons {
	return domain.TitleSeasons{Seasons: []domain.SeasonSummary{
		{Number: 1, Name: "Season 1", EpisodeCount: 10, PosterPath: "/s1.jpg"},
		{Number: 2, Name: "Season 2", EpisodeCount: 8},
	}}
}

func goodSeason() domain.SeasonInfo {
	return domain.SeasonInfo{Number: 1, Name: "Season 1", Overview: "First.", PosterPath: "/s1.jpg",
		Cast: []domain.CastEntry{{Name: "Lead", Character: "Hero", ImagePath: "/lead.jpg"}, {Name: "NoPhoto"}},
		Episodes: []domain.EpisodeInfo{
			{Number: 1, Name: "Pilot", StillPath: "/e1.jpg", Directors: []string{"Dee"}, GuestStars: []domain.CastEntry{{Name: "Guest", Character: "Herald", ImagePath: "/g.jpg"}}},
			{Number: 2, Name: "Second", LazyDetail: true},
		}}
}

func newSeasonService(t *testing.T, provider *seasonStubProvider) (*Service, string) {
	t.Helper()
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "1399", Kind: domain.MediaSeries, Title: "Show"})
	service.SetMetadataProvider(provider)
	return service, titleID
}

func TestTitleSeasonsFetchesCachesAndProxiesPosters(t *testing.T) {
	provider := &seasonStubProvider{list: goodSeasons()}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	list, err := service.TitleSeasons(ctx, titleID)
	if err != nil || !list.Available || len(list.Seasons) != 2 || list.TitleID != titleID {
		t.Fatalf("seasons not served: %+v %v", list, err)
	}
	if list.Seasons[0].PosterURL != "/api/v1/artwork/"+titleID+"/season-1-poster" || list.Seasons[0].PosterPath != "" || list.Seasons[1].PosterURL != "" {
		t.Fatalf("poster must be proxied and the provider path hidden: %+v", list.Seasons)
	}
	if _, err := service.TitleSeasons(ctx, titleID); err != nil || provider.listCalls.Load() != 1 {
		t.Fatalf("fresh cache must not re-hit the provider: %v calls=%d", err, provider.listCalls.Load())
	}
	path, kind, err := service.seasonImagePath(ctx, titleID, "season-1-poster")
	if err != nil || path != "/s1.jpg" || kind != "poster" {
		t.Fatalf("poster path not resolved from the list cache: %q %q %v", path, kind, err)
	}
}

func TestTitleSeasonsFailureDegradesAndIsNegativelyCached(t *testing.T) {
	provider := &seasonStubProvider{err: errors.New("429")}
	service, titleID := newSeasonService(t, provider)
	for i := 0; i < 3; i++ {
		list, err := service.TitleSeasons(context.Background(), titleID)
		if err != nil || list.Available || len(list.Seasons) != 0 || list.TitleID != titleID {
			t.Fatalf("a provider failure must degrade quietly: %+v %v", list, err)
		}
	}
	if provider.listCalls.Load() != 1 {
		t.Fatalf("failure must be negatively cached, provider called %d times", provider.listCalls.Load())
	}
}

func TestTitleSeasonsMovieAndUnmatchedTitlesHaveNoSeasons(t *testing.T) {
	provider := &seasonStubProvider{list: goodSeasons()}
	service, repo := refreshHarness(t)
	movie := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie})
	service.SetMetadataProvider(provider)
	list, err := service.TitleSeasons(context.Background(), movie)
	if err != nil || list.Available || provider.listCalls.Load() != 0 {
		t.Fatalf("movies have no seasons and cost no provider call: %+v %v %d", list, err, provider.listCalls.Load())
	}
}

func TestSeasonInfoProxiesImagesAndCaches(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason()}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	info, err := service.SeasonInfo(ctx, titleID, 1)
	if err != nil || !info.Available || len(info.Episodes) != 2 || info.Number != 1 {
		t.Fatalf("season not served: %+v %v", info, err)
	}
	prefix := "/api/v1/artwork/" + titleID + "/season-1-"
	if info.PosterURL != prefix+"poster" || info.Cast[0].ImageURL != prefix+"cast-0" || info.Cast[1].ImageURL != "" {
		t.Fatalf("season images wrong: %+v", info)
	}
	if info.Episodes[0].StillURL != prefix+"still-1" || info.Episodes[0].GuestStars[0].ImageURL != prefix+"guest-1-0" || info.Episodes[1].StillURL != "" {
		t.Fatalf("episode images wrong: %+v", info.Episodes)
	}
	if info.PosterPath != "" || info.Cast[0].ImagePath != "" || info.Episodes[0].StillPath != "" || info.Episodes[0].GuestStars[0].ImagePath != "" {
		t.Fatalf("provider paths must never leave the server: %+v", info)
	}
	if _, err := service.SeasonInfo(ctx, titleID, 1); err != nil || provider.detailCalls.Load() != 1 {
		t.Fatalf("fresh cache must not re-hit the provider: %v calls=%d", err, provider.detailCalls.Load())
	}
	if _, err := service.SeasonInfo(ctx, titleID, -1); err == nil {
		t.Fatal("negative season must be rejected")
	}
}

func TestSeasonInfoStaleCacheSurvivesProviderFailure(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason()}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	metadata, _ := service.repo.GetCatalogMetadata(ctx, titleID)
	if _, err := service.SeasonInfo(ctx, titleID, 1); err != nil {
		t.Fatal(err)
	}
	language := service.settings.Get().MetadataLanguage
	entry, err := service.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, 1, language)
	if err != nil {
		t.Fatal(err)
	}
	entry.ExpiresAt = time.Now().Add(-time.Hour)
	if err := service.repo.SaveSeasonCache(ctx, entry); err != nil {
		t.Fatal(err)
	}
	provider.err = errors.New("boom")
	info, err := service.SeasonInfo(ctx, titleID, 1)
	if err != nil || !info.Available || info.Overview != "First." {
		t.Fatalf("stale payload must serve while the provider fails: %+v %v", info, err)
	}
	kept, _ := service.repo.GetSeasonCache(ctx, metadata.Provider, metadata.ProviderID, 1, language)
	if !kept.Available || !kept.ExpiresAt.After(time.Now()) {
		t.Fatalf("good payload overwritten or no back-off: %+v", kept)
	}
	if _, err := service.SeasonInfo(ctx, titleID, 1); err != nil || provider.detailCalls.Load() != 2 {
		t.Fatalf("back-off must hold: %v calls=%d", err, provider.detailCalls.Load())
	}
}

func TestSeasonInfoConcurrentOpensShareOneProviderCall(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason(), gate: make(chan struct{})}
	service, titleID := newSeasonService(t, provider)
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if info, _ := service.SeasonInfo(context.Background(), titleID, 1); !info.Available {
				t.Errorf("caller got no data")
			}
		}()
	}
	time.Sleep(60 * time.Millisecond)
	close(provider.gate)
	wg.Wait()
	if provider.detailCalls.Load() != 1 {
		t.Fatalf("concurrent opens must share one provider call, got %d", provider.detailCalls.Load())
	}
}

func TestSeasonInfoCancellationIsNeverNegativelyCached(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason(), gate: make(chan struct{})}
	service, titleID := newSeasonService(t, provider)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan domain.SeasonInfo)
	go func() { info, _ := service.SeasonInfo(ctx, titleID, 1); done <- info }()
	time.Sleep(40 * time.Millisecond)
	cancel()
	if info := <-done; info.Available {
		t.Fatalf("cancelled caller must leave without data: %+v", info)
	}
	close(provider.gate) // the detached fetch finishes and caches the good payload
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if info, _ := service.SeasonInfo(context.Background(), titleID, 1); info.Available {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("closing the panel mid-fetch must not poison the cache")
}

func TestSeasonEpisodeFillsLazyDetailOnceAndStoresIt(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason(), episode: domain.EpisodeInfo{Number: 2, Overview: "Synopsis.", Runtime: 24}}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	episode, found, err := service.SeasonEpisode(ctx, titleID, 1, 2)
	if err != nil || !found || episode.Overview != "Synopsis." || episode.Runtime != 24 || episode.LazyDetail || episode.Name != "Second" {
		t.Fatalf("lazy detail not merged: %+v %v %v", episode, found, err)
	}
	if again, _, _ := service.SeasonEpisode(ctx, titleID, 1, 2); again.Overview != "Synopsis." || provider.episodeCalls.Load() != 1 {
		t.Fatalf("lazy detail must be stored, provider asked %d times", provider.episodeCalls.Load())
	}
	season, _ := service.SeasonInfo(ctx, titleID, 1)
	if season.Episodes[1].Overview != "Synopsis." {
		t.Fatalf("season payload must carry the stored synopsis: %+v", season.Episodes[1])
	}
	pilot, found, _ := service.SeasonEpisode(ctx, titleID, 1, 1)
	if !found || pilot.StillURL == "" || provider.episodeCalls.Load() != 1 {
		t.Fatalf("a complete episode needs no provider call: %+v", pilot)
	}
	if _, found, _ := service.SeasonEpisode(ctx, titleID, 1, 99); found {
		t.Fatal("unknown episode must not be found")
	}
}

func TestSeasonEpisodeLazyFailureStillServesTheEpisode(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason(), episodeErr: errors.New("429")}
	service, titleID := newSeasonService(t, provider)
	episode, found, err := service.SeasonEpisode(context.Background(), titleID, 1, 2)
	if err != nil || !found || episode.Name != "Second" || !episode.LazyDetail {
		t.Fatalf("a failed lazy fetch must degrade to the listed episode: %+v %v %v", episode, found, err)
	}
}

func TestArtworkServesSeasonImagesThroughTheProxy(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason()}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	if _, err := service.SeasonInfo(ctx, titleID, 1); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ kind, path, fetch string }{
		{"season-1-poster", "/s1.jpg", "poster"},
		{"season-1-cast-0", "/lead.jpg", "profile"},
		{"season-1-still-1", "/e1.jpg", "still"},
		{"season-1-guest-1-0", "/g.jpg", "profile"},
	}
	for _, tc := range cases {
		if file, _, err := service.Artwork(ctx, titleID, tc.kind); err != nil || file == "" {
			t.Fatalf("%s not served: %v", tc.kind, err)
		}
		if provider.artworkPath != tc.path || provider.artworkKind != tc.fetch {
			t.Fatalf("%s fetched %q as %q, want %q as %q", tc.kind, provider.artworkPath, provider.artworkKind, tc.path, tc.fetch)
		}
	}
	for _, kind := range []string{"season-1-cast-1", "season-1-cast-9", "season-1-still-2", "season-1-guest-1-5", "season-9-poster", "season-x-poster", "season-1-banner", "season-1-still-1/../x"} {
		if _, _, err := service.Artwork(ctx, titleID, kind); err == nil {
			t.Fatalf("%q must not be served", kind)
		}
	}
}

func TestMetadataChainRoutesSeasonDetailToNamedProvider(t *testing.T) {
	tmdb := &seasonStubProvider{infoStubProvider: infoStubProvider{stubMetaProvider: stubMetaProvider{id: "tmdb"}}, list: goodSeasons(), detail: goodSeason(), episode: domain.EpisodeInfo{Number: 1}}
	plain := &stubMetaProvider{id: "tvmaze"}
	chain := NewMetadataChain([]ProviderEntry{{ID: "tmdb", Provider: tmdb}, {ID: "tvmaze", Provider: plain}}, func() []string { return []string{"tmdb", "tvmaze"} })
	provider, ok := chain.(SeasonInfoProvider)
	if !ok {
		t.Fatal("chain must expose the season capability")
	}
	if _, err := provider.SeasonList(context.Background(), "tmdb", "1", "en-US", ""); err != nil || tmdb.listCalls.Load() != 1 {
		t.Fatalf("list not routed: %v", err)
	}
	if _, err := provider.SeasonDetail(context.Background(), "tmdb", "1", 1, "en-US", ""); err != nil || tmdb.detailCalls.Load() != 1 {
		t.Fatalf("detail not routed: %v", err)
	}
	if _, err := provider.SeasonDetail(context.Background(), "tvmaze", "1", 1, "en-US", ""); err == nil {
		t.Fatal("a provider without season details must report an error")
	}
	if _, err := chain.(EpisodeDetailProvider).EpisodeDetail(context.Background(), "tvmaze", "1", 1, 1, "en-US"); err == nil {
		t.Fatal("a provider without episode details must report an error")
	}
}

func TestForcedRefreshExpiresSeasonCache(t *testing.T) {
	provider := &seasonStubProvider{detail: goodSeason(), list: goodSeasons()}
	service, titleID := newSeasonService(t, provider)
	ctx := context.Background()
	_, _ = service.TitleSeasons(ctx, titleID)
	_, _ = service.SeasonInfo(ctx, titleID, 1)
	service.expireTitleInfo(titleID)
	_, _ = service.TitleSeasons(ctx, titleID)
	_, _ = service.SeasonInfo(ctx, titleID, 1)
	if provider.listCalls.Load() != 2 || provider.detailCalls.Load() != 2 {
		t.Fatalf("a forced refresh must drop the season caches: list=%d detail=%d", provider.listCalls.Load(), provider.detailCalls.Load())
	}
}
