package startupfail

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeMessenger struct {
	calls int
	title string
	text  string
}

func (f *fakeMessenger) Show(title, text string) {
	f.calls++
	f.title = title
	f.text = text
}

// TestReportWritesLogAndShowsDialogOnce pins the fatal-error contract:
// every report lands in <dir>/gui-startup.log, and the platform dialog
// fires exactly once — on the first error — because wails' chromium error
// callback exits the process right after the callback returns.
func TestReportWritesLogAndShowsDialogOnce(t *testing.T) {
	dir := t.TempDir()
	m := &fakeMessenger{}
	r := NewReporter(m, dir)

	r.Report(errors.New("webview2 runtime not found"))
	r.Report(errors.New("second failure"))

	log := readStartupLog(t, filepath.Join(dir, startupLogName))
	if !strings.Contains(log, "error: webview2 runtime not found") {
		t.Fatalf("startup log must contain the first error, got:\n%s", log)
	}
	if !strings.Contains(log, "error: second failure") {
		t.Fatalf("startup log must contain every report, got:\n%s", log)
	}
	if m.calls != 1 {
		t.Fatalf("dialog must fire once per process, got %d calls", m.calls)
	}
	if m.title != dialogTitle {
		t.Fatalf("dialog title must be %q, got %q", dialogTitle, m.title)
	}
	if !strings.Contains(m.text, "webview2 runtime not found") {
		t.Fatalf("dialog text must name the error, got %q", m.text)
	}
}

// TestSetDirRedirectsSubsequentWrites pins directory relocation: once the
// caller resolves the effective data dir (e.g. via --data-dir flag),
// subsequent reports must follow the new directory.
func TestSetDirRedirectsSubsequentWrites(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	m := &fakeMessenger{}
	r := NewReporter(m, dirA)

	r.Report(errors.New("first at A"))
	r.SetDir(dirB)
	r.Report(errors.New("second at B"))

	logA := readStartupLog(t, filepath.Join(dirA, startupLogName))
	logB := readStartupLog(t, filepath.Join(dirB, startupLogName))

	if !strings.Contains(logA, "first at A") || strings.Contains(logA, "second at B") {
		t.Fatalf("log A should only have the first error, got:\n%s", logA)
	}
	if !strings.Contains(logB, "second at B") || strings.Contains(logB, "first at A") {
		t.Fatalf("log B should only have the second error, got:\n%s", logB)
	}
}

// TestLogRecordsMilestones pins startup progression logging so a hang can
// be diagnosed from the last recorded milestone.
func TestLogRecordsMilestones(t *testing.T) {
	dir := t.TempDir()
	r := NewReporter(nil, dir)

	r.Log("single-instance lock acquired")

	log := readStartupLog(t, filepath.Join(dir, startupLogName))
	if !strings.Contains(log, "single-instance lock acquired") {
		t.Fatalf("log must contain milestone, got:\n%s", log)
	}
}

// TestReportPanicRecordsStack pins crash recovery: a panic during startup
// must land with its stack trace in the log, and name the panic in the dialog.
func TestReportPanicRecordsStack(t *testing.T) {
	dir := t.TempDir()
	m := &fakeMessenger{}
	r := NewReporter(m, dir)

	r.ReportPanic("nil pointer dereference", []byte("goroutine 1 [running]:\nmain.main()"))

	log := readStartupLog(t, filepath.Join(dir, startupLogName))
	if !strings.Contains(log, "panic: nil pointer dereference") {
		t.Fatalf("log must record panic value, got:\n%s", log)
	}
	if !strings.Contains(log, "goroutine 1 [running]") {
		t.Fatalf("log must record stack, got:\n%s", log)
	}
	if m.calls != 1 || !strings.Contains(m.text, "nil pointer dereference") {
		t.Fatalf("dialog must fire on panic and name the value, got %d calls: %q", m.calls, m.text)
	}
}

// TestNilReportIgnored pins the no-op behavior on nil error.
func TestNilReportIgnored(t *testing.T) {
	dir := t.TempDir()
	m := &fakeMessenger{}
	r := NewReporter(m, dir)

	r.Report(nil)

	if m.calls != 0 {
		t.Fatalf("nil error must not show dialog, got %d calls", m.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, startupLogName)); !os.IsNotExist(err) {
		t.Fatalf("nil error must not create log file, got err=%v", err)
	}
}

func readStartupLog(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read startup log %s: %v", path, err)
	}
	return string(b)
}
