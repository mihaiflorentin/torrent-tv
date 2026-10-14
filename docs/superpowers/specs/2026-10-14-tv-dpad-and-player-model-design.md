# TV D-pad and player interaction model design

Date: 2026-10-14
Status: Draft, awaiting user review

## Problem

On the household's Tizen TV, D-pad focus "jumps all over the place". In the player, focus leaves the control after every choice, time skip feels wrong, and skip sometimes fires while the user is only moving across the controls. The same shared client (`clients/tv`) runs on Tizen, webOS and Android TV, so every fix lands on all three.

The reported player behavior is the written contract in `DESIGN.md` ("Player Left/Right on a hidden overlay reveals and focuses the timeline while seeking ±10 seconds. Timeline Left/Right continues seeking without moving focus."). The contract is the cause, so this spec changes it.

## Root causes (player)

All paths are under `clients/tv/src` unless noted.

1. Every seek moves focus to the timeline: `scrub()` calls `focusControl('timeline')` (`main.tsx:147`). `remember` ignores the timeline (`main.tsx:278`), so Down returns to the control used before the seek (`main.tsx:308`).
2. Controls hide with a toolbar button focused. `ControlsVisibility` hides after 2000 ms (`clients/shared/src/controls-visibility.ts:41`) and `armWhilePaused: true` (`main.tsx:85`) hides regardless of playback state. While hidden, Left/Right route to scrub (`player.ts:52-58`, `main.tsx:284-287`), so the next press skips instead of moving focus. This is the "skip while navigating" bug.
3. A seek hold cancels the hide timer (`controls-visibility.ts:53-60`). FF/RW return before the non-sticky reveal (`main.tsx:295-296`), so the bar stays up until the next directional key.
4. First OK after auto-hide only re-shows the bar (`main.tsx:288`, `player.ts:56`), so Audio or Subtitles do not open.
5. Likely, needs hardware: when `document.activeElement` is outside the control list the handler focuses `elements[0]`, which is the timeline (`main.tsx:301`, `:306`, `:388`). Tizen 5's treatment of focus on a `visibility:hidden` element is unverified.
6. Likely, needs hardware: `seek()` sets `current.current` and the shown position immediately (`main.tsx:143`) while `oncurrentplaytime` keeps writing pre-seek times (`main.tsx:233`) until AVPlay catches up. `seekTo` is called without success or error callbacks and errors are swallowed.
7. Likely, needs hardware: no `event.repeat` handling. Each auto-repeat calls `scrub(10_000)` and restarts the 550 ms commit timer (`main.tsx:147`).

## Root causes (shared client)

- `performance.css:9` (`button:focus,input:focus,select:focus{transform:none;box-shadow:0 8px 24px #000a}`) loads after `tv.css:39-46` and removes the teal ring, leaving only the white border.
- Disabled-while-busy controls (`main.tsx:447`, `:636`, `:703`, `:901`, `:943`) leave `focusableSelector` (`navigation.ts:52`), so remembered focus misses and focus jumps to the top.
- The release link at `main.tsx:839` is an `<a href>`, which `navigation.ts:52` does not match.
- No `event.repeat` guard on Enter or Back (`navigation.ts:245-249`, `main.tsx:300`, `main.tsx:688`). Held Back with no `onLongBack` repeats `onBack` (`navigation.ts:238-243`) and the Setup screen (`main.tsx:446`) has none.
- Expected server errors escape as unhandled rejections and open the fatal panel (`main.tsx:701-702`, `:892`, `:924`, rethrows at `:530`, `:1124`, `:1128`, uncaught `ensureMetadata` at `:495`, `:1022`; panel at `fatal-error.js:153`).
- `useEffect(() => setRemoteTitles(titles.slice()), [titles])` (`main.tsx:494`) resets the list to the first 12 titles on a `metadata.updated` event, discarding loaded pages, search, sort and category.
- `onAppVisibilityChange` only reads `FileListTVPlatform.onVisibility` (`platform.ts:100-108`). Only webOS installs it (`clients/webos/src/webos-platform.ts:105`), so on Tizen AVPlay never stops on background, SSE stays open and nothing refreshes on return.

## Decisions already made

- Q11: fix the confirmed D-pad and focus bugs, with a vitest regression for each where the setup can reach it.
- Q12: add the Tizen visibility fallback and mark it unverified on hardware until tested on the 2019 set.
- Q14: change the player D-pad model as described below, keep focus on the pressed control after every action, and update `DESIGN.md`'s TV interaction paragraph.
- Q4: hardware-dependent causes (5 to 7) are labeled unverified on hardware.
- Perf items (D-pad rect caching, tick throttling, polling gates, list caps) and cleanup items (dead code, React keys, doc drift) are out.

## New player interaction model

Terms are in `GLOSSARY.md`: Wake, Control focus, Seek step, Timeline focus.

| State | Key | Result |
| --- | --- | --- |
| Controls hidden | Left, Right, Up, Down | Wake: reveal controls and restore Control focus (remembered control, `play` by default). No seek, no focus move beyond the restore. |
| Controls hidden | OK | Wake and activate the remembered control. |
| Controls hidden | FF, RW, Next, Previous | Seek by one Seek step; controls stay hidden except the OSD position feedback. |
| Controls visible, toolbar control focused | Left, Right | Move focus along the toolbar. Never seeks. |
| Controls visible, toolbar control focused | Up | Move to the timeline (Timeline focus). |
| Timeline focus | Left, Right | Seek by one Seek step. Focus stays on the timeline. |
| Timeline focus | Down | Return to the remembered toolbar control. |
| Any | FF, RW | Seek by one Seek step. Focus does not move. |
| Any | Play, Pause, Play/Pause | Act. Focus does not move. |
| Any | Back | Close the open Player panel, else save and leave the player. |

