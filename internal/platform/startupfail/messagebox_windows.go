//go:build windows

package startupfail

import (
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

func (messageBox) Show(title, text string) {
	caption, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	body, err := windows.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	_, _, _ = procMessageBoxW.Call(
		0, // hWnd: no owner; the app window may not exist yet
		uintptr(unsafe.Pointer(body)),
		uintptr(unsafe.Pointer(caption)),
		mbOK|mbIconError|mbSetForeground|mbTopmost,
	)
}
