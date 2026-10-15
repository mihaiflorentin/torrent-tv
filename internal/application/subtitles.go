package application

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

const maxSubtitleSourceBytes = 10 << 20

type SubtitleSearchScope string

const (
	SubtitleScopeAll    SubtitleSearchScope = "all"
	SubtitleScopeLocal  SubtitleSearchScope = "local"
	SubtitleScopeRemote SubtitleSearchScope = "remote"
)

func ParseSubtitleSearchScope(value string) (SubtitleSearchScope, error) {
	scope := SubtitleSearchScope(strings.ToLower(strings.TrimSpace(value)))
	if scope == "" {
		return SubtitleScopeAll, nil
	}
	if scope != SubtitleScopeAll && scope != SubtitleScopeLocal && scope != SubtitleScopeRemote {
		return "", fmt.Errorf("subtitle scope must be local, remote, or all")
	}
	return scope, nil
}

func (s *Service) SearchSubtitles(ctx context.Context, downloadID, language string, scope SubtitleSearchScope) ([]domain.SubtitleCandidate, []domain.SubtitleProviderWarning, error) {
	d, err := s.repo.GetDownload(ctx, downloadID)
	if err != nil {
		return nil, nil, err
	}
	d = s.liveDownload(ctx, d)
	release, err := s.repo.GetRelease(ctx, d.ReleaseID)
	if err != nil {
		return nil, nil, err
	}
	items := make([]domain.SubtitleCandidate, 0)
	warnings := []domain.SubtitleProviderWarning{}
	settings := s.settings.Get()
	fallbackLanguage := ""
	if sameLanguage(language, settings.PreferredSubtitleLanguage) {
		fallbackLanguage = settings.FallbackSubtitleLanguage
	}
	if scope != SubtitleScopeRemote {
		engine, hash, ok := s.owner(d.EngineID)
		if !ok {
			return nil, nil, s.engineUnavailableErr(d.EngineID)
		}
		files, filesErr := engine.Files(ctx, hash)
		if filesErr != nil {
			return nil, nil, filesErr
		}
		for _, file := range files {
			if !subtitle(file.Path) {
				continue
			}
			if !episodeMatches(d.FilePath, file.Path) {
				continue
			}
			lang := subtitleLanguage(file.Path)
			if language != "" && lang != "" && !sameLanguage(language, lang) && !sameLanguage(fallbackLanguage, lang) {
				continue
			}
			score := 300.0
			if sameStem(d.FilePath, file.Path) {
				score += 50
			}
			if sameLanguage(language, lang) {
				score += 25
			}
			name := filepath.Base(file.Path)
			items = append(items, domain.SubtitleCandidate{ID: strconv.Itoa(file.Index), Provider: "contained", ProviderLabel: "Included", Language: lang, Title: name, FileName: name, ReleaseName: release.Name, Format: strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."), Description: "Included in the torrent", Score: score})
		}
	}
	// Embedded streams are read in full to be listed reliably and extracted, so
	// they are offered only once the media file is complete. A probe failure
	// must not hide included or provider subtitles.
	if scope != SubtitleScopeRemote && s.mediaProbe != nil && d.AbsolutePath != "" {
		if !completedLocalFile(d) {
			warnings = append(warnings, domain.SubtitleProviderWarning{Provider: "embedded", Message: "Embedded subtitles are available after the download completes"})
		} else {
			tracks, probeErr := s.probeSubtitles(ctx, d.AbsolutePath)
			if probeErr != nil {
				warnings = append(warnings, domain.SubtitleProviderWarning{Provider: "embedded", Message: probeErr.Error()})
			} else {
				bitmap := 0
				for _, track := range tracks {
					if track.Bitmap {
						bitmap++
						continue
					}
					lang := embeddedTrackLanguage(track)
					label := embeddedTrackLabel(track)
					items = append(items, domain.SubtitleCandidate{ID: strconv.Itoa(track.Index), Provider: "embedded", ProviderLabel: "Embedded", Language: lang, Title: embeddedTrackTitle(track, label), FileName: label, ReleaseName: release.Name, Format: track.Codec, HearingImpaired: track.HearingImpaired, Forced: track.Forced, Default: track.Default, Description: "Embedded in the media file", Score: embeddedScore(track, lang, language, fallbackLanguage)})
				}
				if bitmap > 0 {
					warnings = append(warnings, domain.SubtitleProviderWarning{Provider: "embedded", Message: fmt.Sprintf("%d picture-based subtitle track(s) (PGS, VobSub) cannot be shown and were skipped", bitmap)})
				}
			}
		}
	}
	if scope != SubtitleScopeLocal {
		query := SubtitleQuery{Release: release, MediaPath: d.FilePath, Language: language, FallbackLanguage: fallbackLanguage}
		for _, provider := range s.subtitles {
			found, searchErr := provider.Search(ctx, query)
			if searchErr != nil {
				warnings = append(warnings, domain.SubtitleProviderWarning{Provider: provider.Name(), Message: searchErr.Error()})
				continue
			}
			for i := range found {
				found[i].Provider = provider.Name()
				found[i].Language = domain.NormalizeLanguage(found[i].Language)
				found[i].Score += 100
				if sameLanguage(language, found[i].Language) {
					found[i].Score += 25
				}
				if cached, err := s.repo.HasSubtitleAsset(ctx, downloadID, found[i].Provider, found[i].ID); err == nil && cached {
					found[i].Cached = true
				}
			}
			items = append(items, found...)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Score > items[j].Score })
	return items, warnings, nil
}

func (s *Service) TestSubtitleProvider(ctx context.Context, name string) (string, error) {
	for _, provider := range s.subtitles {
		if provider.Name() == name {
			return provider.Test(ctx)
		}
	}
	return "", fmt.Errorf("unknown subtitle provider")
}

func (s *Service) PrepareSubtitle(ctx context.Context, downloadID, providerName, candidateID string, requested ...string) (domain.SubtitleAsset, error) {
	d, err := s.repo.GetDownload(ctx, downloadID)
	if err != nil {
		return domain.SubtitleAsset{}, err
	}
	d = s.liveDownload(ctx, d)
	target := "sami"
	if len(requested) > 0 && requested[0] != "" {
		target = strings.ToLower(requested[0])
	}
	if target != "vtt" {
		target = "sami"
	}
	embeddedStale := time.Time{}
	if providerName == "embedded" {
		// A track can only be demuxed from the whole file: a partial file yields
		// a truncated track, and an asset extracted before the media last
		// changed may be one, so both are refused or regenerated.
		if !completedLocalFile(d) {
			return domain.SubtitleAsset{}, fmt.Errorf("embedded subtitles are available after the download completes")
		}
		if info, statErr := os.Stat(d.AbsolutePath); statErr == nil {
			embeddedStale = info.ModTime()
		}
	}
	// One preparation per subtitle at a time: a repeated click or a second
	// player would otherwise start another full-file ffmpeg read on a busy disk
	// and then find the cache filled by the first.
	lockAny, _ := s.locks.LoadOrStore("subtitle:"+downloadID+"\x00"+providerName+"\x00"+candidateID+"\x00"+target, &sync.Mutex{})
	prepLock := lockAny.(*sync.Mutex)
	prepLock.Lock()
	defer prepLock.Unlock()
	if cached, cacheErr := s.repo.GetSubtitleAsset(ctx, downloadID, providerName, candidateID, target); cacheErr == nil && !cached.CreatedAt.Add(time.Second).Before(embeddedStale) {
		if _, statErr := os.Stat(cached.Path); statErr == nil {
			if target == "vtt" {
				restampWebVTTCuePositioning(cached.Path)
			}
			cached.LastUsedAt = time.Now().UTC()
			_ = s.repo.SaveSubtitleAsset(ctx, cached)
			return cached, nil
		}
	}
	var source SubtitleDownload
	language := ""
	if providerName == "contained" {
		index, parseErr := strconv.Atoi(candidateID)
		if parseErr != nil {
			return domain.SubtitleAsset{}, fmt.Errorf("invalid contained subtitle id")
		}
		engine, hash, ok := s.owner(d.EngineID)
		if !ok {
			return domain.SubtitleAsset{}, s.engineUnavailableErr(d.EngineID)
		}
		files, filesErr := engine.Files(ctx, hash)
		if filesErr != nil {
			return domain.SubtitleAsset{}, filesErr
		}
		status, statusErr := engine.Status(ctx, hash)
		if statusErr != nil {
			return domain.SubtitleAsset{}, statusErr
		}
		var selected *domain.TorrentFile
		for i := range files {
			if files[i].Index == index && subtitle(files[i].Path) {
				selected = &files[i]
				break
			}
		}
		if selected == nil {
			return domain.SubtitleAsset{}, fmt.Errorf("contained subtitle not found")
		}
		if selected.SizeBytes <= 0 || selected.SizeBytes > maxSubtitleSourceBytes {
			return domain.SubtitleAsset{}, fmt.Errorf("subtitle size is outside the supported range")
		}
		path, pathErr := safeQBContentPath(s.settings.Get().DownloadRoot, status, selected.Path)
		if pathErr != nil {
			return domain.SubtitleAsset{}, pathErr
		}
		subDownload := d
		subDownload.FilePath, subDownload.AbsolutePath, subDownload.FileOffset, subDownload.SizeBytes = selected.Path, path, selected.Offset, selected.SizeBytes
		path, err = s.ReadableRangePath(ctx, subDownload, 0, selected.SizeBytes)
		if err != nil {
			return domain.SubtitleAsset{}, err
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return domain.SubtitleAsset{}, readErr
		}
		language = subtitleLanguage(selected.Path)
		source = SubtitleDownload{Data: data, Format: filepath.Ext(path), Name: filepath.Base(path)}
	} else if providerName == "embedded" {
		if s.mediaProbe == nil {
			return domain.SubtitleAsset{}, fmt.Errorf("embedded subtitle extraction is unavailable")
		}
		index, parseErr := strconv.Atoi(candidateID)
		if parseErr != nil || index < 0 {
			return domain.SubtitleAsset{}, fmt.Errorf("invalid embedded subtitle id")
		}
		tracks, probeErr := s.probeSubtitles(ctx, d.AbsolutePath)
		if probeErr != nil {
			return domain.SubtitleAsset{}, fmt.Errorf("probe embedded subtitles: %w", probeErr)
		}
		var selected *domain.MediaSubtitleTrack
		for i := range tracks {
			if tracks[i].Index == index {
				selected = &tracks[i]
				break
			}
		}
		if selected == nil {
			return domain.SubtitleAsset{}, fmt.Errorf("embedded subtitle track not found")
		}
		if selected.Bitmap {
			return domain.SubtitleAsset{}, fmt.Errorf("embedded subtitle track %d is picture-based (%s) and cannot be shown", index, selected.Codec)
		}
		// The prepared asset persists the candidate's language so an
		// embedded track keeps it across restarts instead of losing it to
		// filename re-derivation.
		language = embeddedTrackLanguage(*selected)
		if err = os.MkdirAll(s.settings.Get().SubtitleCachePath, 0o750); err != nil {
			return domain.SubtitleAsset{}, err
		}
		tmp, createErr := os.CreateTemp(s.settings.Get().SubtitleCachePath, ".embedded-*.vtt")
		if createErr != nil {
			return domain.SubtitleAsset{}, createErr
		}
		tmpPath := tmp.Name()
		_ = tmp.Close()
		defer os.Remove(tmpPath)
		if err = s.mediaProbe.ExtractSubtitle(ctx, d.AbsolutePath, selected.Ordinal, tmpPath); err != nil {
			return domain.SubtitleAsset{}, err
		}
		data, readErr := os.ReadFile(tmpPath)
		if readErr != nil {
			return domain.SubtitleAsset{}, readErr
		}
		source = SubtitleDownload{Data: data, Format: ".vtt", Name: "Embedded subtitle " + candidateID + ".vtt"}
	} else {
		var provider SubtitleProvider
		for _, candidate := range s.subtitles {
			if candidate.Name() == providerName {
				provider = candidate
				break
			}
		}
		if provider == nil {
			return domain.SubtitleAsset{}, fmt.Errorf("unknown subtitle provider")
		}
		source, err = provider.Download(ctx, candidateID)
		if err != nil {
			return domain.SubtitleAsset{}, err
		}
		language = domain.NormalizeLanguage(source.Language)
	}
	data, format, err := unpackSubtitle(source.Data, source.Format, source.Name, d.FilePath)
	if err != nil {
		return domain.SubtitleAsset{}, err
	}
	if providerName != "embedded" {
		// ffmpeg already emits UTF-8 for embedded tracks; every other source
		// may be UTF-16 or a legacy code page.
		data = []byte(decodeSubtitleText(data, language))
	}
	var converted []byte
	if target == "vtt" {
		converted, err = toWebVTT(data, format)
	} else {
		target = "sami"
		converted, err = toSAMI(data, format)
	}
	if err != nil {
		return domain.SubtitleAsset{}, err
	}
	// The id is scoped to the download on purpose: identical subtitle content
	// is common across releases of the same episode, and the asset table keys
	// rows per source - a source-independent id collides on the primary key
	// the moment a second download prepares the same subtitle.
	sum := sha256.Sum256(append([]byte(downloadID+"\x00"+providerName+"\x00"+candidateID+"\x00"+target+"\x00"), converted...))
	id := hex.EncodeToString(sum[:16])
	cache := s.settings.Get().SubtitleCachePath
	if err = os.MkdirAll(cache, 0o750); err != nil {
		return domain.SubtitleAsset{}, err
	}
	ext, mimeType := ".smi", "application/x-sami; charset=utf-8"
	if target == "vtt" {
		ext, mimeType = ".vtt", "text/vtt; charset=utf-8"
	}
	path := filepath.Join(cache, id+ext)
	if err = os.WriteFile(path, converted, 0o640); err != nil {
		return domain.SubtitleAsset{}, err
	}
	pruneSubtitleCache(cache, s.settings.Get().SubtitleCacheMaxBytes, path)
	asset := domain.SubtitleAsset{ID: id, SourceID: downloadID, Provider: providerName, CandidateID: candidateID, Name: source.Name, Language: language, URL: "/api/v1/subtitles/" + id + ext, Format: target, MimeType: mimeType, Path: path, CreatedAt: time.Now().UTC(), LastUsedAt: time.Now().UTC()}
	if err = s.repo.SaveSubtitleAsset(ctx, asset); err != nil {
		return domain.SubtitleAsset{}, err
	}
	return asset, nil
}

// embeddedTrackLanguage is the canonical language of an embedded track: the
// tag (ISO codes, legacy "mol", language names), else a language word in the
// track title ("Romanian SDH"). Undetermined tracks answer "".
func embeddedTrackLanguage(track domain.MediaSubtitleTrack) string {
	if lang := domain.LanguageFromName(track.Language); lang != "" {
		return lang
	}
	for _, token := range subtitleNameTokens.Split(strings.ToLower(track.Title), -1) {
		if lang := domain.LanguageFromName(token); lang != "" {
			return lang
		}
	}
	return ""
}

// embeddedScore keeps the track inside its language bracket: a full track
// outranks a forced-only one, and tracks in neither the requested nor the
// fallback language sink far below so they are never auto-selected ahead of
// a usable one. Undetermined languages rank just below the fallback language.
func embeddedScore(track domain.MediaSubtitleTrack, lang, requested, fallback string) float64 {
	score := 260.0
	switch {
	case lang == "":
		score -= 10
	case sameLanguage(requested, lang):
		score += 25
	case requested != "" && !sameLanguage(fallback, lang):
		score -= 200
	}
	if track.Forced {
		score -= 15
	}
	if track.HearingImpaired {
		score -= 5
	}
	if track.Default {
		score += 3
	}
	return score
}

// embeddedTrackTitle is the title shown for a track: the container's own
// title when it has one, otherwise the composed label.
func embeddedTrackTitle(track domain.MediaSubtitleTrack, label string) string {
	if title := strings.TrimSpace(track.Title); title != "" {
		return title
	}
	return label
}

func embeddedTrackLabel(track domain.MediaSubtitleTrack) string {
	parts := make([]string, 0, 4)
	if strings.TrimSpace(track.Title) != "" {
		parts = append(parts, strings.TrimSpace(track.Title))
	}
	if strings.TrimSpace(track.Language) != "" && !strings.EqualFold(track.Language, "und") {
		parts = append(parts, strings.ToUpper(track.Language))
	}
	if track.Forced {
		parts = append(parts, "Forced")
	}
	if track.HearingImpaired {
		parts = append(parts, "SDH")
	}
	if len(parts) == 0 {
		parts = append(parts, "Embedded subtitle "+strconv.Itoa(track.Index))
	}
	return strings.Join(parts, " · ")
}

func (s *Service) SubtitlePath(assetID string, requested ...string) (string, error) {
	if ok, _ := regexp.MatchString(`^[a-f0-9]{32}$`, assetID); !ok {
		return "", fmt.Errorf("invalid subtitle asset id")
	}
	ext := ".smi"
	if len(requested) > 0 && requested[0] == "vtt" {
		ext = ".vtt"
	}
	path := filepath.Join(s.settings.Get().SubtitleCachePath, assetID+ext)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

// webVTTControlBarCueLine is the `line:` cue setting (percent of the video
// height) stamped onto every cue generated by toWebVTT. Native <track> cues
// cannot be positioned with CSS, and the web player's control chrome
// overlays the bottom of the video — 110px gradient padding plus the control
// row on desktop, 90px on mobile (.player-chrome in web/style.css). Anchoring
// cues at 80% keeps them, even two-line ones, above that zone in the
// upper-middle area. Tizen renders the same VTT through its own renderer and
// ignores cue positioning, so only the browser path is affected.
const webVTTControlBarCueLine = 80

func toWebVTT(data []byte, format string) ([]byte, error) {
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, fmt.Errorf("binary subtitles are not supported")
	}
	text := strings.ReplaceAll(string(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})), "\r\n", "\n")
	if format == ".vtt" {
		if !strings.HasPrefix(strings.TrimSpace(text), "WEBVTT") {
			return nil, fmt.Errorf("invalid WebVTT subtitle")
		}
		return []byte(positionCueLines(sanitizeVTTCues(text))), nil
	}
	if format == ".srt" {
		text = timeLine.ReplaceAllStringFunc(text, func(value string) string { return strings.ReplaceAll(value, ",", ".") })
		return []byte(positionCueLines(sanitizeVTTCues("WEBVTT\n\n" + text))), nil
	}
	if format == ".ass" || format == ".ssa" {
		var out strings.Builder
		out.WriteString("WEBVTT\n\n")
		index := 1
		for _, line := range strings.Split(text, "\n") {
			m := assLine.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n", index, vttTime(assMS(m[1:5])), vttTime(assMS(m[5:9])), normalizeCueText(escapeCueMarkup(m[9]), true, true))
			index++
		}
		if index == 1 {
			return nil, fmt.Errorf("subtitle contains no readable cues")
		}
		return []byte(positionCueLines(out.String())), nil
	}
	return nil, fmt.Errorf("subtitle format %q cannot be used by the browser", format)
}

