package application

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// gatedLeaseRepo can stall or fail the first clearing SetLease write.
type gatedLeaseRepo struct {
	Repository
	failClearOnce atomic.Bool
	holdClear     atomic.Bool
	clearPending  atomic.Bool
	gate          chan struct{}
}

func (r *gatedLeaseRepo) SetLease(ctx context.Context, id string, leased bool) error {
	if !leased && r.failClearOnce.CompareAndSwap(true, false) {
		return errors.New("transient write failure")
	}
	if !leased && r.holdClear.CompareAndSwap(true, false) {
		r.clearPending.Store(true)
		<-r.gate
	}
	return r.Repository.SetLease(ctx, id, leased)
}

// A clearing write that is still in flight when a new stream starts must not
// leave the persisted flag false while that stream is active.
func TestLateLeaseClearDoesNotOverrideNewStream(t *testing.T) {
	repo, settings := retryHarness(t)
	saveStreamableDownload(t, repo, "movie")
	wrapped := &gatedLeaseRepo{Repository: repo, gate: make(chan struct{})}
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "qb:", pollEngine{}), wrapped, settings)
	ctx := context.Background()

	if _, err := service.Acquire(ctx, "movie"); err != nil {
		t.Fatal(err)
	}
	wrapped.holdClear.Store(true)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { // last stream ends; its clear write stalls
		defer wg.Done()
		service.Release("movie")
	}()
	for !wrapped.clearPending.Load() {
		time.Sleep(time.Millisecond)
	}
	go func() { // a new stream starts meanwhile
		defer wg.Done()
		if _, err := service.Acquire(ctx, "movie"); err != nil {
			t.Error(err)
		}
	}()
	time.Sleep(50 * time.Millisecond)
	close(wrapped.gate) // the stalled clear now lands
	wg.Wait()
	if !persistedLease(t, repo, "movie") {
		t.Fatal("late clear left the persisted lease false while a stream is active")
	}
	service.Release("movie")
	if persistedLease(t, repo, "movie") {
		t.Fatal("persisted lease left set after the last stream released")
	}
}

func TestFailedLeaseClearIsRetried(t *testing.T) {
	repo, settings := retryHarness(t)
	saveStreamableDownload(t, repo, "movie")
	wrapped := &gatedLeaseRepo{Repository: repo}
	service := NewService(testRegistry(openCatalog{}), singleEngineSet(t, "qb:", pollEngine{}), wrapped, settings)
	if _, err := service.Acquire(context.Background(), "movie"); err != nil {
		t.Fatal(err)
	}
	wrapped.failClearOnce.Store(true)
	service.Release("movie")
	if persistedLease(t, repo, "movie") {
		t.Fatal("a failed clear left the lease flag set")
	}
}
