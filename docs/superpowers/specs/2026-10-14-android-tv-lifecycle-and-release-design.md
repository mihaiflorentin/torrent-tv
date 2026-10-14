# Android TV lifecycle, input and release design

Date: 2026-10-14
Status: Draft, awaiting user review

## Problem

TorrentTV, the Android TV client (ADR-0009), keeps playing after Home, drops the remote's media keys, can show empty audio and subtitle menus, picks the wrong audio track, and ships with a hardcoded version and a machine-local signing key that break the upgrade story in `docs/ANDROIDTV.md`. The WebView can also navigate away while keeping the native JS bridge. None of this has been observed on a device; the audit read the code.

## Findings

Paths under `clients/android-tv/app/src/main/java/com/torrenttv/app` unless noted.

- No lifecycle handling: `MainActivity.kt` overrides only `onCreate`, `onKeyDown`, `onKeyUp` (`:26`, `:73`, `:90`). The ExoPlayer (`avplay/AvPlayBridge.kt`) is never paused or released and the WebView is never told it is hidden, so the page's suspend path (`clients/tv/src/main.tsx:253`) never runs. `window.addFlags(FLAG_KEEP_SCREEN_ON)` (`MainActivity.kt:28`) applies to every screen.
- Media keys dropped: `onKeyDown` forwards DPAD, Enter and Back only (`DpadKeys.kt`, `MainActivity.kt:73-100`). `clients/tv/src/player.ts:22-45` already accepts `MediaPlay`, `MediaPause`, `MediaPlayPause`, `MediaStop`, `MediaRewind`, `MediaFastForward`, `MediaTrackPrevious`, `MediaTrackNext` by key name.
- Synthetic key events carry no `repeat` flag: `DpadKeys.kt` builds events with `initKeyboardEvent` and defines only `key`, `keyCode`, `which`. The shared client's planned `event.repeat` guards (see the D-pad spec) would never fire on Android, so held OK or Back would still repeat.
- Track list read off the wrong thread: `getTotalTrackInfo` reads `exo.currentTracks` on the JS binder thread (`AvPlayBridge.kt:110-113`, `tracksOf` at `:163`). ExoPlayer requires application-thread access, so this can throw and the JS side swallows it, leaving the menus empty. Needs a device to confirm the exception. `setSelectTrack` already marshals to main (`:115-140`).
- Audio index mismatch: `TrackInfo.toJson` numbers every group (`avplay/TrackInfo.kt:16-20`), including VIDEO and TEXT, while `setSelectTrack` treats the index as an audio-only ordinal counted per track inside audio groups (`AvPlayBridge.kt:128-139`). The JS side passes the reported index straight through (`clients/tv/src/main.tsx:356`, `player.ts:62-65`), so the chosen audio track is wrong or refused.
- WebView navigation: no `shouldOverrideUrlLoading` (`MainActivity.kt:44-63`) while `addJavascriptInterface(..., "FileListTVNative")` exposes the bridge to any loaded document. `Bridge.kt:31-37` `openExternal` passes any string to `ACTION_VIEW`.
- Version and signing: `app/build.gradle.kts:13-14` hardcodes `versionCode = 1`, `versionName = "0.1.0"` while `VERSION` is 0.9.8; the release build type signs with the debug key (`:19-23`). A CI-built and a household-built APK cannot upgrade each other, which contradicts `docs/ANDROIDTV.md:44-45`.
- Renderer restart leak: `onRenderProcessGone` calls `recreate()` without destroying the old WebView or player and with no retry bound (`MainActivity.kt:54-58`).
- On-screen keyboard: arrow keys are ignored while an input is in edit mode (`clients/tv/src/navigation.ts:222-228`) and Android never reports keyboard visibility, so one Back press is needed before the D-pad works again. Needs a device to confirm.

## Decisions already made

- Q8: do the lifecycle and media-key pass: pause and release in the Activity lifecycle, forward `KEYCODE_MEDIA_*`, read tracks on the main thread, number tracks per type.
- Q9: derive `versionCode` and `versionName` from `VERSION`; read one fixed keystore from env or CI secrets, fall back to the debug key with a warning.
- Q4: everything is unverified on hardware; no Android TV hardware is named.
- Perf (position ticker, `platform-bridge.js` debug interval and MutationObserver, whole-object `JSON.stringify` polling) and cleanup (unused permission, stale `www` assets) are out.

## Scope

In: Activity lifecycle, media keys, `repeat` on synthetic events, track threading and indices, WebView navigation lock and `openExternal` scheme check, IME visibility reporting, renderer restart cleanup with a retry cap, versioning, signing, `allowBackup`, screen-on only during playback.