func vttTime(ms int64) string {
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, (ms/60000)%60, (ms/1000)%60, ms%1000)
}

// vttCueTiming matches the timing span of a WebVTT cue timing line, with or
// without the hours component.
var vttCueTiming = regexp.MustCompile(`(?:\d{1,3}:)?\d{2}:\d{2}\.\d{3}[ \t]*-->[ \t]*(?:\d{1,3}:)?\d{2}:\d{2}\.\d{3}`)

// positionCueLines gives every cue timing line exactly one positioning
// settings suffix. Settings a source document already carried are replaced,
// never appended, so the generated VTT stays idempotent.
func positionCueLines(text string) string {
	suffix := fmt.Sprintf(" align:center line:%d%% position:50%%", webVTTControlBarCueLine)
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if m := vttCueTiming.FindStringSubmatch(line); m != nil {
			lines[i] = m[0] + suffix
		}
	}

	return strings.Join(lines, "\n")
}

// restampWebVTTCuePositioning re-applies the control-bar cue positioning to
// a cached WebVTT prepared before the lift existed, so every Subtitle asset
// serves positioned regardless of when it was prepared. It reports whether
// the file changed.
func restampWebVTTCuePositioning(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	stamped := positionCueLines(sanitizeVTTCues(string(data)))
	if stamped == string(data) {
		return false
	}
	return os.WriteFile(path, []byte(stamped), 0o640) == nil
}

