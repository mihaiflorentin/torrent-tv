package config

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// mediaToolName checks only the path shape: absolute, with a base name of
// the expected binary (plus .exe on Windows). It does not touch the disk.
func mediaToolName(key, path, binary string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("%s must be an absolute path", key)
	}
	base := filepath.Base(path)
	if runtime.GOOS == "windows" {
		base = strings.TrimSuffix(strings.ToLower(base), ".exe")
	}
	if base != binary {
		return fmt.Errorf("%s must name the %s executable, not %q", key, binary, filepath.Base(path))
	}
	return nil
}

// ValidateMediaTool checks that path names an existing executable regular
// file called binary ("ffmpeg" or "ffprobe") whose -version banner starts
// with "<binary> version". The path is executed by the server, so it must not
// be an arbitrary program.
func ValidateMediaTool(path, binary string) error {
	key := binary + "Path"
	if err := mediaToolName(key, path, binary); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s must be a regular file", key)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("%s is not executable", key)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-version")
	out, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	line, _ := bufio.NewReader(out).ReadString('\n')
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	if !strings.HasPrefix(strings.TrimSpace(line), binary+" version") {
		return fmt.Errorf("%s: -version output does not start with %q", key, binary+" version")
	}
	return nil
}

// StartupWarnings lists settings that were replaced by defaults at load.
func (s *Store) StartupWarnings() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.warnings...)
}

// resetUnsafeMediaTools replaces a file-provided tool path whose base name is
// wrong (for example a settings file edited to point at /bin/sh) with the
// default, recording a warning. Environment-managed values are the
// operator's explicit word and fail validation loudly instead.
func resetUnsafeMediaTools(base, effective *Settings, managed map[string]bool) (warnings []string) {
	defaults := Defaults()
	for _, t := range []struct {
		key, binary string
		base, eff   *string
		def         string
	}{
		{"ffprobePath", "ffprobe", &base.FFprobePath, &effective.FFprobePath, defaults.FFprobePath},
		{"ffmpegPath", "ffmpeg", &base.FFmpegPath, &effective.FFmpegPath, defaults.FFmpegPath},
	} {
		if managed[t.key] || mediaToolName(t.key, *t.eff, t.binary) == nil {
			continue
		}
		warnings = append(warnings, fmt.Sprintf("%s %q is not a %s executable; using %s", t.key, *t.eff, t.binary, t.def))
		*t.base, *t.eff = t.def, t.def
	}
	return warnings
}