Out: ticker throttling, audio focus (`setAudioAttributes`), `@Volatile` fields, network security config tightening (cleartext is needed for LAN HTTP).

## Design

### Lifecycle

- `onPause`/`onStop`: pause the player through `AvPlayBridge`, call `webView.onPause()`, and dispatch the page's visibility change so the shared suspend path saves the position and closes SSE. `onResume`: `webView.onResume()` and dispatch visible. `onDestroy`: release the player, `webView.destroy()`.
- Screen-on flag is set when playback starts and cleared on pause, stop, error and Activity pause. The catalog no longer holds the screen on.
- Renderer restart: destroy the old WebView and player first, then recreate. After 3 restarts in a minute, stop recreating and show the shared error panel with the reason.

### Keys

- `DpadKeys` also maps `KEYCODE_MEDIA_PLAY`, `MEDIA_PAUSE`, `MEDIA_PLAY_PAUSE`, `MEDIA_STOP`, `MEDIA_REWIND`, `MEDIA_FAST_FORWARD`, `MEDIA_PREVIOUS`, `MEDIA_NEXT` to the key names the page already matches (`MediaPlay`, `MediaPause`, `MediaPlayPause`, `MediaStop`, `MediaRewind`, `MediaFastForward`, `MediaTrackPrevious`, `MediaTrackNext`) with Android-appropriate `keyCode` values.
- Every synthetic keydown defines `repeat` from `KeyEvent.repeatCount > 0`. `BackKeys` already forwards only `repeatCount == 0`, which stays.
- IME: report keyboard visibility from `WindowInsets` (`ime()`) through `platform-bridge.js` as the platform keyboard event the shared platform layer already consumes on other clients (`clients/tv/src/platform.ts:90-98`), so the edit state ends when the keyboard hides.

### Tracks

- `getTotalTrackInfo` runs the scan on the main thread with the same latch pattern as `setSelectTrack` and returns `[]` only when no player exists.
- `TrackInfo` emits a per-type ordinal as the audio index, counting every selectable track inside audio groups, and `setSelectTrack` uses the same enumeration. A shared helper builds the audio track list once so reporting and selection cannot drift.

### WebView

- `shouldOverrideUrlLoading` allows only the app-assets origin and cancels everything else.
- `openExternal` accepts only `http` and `https` and returns false otherwise.
- `allowBackup` becomes false, so the saved server URL is not backed up.

### Version and signing

- Gradle reads `../../../VERSION` (relative to `app/`) once. `versionName` is the string; `versionCode` is `major * 10000 + minor * 100 + patch` (0.9.8 becomes 908). Validation fails the build if `VERSION` does not match `major.minor.patch`.
- Release signing reads the keystore path, store password, key alias and key password from environment variables. When absent, the build signs with the debug key and prints a warning stating that the APK will not upgrade a keystore-signed install. `docs/ANDROIDTV.md` documents the variables and the one-keystore rule.

## Test strategy

JVM tests next to the existing ones (`DpadKeysTest`, `TrackInfoTest`, `AvPlayStateMapperTest`, `BackKeysTest`):
- `DpadKeys`: each media key maps to the expected script; `repeat` is true for repeat counts above 0.
- `TrackInfo`/audio enumeration: a track list with video, two audio groups (one multi-track) and text yields per-type indices; selecting by index hits the matching track.
- Version derivation: a pure function with cases for 0.9.8, 1.0.0, malformed input.
- WebView URL policy and `openExternal` scheme check as pure functions.
- Lifecycle and threading: unit-test the state transitions through a fake player; the real thread-confinement check needs a device.

## Verification

Automated: Gradle unit tests, the existing CI boot smoke if it runs in this environment. Unverified on hardware: Home during playback stops audio and the page saves position, media keys, track menus populated, audio switch lands on the intended track, keyboard dismissal restores D-pad, renderer restart, an upgrade from a previous build with the fixed keystore. The track-thread exception and IME behavior are unconfirmed until observed.

## Risks

- Changing `versionCode` from 1 to 908 is one-way for installed builds; any future scheme must stay monotonic. Documented.
- Falling back to the debug key keeps sideloading easy but silently forks the install lineage; the warning and docs are the only guard.
- `webView.destroy()` on `onDestroy` while an `evaluateJavascript` callback is pending can crash; the dispatcher must check for a null or destroyed view.
- Reporting IME visibility depends on `WindowInsets` behavior across Android 8 to current TV images (minSdk 26). Unverified.

## ADR and glossary impact

No new ADR; ADR-0009 gains a note that release builds follow `VERSION` and a keystore. No glossary change.
