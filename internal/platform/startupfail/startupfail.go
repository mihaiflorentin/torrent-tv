// Package startupfail makes GUI startup failures observable where no
// console exists. A windowsgui-subsystem binary on Windows has no stderr:
// a startup error is printed into the void and the process exits (the
// cobra error print in main, and wails' own fatal handler, which logs to
// io.Discard in production builds before os.Exit). The Reporter mirrors
// every fatal startup error into <data dir>/gui-startup.log and surfaces
// the first one in a native message box, so a silent death always leaves
// a readable trace behind.
//
// The Reporter never exits the process; callers own that. Its methods are
// safe from any goroutine (wails reports errors from window goroutines and
// the main thread alike) and the dialog blocks until dismissed, which is
// required: wails' chromium error callback exits the process as soon as
// its callback returns.
package startupfail

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/platform/datadir"
)

// maxLogBytes caps the startup log. Launches append; a file that grew past
// the cap is truncated at open, so a chatty error source cannot grow it
// without bound.
const maxLogBytes = 1 << 20

const (
	startupLogName = "gui-startup.log"
	dialogTitle    = "Torrent TV"
)

// Messenger surfaces a fatal startup error to the user. Windows shows a
// native MessageBoxW dialog; every other platform keeps the historic
// console-only behavior and no-ops.
type Messenger interface {
	Show(title, text string)
}

// Reporter records fatal startup errors. Every Report and Log appends a
// timestamped line to the startup log; the first Report also shows the
// messenger dialog, once per process.
type Reporter struct {
	mu        sync.Mutex
	messenger Messenger
	dir       string // data dir; resolved lazily when empty
	logFile   *os.File
	shown     bool
}

// NewReporter builds a reporter that logs under dir ("" defers to the
// platform data-dir fallback on first use) and surfaces the first error
// through messenger.
func NewReporter(messenger Messenger, dir string) *Reporter {
	return &Reporter{messenger: messenger, dir: dir}
}

var (
	defaultOnce   sync.Once
	defaultReport *Reporter
)

// Default is the process-wide reporter: platform dialog plus the
// platform-GUI data-dir convention. gui.Run pins the resolved data dir
// with SetDir as soon as it knows it; earlier reports fall back to the
// platform default dir, and if even that is unresolvable, to os.TempDir —
// the error must land somewhere findable.
func Default() *Reporter {
	defaultOnce.Do(func() { defaultReport = NewReporter(PlatformMessenger(), "") })
	return defaultReport
}

// SetDir pins the data directory once the caller resolves it. Earlier
// reports landed in the fallback location; every later write follows the
// real data dir.
func (r *Reporter) SetDir(dir string) {
	if dir == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if dir == r.dir {
		return
	}
	r.dir = dir
	if r.logFile != nil {
		_ = r.logFile.Close()
		r.logFile = nil
	}
}

// LogPath returns the file the next write lands in.
func (r *Reporter) LogPath() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return filepath.Join(r.dirOrFallbackLocked(), startupLogName)
}

// Log records a startup milestone. When a launch hangs rather than fails,
// the log's last line names how far startup got.
func (r *Reporter) Log(step string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writeLocked(time.Now().UTC().Format(time.RFC3339) + " " + step)
}

// Report records a fatal startup error: appended to the log, and shown in
// the platform dialog once per process. Nil is ignored so callers can
// report unconditionally.
func (r *Reporter) Report(err error) {
	if err == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writeLocked(time.Now().UTC().Format(time.RFC3339) + " error: " + err.Error())
	r.showLocked(err.Error() + "\n\nA copy was written to " + r.dirOrFallbackLocked() +
		string(os.PathSeparator) + startupLogName)
}

// ReportPanic records a recovered panic together with its stack.
func (r *Reporter) ReportPanic(v any, stack []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ts := time.Now().UTC().Format(time.RFC3339)
	r.writeLocked(fmt.Sprintf("%s panic: %v", ts, v))
	r.writeLocked(string(stack))
	r.showLocked(fmt.Sprintf("%v\n\nA copy was written to %s", v,
		filepath.Join(r.dirOrFallbackLocked(), startupLogName)))
}

// showLocked surfaces the first reported error through the messenger.
// Later reports only append to the log: a dialog storm from a recurring
// non-fatal wails report would make the running app unusable.
func (r *Reporter) showLocked(text string) {
	if r.shown || r.messenger == nil {
		return
	}
	r.shown = true
	r.messenger.Show(dialogTitle, text)
}

// writeLocked appends one line, opening (and pinning) the log on first use.
func (r *Reporter) writeLocked(line string) {
	if r.dir == "" {
		r.dir = fallbackDir()
	}
	if r.logFile == nil {
		f, err := openStartupLog(filepath.Join(r.dir, startupLogName))
		if err != nil {
			return // the dialog still fires; there is nowhere else to write
		}
		r.logFile = f
	}
	fmt.Fprintln(r.logFile, line)
}

// dirOrFallbackLocked reports the current log directory without pinning it.
func (r *Reporter) dirOrFallbackLocked() string {
	if r.dir != "" {
		return r.dir
	}
	return fallbackDir()
}

// openStartupLog appends to the startup log, creating the directory and
// truncating a file that grew past maxLogBytes.
func openStartupLog(path string) (*os.File, error) {
	if fi, err := os.Stat(path); err == nil && fi.Size() > maxLogBytes {
		return os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	return os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
}

// fallbackDir resolves the GUI data dir per the datadir platform default
// (%APPDATA%\Torrent TV on Windows). Failure falls back to os.TempDir so
// even an unresolvable data dir still leaves the error somewhere findable.
func fallbackDir() string {
	exe, err := os.Executable()
	if err != nil {
		return os.TempDir()
	}
	dir, _, err := datadir.ResolveFor("", exe, datadir.PlatformGUI)
	if err != nil || dir == "" {
		return os.TempDir()
	}
	return dir
}
