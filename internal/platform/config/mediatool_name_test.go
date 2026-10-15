package config

import "testing"

func TestMediaToolNameAcceptsFfmpegPrefixedBaseNames(t *testing.T) {
	good := []string{"/usr/bin/ffmpeg", "/opt/ffmpeg7", "/opt/ffmpeg-static", "/usr/lib/jellyfin-ffmpeg/ffmpeg.real", "/opt/FFmpeg"}
	for _, p := range good {
		if err := mediaToolName("ffmpegPath", p, "ffmpeg"); err != nil {
			t.Errorf("%s rejected: %v", p, err)
		}
	}
	if err := mediaToolName("ffprobePath", "/opt/ffprobe-static", "ffprobe"); err != nil {
		t.Errorf("ffprobe-static rejected: %v", err)
	}
	bad := []string{"/bin/sh", "/usr/bin/python3", "/opt/my-ffmpeg", "/opt/ffprobe"}
	for _, p := range bad {
		if err := mediaToolName("ffmpegPath", p, "ffmpeg"); err == nil {
			t.Errorf("%s accepted for ffmpeg", p)
		}
	}
	if err := mediaToolName("ffmpegPath", "relative/ffmpeg", "ffmpeg"); err == nil {
		t.Error("relative path accepted")
	}
}
