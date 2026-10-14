package filelist

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFailedDownloadErrorOmitsPasskey(t *testing.T) {
	const passkey = "filelist-passkey-456"
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	c := New(func() (string, string, string) { return server.URL, "user", passkey })
	server.Close()
	_, err := c.OpenTorrent(context.Background(), "972366")
	if err == nil {
		t.Fatal("expected a transport failure")
	}
	if strings.Contains(err.Error(), passkey) {
		t.Fatalf("error leaks the FileList passkey: %v", err)
	}
	if !strings.Contains(err.Error(), "FileList") {
		t.Fatalf("error must still name the provider: %v", err)
	}
}
