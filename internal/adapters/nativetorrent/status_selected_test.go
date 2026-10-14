package nativetorrent

import (
	"bytes"
	"testing"
)

// With a selection inside a multi-file torrent, Status reports bytes and ETA
// over the selected set, the way qBittorrent does, not over the whole torrent.
func TestStatusBytesDescribeTheSelectedSet(t *testing.T) {
	root := seedContent(t)
	_, raw := buildTestMetainfo(t, root)
	c := newTestClient(t)
	hash, err := c.Add(t.Context(), bytes.NewReader(raw), "")
	if err != nil {
		t.Fatal(err)
	}
	files, err := c.Files(t.Context(), hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 2 {
		t.Skip("fixture torrent has a single file")
	}
	c.mu.Lock()
	c.selected[hash] = []int{files[0].Index}
	c.mu.Unlock()
	st, err := c.Status(t.Context(), hash)
	if err != nil {
		t.Fatal(err)
	}
	if st.TotalBytes != files[0].SizeBytes {
		t.Fatalf("TotalBytes = %d, want the selected file's %d", st.TotalBytes, files[0].SizeBytes)
	}
}
