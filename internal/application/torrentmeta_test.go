package application

import (
	"context"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// manifestTracker serves a programmed acquisition and records every Acquire
// call so tests can prove the warmup never reaches the adapter.
type manifestTracker struct {
	Tracker
	id          string
	acquisition domain.TorrentAcquisition
	acquires    int
}

func (m *manifestTracker) ID() string   { return m.id }
func (m *manifestTracker) Name() string { return "Manifest" }

func (m *manifestTracker) Acquire(context.Context, string) (domain.TorrentAcquisition, error) {
	m.acquires++
	return m.acquisition, nil
}

// seasonPackMetainfo is a bencoded two-file season pack torrent.
func seasonPackMetainfo() []byte {
	return []byte("d4:infod5:filesld6:lengthi100e4:pathl12:Episode1.mkveed6:lengthi200e4:pathl12:Episode2.mkveeeee")
}

func TestWarmTorrentManifestSavesMetainfoManifest(t *testing.T) {
	h := newTrackerHarness(t, 1)
	tracker := &manifestTracker{id: "filelist", acquisition: domain.TorrentAcquisition{Metainfo: seasonPackMetainfo()}}
	registry := registryOf(t, enabledRegistration(tracker))
	repo := h.openRepo(t)
	service := h.newService(t, registry, nil, repo)

	release := domain.TorrentRelease{ID: "filelist:1", TrackerID: "filelist", TrackerName: "FileList", Name: "Show S01", ProviderID: "1", FileCount: 2}
	if _, err := repo.UpsertReleases(context.Background(), []domain.TorrentRelease{release}); err != nil {
		t.Fatal(err)
	}
	warmed, err := service.warmTorrentManifest(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	if !warmed {
		t.Fatal("expected a metainfo acquisition to warm the manifest")
	}
	manifest, err := repo.GetTorrentManifest(context.Background(), release.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Files) != 2 || manifest.Files[0].Path != "Episode1.mkv" || manifest.Files[1].SizeBytes != 200 {
		t.Fatalf("unexpected manifest files: %+v", manifest.Files)
	}
	if tracker.acquires != 1 {
		t.Fatalf("expected exactly one acquisition, got %d", tracker.acquires)
	}
}

func TestWarmTorrentManifestSkipsMagnetAcquisitions(t *testing.T) {
	h := newTrackerHarness(t, 1)
	tracker := &manifestTracker{id: "filelist", acquisition: domain.TorrentAcquisition{Magnet: "magnet:?xt=urn:btih:abc123"}}
	registry := registryOf(t, enabledRegistration(tracker))
	repo := h.openRepo(t)
	service := h.newService(t, registry, nil, repo)

	release := domain.TorrentRelease{ID: "filelist:2", TrackerID: "filelist", TrackerName: "FileList", Name: "Show S02", ProviderID: "2", FileCount: 30}
	if _, err := repo.UpsertReleases(context.Background(), []domain.TorrentRelease{release}); err != nil {
		t.Fatal(err)
	}
	warmed, err := service.warmTorrentManifest(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	if warmed {
		t.Fatal("a magnet-only acquisition must not report the manifest as warmed")
	}
	if _, err := repo.GetTorrentManifest(context.Background(), release.ID); err == nil {
		t.Fatal("a magnet-only acquisition must not save a manifest")
	}
}

func TestWarmTorrentManifestUsesCachedManifestWithoutAcquiring(t *testing.T) {
	h := newTrackerHarness(t, 1)
	tracker := &manifestTracker{id: "filelist"}
	registry := registryOf(t, enabledRegistration(tracker))
	repo := h.openRepo(t)
	service := h.newService(t, registry, nil, repo)

	release := domain.TorrentRelease{ID: "filelist:3", TrackerID: "filelist", TrackerName: "FileList", Name: "Show S01", ProviderID: "3", FileCount: 1}
	if _, err := repo.UpsertReleases(context.Background(), []domain.TorrentRelease{release}); err != nil {
		t.Fatal(err)
	}
	if err := repo.SaveTorrentManifest(context.Background(), domain.TorrentManifest{ReleaseID: release.ID, Files: []domain.TorrentFile{{Index: 0, Path: "Episode1.mkv", SizeBytes: 100, Playable: true}}, Metainfo: seasonPackMetainfo(), FetchedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}

	warmed, err := service.warmTorrentManifest(context.Background(), release)
	if err != nil {
		t.Fatal(err)
	}
	if !warmed {
		t.Fatal("a cached manifest must report the release as warmed")
	}
	if tracker.acquires != 0 {
		t.Fatalf("cached manifest must not acquire from the tracker, got %d acquisitions", tracker.acquires)
	}
}

func TestApplyMetadataFillsMissingYear(t *testing.T) {
	title := domain.CatalogTitle{ID: "t1"}
	applyMetadata(&title, domain.CatalogMetadata{TitleID: "t1", Title: "Show", Year: 2013})
	if title.Year != 2013 {
		t.Fatalf("expected provider year to fill a missing year, got %d", title.Year)
	}

	parsed := domain.CatalogTitle{ID: "t1", Year: 2009}
	applyMetadata(&parsed, domain.CatalogMetadata{TitleID: "t1", Title: "Show", Year: 2013})
	if parsed.Year != 2009 {
		t.Fatalf("expected release-name year 2009 to survive, got %d", parsed.Year)
	}
}
