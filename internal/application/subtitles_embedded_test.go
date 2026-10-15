package application

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

func embeddedIDs(items []domain.SubtitleCandidate) []string {
	ids := []string{}
	for _, item := range items {
		if item.Provider == "embedded" {
			ids = append(ids, item.ID)
		}
	}
	return ids
}

func TestSearchSubtitlesRanksFullTracksAboveForcedAndExposesFlags(t *testing.T) {
	probe := &subtitleProbeStub{tracks: []domain.MediaSubtitleTrack{
		{Index: 2, Ordinal: 0, Language: "ron", Codec: "subrip", Forced: true},
		{Index: 3, Ordinal: 1, Language: "ron", Codec: "subrip", Default: true},
		{Index: 4, Ordinal: 2, Language: "eng", Codec: "subrip"},
		{Index: 5, Ordinal: 3, Language: "und", Codec: "subrip"},
		{Index: 6, Ordinal: 4, Language: "fre", Codec: "subrip"},
		{Index: 7, Ordinal: 5, Language: "ron", Codec: "hdmv_pgs_subtitle", Bitmap: true},
	}}
	service := newSubtitleTestService(t, &subtitleEngineStub{}, probe)
	items, warnings, err := service.SearchSubtitles(context.Background(), "source", "ro", SubtitleScopeLocal)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(embeddedIDs(items), ","); got != "3,2,4,5,6" {
		t.Fatalf("embedded order = %s, want ro full, ro forced, en, und, fr (bitmap omitted)", got)
	}
	if !items[0].Default || items[1].Forced != true || items[0].Forced {
		t.Fatalf("forced/default flags not exposed: %#v", items[:2])
	}
	found := false
	for _, w := range warnings {
		if w.Provider == "embedded" && strings.Contains(w.Message, "picture") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a picture-subtitle warning, got %#v", warnings)
	}
}

func TestSearchSubtitlesInfersLanguageFromTrackTitleWhenTagIsUndetermined(t *testing.T) {
	probe := &subtitleProbeStub{tracks: []domain.MediaSubtitleTrack{{Index: 2, Language: "und", Title: "Romanian", Codec: "subrip"}, {Index: 3, Language: "mol", Codec: "subrip"}}}
	service := newSubtitleTestService(t, &subtitleEngineStub{}, probe)
	items, _, err := service.SearchSubtitles(context.Background(), "source", "ro", SubtitleScopeLocal)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Language != "ro" || items[1].Language != "ro" {
		t.Fatalf("languages = %#v", items)
	}
}

func TestEmbeddedSubtitlesWaitForTheCompletedDownload(t *testing.T) {
	probe := &subtitleProbeStub{tracks: []domain.MediaSubtitleTrack{{Index: 2, Language: "ron", Codec: "subrip"}}, content: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n"}
	service, repo := newSubtitleTestServiceWithRepo(t, &subtitleEngineStub{}, probe)
	ctx := context.Background()
	download, err := repo.GetDownload(ctx, "source")
	if err != nil {
		t.Fatal(err)
	}
	partial := download
	partial.Progress = 0.4
	if err := repo.SaveDownload(ctx, partial); err != nil {
		t.Fatal(err)
	}
	items, warnings, err := service.SearchSubtitles(ctx, "source", "ro", SubtitleScopeLocal)
	if err != nil {
		t.Fatal(err)
	}
	if len(embeddedIDs(items)) != 0 {
		t.Fatalf("partial download listed embedded tracks: %#v", items)
	}
	if len(warnings) != 1 || warnings[0].Provider != "embedded" || !strings.Contains(warnings[0].Message, "after the download completes") {
		t.Fatalf("warnings = %#v", warnings)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "2", "vtt"); err == nil {
		t.Fatal("expected an error while the download is incomplete")
	}
	if len(probe.extracted) != 0 {
		t.Fatalf("ffmpeg ran against a partial file: %v", probe.extracted)
	}
	if err := repo.SaveDownload(ctx, download); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "2", "vtt"); err != nil {
		t.Fatal(err)
	}
	if len(probe.extracted) != 1 {
		t.Fatalf("extractions = %v, want one after completion", probe.extracted)
	}
}

