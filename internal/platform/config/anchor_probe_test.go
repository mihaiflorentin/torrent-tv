package config

import (
	"os"
	"path/filepath"
	"testing"
)

// A relative path in a settings save must be probed where the store will
// anchor it (next to the settings file), not in the process CWD.
func TestEnsureNativePathsWritableForAnchorsRelativePaths(t *testing.T) {
	dir := t.TempDir()
	cwd := t.TempDir()
	t.Setenv(EnvironmentPrefix+"SETTINGS_PATH", filepath.Join(dir, "settings.json"))
	store, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(cwd); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(previous) }()

	next := store.Get()
	next.DownloadEngine = "native"
	next.DownloadRoot = "data/downloads"
	next.TorrentSessionDir = "data/session"
	if err := store.EnsureNativePathsWritableFor(next); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "downloads")); err != nil {
		t.Fatalf("download root must be created next to the settings file: %v", err)
	}
	if entries, _ := os.ReadDir(cwd); len(entries) != 0 {
		t.Fatalf("the process CWD must stay untouched, found %v", entries)
	}
}

func TestMergeSecretsDoesNotRestorePasswordWithoutUsername(t *testing.T) {
	old := Settings{QBittorrentUsername: "admin", QBittorrentPassword: "secret"}
	next := Settings{QBittorrentUsername: "", QBittorrentPassword: ""}
	mergeSecrets(&next, old)
	if next.QBittorrentPassword != "" {
		t.Fatalf("clearing the username must drop the password too, got %q", next.QBittorrentPassword)
	}
	kept := Settings{QBittorrentUsername: "admin"}
	mergeSecrets(&kept, old)
	if kept.QBittorrentPassword != "secret" {
		t.Fatalf("an unchanged username keeps the stored password, got %q", kept.QBittorrentPassword)
	}
}
