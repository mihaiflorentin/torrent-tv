//go:build !windows

package startupfail

// PlatformMessenger is a no-op off Windows: a console-bound process
// already surfaces errors on stderr, and a dialog would be noise.
func PlatformMessenger() Messenger { return nopMessenger{} }

type nopMessenger struct{}

func (nopMessenger) Show(title, text string) {}
