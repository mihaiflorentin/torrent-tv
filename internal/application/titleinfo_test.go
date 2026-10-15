package application

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/adapters/sqlite"
	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// infoStubProvider is a fake provider chain entry that also serves extended
// details and artwork bytes.
type infoStubProvider struct {
	stubMetaProvider
	info         domain.TitleInfo
	infoErr      error
	infoCalls    int
	lastKind     domain.MediaKind
	artworkPath  string
	artworkKind  string
	artworkCalls int
}

func (p *infoStubProvider) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	p.infoCalls++
	p.lastKind = kind
	if p.infoErr != nil {
		return domain.TitleInfo{}, p.infoErr
	}
	return p.info, nil
}

func (p *infoStubProvider) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	p.artworkCalls++
	p.artworkPath, p.artworkKind = path, kind
	return io.NopCloser(bytes.NewReader([]byte("jpeg"))), "image/jpeg", nil
}

func seedInfoMovie(t *testing.T, repo *sqlite.Repository, metadata domain.CatalogMetadata) string {
	t.Helper()
	ctx := context.Background()
	stored, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{{
		TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m1",
		Name: "The.Matrix.1999.1080p.WEB-DL-GRP", Category: "Movies", IMDbID: "tt0133093", Seeders: 1, SizeBytes: 1 << 30,
	}})
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	if metadata.Provider != "" {
		metadata.TitleID = titleID
		now := time.Now().UTC()
		metadata.FetchedAt, metadata.ExpiresAt = now, now.Add(30*24*time.Hour)
		if err := repo.SaveCatalogMetadata(ctx, metadata); err != nil {
			t.Fatal(err)
		}
	}
	return titleID
}

func goodInfo() domain.TitleInfo {
	now := time.Now().UTC()
	return domain.TitleInfo{
		Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Overview: "A hacker learns the truth.", Tagline: "Real.",
		ReleaseDate: "1999-03-30", Available: true, FetchedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
		Cast: []domain.CastEntry{{Name: "Keanu Reeves", Character: "Neo", ImagePath: "/neo.jpg"}, {Name: "No Photo"}},
	}
}

func TestTitleInfoFetchesCachesAndHidesProviderPaths(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Title: "The Matrix"})
	provider := &infoStubProvider{info: goodInfo()}
	service.SetMetadataProvider(provider)
	ctx := context.Background()

	info, err := service.TitleInfo(ctx, titleID)
	if err != nil || !info.Available || info.TitleID != titleID || info.Tagline != "Real." {
		t.Fatalf("info not served: %+v %v", info, err)
	}
	if provider.lastKind != domain.MediaMovie {
		t.Fatalf("matched kind must reach the provider, got %q", provider.lastKind)
	}
	if info.Cast[0].ImageURL != "/api/v1/artwork/"+titleID+"/cast-0" || info.Cast[0].ImagePath != "" {
		t.Fatalf("cast photo must be proxied and the provider path hidden: %+v", info.Cast[0])
	}
	if info.Cast[1].ImageURL != "" {
		t.Fatalf("cast without a photo must carry no url: %+v", info.Cast[1])
	}
	if _, err := service.TitleInfo(ctx, titleID); err != nil || provider.infoCalls != 1 {
		t.Fatalf("fresh cache must not re-hit the provider: err=%v calls=%d", err, provider.infoCalls)
	}
}

func TestTitleInfoFailureDegradesToCatalogMetadataAndIsNegativelyCached(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Title: "The Matrix", Overview: "Cached overview.", ReleaseDate: "1999-03-30", Genres: []string{"Action"}})
	provider := &infoStubProvider{infoErr: errors.New("429")}
	service.SetMetadataProvider(provider)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		info, err := service.TitleInfo(ctx, titleID)
		if err != nil {
			t.Fatalf("a provider failure must never fail the call: %v", err)
		}
		if info.Overview != "Cached overview." || info.ReleaseDate != "1999-03-30" || len(info.Genres) != 1 || !info.Available {
			t.Fatalf("catalog metadata must back the degraded answer: %+v", info)
		}
	}
	if provider.infoCalls != 1 {
		t.Fatalf("failure must be negatively cached, provider called %d times", provider.infoCalls)
	}
}

