//go:build windows

package main

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

const attachParentProcess = ^uintptr(0) // ATTACH_PARENT_PROCESS

const (
	consoleGenericReadWrite = 0xC0000000 // GENERIC_READ | GENERIC_WRITE
	consoleGenericRead      = 0x80000000 // GENERIC_READ
	consoleShareReadWrite   = 0x3        // FILE_SHARE_READ | FILE_SHARE_WRITE
	consoleOpenExisting     = 3          // OPEN_EXISTING
	consoleInvalidHandle    = ^uintptr(0)
)

var kernel32 = windows.NewLazySystemDLL("kernel32.dll")

var (
	procAttachConsole = kernel32.NewProc("AttachConsole")
	procCreateFileW   = kernel32.NewProc("CreateFileW")
)

// openConsole opens a console device (CONIN$/CONOUT$) for the given access.
// Returns 0 when the device could not be opened.
func openConsole(name string, access uint32) uintptr {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0
	}
	h, _, _ := procCreateFileW.Call(
		uintptr(unsafe.Pointer(namePtr)),
		uintptr(access),
		consoleShareReadWrite,
		0, // security attributes
		consoleOpenExisting,
		0, // flags and attributes
		0, // template file
	)
	if h == consoleInvalidHandle || h == 0 {
		return 0
	}
	return h
}

// attachParentConsole re-attaches stdout/stderr when a windowsgui-subsystem
// binary is started from an existing terminal, so `serve` streams logs.
// A windowsgui process starts with invalid std handles and AttachConsole
// does not populate them — the console devices must be reopened and
// registered with SetStdHandle before the Go files are rebound.
func attachParentConsole() {
	if err := procAttachConsole.Find(); err != nil {
		return
	}
	r1, _, _ := procAttachConsole.Call(attachParentProcess)
	if r1 == 0 {
		return
	}
	if h := openConsole("CONOUT$", consoleGenericReadWrite); h != 0 {
		_ = windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, windows.Handle(h))
		_ = windows.SetStdHandle(windows.STD_ERROR_HANDLE, windows.Handle(h))
		os.Stdout = os.NewFile(h, "stdout")
		os.Stderr = os.NewFile(h, "stderr")
	}
	if h := openConsole("CONIN$", consoleGenericRead); h != 0 {
		_ = windows.SetStdHandle(windows.STD_INPUT_HANDLE, windows.Handle(h))
		os.Stdin = os.NewFile(h, "stdin")
	}
}