func unpackSubtitle(data []byte, format, name, mediaPath string) ([]byte, string, error) {
	if len(data) == 0 || len(data) > maxSubtitleSourceBytes {
		return nil, "", fmt.Errorf("subtitle response is empty or too large")
	}
	if bytes.HasPrefix(data, []byte("PK\x03\x04")) || bytes.HasPrefix(data, []byte("PK\x05\x06")) || bytes.HasPrefix(data, []byte("PK\x07\x08")) {
		reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, "", fmt.Errorf("invalid subtitle archive: %w", err)
		}
		candidates := make([]*zip.File, 0)
		var expanded uint64
		for _, file := range reader.File {
			clean := filepath.Clean(file.Name)
			if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
				continue
			}
			ext := strings.ToLower(filepath.Ext(clean))
			if !supportedSubtitleExt(ext) || file.UncompressedSize64 > maxSubtitleSourceBytes {
				continue
			}
			expanded += file.UncompressedSize64
			if expanded > 50<<20 {
				return nil, "", fmt.Errorf("subtitle archive expands beyond the safety limit")
			}
			candidates = append(candidates, file)
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			return filenameSimilarity(mediaPath, candidates[i].Name) > filenameSimilarity(mediaPath, candidates[j].Name)
		})
		for _, file := range candidates {
			r, openErr := file.Open()
			if openErr != nil {
				continue
			}
			content, readErr := io.ReadAll(io.LimitReader(r, maxSubtitleSourceBytes+1))
			_ = r.Close()
			if readErr == nil && len(content) <= maxSubtitleSourceBytes {
				return content, strings.ToLower(filepath.Ext(file.Name)), nil
			}
		}
		return nil, "", fmt.Errorf("archive contains no supported text subtitle")
	}
	if strings.EqualFold(format, ".zip") {
		format = ""
	}
	if format == "" {
		format = filepath.Ext(name)
	}
	if strings.EqualFold(format, ".zip") || format == "" {
		format = sniffSubtitleFormat(data)
	}
	format = strings.ToLower(format)
	if !supportedSubtitleExt(format) {
		return nil, "", fmt.Errorf("unsupported subtitle format %q", format)
	}
	return data, format, nil
}

