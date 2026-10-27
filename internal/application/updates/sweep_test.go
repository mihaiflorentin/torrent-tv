package updates

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const sweepGrace = 30 * time.Minute

// stagingEntries lays out one extract directory (holding a helper copy) and
// one staged archive per name, aged to mtime.
func stagingEntries(t *testing.T, installDir string, mtime time.Time, names ...string) (extracts, parts []string) {
	t.Helper()
	for _, name := range names {
		extract := filepath.Join(installDir, ".filelist-extract-"+name)
		if err := os.MkdirAll(extract, 0o755); err != nil {
			t.Fatal(err)
		}
		helper := filepath.Join(extract, "helper-op-"+name+".exe")
		if err := os.WriteFile(helper, []byte("helper"), 0o700); err != nil {
			t.Fatal(err)
		}
		part := filepath.Join(installDir, ".filelist-stage-"+name+".part")
		if err := os.WriteFile(part, []byte("archive"), 0o600); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{helper, extract, part} {
			if err := os.Chtimes(path, mtime, mtime); err != nil {
				t.Fatal(err)
			}
		}
		extracts = append(extracts, extract)
		parts = append(parts, part)
	}
	return extracts, parts
}

func assertGone(t *testing.T, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s survived: %v", filepath.Base(path), err)
		}
	}
}

func assertPresent(t *testing.T, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if _, err := os.Lstat(path); err != nil {
			t.Errorf("%s removed: %v", filepath.Base(path), err)
		}
	}
}

func TestSweepStaleStagingRemovesUnnamedStaleEntries(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	extracts, parts := stagingEntries(t, installDir, now.Add(-2*sweepGrace), "1", "2")

	SweepStaleStaging(installDir, now, sweepGrace)

	assertGone(t, extracts...)
	assertGone(t, parts...)
}

func TestSweepStaleStagingKeepsFreshEntries(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	// Staging runs before the journal lock: a fresh entry may belong to an
	// operation that has not recorded itself yet.
	extracts, parts := stagingEntries(t, installDir, now.Add(-time.Minute), "fresh")

	SweepStaleStaging(installDir, now, sweepGrace)

	assertPresent(t, extracts...)
	assertPresent(t, parts...)
}

func TestSweepStaleStagingKeepsEntriesNamedByJournal(t *testing.T) {
	for _, lockHeld := range []bool{false, true} {
		name := "lock free"
		if lockHeld {
			name = "lock held"
		}
		t.Run(name, func(t *testing.T) {
			installDir := t.TempDir()
			now := time.Now()
			stale := now.Add(-2 * sweepGrace)
			named, namedParts := stagingEntries(t, installDir, stale, "named")
			orphans, orphanParts := stagingEntries(t, installDir, stale, "orphan")
			// The helper copy lives inside the extract directory; naming it
			// alone must protect its directory.
			helper := filepath.Join(named[0], "helper-op-named.exe")

			journal, err := OpenJournal(installDir)
			if err != nil {
				t.Fatal(err)
			}
			defer journal.Close()
			if err := journal.Save(Operation{
				ID: "op-1", Version: "0.4.0", Phase: PhaseActivated,
				StagedPaths: []string{namedParts[0], helper},
			}); err != nil {
				t.Fatal(err)
			}
			if !lockHeld {
				if err := journal.Close(); err != nil {
					t.Fatal(err)
				}
			}

			SweepStaleStaging(installDir, now, sweepGrace)

			assertPresent(t, named...)
			assertPresent(t, namedParts...)
			assertPresent(t, helper)
			assertGone(t, orphans...)
			assertGone(t, orphanParts...)
		})
	}
}

func TestSweepStaleStagingKeepsEntriesUnderBackup(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	extracts, _ := stagingEntries(t, installDir, now.Add(-2*sweepGrace), "bundle")
	journal, err := OpenJournal(installDir)
	if err != nil {
		t.Fatal(err)
	}
	defer journal.Close()
	// A bundle operation's backup is the staged bundle inside the extract
	// directory.
	if err := journal.Save(Operation{
		ID: "op-1", Version: "0.4.0", Phase: PhaseRolledBack,
		Backup: filepath.Join(extracts[0], "Torrent TV.app"),
	}); err != nil {
		t.Fatal(err)
	}

	SweepStaleStaging(installDir, now, sweepGrace)

	assertPresent(t, extracts...)
}

func TestSweepStaleStagingSkipsUnreadableJournal(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	extracts, parts := stagingEntries(t, installDir, now.Add(-2*sweepGrace), "1")
	if err := os.WriteFile(journalPath(installDir), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	SweepStaleStaging(installDir, now, sweepGrace)

	assertPresent(t, extracts...)
	assertPresent(t, parts...)
}

func TestSweepStaleStagingLeavesOtherEntries(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	stale := now.Add(-2 * sweepGrace)
	others := []string{
		filepath.Join(installDir, journalName),
		filepath.Join(installDir, journalName+".lock"),
		filepath.Join(installDir, ".filelist-journal-1.tmp"),
		filepath.Join(installDir, ".filelist-backup-1"),
		filepath.Join(installDir, ".filelist-probe-1"),
		filepath.Join(installDir, ".filelist-stage-1.zip"),
		filepath.Join(installDir, "torrent-tv.exe"),
	}
	for _, path := range others {
		content := []byte("x")
		if filepath.Base(path) == journalName {
			content = []byte(`{"id":"op-1","phase":"confirmed"}`)
		}
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, stale, stale); err != nil {
			t.Fatal(err)
		}
	}

	SweepStaleStaging(installDir, now, sweepGrace)

	assertPresent(t, others...)
}

func TestConsumeSuppressionRemovesStagedPaths(t *testing.T) {
	installDir := t.TempDir()
	extracts, parts := stagingEntries(t, installDir, time.Now(), "rolled")
	backup := filepath.Join(installDir, ".filelist-backup-kept")
	if err := os.WriteFile(backup, []byte("previous"), 0o700); err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJournal(installDir)
	if err != nil {
		t.Fatal(err)
	}
	defer journal.Close()
	if err := journal.Save(Operation{
		ID: "op-1", Version: "0.4.0", Phase: PhaseRolledBack, SuppressNext: true,
		Backup:      backup,
		StagedPaths: []string{parts[0], extracts[0], filepath.Join(extracts[0], "helper-op-rolled.exe")},
	}); err != nil {
		t.Fatal(err)
	}
	installer := NewInstaller(journal, PayloadFile, filepath.Join(installDir, "torrent-tv.exe"), "", DefaultHealthTimeout)

	if err := installer.ConsumeSuppression(); err != nil {
		t.Fatalf("ConsumeSuppression: %v", err)
	}

	assertGone(t, extracts...)
	assertGone(t, parts...)
	assertGone(t, journalPath(installDir))
	assertPresent(t, backup)
}

func TestRecoverPendingSweepsStaleStagingWhenNothingPending(t *testing.T) {
	installDir := t.TempDir()
	now := time.Now()
	staleExtracts, staleParts := stagingEntries(t, installDir, now.Add(-2*defaultOperationTimeout), "stale")
	freshExtracts, freshParts := stagingEntries(t, installDir, now.Add(-time.Minute), "fresh")
	m := &Manager{deps: ManagerDeps{InstallDir: installDir, Now: func() time.Time { return now }, OperationTimeout: defaultOperationTimeout}}

	m.recoverPending()

	assertGone(t, staleExtracts...)
	assertGone(t, staleParts...)
	assertPresent(t, freshExtracts...)
	assertPresent(t, freshParts...)
}
