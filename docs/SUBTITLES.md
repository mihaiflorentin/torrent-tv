# Subtitle playback architecture

This document records the working subtitle pipeline and the preservation constraints used while adding saved preferences and automatic fallback. Keep these boundaries intact when changing either client.

## Discovery

`GET /api/v1/downloads/{id}/subtitles` is the only discovery entry point. Its `scope` is `local`, `remote`, or `all`.

- Local discovery asks qBittorrent for subtitle files belonging to the selected episode, then probes the media file for embedded subtitle tracks. Embedded tracks are listed only once the selected file is complete: a track can only be demuxed by reading the whole file, so a partial download would give a truncated track. While the download is incomplete the response carries an `embedded` warning ("available after the download completes") and discovery is repeated each time the menu opens.
- Sidecar language comes from the file name: ISO codes (`ro`, `ron`, `rum`, legacy `mol`) and English or native language names (`Romanian`, `Română`, `English`, `Francais`), in the last name tokens (`Movie.ro.forced.srt`, `Subs/2_Romanian.srt`) or as the whole parent folder name (`Subs/Romanian/2_Track.srt`). Anything else is undetermined. Embedded tracks use their language tag, falling back to a language word in the track title when the tag is `und`.
- Picture-based embedded tracks (PGS, VobSub, DVB, XSUB) cannot be converted to text and are never listed; one `embedded` warning reports how many were skipped.
- Remote discovery queries each configured provider independently. A provider failure is returned as a warning and does not hide candidates from other providers.
- The service ranks included subtitles above embedded tracks and online results. Exact requested-language matches receive an additional score. When the requested language matches the configured primary language, the configured fallback language is also admitted. Inside the embedded group, forced-only tracks rank below full tracks, hearing-impaired tracks slightly below plain ones, the container's default track slightly above, and tracks in neither the requested nor the fallback language far below. Candidates expose `forced`, `default` and `hearingImpaired` so clients can label them.
- Subtitle discovery never blocks ordinary library or download listing. Embedded probing is attempted only when the selected media file exists locally.

## Preparation and cache

`POST /api/v1/downloads/{id}/subtitles/prepare` prepares one candidate as SAMI or WebVTT.

