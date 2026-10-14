package domain

import "testing"

func TestParseReleaseYearIsTheReleaseYearNotATitleNumber(t *testing.T) {
	tests := []struct {
		name, title string
		year        int
	}{
		{"Blade.Runner.2049.2017.1080p.BluRay.x264-GRP", "Blade Runner 2049", 2017},
		{"Wonder.Woman.1984.2020.1080p.WEB-DL", "Wonder Woman 1984", 2020},
		{"1917.2019.1080p.BluRay.x264-GRP", "1917", 2019},
		{"Severance.2022.1080p.BluRay.x265", "Severance", 2022},
		{"Movie (2010) 720p BluRay", "Movie", 2010},
	}
	for _, tt := range tests {
		p := ParseRelease(TorrentRelease{Name: tt.name})
		if p.Title != tt.title || p.Year != tt.year {
			t.Errorf("ParseRelease(%q) title=%q year=%d, want %q %d", tt.name, p.Title, p.Year, tt.title, tt.year)
		}
	}
}

func TestParseReleaseGroup(t *testing.T) {
	tests := []struct{ name, group string }{
		{"Show.S01E01.1080p.WEB-DL", ""},
		{"Show.S01E01.1080p.WEB-DL-GRP", "GRP"},
		{"Movie.2020.1080p.BluRay.x264-GRP.mkv", "GRP"},
		{"Movie.2020.1080p.Blu-ray", ""},
		{"Movie.2020.1080p.BluRay.DTS-HD", ""},
		{"Movie.2020.1080p.BluRay.DTS-HD.MA.5.1.x264-GRP", "GRP"},
		{"Movie.2020.1080p.BluRay.x264", ""},
	}
	for _, tt := range tests {
		if got := ParseRelease(TorrentRelease{Name: tt.name}).ReleaseGroup; got != tt.group {
			t.Errorf("ParseRelease(%q).ReleaseGroup = %q, want %q", tt.name, got, tt.group)
		}
	}
}

func TestParseReleaseTechnicalTagsMatchWholeTokens(t *testing.T) {
	hdrip := ParseRelease(TorrentRelease{Name: "Movie.2020.1080p.HDRip.x264-GRP"})
	if hdrip.HDR != "" {
		t.Errorf("HDRip is not HDR, got %q", hdrip.HDR)
	}
	atmosphere := ParseRelease(TorrentRelease{Name: "Atmosphere.2020.1080p.WEB-DL.AAC2.0"})
	if atmosphere.Audio != "AAC" {
		t.Errorf("title word Atmosphere must not set audio, got %q", atmosphere.Audio)
	}
	improper := ParseRelease(TorrentRelease{Name: "Improper.Conduct.1994.1080p.BluRay"})
	if improper.Edition != "" {
		t.Errorf("title word Improper must not set edition, got %q", improper.Edition)
	}
	real := ParseRelease(TorrentRelease{Name: "Movie.2020.2160p.WEB-DL.DDP5.1.Atmos.HDR10.H.265.PROPER-GRP"})
	if real.HDR != "HDR10" || real.Audio != "ATMOS" || real.Edition != "PROPER" || real.VideoCodec != "H.265" || real.Quality != "WEB-DL" {
		t.Errorf("real tags lost: %+v", real)
	}
	hdr := ParseRelease(TorrentRelease{Name: "Movie.2020.2160p.BluRay.HDR.x265-GRP"})
	if hdr.HDR != "HDR" {
		t.Errorf("plain HDR token lost, got %q", hdr.HDR)
	}
}

func TestParseReleaseMultiEpisode(t *testing.T) {
	for _, name := range []string{"Show.S01E01E02.1080p.WEB-DL", "Show.S01E01-E02.1080p.WEB-DL"} {
		p := ParseRelease(TorrentRelease{Name: name})
		if p.Kind != MediaSeries || p.SeasonStart != 1 || p.EpisodeStart != 1 || p.EpisodeEnd != 2 || p.Title != "Show" {
			t.Errorf("ParseRelease(%q) = %+v", name, p)
		}
	}
}

func TestParseReleaseUnderscoreSeparatedNames(t *testing.T) {
	p := ParseRelease(TorrentRelease{Name: "Movie_Name_1080p_x264"})
	if p.Title != "Movie Name" || p.Resolution != "1080p" {
		t.Errorf("underscore name parsed as %+v", p)
	}
}
