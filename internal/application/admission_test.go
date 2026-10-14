package application

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// admissionEngine adds torrents slowly and one hash per Add, so concurrent
// prepares overlap between the capacity survey and the saved download row.
type admissionEngine struct {
	TorrentEngine
	mu      sync.Mutex
	status  map[string]domain.DownloadStatus
	size    int64
	addErrs []error
	adds    int
}

func (e *admissionEngine) Add(context.Context, io.Reader, string) (string, error) {
	time.Sleep(50 * time.Millisecond)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.adds++
	if len(e.addErrs) > 0 {
		err := e.addErrs[0]
		e.addErrs = e.addErrs[1:]
		if err != nil {
			return "", err
		}
	}
	hash := fmt.Sprintf("h%d", e.adds)
	e.status[hash] = domain.DownloadStatus{Hash: hash, State: "downloading", TotalBytes: e.size}
	return hash, nil
}

func (e *admissionEngine) Files(context.Context, string) ([]domain.TorrentFile, error) {
	return []domain.TorrentFile{{Index: 0, Path: "Movie.mkv", SizeBytes: e.size, Playable: true}}, nil
}

func (e *admissionEngine) Status(_ context.Context, hash string) (domain.DownloadStatus, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st, ok := e.status[hash]
	if !ok {
		return domain.DownloadStatus{}, domain.ErrTorrentNotFound
	}
	return st, nil
}

func (e *admissionEngine) PrepareFiles(context.Context, string, []int, []int) error { return nil }

func (e *admissionEngine) PrepareRange(context.Context, string, int, int64, int64) error {
	return nil
}

func (e *admissionEngine) Remove(_ context.Context, hash string, _ bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.status, hash)
	return nil
}

func (e *admissionEngine) addCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.adds
}

func TestConcurrentPreparesCannotOvershootAllocation(t *testing.T) {
	repo, settings := retryHarness(t)
	retentionSettings(t, settings, 1, 0)
	seedRetentionRelease(t, repo, "release-a", "A.2025.1080p.WEB-DL")
	seedRetentionRelease(t, repo, "release-b", "B.2025.1080p.WEB-DL")
	engine := &admissionEngine{status: map[string]domain.DownloadStatus{}, size: 600 << 20}
	service := NewService(testRegistry(capacityCatalog{torrent: capacityTorrent(600 << 20)}), singleEngineSet(t, "qb:", engine), repo, settings)
	t.Cleanup(func() { _ = service.Close(context.Background()) })

	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, id := range []string{"release-a", "release-b"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = service.Prepare(context.Background(), canonicalReleaseID(id), -1)
		}()
	}
	wg.Wait()

	admitted, rejected := 0, 0
	for _, err := range errs {
		var fit *domain.AllocationError
		switch {
		case err == nil:
			admitted++
		case errors.As(err, &fit):
			rejected++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if admitted != 1 || rejected != 1 {
		t.Fatalf("want one admitted and one rejected, got admitted=%d rejected=%d (%v)", admitted, rejected, errs)
	}
	if adds := engine.addCount(); adds != 1 {
		t.Fatalf("the rejected request reached the engine: adds=%d", adds)
	}
}

func TestFailedAddReleasesItsReservation(t *testing.T) {
	repo, settings := retryHarness(t)
	retentionSettings(t, settings, 1, 0)
	seedRetentionRelease(t, repo, "release-a", "A.2025.1080p.WEB-DL")
	seedRetentionRelease(t, repo, "release-b", "B.2025.1080p.WEB-DL")
	engine := &admissionEngine{status: map[string]domain.DownloadStatus{}, size: 600 << 20, addErrs: []error{errors.New("engine refused")}}
	service := NewService(testRegistry(capacityCatalog{torrent: capacityTorrent(600 << 20)}), singleEngineSet(t, "qb:", engine), repo, settings)
	t.Cleanup(func() { _ = service.Close(context.Background()) })

	if _, err := service.Prepare(context.Background(), canonicalReleaseID("release-a"), -1); err == nil {
		t.Fatal("the first add was meant to fail")
	}
	if _, err := service.Prepare(context.Background(), canonicalReleaseID("release-b"), -1); err != nil {
		t.Fatalf("a failed add must release its reservation, got: %v", err)
	}
}
