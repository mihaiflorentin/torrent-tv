package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func TestCatalogMetadataKindAndReleaseDateRoundTrip(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	if err := r.SaveCatalogMetadata(ctx, domain.CatalogMetadata{TitleID: "t1", Provider: "tmdb", ProviderID: "9", Kind: domain.MediaSeries, ReleaseDate: "2019-03-14", FetchedAt: now, ExpiresAt: now}); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetCatalogMetadata(ctx, "t1")
	if err != nil || got.Kind != domain.MediaSeries || got.ReleaseDate != "2019-03-14" {
		t.Fatalf("kind/release date not durable: %+v %v", got, err)
	}
}

func TestTitleInfoRoundTripKeepsCastImagePathAndDeletes(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	ctx := context.Background()
	now := time.Now().UTC()
	info := domain.TitleInfo{
		Provider: "tmdb", ProviderID: "603", Kind: domain.MediaMovie, Language: "ro-RO", Overview: "Story", Available: true,
		Cast:      []domain.CastEntry{{Name: "Keanu", Character: "Neo", ImagePath: "/neo.jpg"}},
		FetchedAt: now, ExpiresAt: now.Add(time.Hour),
	}
	if err := r.SaveTitleInfo(ctx, info); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetTitleInfo(ctx, "tmdb", "603", domain.MediaMovie, "ro-RO")
	if err != nil || got.Overview != "Story" || len(got.Cast) != 1 || got.Cast[0].ImagePath != "/neo.jpg" || !got.ExpiresAt.After(now) {
		t.Fatalf("info not durable: %+v %v", got, err)
	}
	if _, err := r.GetTitleInfo(ctx, "tmdb", "603", domain.MediaSeries, "ro-RO"); err == nil {
		t.Fatal("kind must be part of the cache key")
	}
	if err := r.DeleteTitleInfo(ctx, "tmdb", "603", domain.MediaMovie, "ro-RO"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetTitleInfo(ctx, "tmdb", "603", domain.MediaMovie, "ro-RO"); err == nil {
		t.Fatal("deleted info must read back as no rows")
	}
}
