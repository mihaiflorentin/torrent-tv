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

The browser app (`web/style.css`) and the desktop shell (`desktop/src/shell.css`) define and use no legacy variable: every value is a `--tt-` token, plus a few layout locals prefixed `--w-` (rail widths, gutter, text measure). `web/style-contract.test.ts` reads both sheets and fails on a `--teal`-style variable, a copied hex color, a looping animation, a transition outside opacity, color, transform and shadow, text under 13 px, a removed outline, a missing reduced-motion block, and a backdrop scrim that would drop muted text below 4.5:1 over an all-white poster. The legacy variables (`--teal`, `--panel`, `--ink` and the rest in `clients/tv/src/tv.css`) remain only where a TV screen has not migrated yet.

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

On the TV nothing a viewer must read goes below 26 px (the existing stylesheet still uses 14 to 25 px in places; #31 raises them). Numbers in source facts keep weight 500 or more.

Font loading. `fonts.css` declares the face only inside `@supports (font-variation-settings: normal)` (Chromium 62+). webOS 4 runs Chromium 53, which cannot apply a weight axis and would render the file's default instance (ExtraBold) at every weight, so it keeps its platform sans. Tizen 5 (Chromium 63), Android TV and every browser get the real face. Both TV startup pages set their `html, body` font from the token too, because an inline `font-family` there would otherwise win over `:root`. `font-display: swap` keeps text visible while the local file loads. The TV builds inline the font into `app.css` as a data URI (Vite library mode, covered by the page `data:` source in the CSP); the browser build emits two hashed `.woff2` files.

### Spacing, shape, targets

- Spacing is a 4 px scale: `--tt-space-1` to `--tt-space-9` = 4, 8, 12, 16, 24, 32, 48, 64, 96. Layouts use margins, not `gap`, on the TV engines (ADR-0006).
- TV safe area is 5% of the canvas: `--tt-tv-safe-x` 96 px, `--tt-tv-safe-y` 54 px. Text and focus rings stay inside it; backdrops and the scrim bleed to the edge. The canvas is fixed at 1920x1080 and scales for 4K output.
- Radii: `--tt-radius-sm` 6, `--tt-radius-md` 10 (buttons, cards), `--tt-radius-lg` 16 (dialogs), `--tt-radius-pill`. Depth comes from tonal separation and the backdrop, not from glass or `backdrop-filter`.
- Targets: `--tt-target-web` 44 px minimum, `--tt-tv-target` 72 px for TV buttons and rows.

### Focus

Focus is two independent signals so it survives an engine that drops one declaration: a solid saffron-light outline (`--tt-focus-ring`, 4 px on TV via `--tt-focus-width-tv`, 3 px in the browser via `--tt-focus-width-web`) drawn outside an offset gap (`--tt-focus-offset`), plus a white inner edge (`--tt-focus-edge`) on the element's own border. On the TV add a scale of `--tt-focus-scale-tv` and the soft halo `--tt-focus-shadow-tv`. The ring sits outside the element, so it contrasts with the surrounding surface (at least 9.8:1) and stays visible on a saffron button. The browser uses `:focus-visible`; the TV stylesheet uses `:focus` because Chromium 63 and 53 lack `:focus-visible`, and TV focus is never pointer-driven. Neighbouring posters in a focused row may dim to about 70% opacity; the focused one never does. `tools/webos_ipk.py` requires the solid outline beside any `button:focus` box-shadow.

### Motion

Transitions only, on opacity, color, transform and shadow: `--tt-dur-fast` 120 ms (focus, press), `--tt-dur-base` 180 ms (menus, rails), `--tt-dur-slow` 260 ms (backdrop crossfade, sidebar), easing `--tt-ease-out`. Nothing loops; no `infinite` and no `@keyframes` in the shared sheets. Never animate `width`, `height`, `top`, `left` or a blur radius. The browser honors `prefers-reduced-motion` by dropping transitions to zero; the TV has no such setting and keeps the short ones.

### Backdrop art

- One blurred layer per screen, behind the rows, sourced from the focused or featured title's backdrop (falling back to its poster). Never one blur per card.
- The blur is static. Change the layer by crossfading opacity over `--tt-dur-slow`; never animate the blur. Browser blur radius is `--tt-backdrop-blur-web` (36 px). On the TV render the layer at half resolution and scale it up with `transform`, with the smaller radius `--tt-backdrop-blur-tv` (18 px); Tizen and webOS GPUs choke on a full-resolution blur. The layer is never larger than the viewport, and the TV never uses `backdrop-filter`.
- Artwork opacity is `--tt-backdrop-art-opacity` (0.55). A scrim sits over it: `--tt-scrim-top` to `--tt-scrim-bottom` vertically, and `--tt-scrim-text` (84% ink) directly under any text block. That keeps body text at 4.5:1 or better over an all-white poster.
- No artwork: the backdrop becomes `--tt-ink` with a soft radial of `--tt-accent-soft`, and the poster fallback shows the title's initial on `--tt-raised`. That state is designed, not an error.
- No autoplay video backdrops.

## Web and desktop layout

The browser app and the desktop shell are pointer and keyboard first, so they use the dense end of the shared scale (15 px secondary text, 44 px minimum targets) and the same palette as the TV, never a second one. Dark only.

- Rail. At 1100 px and wider the left rail is 232 px with labels. From 641 to 1099 px it narrows to 72 px of icons, each with a `title` and a visually hidden label so every item keeps its name. At 640 px and below it becomes a bottom bar with the label under each icon and the selected item marked by a bar on top. The desktop shell keeps a 224 px rail and drops it to a row above the page under 720 px.
- Page. One column of content with a 32 px gutter (24 px on tablets, 16 px on phones), no horizontal scroll from 320 px up. Lists collapse to one column on phones; the title detail becomes a full-screen sheet.
- Home hero. A text panel on the `--tt-scrim-text` scrim beside a sharp 16:9 artwork tile; under 1100 px the columns narrow, on phones the tile moves above the text.
- Detail. A sharp poster beside the title block over the title's backdrop image (not blurred, dimmed by `--tt-backdrop-art-opacity` and a left scrim), so the page keeps exactly one blurred layer. Season tabs, episode rows and version rows follow as text rows; there is no per-episode artwork.
- Backdrop that follows focus. `web/backdrop.tsx` draws one fixed layer behind the page: two image slots that crossfade by opacity over `--tt-dur-slow`, blurred by `--tt-backdrop-blur-web`, under the `--tt-scrim-top` to `--tt-scrim-bottom` gradient. Poster and library cards publish their title's artwork on `pointerenter` and `focus`; the layer rests on the featured title (Home and catalog views) or the first library title (library views) and resets when the view changes. No artwork leaves the tinted radial of `--tt-accent-soft` on `--tt-ink`. Neighbouring cards in a rail dim to 72% while one is hovered or keyboard-focused.
- Version row. A spec strip: resolution with HDR, then quality and codec chips, size and seeders, and the action as a saffron label. Wide rows (640 px and up, by container query) keep it on one line; narrow rows put the facts under the spec. The row is a button for the action plus a separate Details toggle; the toggle is never nested inside the action.
- Focus. Every control uses the global `:focus-visible` ring (3 px, `--tt-focus-ring`, offset 3 px) and a white border; the search field shows the same ring on its wrapper. Selected tabs, switches and menu rows carry a second signal besides saffron (weight, a bar, a check mark or a knob position).
- Motion. The only transitions are on opacity, color, transform and shadow; `prefers-reduced-motion` drops them to zero and the rail arrows scroll without smoothing. Nothing loops: the loading skeleton and the connection-test dot are static, and the volume OSD has no flash.
- Player. The bar is `--tt-controls-surface` over a bottom scrim that is already `--tt-scrim-text` where the title sits; menus are solid `--tt-menu-surface`. The controls keep their order and commands and group into transport, volume, tracks and view.

## Information architecture

Home prioritizes Continue Watching, then discovery. The left rail groups Home/Search, My Library, Tracker, and settings/jobs. Canonical titles open into movie versions or show → season → episode → source. Source rows always expose resolution, source/codec where known, size, and seeders.

## TV interaction

The sidebar is compact until focus enters it. Left from content column zero opens it; Right restores the exact prior content control and collapses it. Rows and columns are explicit, vertical movement clamps to the nearest available column, and Back unwinds detail/dialog/player layers before exiting.

Player keys follow the Wake model. On hidden controls the first Left, Right, Up or Down only wakes them and restores Control focus (the toolbar control last used, `play` by default); it never seeks. OK on hidden controls wakes them and activates that control, so Audio and Subtitles open on the first press. With a toolbar control focused, Left and Right move along the toolbar, and Up moves to the timeline. Seeking by one Seek step happens only with Timeline focus (Left and Right, focus stays on the timeline; Down returns to the remembered toolbar control) or with the fast-forward and rewind keys, which work in every state without moving focus and, with the controls hidden, show the position on the OSD without waking the controls. A seek records a pending target that owns the shown position and current time until AVPlay's `seekTo` succeeds, a playtime within 1 second of the target arrives, or 2 seconds pass; stale playtime is ignored meanwhile, and a seek error is shown as a status message and routed to recovery. Held keys: `event.repeat` is ignored for Enter, Back and Play/Pause, directional repeats keep moving focus, and timeline repeats keep adding Seek steps that commit after the last one. Focus stays on the pressed control after every action, including opening and closing a Player panel. The hide timer re-arms after every key press, a seek does not hold it open, and when it fires the focused control is remembered for the next Wake. If the active element is outside the control list, focus falls back to the remembered control, never the first. Dialogs remember and restore their launcher.

## Player controls surface

This section sets the look and sizes only. It does not touch the Control, Wake and Seek rules in "TV interaction" above: the toolbar order, Timeline focus, Wake behavior, the hide timer and the pending seek all stay as written. The layout and look of the control bar and its menus can be redesigned in #30 inside these rules.

- Surface: the bar is one layer, `--tt-controls-surface` (92% surface) over a bottom scrim. Menus (Audio, Subtitles, speed, and the like) are solid `--tt-menu-surface` on `--tt-overlay` borders. No `backdrop-filter`, so text contrast never depends on the video behind it.
- Position and safe area: the bar sits inside the TV safe area (`--tt-tv-safe-x`, `--tt-tv-safe-y`). The timeline spans the safe width.
- Sizes at 3 m: toolbar buttons are at least `--tt-tv-target` (72 px) high with 40 px icons; the time labels and the title use `--tt-tv-text-body` or larger; menu rows use `--tt-tv-target` height and `--tt-tv-text-body`. The timeline is `--tt-tv-timeline-height` (12 px) and grows to `--tt-tv-timeline-height-focus` (20 px) when Timeline has focus, with the standard focus ring on its handle. In the browser, targets are `--tt-target-web` or larger.
- Focus: the standard ring from "Focus" on every toolbar control and menu row. The pressed or open control keeps a `--tt-accent-soft` fill so an open Player panel is distinguishable from a merely focused control.
- Auto-hide motion: the whole bar fades with one opacity transition of `--tt-controls-fade` (200 ms) in both directions, with no slide and no per-control animation. Hidden controls get `visibility: hidden` after the fade so they cannot take focus, and the Wake handling restores focus to the remembered control. When the hide timer's behavior changes, it changes in the interaction rules, not here. With reduced motion in the browser the fade is instant.
- OSD feedback (volume, mute, seek position) uses the same surface and fades with `--tt-dur-base`; the volume flash plays once per change, never in a loop.

## Information priorities

Each screen shows what helps the viewer decide the next action. Three levels: **primary** (always visible, largest), **secondary** (visible but muted, or shown on focus or hover), **hidden by default** (behind a details control, a focused-row line, or removed). This is a display decision only; the screens keep fetching the same data. Omit a fact when it is unknown instead of printing a placeholder such as "codec unknown", "Year unknown" or "—". "Source" here means the quality attributes of a release, as in the glossary.

Observed before the redesign: poster cards on both clients show seeders, tracker names and source counts, and the web card repeats the rating twice; the web hero and detail header show a summed seeder count; library cards print raw release and file names; Downloads rows print release name, file path and file index; the Player heading shows the tracker and a transfer-mode string; the catalog toolbar prints tracker-sync prose on every page.

| Screen | Primary | Secondary | Hidden by default |
| --- | --- | --- | --- |
| Home hero (web and TV) | Title, year, kind (Movie, or N seasons), overview limited to three lines, one primary action | Genre | Seeders, best resolution, source count |
| Poster card, Home and Browse rows (web and TV) | Poster, title, year, library state (Downloaded, Downloading with percent, Watched) | Best resolution; rating when it has votes (once) | Seeders, tracker names, source count. Exception: a row defined by seeders ("Strong swarms") shows seeders |
| Continue watching and Library cards | Poster or backdrop, title, episode code (S01E02), progress bar with "41% watched" or "Watched" | Year | Tracker, release name, file path, resolution |
| Title detail header | Title, year, kind and season count, genres, overview, play or resume action, Favorite | Library state; one-line resume summary | Summed seeders, tracker badges (they move to each version) |
| Season and episode list | Episode number and title, library state, version count | None on the web: the API carries no per-episode artwork, and the old list repeated the title's backdrop on every row, so rows are text only | Pack release names (shown inside the expanded pack) |
| Version (source) row, the decision point | Resolution with HDR, quality and codec chips, size, seeders, the action label (Play, Play and download) | Tracker badge; audio summary where known (the parsed audio string beside the chips) | Release and file name (one line, shown for the focused row only on TV), release id, category, file index (on the web all of them sit behind the row's Details toggle) |
| Browse, Search and Categories | Search field, media-type filter; result cards as above | Category, resolution and sort controls | Tracker-sync prose (move to the empty state), tracker strip unless a tracker needs setup or is disabled |
| Downloads | Display title with episode, state (percent, speed and ETA while active, Paused, Error), actions | Size, resolution and codec, tracker, "Playable while downloading" | Release name, file path, file index, peers and seeders (inside a Details control), engine route |
| Jobs | Status (a word and an icon), what ran, the last message (the error, or the next attempt time for a waiting job) | Time updated and, once finished, how long it took | Job id, raw logs (Details dialog, newest first) |
| Events (web) | The two catalog actions in plain words (Fetch latest, Rebuild catalog) and the queued message | Observed catalog coverage | Nothing: this page is maintenance actions, not an event log |
| Settings (browser) | Setting groups by task; the status of a group (Connected, Needs attention) once a connection check has run in this session, and tracker readiness from the tracker list. An untested group says nothing | Help text, the Obtain hint | Raw paths, ports and ids in an Advanced group per tab (it opens by itself while one of its fields has an unsaved edit), and the settings file path |
| TV Settings and server | Connected server, Change server (playback preferences join here when TV settings ship) | Version, update state | Diagnostics, device identifiers |
| Player (web and TV) | Title with episode code, position and duration, play state | Current Audio and Subtitles choice (shown on the web buttons: Audio · English, Subtitles · Off) | Tracker, release name, transfer mode (surface it as a status message only while streaming progressively or buffering; the web shows "Streaming while downloading" beside the title in that case only), volume detail on TV |

Rules that follow. A card answers "what is this and where am I with it", so state beats tracker data. Seeders, size and codec appear at the decision point, the version row, because that is where they change a choice. The release name is evidence, not a headline: it is never the largest text when parsed title data exists, and raw release rows (no catalog match) keep it as the title because nothing better exists. Empty and error states state the cause and the next action in one sentence each.

## Support floor for shipped CSS

Everything shipped to the TV runs on Chromium 63 (Tizen 5) and Chromium 53 (webOS 4): no `gap`, `inset`, `aspect-ratio`, `:is()`, `:where()`, `:focus-visible`, `min()`, `max()`, `clamp()`; no 4- or 8-digit hex; grid only with a flex fallback; custom properties are fine (Chromium 49+) but not inside `@media` queries; and comments are scanned too, so do not spell a forbidden construct in a comment. Authored CSS ships verbatim (`cssMinify: false`). `tools/tizen_wgt.py` and `tools/webos_ipk.py` reject violations at pack time; `clients/tv/src/chromium53-css.test.ts` and the design-token test cover the sources.

## Status and unverified

Landed with #29: tokens, the bundled font and its wiring, this document, and the prototypes. Landed with the web re-skin (#31): every screen of the browser app and the desktop shell on the tokens (home, catalog and search, detail, versions, downloads, player, settings, jobs, events, projects, setup prompts, empty and error states), the information priorities above for those screens, and the focus-following backdrop. Component and screen styling of the TV client stays on the legacy teal variables until its own migration lands. Not verified on hardware: legibility at 3 m, overscan, focus visibility, and Bricolage Grotesque rendering on Chromium 63 (Tizen) and the platform-sans fallback on Chromium 53 (webOS). The bundled font is wider than Arial, so dense TV rows need an eye check. Not verified for the web re-skin: rendering in the Wails webviews (the desktop shell was reviewed in Chromium with the Wails bindings stubbed), Safari and WebKitGTK (the version row falls back to its two-row layout where container queries are missing, and the rail dimming needs `:has()`), and real-device phone widths below 390 px (checked in Chromium at 320 px by the stylesheet rules, not by a device).

## References and artifacts

The chosen direction and the two rejected ones are in `docs/design/direction-prototypes.html` (static, fictional artwork, visual direction only). Earlier mocks under `.impeccable/mocks/` show the superseded charcoal and teal identity. `PRODUCT.md` records the household/profile and TV-settings product decisions and the brand commitments. Browser markup includes the direction contract used for design review.
