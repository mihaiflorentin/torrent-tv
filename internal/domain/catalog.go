package domain

import (
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type MediaKind string

const (
	MediaMovie  MediaKind = "movie"
	MediaSeries MediaKind = "series"
)

type ParsedRelease struct {
	Title        string    `json:"title"`
	SortTitle    string    `json:"sortTitle"`
	Kind         MediaKind `json:"kind"`
	Year         int       `json:"year,omitempty"`
	SeasonStart  int       `json:"seasonStart,omitempty"`
	SeasonEnd    int       `json:"seasonEnd,omitempty"`
	EpisodeStart int       `json:"episodeStart,omitempty"`
	EpisodeEnd   int       `json:"episodeEnd,omitempty"`
	EpisodeTitle string    `json:"episodeTitle,omitempty"`
	Resolution   string    `json:"resolution,omitempty"`
	Quality      string    `json:"quality,omitempty"`
	VideoCodec   string    `json:"videoCodec,omitempty"`
	Audio        string    `json:"audio,omitempty"`
	HDR          string    `json:"hdr,omitempty"`
	Edition      string    `json:"edition,omitempty"`
	ReleaseGroup string    `json:"releaseGroup,omitempty"`
}

type CatalogSource struct {
	Release TorrentRelease `json:"release"`
	Parsed  ParsedRelease  `json:"parsed"`
	// TitleID is the canonical projection this release belongs to. Internal
	// projection field; consumers decide whether to expose it.
	TitleID       string     `json:"titleId,omitempty"`
	FileIndex     *int       `json:"fileIndex,omitempty"`
	FilePath      string     `json:"filePath,omitempty"`
	FileSizeBytes int64      `json:"fileSizeBytes,omitempty"`
	LibraryState  MediaState `json:"libraryState"`
}

type MediaState struct {
	DownloadState string  `json:"downloadState"`
	TransferState string  `json:"transferState,omitempty"`
	WatchState    string  `json:"watchState"`
	DownloadID    string  `json:"downloadId,omitempty"`
	Progress      float64 `json:"progress,omitempty"`
	PositionMS    int64   `json:"positionMs,omitempty"`
	DurationMS    int64   `json:"durationMs,omitempty"`
}

type CatalogTitle struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	OriginalTitle    string          `json:"originalTitle,omitempty"`
	Kind             MediaKind       `json:"kind"`
	Year             int             `json:"year,omitempty"`
	ReleaseDate      string          `json:"releaseDate,omitempty"`
	IMDbID           string          `json:"imdbId,omitempty"`
	Overview         string          `json:"overview,omitempty"`
	PosterURL        string          `json:"posterUrl,omitempty"`
	BackdropURL      string          `json:"backdropUrl,omitempty"`
	Trackers         []TrackerRef    `json:"trackers"`
	Categories       []string        `json:"categories"`
	Resolutions      []string        `json:"resolutions"`
	SourceCount      int             `json:"sourceCount"`
	SeasonCount      int             `json:"seasonCount,omitempty"`
	EpisodeCount     int             `json:"episodeCount,omitempty"`
	BestSeeders      int             `json:"bestSeeders"`
	LargestSizeBytes int64           `json:"largestSizeBytes"`
	NewestUpload     *time.Time      `json:"newestUpload,omitempty"`
	Rating           float64         `json:"rating,omitempty"`
	RatingVotes      int             `json:"ratingVotes,omitempty"`
	RatingProvider   string          `json:"ratingProvider,omitempty"`
	Genres           []string        `json:"genres,omitempty"`
	Sources          []CatalogSource `json:"sources,omitempty"`
	LibraryState     MediaState      `json:"libraryState"`
}

type CatalogQuery struct {
	Search     string
	Category   string
	TrackerIDs []string
	Kind       MediaKind
	Resolution string
	HDR        string
	Quality    string
	Codec      string
	MinSeeders int
	Freeleech  *bool
	Internal   *bool
	Moderated  *bool
	Sort       string
	Limit      int
	Offset     int
}

