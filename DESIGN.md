# Torrent TV design system

## Direction

**Velvet Booth.** The product is a private screening room: a dark house with one warm light. Aubergine-black surfaces, a saffron accent, one characterful variable typeface, and a blurred poster backdrop that follows focus. It is not a trademark clone of any streaming product. Static artwork, typography and selection state carry the experience; autoplay video backgrounds are intentionally excluded.

Decisions recorded for ticket #29 (parent spec `docs/superpowers/specs/2026-10-14-visual-redesign-design.md`; the three prototypes and the reasons two were rejected are in `docs/design/direction-prototypes.html`):

- Accent: amber/saffron, `#ffab2e`. Set against violet-black it is a complement, which is what keeps it apart from gold-on-grey media apps.
- Font: one bundled variable family, Bricolage Grotesque (SIL OFL 1.1, bundled offline, Latin plus Latin Extended for Romanian diacritics, about 60 KB).
- Artwork: a single blurred poster layer behind rows, following the focused title, with a scrim that guarantees text contrast. Posters themselves stay sharp. Titles without artwork get a designed tinted backdrop, never an empty hole.
- One visual language for the browser app and the TV client. Both import the same token file. Density differs by platform through the type scale and target sizes, never through a second palette.
- Dark only. There is no light theme.
- Signature: the backdrop follows focus. Beside it, source facts (resolution, codec, size, seeders) sit in a spec strip set apart from titles.

Hard limits that hold for every screen: an original look, legibility at 3 m on the TV, an obvious focus state that does not depend on one CSS feature, no looping decorative animation, contrast at WCAG AA, and CSS that stays inside the support floor below.

## Tokens

The single source is `clients/shared/design/tokens.css` (custom properties, all prefixed `--tt-`) and `clients/shared/design/fonts.css` (the bundled face). Entry points import them as `@torrent-tv/shared/design/fonts.css` and `@torrent-tv/shared/design/tokens.css`: `clients/tv/src/main.tsx` (so the Tizen, webOS and Android builds get them), `web/src.tsx`, and `desktop/src/App.tsx`. Screens read tokens with `var(--tt-...)` and never copy a hex value. `clients/shared/src/design-tokens.test.ts` checks the file: required names, contrast, the forbidden-CSS list, motion limits and the font rules.

The legacy variables (`--teal`, `--panel`, `--ink` and the rest) are gone from the TV client: ticket #30 rewrote `clients/tv/src/tv.css` and `performance.css` on the `--tt-` tokens, and `clients/tv/src/design-tokens.test.ts` fails if a legacy variable, a colour of its own (other than video black and subtitle white) or a literal TV font size under 26 px comes back. The browser app (`web/style.css`) keeps its legacy variables until ticket #31 migrates it.

### Palette

| Token | Value | Role |
| --- | --- | --- |
| `--tt-ink` | `#0e0a15` | Page background |
| `--tt-surface` | `#17111f` | Panels, rows |
| `--tt-raised` | `#221a2e` | Cards, inputs, menus |
| `--tt-overlay` | `#2c2239` | Dialogs and the player menu |
| `--tt-line` / `--tt-line-strong` | `#3b3050` / `#7a6e92` | Hairlines / control boundaries (3:1 on surfaces) |
| `--tt-text` | `#f8f2ea` | Primary text, 13.5:1 to 17.6:1 on every surface |
| `--tt-text-muted` | `#bdb3cc` | Secondary text, 7.5:1 to 9.8:1 |
| `--tt-accent` | `#ffab2e` | Selection, primary action, progress; 8:1 to 10.4:1 |
| `--tt-accent-hover` / `--tt-accent-deep` | `#ffbc55` / `#d98a0b` | Hover and pressed fills |
| `--tt-on-accent` | `#1d1200` | Text on a saffron fill, 9.8:1 |
| `--tt-ok` / `--tt-warn` / `--tt-danger` / `--tt-info` | `#5fdca4` / `#ffd166` / `#ff7b86` / `#8fc4ff` | Status, each at least 6.7:1 on surfaces |

Rules. Saffron means "you are here" or "do this"; it is never the only signal of a state. Status colors always travel with an icon or a word (`Downloaded`, `Needs attention`). Because warn sits close to saffron in hue, warn text uses `--tt-warn` on a surface and never on a saffron fill. Translucent colors are written `rgba()`; the TV engines reject 4- and 8-digit hex.