func sniffSubtitleFormat(data []byte) string {
	text := strings.TrimSpace(strings.ToLower(string(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))))
	switch {
	case strings.HasPrefix(text, "webvtt"):
		return ".vtt"
	case strings.Contains(text, "[script info]") && strings.Contains(text, "dialogue:"):
		return ".ass"
	case strings.Contains(text, "<sami"):
		return ".smi"
	case strings.Contains(text, "-->"):
		return ".srt"
	}
	return ""
}

func supportedSubtitleExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".srt", ".vtt", ".ass", ".ssa", ".smi", ".sami":
		return true
	}
	return false
}

var (
	timeLine = regexp.MustCompile(`(?i)(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{3})`)
	assLine  = regexp.MustCompile(`(?i)^Dialogue:[^,]*,(\d+):(\d{2}):(\d{2})[.](\d{2}),(\d+):(\d{2}):(\d{2})[.](\d{2}),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$`)
)

func toSAMI(data []byte, format string) ([]byte, error) {
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, fmt.Errorf("binary subtitles are not supported")
	}
	text := strings.ReplaceAll(string(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})), "\r\n", "\n")
	if format == ".smi" || format == ".sami" {
		if !strings.Contains(strings.ToUpper(text), "<SAMI") {
			return nil, fmt.Errorf("invalid SAMI subtitle")
		}
		return []byte(text), nil
	}
	type cue struct {
		start, end int64
		text       string
	}
	cues := make([]cue, 0)
	if format == ".ass" || format == ".ssa" {
		for _, line := range strings.Split(text, "\n") {
			if m := assLine.FindStringSubmatch(line); m != nil {
				cues = append(cues, cue{assMS(m[1:5]), assMS(m[5:9]), cleanCue(m[9], true)})
			}
		}
	} else {
		lines := strings.Split(text, "\n")
		for i := 0; i < len(lines); i++ {
			m := timeLine.FindStringSubmatch(lines[i])
			if m == nil {
				continue
			}
			body := []string{}
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != ""; i++ {
				body = append(body, lines[i])
			}
			cues = append(cues, cue{vttClockMS(m[1:5]), vttClockMS(m[5:9]), cleanCue(strings.Join(body, "\n"), false)})
		}
	}
	if len(cues) == 0 {
		return nil, fmt.Errorf("subtitle contains no readable cues")
	}
	var out strings.Builder
	out.WriteString("<SAMI><HEAD><STYLE><!-- P { font-family: sans-serif; color: white; text-align: center; } --></STYLE></HEAD><BODY>\n")
	for _, cue := range cues {
		fmt.Fprintf(&out, "<SYNC Start=%d><P Class=SUBTTL>%s</P>\n<SYNC Start=%d><P Class=SUBTTL>&nbsp;</P>\n", cue.start, cue.text, cue.end)
	}
	out.WriteString("</BODY></SAMI>\n")
	return []byte(out.String()), nil
}

