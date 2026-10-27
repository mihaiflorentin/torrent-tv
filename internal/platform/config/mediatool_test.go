package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fakeBanner(t *testing.T, dir, name, banner string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(dir, name)
	script := "#!/bin/sh\necho '" + banner + "'\n"
	if err := os.WriteFile(path, []byte(script), mode); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestValidateMediaTool(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fakes")
	}
	dir := t.TempDir()
	good := fakeBanner(t, dir, "ffmpeg", "ffmpeg version 6.0 Copyright", 0o755)
	goodProbe := fakeBanner(t, dir, "ffprobe", "ffprobe version 6.0", 0o755)
	otherDir := filepath.Join(dir, "other")
	if err := os.MkdirAll(otherDir, 0o755); err != nil {
		t.Fatal(err)
	}
	wrongBanner := fakeBanner(t, otherDir, "ffmpeg", "evil version 1", 0o755)
	notExec := fakeBanner(t, filepath.Join(dir), "ffmpeg-noexec", "ffmpeg version 6", 0o644)
	wrongName := fakeBanner(t, dir, "sh-wrapper", "ffmpeg version 6", 0o755)

	cases := []struct {
		name, path, binary string
		ok                 bool
	}{
		{"accepted ffmpeg", good, "ffmpeg", true},
		{"accepted ffprobe", goodProbe, "ffprobe", true},
		{"wrong banner", wrongBanner, "ffmpeg", false},
		{"ffprobe banner for ffmpeg", goodProbe, "ffmpeg", false},
		{"missing", filepath.Join(dir, "nope", "ffmpeg"), "ffmpeg", false},
		{"not executable", notExec, "ffmpeg", false},
		{"wrong base name", wrongName, "ffmpeg", false},
		{"relative path", "ffmpeg", "ffmpeg", false},
		{"directory", dir, "ffmpeg", false},
	}
	for _, c := range cases {
		err := ValidateMediaTool(c.path, c.binary)
		if c.ok && err != nil {
			t.Errorf("%s: unexpected error %v", c.name, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%s: expected an error", c.name)
		}
	}
}

func TestSaveRejectsChangedMediaToolThatFailsProbe(t *testing.T) {
	dir := t.TempDir()
	store := loadAt(t, filepath.Join(dir, "settings.json"))
	next := store.Get()
	next.FFmpegPath = fakeBanner(t, dir, "ffmpeg", "not a banner", 0o755)
	err := store.Save(next)
	if err == nil || !strings.Contains(err.Error(), "ffmpegPath") {
		t.Fatalf("Save error = %v, want ffmpegPath rejection", err)
	}
	next.FFmpegPath = fakeBanner(t, dir, "ffmpeg", "ffmpeg version 7.1", 0o755)
	if err := store.Save(next); err != nil {
		t.Fatalf("Save with valid tool: %v", err)
	}
}

func TestSaveKeepsUnchangedMediaToolPathsWithoutProbing(t *testing.T) {
	dir := t.TempDir()
	store := loadAt(t, filepath.Join(dir, "settings.json"))
	next := store.Get()
	next.InstanceName = "Renamed"
	if err := store.Save(next); err != nil {
		t.Fatalf("Save with untouched tool paths: %v", err)
	}
}

func TestValidateRejectsMediaToolWithArbitraryBaseName(t *testing.T) {
	dir := t.TempDir()
	store := loadAt(t, filepath.Join(dir, "settings.json"))
	v := store.Get()
	v.FFprobePath = "/bin/sh"
	if err := store.Validate(v); err == nil {
		t.Fatal("expected /bin/sh to be rejected as ffprobePath")
	}
}

func TestLoadFallsBackWhenFileHoldsArbitraryMediaToolPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"ffmpegPath":"/bin/sh"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := loadAt(t, path)
	if got := store.Get().FFmpegPath; got != Defaults().FFmpegPath {
		t.Fatalf("FFmpegPath = %q, want default fallback", got)
	}
	if w := store.StartupWarnings(); len(w) != 1 || !strings.Contains(w[0], "ffmpegPath") {
		t.Fatalf("StartupWarnings = %v", w)
	}
}