func TestPrepareEmbeddedSubtitleExtractsByOrdinalAndRejectsBitmapTracks(t *testing.T) {
	probe := &subtitleProbeStub{
		tracks:  []domain.MediaSubtitleTrack{{Index: 4, Ordinal: 0, Language: "ron", Codec: "hdmv_pgs_subtitle", Bitmap: true}, {Index: 5, Ordinal: 1, Language: "eng", Codec: "subrip"}},
		content: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n",
	}
	service := newSubtitleTestService(t, &subtitleEngineStub{}, probe)
	ctx := context.Background()
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "4", "vtt"); err == nil || !strings.Contains(err.Error(), "picture") {
		t.Fatalf("bitmap track error = %v", err)
	}
	if len(probe.extracted) != 0 {
		t.Fatalf("ffmpeg called for a bitmap track: %v", probe.extracted)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "5", "vtt"); err != nil {
		t.Fatal(err)
	}
	if len(probe.extracted) != 1 || probe.extracted[0] != 1 {
		t.Fatalf("extracted ordinals = %v, want [1]", probe.extracted)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "99", "vtt"); err == nil {
		t.Fatal("unknown stream index must fail")
	}
}

func TestPreparedEmbeddedAssetOlderThanTheMediaFileIsRegenerated(t *testing.T) {
	probe := &subtitleProbeStub{tracks: []domain.MediaSubtitleTrack{{Index: 2, Language: "ron", Codec: "subrip"}}, content: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n"}
	service, _ := newSubtitleTestServiceWithRepo(t, &subtitleEngineStub{}, probe)
	ctx := context.Background()
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "2", "vtt"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "2", "vtt"); err != nil {
		t.Fatal(err)
	}
	if len(probe.extracted) != 1 {
		t.Fatalf("a fresh asset must be reused, extractions = %v", probe.extracted)
	}
	d, _ := service.repo.GetDownload(ctx, "source")
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(d.AbsolutePath, later, later); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareSubtitle(ctx, "source", "embedded", "2", "vtt"); err != nil {
		t.Fatal(err)
	}
	if len(probe.extracted) != 2 {
		t.Fatalf("an asset extracted before the media last changed must be regenerated, extractions = %v", probe.extracted)
	}
}

func TestEmbeddedSubtitlesUseTheEnginePathWhenTheStoredPathIsStale(t *testing.T) {
	probe := &subtitleProbeStub{tracks: []domain.MediaSubtitleTrack{{Index: 2, Language: "ron", Codec: "subrip"}}}
	engine := &subtitleEngineStub{}
	service, repo := newSubtitleTestServiceWithRepo(t, engine, probe)
	ctx := context.Background()
	download, err := repo.GetDownload(ctx, "source")
	if err != nil {
		t.Fatal(err)
	}
	// The file lives under <root>/<hash>/, but the persisted row points at
	// <root>/ as rows written by the native engine once did.
	saveDir := filepath.Join(service.settings.Get().DownloadRoot, "hash")
	if err := os.MkdirAll(saveDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(download.AbsolutePath, filepath.Join(saveDir, "movie.mkv")); err != nil {
		t.Fatal(err)
	}
	engine.status = &domain.DownloadStatus{SavePath: saveDir, Progress: 1}
	engine.files = []domain.TorrentFile{{Index: 0, Path: "movie.mkv", SizeBytes: 5, Progress: 1}}
	items, warnings, err := service.SearchSubtitles(ctx, "source", "ro", SubtitleScopeLocal)
	if err != nil {
		t.Fatal(err)
	}
	if len(embeddedIDs(items)) != 1 {
		t.Fatalf("embedded tracks = %v, warnings = %#v", embeddedIDs(items), warnings)
	}
}