### Type

One family. `--tt-font-sans` is `"Bricolage Grotesque", system-ui, "Segoe UI", Arial, "Helvetica Neue", sans-serif`. Body copy uses weight 400 to 500, titles 700, the display size 800. Line height 1.15 for headings and 1.45 for body.

| Role | Web (`--tt-text-*`) | TV at 1920x1080 (`--tt-tv-text-*`) |
| --- | --- | --- |
| meta, captions, badges | xs 13 px | meta 26 px |
| secondary and body | sm 15 px, md 16 px | body 30 px |
| lead, row headings | lg 20 px | lead 36 px |
| section heading | xl 26 px | heading 46 px |
| page title | 2xl 36 px | title 64 px |
| hero | display 52 px | display 92 px |

On the TV nothing a viewer must read goes below 26 px; `clients/tv/src/design-tokens.test.ts` rejects a literal font size under 26 px in `tv.css`. Numbers in source facts keep weight 500 or more.

Font loading. `fonts.css` declares the face only inside `@supports (font-variation-settings: normal)` (Chromium 62+). webOS 4 runs Chromium 53, which cannot apply a weight axis and would render the file's default instance (ExtraBold) at every weight, so it keeps its platform sans. Tizen 5 (Chromium 63), Android TV and every browser get the real face. Both TV startup pages set their `html, body` font from the token too, because an inline `font-family` there would otherwise win over `:root`. `font-display: swap` keeps text visible while the local file loads. The TV builds inline the font into `app.css` as a data URI (Vite library mode, covered by the page `data:` source in the CSP); the browser build emits two hashed `.woff2` files.

### Spacing, shape, targets