// vttClockMS converts a timeLine submatch group ([hours,]minutes,seconds,millis)
// to milliseconds. The hours group is empty for ffmpeg-emitted WebVTT tracks
// shorter than one hour, which omit the hours component.
func vttClockMS(match []string) int64 {
	var hours int64
	if match[0] != "" {
		hours, _ = strconv.ParseInt(match[0], 10, 64)
	}
	minutes, _ := strconv.ParseInt(match[1], 10, 64)
	seconds, _ := strconv.ParseInt(match[2], 10, 64)
	millis, _ := strconv.ParseInt(match[3], 10, 64)
	return ((hours*60+minutes)*60+seconds)*1000 + millis
}

func assMS(parts []string) int64 {
	values := make([]int64, 4)
	for i := range values {
		values[i], _ = strconv.ParseInt(parts[i], 10, 64)
	}
	return ((values[0]*60+values[1])*60+values[2])*1000 + values[3]*10
}

// cleanCue prepares cue text for SAMI: line breaks of every spelling become
// <br>, formatting is dropped and the rest is HTML-escaped.
func cleanCue(value string, ass bool) string {
	escaped := html.EscapeString(normalizeCueText(value, false, ass))
	return strings.ReplaceAll(escaped, "\n", "<br>")
}

var (
	cueBreakTag    = regexp.MustCompile(`(?i)(?:<|&lt;)\s*/?\s*br\s*/?\s*(?:>|&gt;)`)
	cueASSBreak    = regexp.MustCompile(`\\[Nn]`)
	cueOverride    = regexp.MustCompile(`\{\\[^}]*\}`)
	cueFontTag     = regexp.MustCompile(`(?i)(?:<|&lt;)/?font(?:[\s](?:(?:&gt;)?[^>&]|&(?:[^g]|g(?:[^t]|t[^;])))*)?(?:>|&gt;)`)
	cueEscapedTag  = regexp.MustCompile(`(?i)&lt;(/?[ibu])&gt;`)
	cueFormatTag   = regexp.MustCompile(`(?i)</?[ibu]>`)
	assFormatBlock = regexp.MustCompile(`(?i)\{\\([ibu])([01])\}`)
)

