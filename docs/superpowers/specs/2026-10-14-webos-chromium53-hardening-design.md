# webOS Chromium 53 hardening design

Date: 2026-10-14
Status: Draft, awaiting user review

## Problem

The webOS client (ADR-0010) has a Chromium 53 floor (webOS TV 4.0) and builds the shared `clients/tv` source with `target: 'chrome53'` and `cssTarget: 'chrome53'` (`clients/webos/vite.config.ts:40-41`). The audit found shared CSS and one player adapter detail that either fail on Chromium 53 or depend on an unverified build step. No LG hardware exists, so none of this is observable on a TV today.

## Findings

- Focus ring: `clients/tv/src/tv.css:43` (`box-shadow: 0 0 0 5px var(--teal), 0 12px 34px #000b`). Four- and eight-digit hex colors are Chromium 62+; Chromium 53 drops the whole declaration, and with `outline: 0` set at `tv.css:40` the focus indicator disappears. The same notation appears in 14 more declarations (`tv.css:100`, `:103`, `:265`, `:436`, `:538`, `:626`, `:909`, `:1017`, `:1544`, `:1559`, `:1560`, `:1628`, `:1707`, `performance.css:9`). esbuild may lower them because of `cssTarget`, but `cssMinify: false` (`vite.config.ts:42`) makes that unverified; nothing has inspected the built `app.css`.
- Grid without fallback: `.tv-list article` (`tv.css:661-662`) and `.job-log-expanded dl` (`tv.css:765-766`) use `display: grid` / `grid-template-columns`. The `@supports not (display: grid)` block (`tv.css:1840` onward) does not cover them. Chromium 53 supports grid only behind a flag.
- Media event: `clients/webos/src/avplay.ts:378` listens for `stall`. The HTML media event is `stalled`; buffering currently starts only through `waiting`.
- Latent: `Promise.allSettled` (Chromium 76+) at `clients/shared/src/index.ts:180` in `PortalSync.recover`. `clients/webos/src/compat.ts` does not polyfill it. No caller exists in `clients/tv/src`, so it only matters if the webOS bundle pulls `PortalSync`.
- Unverified: `webos-platform.ts:58-62` `exit()` relies on `window.close()` and swallows errors; `docs/WEBOS.md` lists the hardware check as pending.

## Decisions already made

- Q13 option (c): webOS Chromium 53 hardening goes into the bug-fix pass. It covers the `rgba()` focus ring, the grid fallbacks and the `stalled` event name.
- Q4: webOS has no named hardware; every item is marked unverified on hardware.
- Perf items and cleanup are out.

## Scope

In: author colors as `rgb()`/`rgba()` in shipped TV CSS; add a non-shadow focus fallback; grid fallbacks for the two uncovered rules; the `stalled` listener; a build-output check for CSS and the `allSettled` reference; a polyfill or guard decision for `allSettled`.

Out: the webOS exit behavior (documented as pending hardware), Magic Remote pointer work, visual redesign (separate spec; it must follow the same Chromium 53 rules).

## Design

### Colors

Replace every four- and eight-digit hex in `clients/tv/src/*.css` with `rgba()`. `tv.css` is shared by Tizen (Chromium 63, which accepts both) and Android, so the change is behavior-neutral there. Keep three- and six-digit hex.

### Focus indicator fallback

Keep the teal ring as `box-shadow`. Add a second signal that does not depend on `box-shadow` parsing: a solid `border-color: #fff` (already present at `tv.css:41`) plus `outline: 3px solid` in the ring color with `outline-offset: 2px`, removing `outline: 0` from `tv.css:40`. The result is a visible focus state even if the shadow declaration is dropped.

### Grid fallbacks

Extend the `@supports not (display: grid)` block with `display: flex` equivalents for `.tv-list article` (label column grows, trailing control fixed) and `.job-log-expanded dl` (fixed 148 px term column, flexible description) using margin spacing, never `gap`.

### Media event

Listen for `stalled` in addition to `waiting`. Remove the `stall` listener.

### allSettled

Add `core-js/modules/es.promise.all-settled` to `clients/webos/src/compat.ts` next to the existing polyfills. Reason: the shared `PortalSync` is cheap to polyfill and the alternative (proving it is never bundled) is a weaker guarantee than a polyfill.

### Build check

`tools/webos_ipk.py` (or a sibling check run by the same entry point) scans the built webOS `app.css` for four- and eight-digit hex, `display: grid` rules lacking a fallback, and `gap` properties, and scans the built `app.js` for `allSettled` without the polyfill. A Chromium 53-capable headless engine is not available in this environment; if one exists in CI it runs the same smoke style as `tools/smoke_webos_engine`.

## Test strategy

- Python (`tools/tests`): fixtures for each new CSS/JS rule, positive and negative.
- vitest: the `avplay.ts` adapter fires `onbufferingstart` on `stalled` and on `waiting` (an `<video>` stub dispatching each event).
- CSS source test: no four- or eight-digit hex remains under `clients/tv/src`.

## Verification

Automated: the build check, vitest, the existing `tools/smoke_webos_engine`. Unverified on hardware: focus ring visible on a webOS 4 set, list and job-log layouts, buffering indicator on a stalled network. Milestone B (physical-TV verification, ADR-0010) stays open.

## Risks

- Replacing hex with `rgba()` across `tv.css` is a wide mechanical edit; visual diff must be zero. A screenshot comparison in the Tizen smoke would catch drift.
- The `outline` fallback can double-draw on engines that render both ring and outline. Acceptable; the teal ring and outline share a color.
- The flex fallbacks only run on engines without grid, so they cannot be exercised on desktop Chromium without forcing the `@supports` branch. Tests force it by loading the fallback block directly.

## ADR and glossary impact

No new ADR. ADR-0010 gains a note that the shared CSS is authored for Chromium 53 (no 4/8-digit hex, grid fallbacks required). No glossary change.