- Included torrent subtitles are read through the same progressive range strategy as media; this retains the qBittorrent streaming behavior.
- Embedded subtitles are extracted by the configured media probe only from a completed local file, with `-map 0:s:N` (the track's position among subtitle streams) and WebVTT encoding. The timeout scales with file size (4 MiB/s, between 2 minutes and 3 hours) because Matroska cannot locate one track without scanning the file, and extraction has its own slot so it never blocks audio or subtitle probing. Track lists are cached by file path, size and modification time. A prepared embedded asset older than the media file's last modification is regenerated.
- Online candidates are downloaded by their provider adapter.
- ZIP payloads are safely unpacked and the best matching subtitle file is selected. Included and online text is decoded to UTF-8 first: UTF-8 (with or without BOM), UTF-16 LE/BE, then a legacy code page chosen from the subtitle language (Windows-1250 for Romanian and neighbouring languages, 1251 for Cyrillic, and so on; without a hint, Romanian cedilla bytes select Windows-1250, otherwise Windows-1252). Romanian cedilla letters are normalised to ș and ț. Supported formats are then converted to WebVTT or SAMI.
- Cue text is normalised during conversion: `<br>`, `<br/>`, `</br>`, entity-escaped forms, and ASS `\N`/`\n` become real line breaks, ASS `{\i1}` style overrides map to `<i>`/`<b>`/`<u>` (other override blocks are dropped), and `<font>` tags are removed. Clients repeat the cleanup defensively (`cueDisplayText` in `clients/shared`) and render cue text as plain text with `white-space: pre-line`.
- The converted result is content-addressed and written below `subtitleCachePath`. Its database row is keyed by source, provider, candidate, and target format. A later identical request reuses that file and only refreshes its last-used timestamp.
- Cache pruning respects `subtitleCacheMaxBytes`. Subtitle asset URLs expose only validated asset identifiers; provider credentials and filesystem paths are never returned.

## Preferences and automatic fallback

Playback preferences are stored per managed source in SQLite. They record audio language/index plus subtitle language, mode (`auto`, `selected`, or `off`), provider, and candidate ID. A new source inherits the configured defaults: English audio and Romanian subtitles with English fallback.

When either player opens it first tries a remembered exact choice, then local candidates in `autoSubtitleOrder` (`clients/shared`): the preferred language, then the fallback language (English, or Romanian when English is preferred), then undetermined tracks as a last resort. Other languages are never auto-selected. Full tracks always come before forced-only tracks, and plain before hearing-impaired. Tizen then tries a native text track in the preferred or fallback language. If nothing is usable, it searches online providers for the preferred language and then the fallback language, prepares the first usable result, and persists the candidate. A pick without a language (`und`) never rewrites the saved subtitle language. Preparation is cache-backed, so later playback reuses the converted subtitle rather than downloading it again. Choosing **Off** or another track overrides automatic behavior for that source. Auto-next carries the language/mode intent but clears an episode-specific candidate ID.

## Web playback

The browser tries ranked candidates in order, prepares the first usable one as WebVTT, and attaches it as a generated `<track>`. A user can disable subtitles or choose another ranked candidate. The server probes the original file's audio tracks, and the browser plays the single progressive stream directly for codecs it handles natively, while AC3/EAC3/DTS-class audio plays from a compatibility stream that transcodes only the selected track to AAC stereo and copies the video (see `docs/adr/0003`, which revises `docs/adr/0001`). Seeks and audio changes stay on the original file's timeline: a compatibility-stream seek re-requests at the new position and prepared cues are shifted client-side to match. Playback position uses the original duration and is saved every ten seconds, on pause, and at completion.

## Tizen playback

AVPlay native text tracks remain available as a fallback and are listed under "Built-in tracks" only when the server found no embedded tracks, so one physical track is not offered twice. Native track labels read the codec from `fourCC` (`subtitle_type` is a numeric kind) and accept language names as well as codes. The Tizen client also requests local candidates, prepares the selected item as WebVTT, parses cues in the app, and renders the current cue itself. This path is deliberate: it avoids device-specific instability in AVPlay external subtitle loading. If no local or native track in the preferred or fallback language is usable, the client automatically requests and caches an online result for the preferred language, then the fallback language. Subtitle delay is applied in the cue lookup, while native-track delay uses AVPlay.

## Android TV playback

The Android TV shell uses ExoPlayer with no text renderer output, so native (built-in) text tracks cannot be selected or drawn. The shell does not list them, and the bridge keeps ExoPlayer text decoding disabled. Subtitles come only from the server (prepared WebVTT in the shared overlay). A saved native-track preference finds no matching track on Android and falls back to the server candidates, and a direct native `TEXT` selection is ignored instead of raising an error.

## webOS playback

The webOS client renders the same pipeline through its platform adapter: prepared server WebVTT stays the primary path and renders in the shared overlay, while AVPlay-shaped native TEXT tracks are mirrored onto hidden HTML text tracks whose cues forward through the same listener the overlay already consumes. Subtitle delay shifts the native cue evaluation instead of relying on a device delay property, and Off disables every native track so the overlay never doubles with device rendering. Native-track presence on real LG firmware is a pending hardware check ([WEBOS-VERIFICATION.md](WEBOS-VERIFICATION.md)).

## Preservation constraints

- Do not replace Tizen's parsed-WebVTT overlay with an unverified AVPlay external-subtitle path.
- Keep the webOS adapter's native text tracks hidden; the shared overlay remains the only renderer on every TV client.
- Keep local discovery independent from online provider availability and rate limits.
- Reuse prepared subtitle assets instead of downloading the same candidate again.
- Preserve per-provider warnings and continue trying other ranked candidates.
- Never expose provider keys, qBittorrent credentials, or subtitle cache filesystem paths to either client.
