package domain

import "testing"

func TestParseReleaseTechnicalTagsWithoutEpisodeOrYear(t *testing.T) {
	tests := []struct {
		name, title, quality, codec string
	}{
		{"Some.Movie.1080p.WEB-DL.x264-GRP", "Some Movie", "WEB-DL", "X264"},
		{"Some.Show.1080p.HDTV.x264-GRP", "Some Show", "HDTV", "X264"},
		{"Some Movie 720p BluRay HEVC", "Some Movie", "BLURAY", "HEVC"},
	}
	for _, tt := range tests {
		p := ParseRelease(TorrentRelease{Name: tt.name})
		if p.Title != tt.title || p.Quality != tt.quality || p.VideoCodec != tt.codec {
			t.Errorf("ParseRelease(%q) = title %q quality %q codec %q, want %q %q %q", tt.name, p.Title, p.Quality, p.VideoCodec, tt.title, tt.quality, tt.codec)
		}
	}
}
