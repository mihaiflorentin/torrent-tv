package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func loadAt(t *testing.T, path string) *Store {
	t.Helper()
	t.Setenv(EnvironmentPrefix+"SETTINGS_PATH", path)
	store, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestMissingRequiredListsKeysAbsentFromFileAndEnvironment(t *testing.T) {
	dir := t.TempDir()
	store := loadAt(t, filepath.Join(dir, "settings.json"))
	if got := strings.Join(store.MissingRequired(), ","); got != "fileListUsername,fileListPasskey" {
		t.Fatalf("MissingRequired with no settings file = %q", got)
	}

	provided := `{"downloadRoot":"/tmp/root","fileListUsername":"me","fileListPasskey":"k"}`
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(provided), 0o600); err != nil {
		t.Fatal(err)
	}
	store = loadAt(t, path)
	if got := store.MissingRequired(); len(got) != 0 {
		t.Fatalf("MissingRequired with a complete file = %v", got)
	}

	partial := `{"downloadRoot":"/tmp/root"}`
	if err := os.WriteFile(path, []byte(partial), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(EnvironmentPrefix+"FILE_LIST_USERNAME", "envuser")
	store = loadAt(t, path)
	if got := strings.Join(store.MissingRequired(), ","); got != "fileListPasskey" {
		t.Fatalf("MissingRequired with file root and env username = %q", got)
	}
}

// TestSaveCompletingRequiredClearsMissingForTheSameStore pins that a save
// which fills every required key clears MissingRequired on the in-memory
// store — not just after a reload — so the GUI's advisory banner clears
// immediately on save.
func TestSaveCompletingRequiredClearsMissingForTheSameStore(t *testing.T) {
	dir := t.TempDir()
	store := loadAt(t, filepath.Join(dir, "settings.json"))
	if missing := store.MissingRequired(); len(missing) != 2 {
		t.Fatalf("fresh store missing = %v, want both required FileList credential keys", missing)
	}
	next := store.Get()
	next.DownloadRoot = filepath.Join(dir, "downloads")
	next.TorrentSessionDir = filepath.Join(dir, "session")
	next.FileListUsername = "me"
	next.FileListPasskey = "secret"
	if err := store.Save(next); err != nil {
		t.Fatal(err)
	}
	if missing := store.MissingRequired(); len(missing) != 0 {
		t.Fatalf("missing after completing save = %v, want none", missing)
	}
}

func TestMissingRequiredGatesFileListCredentialsOnTrackerEnabled(t *testing.T) {
	cases := []struct {
		enabled         bool
		user, pass      string
		wantCredentials bool
	}{
		{false, "", "", false},
		{true, "", "", true},
		{true, "user", "pass", false},
	}
	for _, tc := range cases {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		payload := fmt.Sprintf(`{"fileListEnabled":%t,"fileListUsername":%q,"fileListPasskey":%q}`,
			tc.enabled, tc.user, tc.pass)
		if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
			t.Fatal(err)
		}
		store, err := LoadAt(path)
		if err != nil {
			t.Fatal(err)
		}
		missing := store.MissingRequired()
		hasCredentials := false
		for _, key := range missing {
			if key == "fileListUsername" || key == "fileListPasskey" {
				hasCredentials = true
			}
		}
		if hasCredentials != tc.wantCredentials {
			t.Fatalf("enabled=%t user=%q pass=%q: MissingRequired=%v, wantCredentials=%t", tc.enabled, tc.user, tc.pass, missing, tc.wantCredentials)
		}
		for _, key := range missing {
			if key == "downloadRoot" {
				t.Fatalf("enabled=%t: downloadRoot must never be required", tc.enabled)
			}
		}
	}
}

func TestPirateBayOnlyStartupSurvivesSaveReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(fmt.Sprintf(`{"downloadRoot":%q}`, filepath.Join(dir, "downloads"))), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := LoadAt(path)
	if err != nil {
		t.Fatal(err)
	}
	next := store.Get()
	next.FileListEnabled = false
	next.PirateBayEnabled = true
	next.FileListUsername = ""
	next.FileListPasskey = ""
	if err := store.Save(next); err != nil {
		t.Fatal(err)
	}
	reloaded, err := LoadAt(path)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get()
	if got.FileListEnabled || !got.PirateBayEnabled {
		t.Fatalf("tracker toggles did not survive reload: fileListEnabled=%t pirateBayEnabled=%t", got.FileListEnabled, got.PirateBayEnabled)
	}
	for _, key := range reloaded.MissingRequired() {
		if key == "fileListUsername" || key == "fileListPasskey" {
			t.Fatalf("Pirate Bay-only startup reported %q as missing", key)
		}
	}

	next = reloaded.Get()
	next.FileListEnabled = true
	if err := reloaded.Save(next); err != nil {
		t.Fatal(err)
	}
	reloaded, err = LoadAt(path)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(reloaded.MissingRequired(), ",")
	if !strings.Contains(joined, "fileListUsername") || !strings.Contains(joined, "fileListPasskey") {
		t.Fatalf("re-enabled FileList without credentials must report them, got %q", joined)
	}
}

func TestDefaultsInUseReportsBothBuiltInDefaults(t *testing.T) {
	store := loadAt(t, filepath.Join(t.TempDir(), "settings.json"))
	got := store.DefaultsInUse()
	if len(got) != 2 || got[0] != "downloadRoot" || got[1] != "listenAddress" {
		t.Fatalf("fresh store DefaultsInUse = %v, want [downloadRoot listenAddress]", got)
	}
}

func TestDefaultsInUseClearsWhenSettingsAreCustomized(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	body := fmt.Sprintf(`{"downloadRoot":%q,"listenAddress":"127.0.0.1:8098"}`, filepath.Join(dir, "custom-downloads"))
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	store := loadAt(t, path)
	if got := store.DefaultsInUse(); len(got) != 0 {
		t.Fatalf("customized store DefaultsInUse = %v, want none", got)
	}
}

func TestDefaultsInUseComparesValuesNotProvenance(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"downloadRoot":"data/downloads"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := loadAt(t, path)
	got := store.DefaultsInUse()
	if len(got) != 2 || got[0] != "downloadRoot" || got[1] != "listenAddress" {
		t.Fatalf("file carrying default downloadRoot = %v, want [downloadRoot listenAddress]", got)
	}
}
