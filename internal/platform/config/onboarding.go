package config

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// MissingRequired reports which FileList credentials are still blank while
// the FileList tracker is enabled, in banner order (username, then passkey).
// It is advisory UI state for the Settings page and never a start gate: the
// server starts unconditionally, so a switched-on-but-unconfigured tracker
// degrades at login time instead of withholding boot. A disabled tracker
// plus blank credentials is a valid setup and reports nothing. The download
// root is never reported: startup auto-creates and verifies it (CanStart via
// EnsureNativePathsWritable), and a value still sitting at the built-in
// default surfaces through DefaultsInUse as a nudge instead of a refusal.
func (s *Store) MissingRequired() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.value.FileListEnabled {
		return nil
	}
	var missing []string
	if strings.TrimSpace(s.value.FileListUsername) == "" {
		missing = append(missing, "fileListUsername")
	}
	if strings.TrimSpace(s.value.FileListPasskey) == "" {
		missing = append(missing, "fileListPasskey")
	}
	return missing
}

// DefaultsInUse reports which settings still sit at their built-in default,
// in a fixed key order, so the GUI can nudge the operator without blocking
// startup. downloadRoot compares the effective value against the built-in
// default re-anchored to this store's settings dir — the same transform
// LoadAt applies — so a file that explicitly carries "data/downloads" is
// still "at default" (value-based, not provenance-based), while an
// absolute custom root is not. listenAddress compares raw: anchoring never
// touches it. Returns an empty slice when everything has been customized.
func (s *Store) DefaultsInUse() []string {
	s.mu.RLock()
	value := s.value
	s.mu.RUnlock()
	anchored := Defaults()
	anchorNativePaths(&anchored, map[string]bool{}, filepath.Dir(s.path))
	inUse := []string{}
	if value.DownloadRoot == anchored.DownloadRoot {
		inUse = append(inUse, "downloadRoot")
	}
	if value.ListenAddress == Defaults().ListenAddress {
		inUse = append(inUse, "listenAddress")
	}
	return inUse
}

// ResolveMediaTools fills ffprobePath and ffmpegPath from PATH when the
// configured paths do not exist on disk and the environment does not manage
// them, persisting discoveries so later starts skip the lookup. Existing
// usable paths are trusted. It returns the tools still missing after the
// lookup; a missing tool warns but never blocks startup, matching how the
// probe degrades at runtime.
func (s *Store) ResolveMediaTools() ([]string, error) {
	type mediaTool struct {
		key, binary, current string
		managed              bool
	}
	s.mu.RLock()
	tools := []mediaTool{
		{key: "ffprobePath", binary: "ffprobe", current: s.value.FFprobePath, managed: s.envManaged["ffprobePath"]},
		{key: "ffmpegPath", binary: "ffmpeg", current: s.value.FFmpegPath, managed: s.envManaged["ffmpegPath"]},
	}
	s.mu.RUnlock()

	discovered := map[string]string{}
	var missing []string
	for _, tool := range tools {
		if tool.managed {
			continue // the environment overlay is authoritative
		}
		if _, err := os.Stat(tool.current); err == nil {
			continue // a configured path that exists is the user's choice
		}
		found, err := exec.LookPath(tool.binary)
		if err != nil {
			missing = append(missing, tool.binary)
			continue
		}
		discovered[tool.key] = found
	}
	if len(discovered) == 0 {
		return missing, nil
	}
	next := s.Get()
	if found, ok := discovered["ffprobePath"]; ok {
		next.FFprobePath = found
	}
	if found, ok := discovered["ffmpegPath"]; ok {
		next.FFmpegPath = found
	}
	if err := s.Save(next); err != nil {
		return missing, fmt.Errorf("save discovered media tools: %w", err)
	}
	return missing, nil
}