- Spacing is a 4 px scale: `--tt-space-1` to `--tt-space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96. Layouts use margins, not `gap`, on the TV engines (ADR-0006).
- TV safe area is 5% of the canvas: `--tt-tv-safe-x` 96 px, `--tt-tv-safe-y` 54 px. Text and focus rings stay inside it; backdrops and the scrim bleed to the edge. The canvas is fixed at 1920x1080 and scales for 4K output.
- Radii: `--tt-radius-sm` 6, `--tt-radius-md` 10 (buttons, cards), `--tt-radius-lg` 16 (dialogs), `--tt-radius-pill`. Depth comes from tonal separation and the backdrop, not from glass or `backdrop-filter`.
- Targets: `--tt-target-web` 44 px minimum, `--tt-tv-target` 72 px for TV buttons and rows. One exception: the left rail rows are 56 px high, because the rail holds up to 15 destinations and 15 rows at 72 px do not fit 1080 px; their labels stay at body size.

### Focus

Focus is two independent signals so it survives an engine that drops one declaration: a solid saffron-light outline (`--tt-focus-ring`, 4 px on TV via `--tt-focus-width-tv`, 3 px in the browser via `--tt-focus-width-web`) drawn outside an offset gap (`--tt-focus-offset`), plus a white inner edge (`--tt-focus-edge`) on the element's own border. On the TV add a scale of `--tt-focus-scale-tv` and the soft halo `--tt-focus-shadow-tv`. The ring sits outside the element, so it contrasts with the surrounding surface (at least 9.8:1) and stays visible on a saffron button. The browser uses `:focus-visible`; the TV stylesheet uses `:focus` because Chromium 63 and 53 lack `:focus-visible`, and TV focus is never pointer-driven. Neighbouring posters in a focused row may dim to about 70% opacity; the focused one never does. `tools/webos_ipk.py` requires the solid outline beside any `button:focus` box-shadow.

As built on the TV: only poster cards scale under focus (`.poster-card:focus`); every other control keeps its geometry, so lists never shift while the remote moves, and `performance.css` pins `transform: none` for them. The 70% dim is not built, because it needs `:focus-within` (Chromium 60+). A ring is clipped by an `overflow` container, so rails, grids and scrolling lists reserve at least 16 px of padding around their focusable children; a control inside a clipped card (a season pack header) lives outside the card's `overflow` instead.

### Motion

Transitions only, on opacity, color, transform and shadow: `--tt-dur-fast` 120 ms (focus, press), `--tt-dur-base` 180 ms (menus, rails), `--tt-dur-slow` 260 ms (backdrop crossfade, sidebar), easing `--tt-ease-out`. Nothing loops; no `infinite` and no `@keyframes` in the shared sheets. Never animate `width`, `height`, `top`, `left` or a blur radius. The browser honors `prefers-reduced-motion` by dropping transitions to zero; the TV has no such setting and keeps the short ones.

### Backdrop art

- One blurred layer per screen, behind the rows, sourced from the focused or featured title's backdrop (falling back to its poster). Never one blur per card.
- The blur is static. Change the layer by crossfading opacity over `--tt-dur-slow`; never animate the blur. Browser blur radius is `--tt-backdrop-blur-web` (36 px). On the TV render the layer at half resolution and scale it up with `transform`, with the smaller radius `--tt-backdrop-blur-tv` (18 px); Tizen and webOS GPUs choke on a full-resolution blur. The layer is never larger than the viewport, and the TV never uses `backdrop-filter`.
- Artwork opacity is `--tt-backdrop-art-opacity` (0.55). A scrim sits over it: `--tt-scrim-top` to `--tt-scrim-bottom` vertically, and `--tt-scrim-text` (84% ink) directly under any text block. That keeps body text at 4.5:1 or better over an all-white poster.
- No artwork: the backdrop becomes `--tt-ink` with a soft radial of `--tt-accent-soft`, and the poster fallback shows the title's initial on `--tt-raised`. That state is designed, not an error.
- TV as built (`clients/tv/src/backdrop.tsx`): two stacked layers inside the viewport, 960x540 and scaled by 2, blurred at `--tt-backdrop-blur-tv`, only one on at a time; a change preloads the image, then flips the `on` class, so the cost is one decode and one opacity fade. A card or button opts in with `data-art="<url>"` (empty means no artwork and brings the fallback back); a control without `data-art` leaves the art alone; the art follows focus after 180 ms, so a held D-pad key loads only where it stops. Home and the list screens start from the featured or first title, the detail screen holds its own title's art (`follow={false}`), and Setup shows the fallback only. Text blocks that sit on art (the hero, the detail header) carry their own `--tt-scrim-text` panel.
- No autoplay video backdrops.

## Information architecture

Home prioritizes Continue Watching, then discovery. The left rail groups Home/Search, My Library, Tracker, and settings/jobs. Canonical titles open into movie versions or show → season → episode → source. Source rows always expose resolution, source/codec where known, size, and seeders.

## TV interaction

The sidebar is compact until focus enters it. Left from content column zero opens it; Right restores the exact prior content control and collapses it. As built, the rail is one 400 px element revealed with a paint-only `clip`: a 120 px icon strip when compact, the whole panel with labels when open, so opening it never re-lays out the page. Rows and columns are explicit, vertical movement clamps to the nearest available column, and Back unwinds detail/dialog/player layers before exiting.

Player keys follow the Wake model. On hidden controls the first Left, Right, Up or Down only wakes them and restores Control focus (the toolbar control last used, `play` by default); it never seeks. OK on hidden controls wakes them and activates that control, so Audio and Subtitles open on the first press. With a toolbar control focused, Left and Right move along the toolbar, and Up moves to the timeline. Seeking by one Seek step happens only with Timeline focus (Left and Right, focus stays on the timeline; Down returns to the remembered toolbar control) or with the fast-forward and rewind keys (and Next and Previous, a larger step; see Remote keys), which work in every state without moving focus and, with the controls hidden, show the position on the OSD without waking the controls. A seek records a pending target that owns the shown position and current time until AVPlay's `seekTo` succeeds, a playtime within 1 second of the target arrives, or 2 seconds pass; stale playtime is ignored meanwhile, and a seek error is shown as a status message and routed to recovery. Held keys: `event.repeat` is ignored for Enter, Back and Play/Pause, directional repeats keep moving focus, and timeline repeats keep adding Seek steps that commit after the last one. Focus stays on the pressed control after every action, including opening and closing a Player panel. The hide timer re-arms after every key press, a seek does not hold it open, and when it fires the focused control is remembered for the next Wake. If the active element is outside the control list, focus falls back to the remembered control, never the first. Dialogs remember and restore their launcher.

## Remote keys

One table for every remote, handled in the Player by `playerAction` and `PlayerKeyController` (`clients/tv/src/player.ts`, `player-keys.ts`). A key matches by `event.key` name or by `keyCode`, whichever the platform sends. Android TV delivers the key names natively (ticket #27); Tizen needs each name registered through `tizen.tvinputdevice.registerKey` (`registerMediaKeys` in `platform.ts`, one try/catch per key, because a name the firmware lacks throws); webOS delivers the keyCodes without registration.

| Action | Key names | keyCodes | In the Player |
| --- | --- | --- | --- |
| Play | `MediaPlay` | 415 | Plays. Explicit, never toggles. |
| Pause | `MediaPause` | 19 | Pauses and saves the position. Explicit. |
| Play/Pause | `MediaPlayPause` | 10252 | Toggles. Ignored while held. |
| Stop | `MediaStop` | 413 | Saves and leaves the Player, like Back. |
| Rewind | `MediaRewind` | 412 | One Seek step back (10 s). |
| Fast-forward | `MediaFastForward` | 417 | One Seek step forward (10 s). |
| Previous | `MediaTrackPrevious` | 10232 | Skip step back (60 s). |
| Next | `MediaTrackNext` | 10233 | Skip step forward (60 s). |
| Previous episode | `ChannelDown` | 428 | Series: saves progress and starts the previous episode. Otherwise the OSD says "No previous episode". |
| Next episode | `ChannelUp` | 427 | Series: saves progress and starts the next episode. Otherwise the OSD says "No next episode". |
| Back | `GoBack`, `BrowserBack`, `XF86Back`, `Back` | 27, 10009 (Tizen), 461 (webOS) | Closes a Player panel, else leaves. |

Rules:

- Channel up and down are the episode skip (the episode queue): `POST /downloads/{id}/next-episode` and `/previous-episode` resolve the sibling from the series hierarchy. The Player saves the current progress first, drops any pending seek target, and swaps the player to the sibling; a result that arrives after the Player closed or suspended is discarded. A movie, or the first or last episode, gets a brief OSD notice instead. The Wake model is untouched: the keys never move Control focus, and held repeats are ignored. The media-track keys keep the plain seek: Next and Previous skip a larger step (`SKIP_STEP_MS`, 60 s) rather than change item. They use the same pending seek target, commit timer and clamping as Rewind and Fast-forward, so any mix of the four accumulates into one committed seek.
- Rewind, Fast-forward, Next and Previous work with the controls hidden or visible, repeat while held, and never move Control focus. Hidden, they show the new position on the OSD and leave the controls hidden (the Wake model above); visible, they re-arm the hide timer. Play, Pause and Play/Pause reveal the controls through the existing playback state change and do not move focus either.
- A media key typed while a text field has focus is ignored by the Player (`isEditableTarget`).
- Outside the Player the media keys are not mapped at all (`remoteAction` in `navigation.ts` returns null for them), so D-pad navigation, OK and Back are unaffected. Channel up and down are only the episode skip inside the Player.
- Tizen registers the eight media names plus `ChannelUp` and `ChannelDown`. The colour keys (`ColorF0Red` to `ColorF3Blue`) are deliberately not registered: nothing in the client uses them. The `tv.inputdevice` privilege is already in `clients/tizen/config.xml` and required by `tools/tizen_wgt.py`; the key names themselves are not listed in the config or the validator.
- Not verified on hardware: that each physical remote sends these codes (Channel up and down as episode skip is likewise unverified on hardware) (Samsung and LG remotes differ, and many have no Previous or Next button), that Tizen 5.0 firmware accepts every name, and that Channel up and down reach the page on both platforms. See the Remote keys rows in `docs/TIZEN.md` and `docs/WEBOS-VERIFICATION.md`.

## Player controls surface

This section sets the look and sizes only. It does not touch the Control, Wake and Seek rules in "TV interaction" above: the toolbar order, Timeline focus, Wake behavior, the hide timer and the pending seek all stay as written. Ticket #30 redesigned the bar and its menus inside these rules (as built, below); `player-keys.test.ts` and the lifecycle tests pin that the controls, `data-focus-row` and `data-focus-col` did not move.

- Surface: the bar is one layer, `--tt-controls-surface` (92% surface) over a bottom scrim. Menus (Audio, Subtitles, speed, and the like) are solid `--tt-menu-surface` on `--tt-overlay` borders. No `backdrop-filter`, so text contrast never depends on the video behind it.
- Position and safe area: the bar sits inside the TV safe area (`--tt-tv-safe-x`, `--tt-tv-safe-y`). The timeline spans the bar, which spans the safe width.
- Sizes at 3 m: toolbar buttons are at least `--tt-tv-target` (72 px) high with 40 px icons and a visible label at `--tt-tv-text-meta` (nine labelled buttons only fit the safe width at that size); the time labels use `--tt-tv-text-body`, the title `--tt-tv-text-lead`; menu rows use `--tt-tv-target` height and `--tt-tv-text-body`. The timeline is `--tt-tv-timeline-height` (12 px) and grows to `--tt-tv-timeline-height-focus` (20 px) when Timeline has focus, with the standard focus ring on its handle. In the browser, targets are `--tt-target-web` or larger.
- Focus: the standard ring from "Focus" on every toolbar control and menu row. The pressed or open control keeps a `--tt-accent-soft` fill so an open Player panel is distinguishable from a merely focused control.
- Auto-hide motion: the whole bar fades with one opacity transition of `--tt-controls-fade` (200 ms) in both directions, with no slide and no per-control animation. Hidden controls get `visibility: hidden` after the fade so they cannot take focus, and the Wake handling restores focus to the remembered control. When the hide timer's behavior changes, it changes in the interaction rules, not here. With reduced motion in the browser the fade is instant.
- OSD feedback (volume, mute, seek position) uses the same surface and fades with `--tt-dur-base`; the volume flash plays once per change, never in a loop. On the TV the status message keeps its last text mounted while it fades out.
- Layout as built: a heading row (the title, with the episode code, left; the current Audio and Subtitles choice, muted, right), the timeline, the two time labels, then the toolbar in the existing order with a wider break before Audio and before Back. The timeline button keeps one 36 px height; only the drawn track grows to 20 px on focus, so nothing below it moves. Audio, Subtitles and Options carry `aria-expanded` and the accent-soft fill plus bottom bar while their Player panel is open. The Player panel sits at the top right inside the safe area, 700 px wide, scrolling when it holds more than six rows.

## Information priorities

Each screen shows what helps the viewer decide the next action. Three levels: **primary** (always visible, largest), **secondary** (visible but muted, or shown on focus or hover), **hidden by default** (behind a details control, a focused-row line, or removed). This is a display decision only; the screens keep fetching the same data. Omit a fact when it is unknown instead of printing a placeholder such as "codec unknown", "Year unknown" or "—". "Source" here means the quality attributes of a release, as in the glossary.

Observed before the redesign: poster cards on both clients show seeders, tracker names and source counts, and the web card repeats the rating twice; the web hero and detail header show a summed seeder count; library cards print raw release and file names; Downloads rows print release name, file path and file index; the web Player heading shows the tracker and a transfer-mode string; the catalog toolbar prints tracker-sync prose on every page. On the TV specifically: the hero fell back to "N versions, up to N seeders", the title header printed tracker names and "Year unknown", version rows always printed the file name and "codec unknown", Downloads rows ran to ten lines with the file path, index and peers, Jobs rows printed job ids, the Player heading was the file path, and Settings showed the eight connection tests at all times.

| Screen | Primary | Secondary | Hidden by default |
| --- | --- | --- | --- |
| Home hero (web and TV) | Title, year, kind (Movie, or N seasons), overview limited to three lines, one primary action | Genre | Seeders, best resolution, source count |
| Poster card, Home and Browse rows (web and TV) | Poster, title, year, library state (Downloaded, Downloading with percent, Watched) | Best resolution; rating when it has votes (once) | Seeders, tracker names, source count. Exception: a row defined by seeders ("Strong swarms") shows seeders |
| Continue watching and Library cards | Poster or backdrop, title, episode code (S01E02), progress bar with "41% watched" or "Watched" | Year (TV: movies only, an episode shows its code instead) | Tracker, release name, file path, resolution |
| Title detail header | Title, year, kind and season count, genres, overview, play or resume action, Favorite | Library state; one-line resume summary; Refresh data (TV: the explanation sits in the button's label for assistive tech, not on screen) | Summed seeders, tracker badges (they move to each version) |
| Season and episode list | Episode number and title, library state, version count | Episode artwork (web only; the TV has no episode art) | Pack release names (shown inside the expanded pack) |
| Version (source) row, the decision point | Resolution with HDR, quality and codec chips, size, seeders, the action label (Play, Play and download) | Tracker badge (TV: tracker name as muted text); audio summary where known | Release and file name (one line, shown for the focused row only on TV, behind a details control on the web), release id, category, file index |
| Browse, Search and Categories | Search field, media-type filter (web); result cards as above | Category, resolution and sort controls (TV: the four sort buttons and a category chip; it has no media-type or resolution filter) | Tracker-sync prose (move to the empty state), tracker strip unless a tracker needs setup or is disabled (the TV never had either) |
| Downloads | Display title with episode, state (percent, speed and ETA while active, Paused, Error), actions | Size, resolution and codec, tracker, "Playable while downloading" | Release name, file path, file index, peers and seeders (inside a Details control), engine route |
| Jobs and Events | Status, what ran, the last message | Time and duration (TV Events page: the two catalog actions, Fetch latest and Rebuild catalog, with the release counts muted) | Job ids, raw logs (open on demand, newest first) |
| Settings (browser) | Setting groups by task, the status of each group (Connected, Needs attention) | Help text, the Obtain hint | Raw paths and ids under Advanced |
| TV Settings and server | Playback preferences (audio and subtitle languages, watched threshold), tracker switches with their readiness, Save; the connected server and Change server | Background-work limits, Pirate Bay addresses, the engine ownership note, version and update state with its notice | Connection tests (a disclosure, closed by default), device identifiers (never shown) |
| Player (web and TV) | Title with episode code, position and duration, play state | Current Audio and Subtitles choice | Tracker, release name, transfer mode (surface it as a status message only while streaming progressively or buffering; on the TV, Options, then Playback information, opens the tracker and file facts on demand), volume detail on TV |

Rules that follow. A card answers "what is this and where am I with it", so state beats tracker data. Seeders, size and codec appear at the decision point, the version row, because that is where they change a choice. The release name is evidence, not a headline: it is never the largest text when parsed title data exists, and raw release rows (no catalog match) keep it as the title because nothing better exists. Empty and error states state the cause and the next action in one sentence each.

## Support floor for shipped CSS

Everything shipped to the TV runs on Chromium 63 (Tizen 5) and Chromium 53 (webOS 4): no `gap`, `inset`, `aspect-ratio`, `:is()`, `:where()`, `:focus-visible`, `min()`, `max()`, `clamp()`; no 4- or 8-digit hex; grid only with a flex fallback (the TV stylesheet uses no grid at all, and keeps the empty-handed `@supports not (display: grid)` block that `tools/webos_ipk.py` requires); custom properties are fine (Chromium 49+) but not inside `@media` queries; and comments are scanned too, so do not spell a forbidden construct in a comment. Authored CSS ships verbatim (`cssMinify: false`). `tools/tizen_wgt.py` and `tools/webos_ipk.py` reject violations at pack time; `clients/tv/src/chromium53-css.test.ts` and the design-token test cover the sources.

## Status and unverified

Landed with #29: tokens, the bundled font and its wiring, this document, and the prototypes. Landed with #30: the TV client on the tokens (every screen, the Player controls surface, the focus-following backdrop, the per-screen information priorities above), the startup and fatal-error pages, and the empty, loading and error copy. Still to do in #31: the browser app and desktop. Not verified on hardware: legibility at 3 m, overscan, focus visibility on Tizen and webOS sets, the toolbar fitting the safe width with the platform font on webOS and with a two-digit track count, the backdrop blur and crossfade cost on old GPUs, and Bricolage Grotesque rendering on Chromium 63 (Tizen) and the platform-sans fallback on Chromium 53 (webOS). Screens were checked only in desktop Chromium at 1920x1080 against a mock server; the old-engine smoke runs (Chromium 53 and 63, Docker) were not run.

## References and artifacts

The chosen direction and the two rejected ones are in `docs/design/direction-prototypes.html` (static, fictional artwork, visual direction only). Earlier mocks under `.impeccable/mocks/` show the superseded charcoal and teal identity. `PRODUCT.md` records the household/profile and TV-settings product decisions and the brand commitments. Browser markup includes the direction contract used for design review.
