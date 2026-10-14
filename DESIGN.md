# Torrent TV design system

## Direction

The product is a private screening archive: Plex-first information density and source transparency, with Netflix-inspired cinematic artwork and restrained reveal. It is not a trademark clone. Static artwork, typography, and selection state carry the experience; autoplay video backgrounds are intentionally excluded.

## Visual language

- Base: near-black charcoal `#090d10`; panels `#11181d`; raised controls `#1a242b`.
- Accent: sea-glass teal `#55dfc1`; TV focus adds a white inner edge and teal outer ring.
- Text: cool white `#f4f7f8`; secondary copy `#a8b3b9`.
- Type: platform/system sans (Arial/Helvetica on Tizen) for reliable offline rendering and predictable TV metrics.
- Corners: compact 8–12 px. Depth comes from tonal separation and artwork shading, not glassmorphism.
- Motion: short 120–200 ms focus/sidebar transitions; honor reduced motion on the browser. No decorative looping animation.

## Information architecture

Home prioritizes Continue Watching, then discovery. The left rail groups Home/Search, My Library, Tracker, and settings/jobs. Canonical titles open into movie versions or show → season → episode → source. Source rows always expose resolution, source/codec where known, size, and seeders.

## TV interaction

The sidebar is compact until focus enters it. Left from content column zero opens it; Right restores the exact prior content control and collapses it. Rows and columns are explicit, vertical movement clamps to the nearest available column, and Back unwinds detail/dialog/player layers before exiting.

Player keys follow the Wake model. On hidden controls the first Left, Right, Up or Down only wakes them and restores Control focus (the toolbar control last used, `play` by default); it never seeks. OK on hidden controls wakes them and activates that control, so Audio and Subtitles open on the first press. With a toolbar control focused, Left and Right move along the toolbar, and Up moves to the timeline. Seeking by one Seek step happens only with Timeline focus (Left and Right, focus stays on the timeline; Down returns to the remembered toolbar control) or with the fast-forward and rewind keys, which work in every state without moving focus and, with the controls hidden, show the position on the OSD without waking the controls. Focus stays on the pressed control after every action, including opening and closing a Player panel. The hide timer re-arms after every key press, a seek does not hold it open, and when it fires the focused control is remembered for the next Wake. If the active element is outside the control list, focus falls back to the remembered control, never the first. Dialogs remember and restore their launcher.

## References and artifacts

Approved design references are stored under `.impeccable/mocks/`; they use fictional artwork and are visual direction only. `PRODUCT.md` records the household/profile and TV-settings product decisions. Browser markup includes the direction contract used for design review.
