package domain

import (
	"testing"
	"time"
)

func TestFamilyForCategoryMapsEveryKnownTrackerCategory(t *testing.T) {
	cases := map[string]string{
		"Movies": "movies", "HD Movies": "movies", "Movies HD": "movies", "Movies SD": "movies",
		"Movies DVD": "movies", "Movies DVDR": "movies", "Movies Blu-Ray": "movies", "Movies 3D": "movies", "3D": "movies",
		"HD TV-Shows": "series", "TV-Shows": "series", "TV-Series HD": "series", "TV-Series SD": "series", "K-Drama": "series",
		"Movies 4K": "uhd", "Movies 4K Blu-Ray": "uhd", "TV-Series 4K": "uhd", "UHD/4k Movies": "uhd", "UHD/4k TV-Shows": "uhd",
		"Anime":         "anime",
		"Cartoons":      "kids",
		"Movies DVD-RO": "romanian", "Movies HD-RO": "romanian", "RO Dubbed": "romanian",
		"Sport": "docs-sport", "Documentaries": "docs-sport",
		"Music videos": "music-videos", "Videoclips": "music-videos",
		"Other Video": "other", "Movie Clips": "other", "Handheld": "other", "Something New": "other",
	}
	for name, want := range cases {
		got, ok := FamilyForCategory(name)
		if !ok || got != want {
			t.Errorf("FamilyForCategory(%q) = %q, %v; want %q", name, got, ok, want)
		}
	}
}

func TestFamilyForCategoryHidesAudioAndCam(t *testing.T) {
	for _, name := range []string{"FLAC", "Audio Books", "Sound clips", "Other Audio", "Music", "CAM/TS", "cam/ts", "XXX", "Games PC", "Apps", ""} {
		if key, ok := FamilyForCategory(name); ok {
			t.Errorf("FamilyForCategory(%q) = %q; want hidden", name, key)
		}
	}
}

func TestFamilyForCategoryIgnoresCaseAndSpacing(t *testing.T) {
	if key, ok := FamilyForCategory("  movies 4k "); !ok || key != "uhd" {
		t.Fatalf("got %q, %v", key, ok)
	}
}

func TestFamilyListIsOrderedAndComplete(t *testing.T) {
	want := []string{"movies", "series", "uhd", "anime", "kids", "romanian", "docs-sport", "music-videos", "other"}
	if len(CategoryFamilies) != len(want) {
		t.Fatalf("families = %d", len(CategoryFamilies))
	}
	for i, key := range want {
		if CategoryFamilies[i].Key != key || CategoryFamilies[i].Name == "" {
			t.Fatalf("family %d = %+v; want key %s", i, CategoryFamilies[i], key)
		}
		if _, ok := CategoryFamilyByKey(key); !ok {
			t.Fatalf("lookup %s failed", key)
		}
	}
	if _, ok := CategoryFamilyByKey("nope"); ok {
		t.Fatal("unknown key resolved")
	}
}

func TestArtQuarterChangesOnQuarterBoundaries(t *testing.T) {
	at := func(m time.Month, d int) string { return ArtQuarter(time.Date(2026, m, d, 12, 0, 0, 0, time.UTC)) }
	if at(time.March, 31) != "2026-Q1" || at(time.April, 1) != "2026-Q2" || at(time.June, 30) != "2026-Q2" ||
		at(time.July, 1) != "2026-Q3" || at(time.October, 1) != "2026-Q4" || at(time.December, 31) != "2026-Q4" {
		t.Fatal("quarter boundaries are wrong")
	}
	if ArtQuarter(time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)) != "2027-Q1" {
		t.Fatal("year rollover")
	}
}

func TestPickFamilyArtIsDeterministicAndRotates(t *testing.T) {
	candidates := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	first, ok := PickFamilyArt("movies", "2026-Q4", candidates)
	if !ok {
		t.Fatal("no pick")
	}
	for i := 0; i < 20; i++ {
		if again, _ := PickFamilyArt("movies", "2026-Q4", candidates); again != first {
			t.Fatalf("pick changed: %s vs %s", again, first)
		}
	}
	seen := map[string]bool{}
	for _, q := range []string{"2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"} {
		pick, _ := PickFamilyArt("movies", q, candidates)
		seen[pick] = true
	}
	if len(seen) < 3 {
		t.Fatalf("rotation too static: %v", seen)
	}
	if _, ok := PickFamilyArt("movies", "2026-Q4", nil); ok {
		t.Fatal("empty candidates must not pick")
	}
}
