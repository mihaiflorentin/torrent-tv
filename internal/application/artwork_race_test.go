package application

import (
	"bytes"
	"context"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// gatedArtworkProvider holds every OpenArtwork body until both callers have
// started reading, so the two downloads are guaranteed to overlap.
type gatedArtworkProvider struct {
	stubMetaProvider
	payload []byte
	ready   sync.WaitGroup
	gate    chan struct{}
}

func (p *gatedArtworkProvider) OpenArtwork(ctx context.Context, path, kind string) (io.ReadCloser, string, error) {
	return &gatedBody{p: p, r: bytes.NewReader(p.payload)}, "image/png", nil
}

type gatedBody struct {
	p    *gatedArtworkProvider
	r    *bytes.Reader
	once sync.Once
}

func (b *gatedBody) Read(buf []byte) (int, error) {
	b.once.Do(func() {
		b.p.ready.Done()
		<-b.p.gate
	})
	return b.r.Read(buf)
}

func (b *gatedBody) Close() error { return nil }

func TestConcurrentArtworkRequestsDoNotCorruptTheCache(t *testing.T) {
	service, repo := refreshHarness(t)
	ctx := context.Background()
	stored, err := repo.UpsertReleases(ctx, []domain.TorrentRelease{{
		TrackerID: "filelist", TrackerName: "FileList", ProviderID: "m1",
		Name: "Some.Movie.2020.1080p.WEB-DL-GRP", Category: "Movies", IMDbID: "tt1234567", Seeders: 1, SizeBytes: 1 << 30,
	}})
	if err != nil {
		t.Fatal(err)
	}
	titleID := projectedTitleOf(t, repo, stored[0].ID)
	now := time.Now().UTC()
	if err := repo.SaveCatalogMetadata(ctx, domain.CatalogMetadata{TitleID: titleID, Provider: "tmdb", ProviderID: "1", Title: "Some Movie", Year: 2020, PosterPath: "/p.png", FetchedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("poster-bytes-"), 4096)
	provider := &gatedArtworkProvider{payload: payload, gate: make(chan struct{})}
	provider.ready.Add(2)
	service.SetMetadataProvider(provider)

	type result struct {
		path string
		err  error
	}
	results := make(chan result, 2)
	for i := 0; i < 2; i++ {
		go func() {
			path, _, err := service.Artwork(ctx, titleID, "poster")
			results <- result{path, err}
		}()
	}
	provider.ready.Wait()
	close(provider.gate)
	for i := 0; i < 2; i++ {
		res := <-results
		if res.err != nil {
			t.Fatalf("concurrent artwork request failed: %v", res.err)
		}
		got, err := os.ReadFile(res.path)
		if err != nil || !bytes.Equal(got, payload) {
			t.Fatalf("cached artwork corrupted: %v (len %d want %d)", err, len(got), len(payload))
		}
	}
}