func TestTitleInfoStaleGoodCacheSurvivesProviderFailure(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie})
	ctx := context.Background()
	stale := goodInfo()
	stale.Language = service.settings.Get().MetadataLanguage
	stale.FetchedAt, stale.ExpiresAt = time.Now().Add(-40*24*time.Hour), time.Now().Add(-time.Hour)
	if err := repo.SaveTitleInfo(ctx, stale); err != nil {
		t.Fatal(err)
	}
	provider := &infoStubProvider{infoErr: errors.New("boom")}
	service.SetMetadataProvider(provider)
	info, err := service.TitleInfo(ctx, titleID)
	if err != nil || info.Tagline != "Real." || len(info.Cast) != 2 {
		t.Fatalf("stale payload must serve while the provider fails: %+v %v", info, err)
	}
	cached, err := repo.GetTitleInfo(ctx, "tmdb", "603", domain.MediaMovie, stale.Language)
	if err != nil || cached.Tagline != "Real." || !cached.ExpiresAt.After(time.Now()) {
		t.Fatalf("good payload overwritten or no back-off: %+v %v", cached, err)
	}
	if _, err := service.TitleInfo(ctx, titleID); err != nil || provider.infoCalls != 1 {
		t.Fatalf("back-off must hold: err=%v calls=%d", err, provider.infoCalls)
	}
}

func TestTitleInfoWithoutProviderMatchIsUnavailableNotAnError(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{})
	provider := &infoStubProvider{info: goodInfo()}
	service.SetMetadataProvider(provider)
	info, err := service.TitleInfo(context.Background(), titleID)
	if err != nil || info.Available || info.TitleID != titleID || provider.infoCalls != 0 {
		t.Fatalf("unmatched title must degrade quietly: %+v %v calls=%d", info, err, provider.infoCalls)
	}
}

func TestTitleInfoProviderWithoutCapabilityIsUnavailable(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Overview: "O"})
	service.SetMetadataProvider(&stubMetaProvider{id: "tmdb"})
	info, err := service.TitleInfo(context.Background(), titleID)
	if err != nil || info.Overview != "O" {
		t.Fatalf("provider lacking details must degrade to metadata: %+v %v", info, err)
	}
}

func TestMetadataChainRoutesTitleInfoToNamedProvider(t *testing.T) {
	tmdb := &infoStubProvider{stubMetaProvider: stubMetaProvider{id: "tmdb"}, info: goodInfo()}
	plain := &stubMetaProvider{id: "tvmaze"}
	chain := NewMetadataChain([]ProviderEntry{{ID: "tmdb", Provider: tmdb}, {ID: "tvmaze", Provider: plain}}, func() []string { return []string{"tmdb", "tvmaze"} })
	provider, ok := chain.(TitleInfoProvider)
	if !ok {
		t.Fatal("chain must expose the details capability")
	}
	if _, err := provider.TitleInfo(context.Background(), "tmdb", "603", domain.MediaMovie, "en-US", ""); err != nil || tmdb.infoCalls != 1 {
		t.Fatalf("tmdb not routed: %v %d", err, tmdb.infoCalls)
	}
	if _, err := provider.TitleInfo(context.Background(), "tvmaze", "1", domain.MediaSeries, "en-US", ""); err == nil {
		t.Fatal("a provider without details must report an error")
	}
	if _, err := provider.TitleInfo(context.Background(), "nope", "1", domain.MediaSeries, "en-US", ""); err == nil {
		t.Fatal("unknown provider must error")
	}
}

func TestArtworkServesCastPhotosThroughTheProxy(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie})
	provider := &infoStubProvider{info: goodInfo()}
	service.SetMetadataProvider(provider)
	ctx := context.Background()
	if _, err := service.TitleInfo(ctx, titleID); err != nil {
		t.Fatal(err)
	}
	path, _, err := service.Artwork(ctx, titleID, "cast-0")
	if err != nil || path == "" {
		t.Fatalf("cast photo not served: %q %v", path, err)
	}
	if provider.artworkPath != "/neo.jpg" || provider.artworkKind != "profile" {
		t.Fatalf("cast photo fetched wrongly: %q %q", provider.artworkPath, provider.artworkKind)
	}
	if _, _, err := service.Artwork(ctx, titleID, "cast-1"); err == nil {
		t.Fatal("cast without a photo must 404")
	}
	if _, _, err := service.Artwork(ctx, titleID, "cast-99"); err == nil {
		t.Fatal("out-of-range cast index must fail")
	}
	if _, _, err := service.Artwork(ctx, titleID, "cast-x"); err == nil {
		t.Fatal("malformed kind must fail")
	}
}