type CatalogSeason struct {
	Number       int              `json:"number"`
	Title        string           `json:"title"`
	EpisodeCount int              `json:"episodeCount"`
	Episodes     []CatalogEpisode `json:"episodes"`
	// Unknown holds playable files that fit no provider episode; nil when
	// no provider structure is in play.
	Unknown      []CatalogEpisode `json:"unknown,omitempty"`
	PackSources  []CatalogSource  `json:"packSources,omitempty"`
	LibraryState MediaState       `json:"libraryState"`
}

type CatalogEpisode struct {
	Number       int             `json:"number"`
	Title        string          `json:"title"`
	Season       int             `json:"season"`
	AirDate      string          `json:"airDate,omitempty"`
	SourceCount  int             `json:"sourceCount"`
	Sources      []CatalogSource `json:"sources,omitempty"`
	LibraryState MediaState      `json:"libraryState"`
}

type CatalogDetail struct {
	Title   CatalogTitle    `json:"title"`
	Seasons []CatalogSeason `json:"seasons"`
	Sources []CatalogSource `json:"sources"`
}

type CatalogFacets struct {
	Categories  []string `json:"categories"`
	Kinds       []string `json:"kinds"`
	Resolutions []string `json:"resolutions"`
	HDR         []string `json:"hdr"`
	Qualities   []string `json:"qualities"`
	Codecs      []string `json:"codecs"`
}

