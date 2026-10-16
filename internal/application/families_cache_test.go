package application

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// gatedFamilyRepo counts the aggregate queries behind the family tiles and can
// hold them until released, so tests control when a computation finishes.
type gatedFamilyRepo struct {
	Repository
	calls   atomic.Int32
	entered chan struct{}
	mu      sync.Mutex
	gate    chan struct{}
	ctxErr  error
}

func gateFamilies(f familyFixture) *gatedFamilyRepo {
	g := &gatedFamilyRepo{Repository: f.service.repo, entered: make(chan struct{}, 16)}
	f.service.repo = g
	return g
}

func (g *gatedFamilyRepo) hold() chan struct{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.gate = make(chan struct{})
	return g.gate
}

func (g *gatedFamilyRepo) CatalogFamilyRows(ctx context.Context, eligible []string) ([]domain.FamilyTitleRow, error) {
	g.calls.Add(1)
	g.entered <- struct{}{}
	g.mu.Lock()
	gate := g.gate
	g.mu.Unlock()
	if gate != nil {
		<-gate
	}
	rows, err := g.Repository.CatalogFamilyRows(ctx, eligible)
	g.mu.Lock()
	g.ctxErr = ctx.Err()
	g.mu.Unlock()
	return rows, err
}

func (g *gatedFamilyRepo) awaitEntered(t *testing.T) {
	t.Helper()
	select {
	case <-g.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("computation never started")
	}
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCatalogFamiliesConcurrentColdCallsShareOneComputation(t *testing.T) {
	f := seedFamilies(t, nil)
	g := gateFamilies(f)
	release := g.hold()

	const callers = 6
	results := make(chan []domain.FamilySummary, callers)
	for i := 0; i < callers; i++ {
		go func() {
			items, err := f.service.CatalogFamilies(context.Background())
			if err != nil {
				t.Error(err)
			}
			results <- items
		}()
	}
	g.awaitEntered(t)
	time.Sleep(50 * time.Millisecond) // let the other callers pile onto the flight
	close(release)
	for i := 0; i < callers; i++ {
		select {
		case items := <-results:
			if len(items) != 2 {
				t.Fatalf("items = %+v", items)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("caller never returned")
		}
	}
	if got := g.calls.Load(); got != 1 {
		t.Fatalf("computations = %d, want 1 shared by every caller", got)
	}
}

func TestCatalogFamiliesServesStaleWhileRevalidating(t *testing.T) {
	f := seedFamilies(t, nil)
	var clock atomic.Int64
	start := time.Now()
	clock.Store(start.UnixNano())
	f.service.familyNow = func() time.Time { return time.Unix(0, clock.Load()) }
	g := gateFamilies(f)

	first, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	moviesBefore := familyByKey(t, first, "movies").Count
	g.awaitEntered(t) // the initial computation

	// A new title arrives and the cache expires; the refresh is held back.
	uploaded := start
	if _, err := f.repo.UpsertReleases(context.Background(), []domain.TorrentRelease{{TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m9", Name: "Zulu.Film.2023.1080p.WEB-DL", Category: "Movies HD", Seeders: 4, UploadedAt: &uploaded}}); err != nil {
		t.Fatal(err)
	}
	clock.Store(start.Add(familyCacheTTL + time.Minute).UnixNano())
	release := g.hold()

	done := make(chan []domain.FamilySummary, 1)
	go func() {
		items, _ := f.service.CatalogFamilies(context.Background())
		done <- items
	}()
	select {
	case stale := <-done:
		if got := familyByKey(t, stale, "movies").Count; got != moviesBefore {
			t.Fatalf("stale movies count = %d, want the cached %d", got, moviesBefore)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a stale cache must be served without waiting for the refresh")
	}
	g.awaitEntered(t) // the background refresh is running, still held
	close(release)

	eventually(t, "the refreshed tiles", func() bool {
		items, err := f.service.CatalogFamilies(context.Background())
		return err == nil && familyByKey(t, items, "movies").Count == moviesBefore+1
	})
	if got := g.calls.Load(); got != 2 {
		t.Fatalf("computations = %d, want the initial one and one refresh", got)
	}
}

func TestRefreshFamiliesKeepsServingPreviousTilesUntilTheNewOnesLand(t *testing.T) {
	f := seedFamilies(t, nil)
	g := gateFamilies(f)
	first, err := f.service.CatalogFamilies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	g.awaitEntered(t) // the initial computation
	release := g.hold()
	f.service.RefreshFamilies()
	g.awaitEntered(t)

	// A second sync while one refresh runs does not start a second computation,
	// but the result of the running one is not trusted: it runs again.
	f.service.RefreshFamilies()
	got, err := f.service.CatalogFamilies(context.Background())
	if err != nil || len(got) != len(first) {
		t.Fatalf("stale tiles = %+v, %v", got, err)
	}
	close(release)
	eventually(t, "the rerun after the second sync", func() bool { return g.calls.Load() == 3 })
	eventually(t, "the refresh to settle", func() bool {
		f.service.familyMu.Lock()
		defer f.service.familyMu.Unlock()
		return f.service.familyFlight == nil
	})
}

func TestFamilyComputationOutlivesTheRequestThatStartedIt(t *testing.T) {
	f := seedFamilies(t, map[string]string{"m1": "backdrop"})
	f.service.familyNow = func() time.Time { return time.Date(2026, time.November, 15, 9, 0, 0, 0, time.UTC) }
	g := gateFamilies(f)
	release := g.hold()

	ctx, cancel := context.WithCancel(context.Background())
	errs := make(chan error, 1)
	go func() {
		_, err := f.service.CatalogFamilies(ctx)
		errs <- err
	}()
	g.awaitEntered(t)
	cancel()
	select {
	case err := <-errs:
		if err == nil {
			t.Fatal("a cancelled request must stop waiting")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the cancelled request kept waiting")
	}
	close(release)

	eventually(t, "the art pick to be stored after the client left", func() bool {
		id, err := f.repo.FamilyArtPick(context.Background(), "movies", "2026-Q4")
		return err == nil && id == f.ids["m1"]
	})
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.ctxErr != nil {
		t.Fatalf("the computation ran on the request's context: %v", g.ctxErr)
	}
}

func TestWarmFamiliesFillsTheCacheWithoutARequest(t *testing.T) {
	f := seedFamilies(t, nil)
	g := gateFamilies(f)
	f.service.WarmFamilies()
	g.awaitEntered(t)
	eventually(t, "the cache to be filled", func() bool {
		f.service.familyMu.Lock()
		defer f.service.familyMu.Unlock()
		return f.service.families.items != nil
	})
	f.service.WarmFamilies() // already fresh: nothing to do
	items, err := f.service.CatalogFamilies(context.Background())
	if err != nil || len(items) != 2 {
		t.Fatalf("items = %+v, %v", items, err)
	}
	if got := g.calls.Load(); got != 1 {
		t.Fatalf("computations = %d, want 1", got)
	}
}
