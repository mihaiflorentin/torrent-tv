# Android TV client (TorrentTV)

TorrentTV is the household's Android TV client, built for Android 8.0
(API 26, the 2018 Android TV baseline) through the newest platforms. It runs
the same web application as the Tizen client — identical screens, design,
and behavior (see the Parity contract in
`docs/superpowers/specs/2026-09-05-android-tv-client-design.md`) — inside a
Kotlin WebView shell that plays video on a native surface through media3
ExoPlayer behind the same AVPlay-shaped API the Tizen app uses. The app
displays as TorrentTV with the TT monogram; everything else is
byte-identical to the Tizen bundle. (The same shared TV web application also
serves the LG webOS TV client; see `docs/WEBOS.md` and `docs/adr/0010-webos-tv-client.md`.)
Codec reality matches the Tizen posture: direct play only, so DTS-class audio
or AV1 sources that a 2018-era set cannot decode are avoided by choosing
another release (see `docs/adr/0009`).

## Build the sideload APK

```sh
make torrenttv-apk
```

The build syncs `clients/tv/dist` into the APK assets (replacing only
`index.html` with the Android page variant), runs the Kotlin unit tests
inside the Gradle build, and produces:

```text
clients/android-tv/.build/artifacts/torrent-tv-<VERSION>-android-tv.apk
clients/android-tv/.build/artifacts/torrent-tv-<VERSION>-android-tv.apk.sha256
```

The artifact name rides the repository's `VERSION` train, the same way the
Tizen WGT does. The build needs a JDK 17+ (`JAVA_HOME`) and an Android SDK
(`ANDROID_HOME`) — on the household build machine the script falls back to
the Homebrew locations; CI provides both.

Install by sideload — Android TV treats unknown sources per device
(Settings → Device Preferences → Security & Restrictions):

```sh
adb install clients/android-tv/.build/artifacts/torrent-tv-<VERSION>-android-tv.apk
```

Updates are manual: install the newer APK over the old one (same
application id, higher `versionCode`, same signing key). CI checks that the packaged web
assets are byte-identical to the Tizen bundle and smoke-boots the real APK
on an API 26 Android TV emulator.

## Versioning and signing

`versionName` is the `VERSION` file. `versionCode` is derived as
`major * 10000 + minor * 100 + patch` (0.9.8 becomes 908), so it rises with
every release as long as minor and patch stay below 100; the build fails on
a `VERSION` that is not `major.minor.patch` or breaks that bound, and a
`verifyVersion` Gradle task fails the build if the derived values drift.
Moving from the old hardcoded `versionCode = 1` to 908 is one-way for
installed builds; any future scheme must stay monotonic.

Release builds are signed with one fixed keystore read from environment
variables (CI supplies them from secrets); the keystore is never committed:

```text
TORRENTTV_KEYSTORE_PATH, TORRENTTV_KEYSTORE_PASSWORD,
TORRENTTV_KEY_ALIAS, TORRENTTV_KEY_PASSWORD
```

If any is unset the build prints a warning and signs with the debug key.
Such an APK installs fresh but cannot update a keystore-signed install (and
vice versa); uninstall first. Keep the one keystore: losing it breaks the
update path for every installed device. Upgrade installs over a previous
build are unverified on hardware.

## Physical-TV verification log

Behavior counts as confirmed only by direct observation on a named device
(same posture as `docs/TIZEN.md`). No Android TV hardware is named yet;
every API 26+ result so far comes from the CI emulator.

| Device | Platform | Verified versions | Notes |
| ------ | -------- | ----------------- | ----- |
| (none named yet) | — | — | CI emulator `android-tv; API 26` is the only exercised floor |

Unverified on hardware: the WebView navigation lock (only the app-assets
origin loads) and the `openExternal` http(s)-only check. The URL decisions
are covered by JVM unit tests (`UrlPolicyTest`); the WebView and intent
behavior has not been observed on a device.
