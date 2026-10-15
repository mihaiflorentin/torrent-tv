package application

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// gatedInfoProvider blocks TitleInfo until released and counts calls
// atomically, so concurrent callers can be observed.
type gatedInfoProvider struct {
	infoStubProvider
	calls   atomic.Int32
	entered chan struct{}
	release chan struct{}
	once    sync.Once
	err     error
	info    domain.TitleInfo
}

func (p *gatedInfoProvider) TitleInfo(ctx context.Context, provider, providerID string, kind domain.MediaKind, language, fallback string) (domain.TitleInfo, error) {
	p.calls.Add(1)
	p.once.Do(func() { close(p.entered) })
	select {
	case <-p.release:
	case <-ctx.Done():
		return domain.TitleInfo{}, ctx.Err()
	}
	if p.err != nil {
		return domain.TitleInfo{}, p.err
	}
	return p.info, nil
}

func newGatedInfoProvider() *gatedInfoProvider {
	return &gatedInfoProvider{entered: make(chan struct{}), release: make(chan struct{}), info: goodInfo()}
}

func TestTitleInfoConcurrentOpensShareOneProviderCall(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Title: "The Matrix"})
	provider := newGatedInfoProvider()
	service.SetMetadataProvider(provider)

	const callers = 5
	results := make(chan domain.TitleInfo, callers)
	for i := 0; i < callers; i++ {
		go func() {
			info, _ := service.TitleInfo(context.Background(), titleID)
			results <- info
		}()
	}
	<-provider.entered
	time.Sleep(50 * time.Millisecond) // let the other callers join the flight
	close(provider.release)
	for i := 0; i < callers; i++ {
		if info := <-results; !info.Available || info.Tagline != "Real." {
			t.Fatalf("caller %d got %+v", i, info)
		}
	}
	if got := provider.calls.Load(); got != 1 {
		t.Fatalf("provider called %d times, want 1", got)
	}
}

func TestTitleInfoCancelledCallerDoesNotPoisonCache(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Title: "The Matrix", Overview: "Catalog."})
	provider := newGatedInfoProvider()
	service.SetMetadataProvider(provider)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = service.TitleInfo(ctx, titleID)
	}()
	<-provider.entered
	cancel() // the Info panel closed mid-fetch
	<-done
	close(provider.release)

	// The detached fetch completes and caches; the next open is served
	// without a negative-cache window blocking it.
	deadline := time.Now().Add(3 * time.Second)
	for {
		info, err := service.TitleInfo(context.Background(), titleID)
		if err == nil && info.Tagline == "Real." {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("details unavailable after a cancelled open: %+v %v", info, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := provider.calls.Load(); got != 1 {
		t.Fatalf("provider called %d times, want 1", got)
	}
}

func TestTitleInfoCanceledProviderErrorIsNotNegativelyCached(t *testing.T) {
	service, repo := refreshHarness(t)
	titleID := seedInfoMovie(t, repo, domain.CatalogMetadata{Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Title: "The Matrix", Overview: "Catalog."})
	provider := newGatedInfoProvider()
	provider.err = context.Canceled
	close(provider.release)
	service.SetMetadataProvider(provider)

	for i := 0; i < 2; i++ {
		if _, err := service.TitleInfo(context.Background(), titleID); err != nil {
			t.Fatal(err)
		}
	}
	if got := provider.calls.Load(); got != 2 {
		t.Fatalf("a cancellation must not be cached; provider called %d times, want 2", got)
	}
}
