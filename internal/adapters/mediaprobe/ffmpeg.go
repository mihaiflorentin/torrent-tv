package mediaprobe

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
	"github.com/mihaiflorentin/torrent-tv/internal/platform/config"
)

type Adapter struct {
	settings     *config.Store
	slots        chan struct{}
	extractSlots chan struct{}
	probeMu      sync.Mutex
	probeCache   map[subtitleProbeKey][]domain.MediaSubtitleTrack
}

func New(settings *config.Store) *Adapter {
	return &Adapter{settings: settings, slots: make(chan struct{}, 1), extractSlots: make(chan struct{}, 1), probeCache: map[subtitleProbeKey][]domain.MediaSubtitleTrack{}}
}

func (a *Adapter) ProbeMedia(ctx context.Context, path string) (domain.MediaInfo, error) {
	if err := a.acquire(ctx); err != nil {
		return domain.MediaInfo{}, err
	}
	defer a.release()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, a.settings.Get().FFprobePath,
		"-v", "error", "-select_streams", "a", "-show_streams", "-show_format", "-of", "json", path,
	).Output()
	if err != nil {
		return domain.MediaInfo{}, fmt.Errorf("ffprobe media information: %w", err)
	}
	return decodeMediaInfo(out)
}

func decodeMediaInfo(out []byte) (domain.MediaInfo, error) {
	var payload struct {
		Streams []struct {
			Index       int               `json:"index"`
			Codec       string            `json:"codec_name"`
			Channels    int               `json:"channels"`
			Duration    string            `json:"duration"`
			Tags        map[string]string `json:"tags"`
			Disposition map[string]int    `json:"disposition"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return domain.MediaInfo{}, fmt.Errorf("decode ffprobe media information: %w", err)
	}
	durationSeconds, _ := strconv.ParseFloat(payload.Format.Duration, 64)
	tracks := make([]domain.MediaAudioTrack, 0, len(payload.Streams))
	for _, stream := range payload.Streams {
		if durationSeconds <= 0 {
			if value, err := strconv.ParseFloat(stream.Duration, 64); err == nil && value > durationSeconds {
				durationSeconds = value
			}
		}
		tracks = append(tracks, domain.MediaAudioTrack{Index: stream.Index, Language: stream.Tags["language"], Title: stream.Tags["title"], Codec: stream.Codec, Channels: stream.Channels, Default: stream.Disposition["default"] == 1})
	}
	if durationSeconds <= 0 {
		return domain.MediaInfo{}, fmt.Errorf("ffprobe did not report a stable media duration")
	}
	if len(tracks) == 0 {
		return domain.MediaInfo{}, fmt.Errorf("ffprobe did not find an audio stream")
	}
	return domain.MediaInfo{DurationMS: int64(durationSeconds*1000 + .5), AudioTracks: tracks, ProbedAt: time.Now().UTC()}, nil
}

// bitmapSubtitleCodecs are picture-based subtitle formats. ffmpeg cannot
// convert them to WebVTT and the TV shells cannot render them.
var bitmapSubtitleCodecs = map[string]bool{
	"hdmv_pgs_subtitle": true, "pgssub": true, "dvd_subtitle": true, "dvdsub": true, "dvb_subtitle": true, "dvbsub": true, "xsub": true, "dvb_teletext": true,
}

func isBitmapSubtitleCodec(codec string) bool {
	codec = strings.ToLower(strings.TrimSpace(codec))
	return codec == "" || bitmapSubtitleCodecs[codec]
}

type subtitleProbeKey struct {
	path    string
	size    int64
	modTime int64
}

func (a *Adapter) ProbeSubtitles(ctx context.Context, path string) ([]domain.MediaSubtitleTrack, error) {
	var key subtitleProbeKey
	if info, err := os.Stat(path); err == nil {
		key = subtitleProbeKey{path, info.Size(), info.ModTime().UnixNano()}
		a.probeMu.Lock()
		cached, ok := a.probeCache[key]
		a.probeMu.Unlock()
		if ok {
			return append([]domain.MediaSubtitleTrack(nil), cached...), nil
		}
	}
	if err := a.acquire(ctx); err != nil {
		return nil, err
	}
	defer a.release()
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, a.settings.Get().FFprobePath, "-v", "error", "-select_streams", "s", "-show_streams", "-of", "json", path).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe subtitle streams: %w", err)
	}
	tracks, err := decodeSubtitleTracks(out)
	if err != nil {
		return nil, err
	}
	if key.path != "" {
		a.probeMu.Lock()
		if len(a.probeCache) > 64 {
			a.probeCache = map[subtitleProbeKey][]domain.MediaSubtitleTrack{}
		}
		a.probeCache[key] = tracks
		a.probeMu.Unlock()
	}
	return append([]domain.MediaSubtitleTrack(nil), tracks...), nil
}

func decodeSubtitleTracks(out []byte) ([]domain.MediaSubtitleTrack, error) {
	var payload struct {
		Streams []struct {
			Index       int               `json:"index"`
			Codec       string            `json:"codec_name"`
			Tags        map[string]string `json:"tags"`
			Disposition map[string]int    `json:"disposition"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil, fmt.Errorf("decode ffprobe output: %w", err)
	}
	now := time.Now().UTC()
	tracks := make([]domain.MediaSubtitleTrack, 0, len(payload.Streams))
	for ordinal, stream := range payload.Streams {
		tracks = append(tracks, domain.MediaSubtitleTrack{Index: stream.Index, Ordinal: ordinal, Language: stream.Tags["language"], Title: stream.Tags["title"], Codec: stream.Codec, Bitmap: isBitmapSubtitleCodec(stream.Codec), Default: stream.Disposition["default"] == 1, Forced: stream.Disposition["forced"] == 1, HearingImpaired: stream.Disposition["hearing_impaired"] == 1, ProbedAt: now})
	}
	return tracks, nil
}

// extractTimeout allows a full sequential read of the file at a pessimistic
// 4 MiB/s (a Matroska subtitle stream cannot be located without scanning the
// whole file), never less than two minutes and never more than three hours.
func extractTimeout(size int64) time.Duration {
	const floor, ceiling = 2 * time.Minute, 3 * time.Hour
	const bytesPerSecond = 4 << 20
	seconds := size / bytesPerSecond
	if seconds > int64(ceiling/time.Second) {
		return ceiling
	}
	if timeout := time.Duration(seconds) * time.Second; timeout > floor {
		return timeout
	}
	return floor
}

func extractSubtitleArgs(path string, ordinal int, target string) []string {
	return []string{"-v", "error", "-nostdin", "-nostats", "-i", path, "-map", "0:s:" + strconv.Itoa(ordinal), "-vn", "-an", "-dn", "-c:s", "webvtt", "-f", "webvtt", "-y", target}
}

// ExtractSubtitle converts the ordinal-th subtitle stream of a completed file
// to WebVTT. It uses its own slot, so a long extraction never blocks audio or
// subtitle probing.
func (a *Adapter) ExtractSubtitle(ctx context.Context, path string, ordinal int, target string) error {
	if err := a.acquireExtract(ctx); err != nil {
		return err
	}
	defer a.releaseExtract()
	var size int64
	if info, err := os.Stat(path); err == nil {
		size = info.Size()
	}
	ctx, cancel := context.WithTimeout(ctx, extractTimeout(size))
	defer cancel()
	output, err := exec.CommandContext(ctx, a.settings.Get().FFmpegPath, extractSubtitleArgs(path, ordinal, target)...).CombinedOutput()
	if err != nil {
		if len(output) > 2048 {
			output = output[len(output)-2048:]
		}
		return fmt.Errorf("extract embedded subtitle: %w: %s", err, string(output))
	}
	return nil
}

func (a *Adapter) acquire(ctx context.Context) error {
	select {
	case a.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (a *Adapter) release() { <-a.slots }
func (a *Adapter) acquireExtract(ctx context.Context) error {
	select {
	case a.extractSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (a *Adapter) releaseExtract() { <-a.extractSlots }