// escapeCueMarkup escapes the characters that are markup in WebVTT so plain
// ASS dialogue text is not read as tags.
func escapeCueMarkup(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(value)
}

// normalizeCueText resolves every <br> spelling (literal or entity-escaped,
// "</br>" included) and, when ass is set, the ASS \N / \n breaks into real
// newlines (in SRT and WebVTT they are dialogue), maps ASS
// {\i1} style overrides to <i>/<b>/<u> and drops every other {\...} override block
// and <font> tag. Empty lines are removed, since a blank line would end the
// cue. keepFormatting=false also drops <i>/<b>/<u>.
func normalizeCueText(value string, keepFormatting, ass bool) string {
	value = strings.ReplaceAll(value, "\r", "")
	value = cueBreakTag.ReplaceAllString(value, "\n")
	if ass {
		value = cueASSBreak.ReplaceAllString(value, "\n")
	}
	value = assFormatBlock.ReplaceAllStringFunc(value, func(block string) string {
		m := assFormatBlock.FindStringSubmatch(block)
		if m[2] == "1" {
			return "<" + strings.ToLower(m[1]) + ">"
		}
		return "</" + strings.ToLower(m[1]) + ">"
	})
	value = cueOverride.ReplaceAllString(value, "")
	value = cueFontTag.ReplaceAllString(value, "")
	value = cueEscapedTag.ReplaceAllString(value, "<$1>")
	if !keepFormatting {
		value = cueFormatTag.ReplaceAllString(value, "")
	}
	lines := strings.Split(value, "\n")
	kept := lines[:0]
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

// sanitizeVTTCues rewrites every cue payload of a WebVTT document through
// normalizeCueText so no break tag, ASS override or <font> tag reaches a
// player as raw text. It is idempotent.
func sanitizeVTTCues(text string) string {
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for i := 0; i < len(lines); i++ {
		out = append(out, lines[i])
		if !vttCueTiming.MatchString(lines[i]) {
			continue
		}
		payload := []string{}
		for i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != "" {
			i++
			payload = append(payload, lines[i])
		}
		if cleaned := normalizeCueText(strings.Join(payload, "\n"), true, false); cleaned != "" {
			out = append(out, cleaned)
		}
	}
	return strings.Join(out, "\n")
}

func sameStem(media, sub string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSuffix(filepath.Base(sub), filepath.Ext(sub))), strings.ToLower(strings.TrimSuffix(filepath.Base(media), filepath.Ext(media))))
}