Rules:
- Focus stays on the pressed control after every action, including actions that open and close a Player panel (the launcher is restored, as dialogs already do at `main.tsx:119-131`).
- The hide timer is not armed while a toolbar control or the timeline has focus and the controls were revealed by a key press. It arms after the last key press by the existing timeout, and when it fires the focused key is recorded and restored on the next Wake.
- A seek does not hold the hide timer open. FF/RW re-arm it like any other key.
- Seek commits after the 550 ms idle timer as today. The accumulated target is the single source of truth until the commit resolves.
- Held keys: `event.repeat` is ignored for Enter, Back and Play/Pause. Directional repeats keep moving focus. Repeats on the timeline keep accumulating fixed Seek steps committed on release; hold acceleration is out of scope.
- Focus fallback when the active element is not in the control list: the remembered control, never `elements[0]`.

### Seek pending target

`seek()` records a pending target. While it is pending, `oncurrentplaytime` values are ignored for both `current.current` and the displayed position until either the `seekTo` success callback fires or the reported time is within 1 s of the target, with a 2 s timeout as a safety release. The `seekTo` error callback is passed and reported through `setStatus` and the existing `recover` path. Audio-track switches (`main.tsx:336-340`) seek to the pending target if one exists, otherwise to `current.current`.

### Disabled controls

Busy controls use `aria-disabled="true"` with an `onClick` guard instead of `disabled`, so they stay focusable. Focus restore keys off `data-focus-key` when the busy state clears.

### Release link

The release link becomes a focusable button with a `data-focus-key` that calls `openExternalURL`, like the project cards at `main.tsx:638`.

### Focus ring

Remove the `box-shadow` from `performance.css:9`. Keep `transform:none` only where the layout needs it. `tv.css:39-46` owns the ring.

### Errors and list state

- Each action call site (`runAction`, `confirmRemoval`, `TVSeasonPackCard.run`, `confirmDelete`, `ensureMetadata` callers) catches and shows the message through `setStatus` or `setDetailMessage`. The fatal panel stays reserved for startup and unrecoverable failures.
- `metadata.updated` patches `remoteTitles` by id. A reset happens only on an explicit refresh that reapplies the current query, category and sort.

### Visibility fallback

`platform.ts` `onAppVisibilityChange` falls back to `document.hidden` plus the `visibilitychange` event when `FileListTVPlatform.onVisibility` is absent. On hide the player pauses AVPlay and saves position, SSE closes, and on show SSE reopens and the visible-return refresh runs (`main.tsx:1176-1196`). Unverified on hardware: whether Tizen 5 to 7 fire `visibilitychange` on Home press.

## Test strategy

vitest, in `clients/tv/src` and `clients/shared/test`:
- `player.ts` route table: every row above as a case, replacing the cases pinning hidden Left/Right = seek (`player.test.ts:19-20`).
- `ControlsVisibility`: no arming while a control is focused after a key reveal, no hold on seek, FF/RW re-arm.
- Seek pending target: stale `oncurrentplaytime` ignored, released on success callback, on proximity, and on timeout; error callback surfaces.
- Player key handler with a jsdom-style fake: Left/Right on a toolbar control never calls `seekTo`; focus stays on the pressed control after an action; `event.repeat` ignored for Enter and Back.
- Navigation: busy `aria-disabled` control stays in the focus set; release link reachable; fallback focus uses the remembered control.
- Error handling: a rejected `runAction` sets status and does not reach `fatal-error`.
- `metadata.updated` patches in place and keeps pages and query.
- `platform.ts` fallback with a faked `document.hidden` and `visibilitychange`.
- CSS: a test or validator assertion that no later stylesheet overrides the focus ring declaration.

## Verification

Automated: vitest, `tsc`, the TV build, the Tizen validator, the headless old-engine smoke.

Unverified on hardware (record in the Physical-TV verification log in `docs/TIZEN.md`, per generation): the full player walkthrough on the 2019 Tizen 5.0 set and on the S90C (focus stays put after every action, no seek while navigating, OK after hide opens the control, seek lands without a visible jump back, held keys behave), the visibility fallback, focus fallback after `visibility:hidden`, and key-repeat rate. webOS and Android TV behavior is unverified on hardware until named hardware exists.

## Risks

- The new model changes muscle memory for a hidden overlay: Left/Right no longer seeks. FF/RW and the timeline remain for seeking. The OSD must still confirm Seek steps on FF/RW with the controls hidden.
- `aria-disabled` controls must not run their action while busy. Each guard needs a test.
- Ignoring stale playtime for up to 2 s can show a frozen position when AVPlay never reports. The safety timeout bounds it.
- Android's synthetic key events carry no `repeat` flag (`clients/android-tv/.../DpadKeys.kt`), so the `event.repeat` guards only work there after the Android spec sets `repeat` from `KeyEvent.repeatCount`. Until then the guard must not be the only protection for Back and Enter on Android.
- General D-pad jumps may also come from overlapping `data-focus-row` numbers across sections (`navigation.ts:63-85`, `main.tsx:641`, `:708`). Not verified. If the player fixes do not resolve the complaint on hardware, mapping row values per screen is the next step and gets its own spec.

## ADR and glossary impact

No ADR: the change is reversible and local to the client. `GLOSSARY.md` gains Wake, Control focus, Seek step and Timeline focus. `DESIGN.md` TV interaction paragraph is rewritten to the table above during implementation.
