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

func TestDefaultMediaToolPathIsAbsoluteOnWindows(t *testing.T) {
	for _, binary := range []string{"ffprobe", "ffmpeg"} {
		got := defaultMediaToolPath("windows", binary)
		// filepath.IsAbs follows the host OS, so check the drive-letter
		// shape Windows' IsAbs requires directly.
		if len(got) < 3 || got[1] != ':' || got[2] != '\\' {
			t.Errorf("%s default %q is not a drive-letter absolute path", binary, got)
		}
		if want := `\` + binary + ".exe"; got[len(got)-len(want):] != want {
			t.Errorf("%s default %q does not end in %q", binary, got, want)
		}
	}
}

func TestDefaultsPassMediaToolNameCheck(t *testing.T) {
	d := Defaults()
	if err := mediaToolName("ffprobePath", d.FFprobePath, "ffprobe"); err != nil {
		t.Error(err)
	}
	if err := mediaToolName("ffmpegPath", d.FFmpegPath, "ffmpeg"); err != nil {
		t.Error(err)
	}
}