var episodePattern = regexp.MustCompile(`(?i)(?:s(\d{1,2})[ ._-]*e(\d{1,3})|(\d{1,2})x(\d{1,3}))`)

func episodeKey(path string) string {
	match := episodePattern.FindStringSubmatch(filepath.Base(path))
	if match == nil {
		return ""
	}
	if match[1] != "" {
		return match[1] + ":" + match[2]
	}
	return match[3] + ":" + match[4]
}

func episodeMatches(media, subtitle string) bool {
	left, right := episodeKey(media), episodeKey(subtitle)
	return left == "" || right == "" || left == right
}

func filenameSimilarity(left, right string) int {
	words := strings.Fields(strings.NewReplacer(".", " ", "_", " ", "-", " ").Replace(strings.ToLower(strings.TrimSuffix(filepath.Base(left), filepath.Ext(left)))))
	haystack := " " + strings.Join(strings.Fields(strings.NewReplacer(".", " ", "_", " ", "-", " ").Replace(strings.ToLower(strings.TrimSuffix(filepath.Base(right), filepath.Ext(right))))), " ") + " "
	score := 0
	for _, word := range words {
		if len(word) > 1 && strings.Contains(haystack, " "+word+" ") {
			score++
		}
	}
	leftEpisode, rightEpisode := episodeKey(left), episodeKey(right)
	if leftEpisode != "" && rightEpisode != "" {
		if leftEpisode != rightEpisode {
			return -1000
		}
		score += 20
	}
	return score
}

