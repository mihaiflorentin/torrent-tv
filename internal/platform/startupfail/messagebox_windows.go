//go:build windows

package startupfail

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// PlatformMessenger shows fatal startup errors in a native MessageBoxW
// dialog: under the windowsgui subsystem no stderr exists, so the dialog
// is the only surface a double-launched exe can speak through. It blocks
// until dismissed — wails' chromium error callback exits the process the
// moment its callback returns, so the dialog must complete first.
func PlatformMessenger() Messenger { return messageBox{} }

type messageBox struct{}

var (
	user32          = windows.NewLazySystemDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
)

const (
	mbOK            = 0x00000000
	mbIconError     = 0x00000010
	mbSetForeground = 0x00010000
	mbTopmost       = 0x00040000
)

// Show reports MessageBoxW's result and how long the dialog stayed up: 0
// means the dialog never showed (the error names why), and a near-instant
// IDOK means something dismissed it before the user could read it.
func (messageBox) Show(title, text string) string {
	caption, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return "not shown: " + err.Error()
	}
	body, err := windows.UTF16PtrFromString(text)
	if err != nil {
		return "not shown: " + err.Error()
	}
	start := time.Now()
	ret, _, callErr := procMessageBoxW.Call(
		0, // hWnd: no owner; the app window may not exist yet
		uintptr(unsafe.Pointer(body)),
		uintptr(unsafe.Pointer(caption)),
		mbOK|mbIconError|mbSetForeground|mbTopmost,
	)
	elapsed := time.Since(start).Round(time.Millisecond)
	if ret == 0 {
		return fmt.Sprintf("MessageBoxW failed after %s: %v", elapsed, callErr)
	}
	return fmt.Sprintf("MessageBoxW returned %d after %s", ret, elapsed)
}
