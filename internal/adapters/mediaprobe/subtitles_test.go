package mediaprobe

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestDecodeSubtitleTracksKeepsOrdinalsAndFlagsBitmapCodecs(t *testing.T) {
	tracks, err := decodeSubtitleTracks([]byte(`{"streams":[
		{"index":2,"codec_name":"subrip","tags":{"language":"ron","title":"Full"},"disposition":{"default":1,"forced":0,"hearing_impaired":0}},
		{"index":3,"codec_name":"subrip","tags":{"language":"rum"},"disposition":{"forced":1}},
		{"index":4,"codec_name":"hdmv_pgs_subtitle","tags":{"language":"eng"},"disposition":{}},
		{"index":5,"codec_name":"dvd_subtitle","tags":{"language":"fre"}},
		{"index":6,"codec_name":"dvb_subtitle","tags":{}},
		{"index":7,"codec_name":"xsub","tags":{}},
		{"index":8,"codec_name":"ass","tags":{"language":"und"},"disposition":{"hearing_impaired":1}},
		{"index":9,"codec_name":"mov_text","tags":{"language":"eng"}}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	wantBitmap := []bool{false, false, true, true, true, true, false, false}
	if len(tracks) != len(wantBitmap) {
		t.Fatalf("tracks = %d", len(tracks))
	}
	for i, track := range tracks {
		if track.Ordinal != i || track.Bitmap != wantBitmap[i] {
			t.Errorf("track %d = ordinal %d bitmap %v, want ordinal %d bitmap %v", i, track.Ordinal, track.Bitmap, i, wantBitmap[i])
		}
	}
	if !tracks[0].Default || !tracks[1].Forced || !tracks[6].HearingImpaired || tracks[0].Index != 2 {
		t.Fatalf("dispositions lost: %#v", tracks)
	}
}

func TestExtractSubtitleArgsSelectSubtitleOrdinalAndEncodeWebVTT(t *testing.T) {
	joined := strings.Join(extractSubtitleArgs("/m/movie.mkv", 3, "/tmp/out.vtt"), " ")
	for _, want := range []string{"-i /m/movie.mkv", "-map 0:s:3", "-vn", "-an", "-c:s webvtt", "-f webvtt", "-y /tmp/out.vtt"} {
		if !strings.Contains(joined, want) {
			t.Errorf("args %q missing %q", joined, want)
		}
	}
	if strings.Contains(joined, "-map 0:3") {
		t.Errorf("args must not map by absolute stream index: %q", joined)
	}
}

func TestExtractTimeoutScalesWithFileSize(t *testing.T) {
	if got := extractTimeout(10 << 20); got != 2*time.Minute {
		t.Fatalf("small file timeout = %v, want the 2 minute floor", got)
	}
	big := extractTimeout(40 << 30)
	if big <= 10*time.Minute || big > 3*time.Hour {
		t.Fatalf("40 GiB timeout = %v, want generous but bounded", big)
	}
	if extractTimeout(1<<50) != 3*time.Hour {
		t.Fatalf("huge file timeout must be capped at 3h")
	}
}

func TestExtractionDoesNotHoldTheProbeSlot(t *testing.T) {
	adapter := New(nil)
	if err := adapter.acquireExtract(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer adapter.releaseExtract()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := adapter.acquire(ctx); err != nil {
		t.Fatalf("probe slot blocked by a running extraction: %v", err)
	}
	adapter.release()
}