func sameLanguage(a, b string) bool {
	return domain.NormalizeLanguage(a) == domain.NormalizeLanguage(b)
}

// subtitleNameMarkers are sidecar name words that may follow a language tag
// without hiding it: Movie.jpn.forced.srt, Movie.ro.subs.srt.
var subtitleNameMarkers = map[string]bool{
	"cc": true, "forced": true, "sdh": true, "sub": true, "subs": true, "subtitle": true, "subtitles": true, "subtitrari": true,
}

var subtitleNameTokens = regexp.MustCompile(`[^\p{L}]+`)

// subtitleLanguage derives the canonical subtitle language hinted by a
// torrent-contained sidecar file name. A language word (ISO code or English or
// native name: ro, ron, rum, mol, Romanian, Română) is only recognized in the
// last tokens of the file name, optionally followed by subtitle markers
// (Movie.ro.forced.srt, Subs/2_Romanian.srt), or as the whole name of the
// parent folder (Subs/Romanian/2_Track.srt). Anything else is undetermined so
// release words are never mistaken for languages.
func subtitleLanguage(name string) string {
	base := strings.TrimSuffix(strings.ToLower(filepath.Base(name)), strings.ToLower(filepath.Ext(name)))
	tokens := subtitleNameTokens.Split(base, -1)
	for i := len(tokens) - 1; i >= 0 && len(tokens)-i <= 3; i-- {
		if code := domain.LanguageFromName(tokens[i]); code != "" {
			return code
		}
		if !subtitleNameMarkers[tokens[i]] {
			break
		}
	}
	if dir := filepath.Base(filepath.Dir(filepath.FromSlash(name))); dir != "." && dir != string(filepath.Separator) {
		parent := strings.Fields(strings.TrimSpace(subtitleNameTokens.ReplaceAllString(strings.ToLower(dir), " ")))
		if len(parent) == 1 {
			return domain.LanguageFromName(parent[0])
		}
	}
	return ""
}

func pruneSubtitleCache(dir string, maximum int64, keep string) {
	entries, _ := os.ReadDir(dir)
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	files := []item{}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || (filepath.Ext(entry.Name()) != ".smi" && filepath.Ext(entry.Name()) != ".vtt") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, item{filepath.Join(dir, entry.Name()), info.Size(), info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	for _, file := range files {
		if total <= maximum {
			break
		}
		if file.path == keep {
			continue
		}
		if os.Remove(file.path) == nil {
			total -= file.size
		}
	}
}

type probeCacheKey struct {
	path string
	size int64
	mod  int64
}

// probeSubtitles lists a file's subtitle streams. Listing reads the whole file
// (see SearchSubtitles), so the answer is remembered per file version: opening
// the subtitle panel and then choosing a track no longer reads it twice.
func (s *Service) probeSubtitles(ctx context.Context, path string) ([]domain.MediaSubtitleTrack, error) {
	var key probeCacheKey
	if info, err := os.Stat(path); err == nil {
		key = probeCacheKey{path, info.Size(), info.ModTime().UnixNano()}
		if cached, ok := s.probeCache.Load(key); ok {
			return cached.([]domain.MediaSubtitleTrack), nil
		}
	}
	tracks, err := s.mediaProbe.ProbeSubtitles(ctx, path)
	if err == nil && key.path != "" {
		s.probeCache.Store(key, tracks)
	}
	return tracks, err
}