// CatalogMetadata is the cached provider match for a title. Kind is the media
// kind the provider actually matched (it can differ from the kind parsed from
// release names and selects the provider endpoint for extended details);
// ReleaseDate is the full YYYY-MM-DD premiere (first air date for series)
// when the provider published one.
type CatalogMetadata struct {
	TitleID        string    `json:"titleId"`
	Provider       string    `json:"provider"`
	ProviderID     string    `json:"providerId,omitempty"`
	Title          string    `json:"title,omitempty"`
	OriginalTitle  string    `json:"originalTitle,omitempty"`
	Overview       string    `json:"overview,omitempty"`
	PosterPath     string    `json:"-"`
	BackdropPath   string    `json:"-"`
	Language       string    `json:"language,omitempty"`
	Rating         float64   `json:"rating,omitempty"`
	RatingVotes    int       `json:"ratingVotes,omitempty"`
	RatingProvider string    `json:"ratingProvider,omitempty"`
	Year           int       `json:"year,omitempty"`
	ReleaseDate    string    `json:"releaseDate,omitempty"`
	Kind           MediaKind `json:"-"`
	Genres         []string  `json:"genres,omitempty"`
	FetchedAt      time.Time `json:"fetchedAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
	LastError      string    `json:"-"`
}

// TitleInfo is the extended, display-ready description of a title shown by the
// Info panel: story, dates, credits and a few facts. Every field except
// TitleID may be empty because providers differ in what they publish; clients
// render what is present. Cached per (provider, providerId, kind, language).
type TitleInfo struct {
	TitleID          string      `json:"titleId"`
	Provider         string      `json:"provider,omitempty"`
	ProviderID       string      `json:"providerId,omitempty"`
	Kind             MediaKind   `json:"kind,omitempty"`
	Language         string      `json:"language,omitempty"`
	Tagline          string      `json:"tagline,omitempty"`
	Overview         string      `json:"overview,omitempty"`
	ReleaseDate      string      `json:"releaseDate,omitempty"`
	LastAirDate      string      `json:"lastAirDate,omitempty"`
	Status           string      `json:"status,omitempty"`
	RuntimeMinutes   int         `json:"runtimeMinutes,omitempty"`
	Rating           float64     `json:"rating,omitempty"`
	RatingVotes      int         `json:"ratingVotes,omitempty"`
	RatingProvider   string      `json:"ratingProvider,omitempty"`
	Genres           []string    `json:"genres,omitempty"`
	Cast             []CastEntry `json:"cast,omitempty"`
	Directors        []string    `json:"directors,omitempty"`
	Creators         []string    `json:"creators,omitempty"`
	Countries        []string    `json:"countries,omitempty"`
	OriginalLanguage string      `json:"originalLanguage,omitempty"`
	Seasons          int         `json:"seasons,omitempty"`
	Episodes         int         `json:"episodes,omitempty"`
	Certification    string      `json:"certification,omitempty"`
	// Available is false when no provider could describe the title, which is
	// a normal state rather than an error.
	Available bool      `json:"available"`
	FetchedAt time.Time `json:"fetchedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// CastEntry is one top-billed performer. ImagePath is the provider-relative
// profile image and is never exposed; ImageURL is the local proxy address the
// service assigns when a photo exists.
type CastEntry struct {
	Name      string `json:"name"`
	Character string `json:"character,omitempty"`
	ImageURL  string `json:"imageUrl,omitempty"`
	ImagePath string `json:"imagePath,omitempty"`
}

// MaxCastEntries bounds the cast list a provider adapter returns.
const MaxCastEntries = 12

// SeriesSeasons is the provider canonical season/episode structure for a
// series, cached per (provider, providerId, language).
type SeriesSeasons struct {
	Provider   string         `json:"provider"`
	ProviderID string         `json:"providerId"`
	Language   string         `json:"language"`
	Genres     []string       `json:"genres,omitempty"`
	Seasons    []SeriesSeason `json:"seasons"`
	FetchedAt  time.Time      `json:"fetchedAt"`
	ExpiresAt  time.Time      `json:"expiresAt"`
}

// SeriesSeason is one provider season with its episode list.
type SeriesSeason struct {
	Number       int             `json:"number"`
	Name         string          `json:"name"`
	EpisodeCount int             `json:"episodeCount"`
	Episodes     []SeriesEpisode `json:"episodes"`
}

// SeriesEpisode is one provider episode entry.
type SeriesEpisode struct {
	Number  int    `json:"number"`
	Name    string `json:"name"`
	AirDate string `json:"airDate,omitempty"`
}

var (
	episodeRE    = regexp.MustCompile(`(?i)(?:^|[ ._\-])S(\d{1,2})[ ._\-]?E(\d{1,3})(?:[ ._\-]?E(\d{1,3}))?(?:[ ._\-]|$)`)
	episodeAltRE = regexp.MustCompile(`(?i)(?:^|[ ._\-])(\d{1,2})x(\d{1,3})(?:[ ._\-]|$)`)
	seasonRE     = regexp.MustCompile(`(?i)(?:^|[ ._\-])S(\d{1,2})(?:\s*[-–]\s*S(\d{1,2}))?(?:[ ._\-]|$)`)
	seasonWordRE = regexp.MustCompile(`(?i)(?:^|[ ._\-])(?:season|sezonul)\s*(\d{1,2})(?:\s*[-–]\s*(?:season|sezonul)?\s*(\d{1,2}))?(?:[ ._\-\[]|$)`)
	leadingGroup = regexp.MustCompile(`^\[([^\]]{2,40})\]\s*`)
	yearRE       = regexp.MustCompile(`(?:^|[ ._\-(])(19\d{2}|20\d{2})(?:[ ._\-)]|$)`)
	resolutionRE = regexp.MustCompile(`(?i)(?:^|[ ._\-\[])(2160p|1080p|1080i|720p|576p|480p|4k|uhd)(?:[ ._\-\]]|$)`)
	releaseExtRE = regexp.MustCompile(`(?i)\.(mkv|mp4|avi|m4v|mov|ts|wmv|srt)$`)
)

// ParseRelease converts tracker naming conventions into stable, display-ready
// fields. It deliberately treats the tracker category only as a weak hint.
func ParseRelease(release TorrentRelease) ParsedRelease {
	name := strings.TrimSpace(release.Name)
	p := ParsedRelease{Kind: MediaMovie}
	if group := leadingGroup.FindStringSubmatch(name); len(group) > 1 {
		p.ReleaseGroup = strings.TrimSpace(group[1])
		name = strings.TrimSpace(name[len(group[0]):])
	}
	boundary := len(name)

	if m := episodeRE.FindStringSubmatchIndex(name); m != nil {
		p.Kind = MediaSeries
		p.SeasonStart, _ = strconv.Atoi(name[m[2]:m[3]])
		p.SeasonEnd = p.SeasonStart
		p.EpisodeStart, _ = strconv.Atoi(name[m[4]:m[5]])
		p.EpisodeEnd = p.EpisodeStart
		if m[6] >= 0 {
			if end, _ := strconv.Atoi(name[m[6]:m[7]]); end > p.EpisodeStart {
				p.EpisodeEnd = end
			}
		}
		boundary = m[0]
		p.EpisodeTitle = cleanEpisodeTitle(name[m[1]:])
	} else if m := episodeAltRE.FindStringSubmatchIndex(name); m != nil {
		p.Kind = MediaSeries
		p.SeasonStart, _ = strconv.Atoi(name[m[2]:m[3]])
		p.SeasonEnd = p.SeasonStart
		p.EpisodeStart, _ = strconv.Atoi(name[m[4]:m[5]])
		p.EpisodeEnd = p.EpisodeStart
		boundary = m[0]
		p.EpisodeTitle = cleanEpisodeTitle(name[m[1]:])
	} else if m := seasonRE.FindStringSubmatchIndex(name); m != nil {
		p.Kind = MediaSeries
		p.SeasonStart, _ = strconv.Atoi(name[m[2]:m[3]])
		p.SeasonEnd = p.SeasonStart
		if m[4] >= 0 {
			p.SeasonEnd, _ = strconv.Atoi(name[m[4]:m[5]])
		}
		boundary = m[0]
	} else if m := seasonWordRE.FindStringSubmatchIndex(name); m != nil {
		p.Kind = MediaSeries
		p.SeasonStart, _ = strconv.Atoi(name[m[2]:m[3]])
		p.SeasonEnd = p.SeasonStart
		if m[4] >= 0 {
			p.SeasonEnd, _ = strconv.Atoi(name[m[4]:m[5]])
		}
		boundary = m[0]
	}

	if start, year := releaseYear(name); year > 0 {
		p.Year = year
		if start < boundary {
			boundary = start
		}
	}
	titleEnd := boundary
	if boundary == len(name) {
		boundary = firstTechnicalToken(name)
	}
	p.Title = cleanTitle(name[:boundary])
	if p.Title == "" {
		p.Title = cleanTitle(name)
	}
	p.SortTitle = normalizeTitle(p.Title)

	if m := resolutionRE.FindStringSubmatch(name); len(m) > 1 {
		p.Resolution = strings.ToUpper(m[1])
		if p.Resolution == "4K" || p.Resolution == "UHD" {
			p.Resolution = "2160p"
		} else {
			p.Resolution = strings.ToLower(p.Resolution)
		}
	}
	// Technical tags are read from the part after the title only, as whole
	// tokens: "HDRip" is not HDR and the title "Atmosphere" is not Atmos.
	// With no episode marker or year, the tags start at the first technical
	// token instead.
	techStart := titleEnd
	if techStart == len(name) {
		techStart = boundary
	}
	upper := strings.ToUpper(name[techStart:])
	p.Quality = firstMatch(upper, []string{"REMUX", "BLU-RAY", "BLURAY", "WEB-DL", "WEBRIP", "HDTV", "DVDRIP"})
	p.VideoCodec = firstMatch(upper, []string{"AV1", "H.265", "H265", "HEVC", "X265", "H.264", "H264", "X264", "XVID"})
	p.Audio = firstMatch(upper, []string{"TRUEHD", "ATMOS", "DTS-HD", "DTS", "EAC3", "DDP", "AC3", "AAC", "FLAC"})
	p.HDR = firstMatch(upper, []string{"DOLBY VISION", "DOVI", "HDR10+", "HDR10", "HDR"})
	p.Edition = firstMatch(upper, []string{"DIRECTOR'S CUT", "EXTENDED", "REMASTERED", "REPACK", "PROPER"})
	if p.ReleaseGroup == "" {
		p.ReleaseGroup = trailingReleaseGroup(name)
	}
	return p
}

// releaseYear picks the release year: the last year token before the first
// technical token. Numeric title words ("Blade.Runner.2049.2017") lose to the
// real year, and a year at the very start is the title ("1917.2019").
func releaseYear(name string) (start, year int) {
	limit := len(name)
	if i := firstTechnicalToken(name); i < limit {
		limit = i
	}
	if m := resolutionRE.FindStringIndex(name); m != nil && m[0] < limit {
		limit = m[0]
	}
	for pos := 0; pos < len(name); {
		m := yearRE.FindStringSubmatchIndex(name[pos:])
		if m == nil {
			break
		}
		yearStart, yearEnd := pos+m[2], pos+m[3]
		if yearStart >= limit {
			break
		}
		matchStart := pos + m[0]
		// Scanning resumes on the separator so adjacent years both match.
		pos = yearEnd
		if yearStart == 0 {
			continue
		}
		start = matchStart
		year, _ = strconv.Atoi(name[yearStart:yearEnd])
	}
	return start, year
}

// trailingReleaseGroup reads the scene-style "-GROUP" suffix, ignoring file
// extensions and hyphenated tags such as WEB-DL, Blu-ray and DTS-HD.
func trailingReleaseGroup(name string) string {
	name = releaseExtRE.ReplaceAllString(name, "")
	i := strings.LastIndex(name, "-")
	if i < 0 || i == len(name)-1 {
		return ""
	}
	group := name[i+1:]
	if len(group) < 2 || len(group) > 30 || strings.ContainsAny(group, " .") {
		return ""
	}
	before := strings.ToUpper(name[:i])
	switch strings.ToUpper(group) {
	case "DL", "RAY", "HD", "MA", "HDMA", "X", "RIP":
		for _, tag := range []string{"WEB", "BLU", "DTS", "DD", "HDTV", "DVD"} {
			if strings.HasSuffix(before, tag) {
				return ""
			}
		}
	}
	return group
}

func CatalogTitleID(release TorrentRelease, parsed ParsedRelease) string {
	key := string(parsed.Kind) + "\x00" + parsed.SortTitle + "\x00" + strconv.Itoa(parsed.Year)
	if release.IMDbID != "" {
		key = string(parsed.Kind) + "\x00imdb:" + strings.ToLower(release.IMDbID)
	}
	sum := sha256.Sum256([]byte(key))
	return base64.RawURLEncoding.EncodeToString(sum[:15])
}

// CandidateAnchor represents an IMDb-backed identity within a family.
type CandidateAnchor struct {
	IMDbID      string
	CanonicalID string       // base64url SHA256 hash from CatalogTitleID
	KnownYears  map[int]bool // parsed release years from anchor releases
}

// ReleaseEvidence is the per-release identity evidence used by canonical resolution.
type ReleaseEvidence struct {
	ReleaseID string
	Title     string
	SortTitle string
	IMDbID    string // raw provider fact; "" when absent
	Year      int    // parsed release year; 0 when absent
}

// ResolveFamilyTitleIDs returns the canonical title id (a real CatalogTitleID
// base64url hash) for every release in one (media kind, normalized sort title)
// family. Pure, deterministic, order-independent.
func ResolveFamilyTitleIDs(kind MediaKind, sortTitle string, evidence []ReleaseEvidence) map[string]string {
	anchors := make([]CandidateAnchor, 0, 4)
	anchorIndex := make(map[string]int) // lowercased IMDbID -> anchors index
	results := make(map[string]string, len(evidence))

	// Pass 1: explicit IMDb identity is authoritative; distinct IDs never merge.
	for _, ev := range evidence {
		id := strings.ToLower(strings.TrimSpace(ev.IMDbID))
		if id == "" {
			continue
		}
		idx, ok := anchorIndex[id]
		if !ok {
			idx = len(anchors)
			anchorIndex[id] = idx
			anchors = append(anchors, CandidateAnchor{
				IMDbID:      id,
				CanonicalID: CatalogTitleID(TorrentRelease{IMDbID: id}, ParsedRelease{Kind: kind, Title: ev.Title, SortTitle: sortTitle}),
				KnownYears:  map[int]bool{},
			})
		}
		if ev.Year > 0 {
			anchors[idx].KnownYears[ev.Year] = true
		}
		results[ev.ReleaseID] = anchors[idx].CanonicalID
	}

	// Pass 2: missing-IMDb releases join an anchor only under conservative,
	// unambiguous conditions; otherwise they keep their evidence fallback.
	for _, ev := range evidence {
		if strings.TrimSpace(ev.IMDbID) != "" {
			continue
		}
		switch {
		case kind == MediaSeries:
			if len(anchors) == 1 {
				results[ev.ReleaseID] = anchors[0].CanonicalID
			}
		case ev.Year > 0:
			var match *CandidateAnchor
			for i := range anchors {
				a := &anchors[i]
				if len(a.KnownYears) == 0 || a.KnownYears[ev.Year] {
					if match != nil {
						match = nil
						break
					}
					match = a
				}
			}
			if match != nil {
				results[ev.ReleaseID] = match.CanonicalID
			}
		default: // movie, year 0
			if len(anchors) == 1 {
				results[ev.ReleaseID] = anchors[0].CanonicalID
			}
		}
		if results[ev.ReleaseID] == "" {
			results[ev.ReleaseID] = CatalogTitleID(TorrentRelease{}, ParsedRelease{Kind: kind, Title: ev.Title, SortTitle: sortTitle, Year: ev.Year})
		}
	}
	return results
}

func cleanTitle(v string) string {
	v = strings.Trim(v, " ._-()[]")
	v = strings.NewReplacer(".", " ", "_", " ").Replace(v)
	return strings.Join(strings.Fields(v), " ")
}

func normalizeTitle(v string) string {
	v = strings.ToLower(v)
	var b strings.Builder
	space := false
	for _, r := range v {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
		} else if !space {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

func cleanEpisodeTitle(v string) string {
	end := firstTechnicalToken(v)
	return cleanTitle(v[:end])
}

func firstTechnicalToken(v string) int {
	// Underscore-separated names tokenise like dotted ones; the swap keeps
	// every byte offset intact.
	upper := strings.ToUpper(strings.ReplaceAll(v, "_", "."))
	tokens := []string{"2160P", "1080P", "1080I", "720P", "576P", "480P", "WEB-DL", "WEBRIP", "BLURAY", "BLU-RAY", "HDTV", "DVDRIP", "REMUX"}
	best := len(v)
	for _, token := range tokens {
		for _, sep := range []string{".", " "} {
			if i := strings.Index(upper, sep+token); i >= 0 && i < best {
				best = i
			}
		}
	}
	return best
}

// firstMatch returns the first value present as a whole token: not glued to a
// preceding letter or digit, nor to a following letter (digits may follow, as
// in DDP5.1 and AAC2.0).
func firstMatch(upper string, values []string) string {
	for _, value := range values {
		for from := 0; from < len(upper); {
			i := strings.Index(upper[from:], value)
			if i < 0 {
				break
			}
			i += from
			end := i + len(value)
			beforeOK := i == 0 || !isAlnum(upper[i-1])
			afterOK := end == len(upper) || !isLetter(upper[end])
			if beforeOK && afterOK {
				return value
			}
			from = i + 1
		}
	}
	return ""
}

func isLetter(b byte) bool { return b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' }
func isAlnum(b byte) bool  { return isLetter(b) || b >= '0' && b <= '9' }
