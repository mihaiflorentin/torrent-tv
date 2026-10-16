package domain

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// CategoryFamily is a household-facing grouping of tracker Categories that
// mean the same kind of video. The mapping lives here, once, so every client
// shows the same families.
type CategoryFamily struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// CategoryFamilies is the display order of the families.
var CategoryFamilies = []CategoryFamily{
	{"movies", "Movies"},
	{"series", "Series"},
	{"uhd", "4K & UHD"},
	{"anime", "Anime"},
	{"kids", "Animation & Kids"},
	{"romanian", "Romanian"},
	{"docs-sport", "Documentaries & Sport"},
	{"music-videos", "Music videos"},
	{"other", "Other"},
}

func CategoryFamilyByKey(key string) (CategoryFamily, bool) {
	for _, f := range CategoryFamilies {
		if f.Key == key {
			return f, true
		}
	}
	return CategoryFamily{}, false
}

var (
	hiddenCategory   = regexp.MustCompile(`flac|audio|sound|\bmusic\b|\bmp3\b|^cam\b|\bcam/ts\b|\bts\b|telesync|\bxxx\b`)
	romanianCategory = regexp.MustCompile(`(^|[\s-])ro($|[\s-])`)
	uhdCategory      = regexp.MustCompile(`4k|uhd|2160`)
	seriesCategory   = regexp.MustCompile(`tv-|tv |series|shows|drama`)
	moviesCategory   = regexp.MustCompile(`movie|dvd|blu-?ray|^3d$|\b3d\b`)
)

// FamilyForCategory maps a raw tracker category to its Category family by
// pattern, so categories the tracker adds later land sensibly: unknown video
// goes to "other". Audio-only categories, CAM/TS and categories the catalog
// hides by default belong to no family (ok is false).
func FamilyForCategory(name string) (key string, ok bool) {
	n := strings.ToLower(strings.Join(strings.Fields(name), " "))
	if n == "" || DefaultBlacklistedCategory(n) {
		return "", false
	}
	switch {
	case strings.Contains(n, "videoclip") || strings.Contains(n, "music video"):
		return "music-videos", true
	case hiddenCategory.MatchString(n):
		return "", false
	case strings.Contains(n, "anime"):
		return "anime", true
	case strings.Contains(n, "cartoon") || strings.Contains(n, "kids"):
		return "kids", true
	case romanianCategory.MatchString(n):
		return "romanian", true
	case uhdCategory.MatchString(n):
		return "uhd", true
	case strings.Contains(n, "clip"):
		return "other", true
	case seriesCategory.MatchString(n):
		return "series", true
	case moviesCategory.MatchString(n):
		return "movies", true
	case n == "sport" || strings.Contains(n, "sport") || strings.Contains(n, "doc"):
		return "docs-sport", true
	}
	return "other", true
}

// ArtQuarter names the calendar quarter of t (UTC), e.g. "2026-Q4". Family art
// rotates when it changes.
func ArtQuarter(t time.Time) string {
	t = t.UTC()
	return fmt.Sprintf("%d-Q%d", t.Year(), (int(t.Month())-1)/3+1)
}

// PickFamilyArt chooses one candidate for a family and quarter. The choice is
// a pure function of (quarter, family, candidate list), so every device the
// server answers sees the same image for the whole quarter.
func PickFamilyArt(familyKey, quarter string, candidates []string) (string, bool) {
	if len(candidates) == 0 {
		return "", false
	}
	sum := sha256.Sum256([]byte(quarter + "\x00" + familyKey))
	return candidates[binary.BigEndian.Uint64(sum[:8])%uint64(len(candidates))], true
}

// FamilyArt describes the image of a family tile. Source is "catalog" (a
// title's artwork served by the artwork proxy) or "bundled" (the family's own
// designed artwork).
type FamilyArt struct {
	URL     string `json:"url"`
	Source  string `json:"source"`
	TitleID string `json:"titleId,omitempty"`
}

// FamilySummary is one tile on a Categories page.
type FamilySummary struct {
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Count       int       `json:"count"`
	NewestTitle string    `json:"newestTitle,omitempty"`
	NewestID    string    `json:"newestTitleId,omitempty"`
	Categories  []string  `json:"categories"`
	Art         FamilyArt `json:"art"`
}

// BundledFamilyArtURL is where the server serves a family's designed artwork.
func BundledFamilyArtURL(key string) string {
	return "/api/v1/catalog/families/" + key + "/art.svg"
}
