# Visual redesign design

Date: 2026-10-14
Status: Draft, awaiting user review. The concrete visual direction is intentionally open and is decided at implementation.

## Problem

The user asked to improve the experience of the web app and the TV clients and gave full creative freedom ("go wild"). `DESIGN.md` and `PRODUCT.md` currently fix the identity: near-black charcoal, sea-glass teal, platform sans, compact corners, no decorative looping animation. The user's pasted answer to Q15 overrides the "polish within the identity" recommendation, so the identity is open.

## Decisions already made

- Q15: option (b), reinvent the look and update `DESIGN.md`.
- Q16: the palette, type and layout are free to change, including the accent color. Dark stays the base because this is a living-room TV.
- Hard limits that survive the redesign:
  - Original. No Plex or Netflix imitation in layout, palette or branding.
  - Readable at 3 m on a TV: large type and generous contrast.
  - An obvious focus state on every focusable control, independent of any single CSS feature.
  - No looping decorative animation. Short transitions are allowed.
  - Shipped TV CSS runs on Chromium 63 (Tizen 5) and Chromium 53 (webOS 4): no `gap`, no `inset`, `aspect-ratio`, `:is()`, `:where()`, `:focus-visible`, `min()`/`max()`/`clamp()`, no four- or eight-digit hex, grid only with a flex fallback.
- Q3: this is feature work, scheduled after the bug-fix specs. Perf and cleanup items stay out.
- Q4: nothing is hardware-verified until observed on a Verified TV.
- Product behavior, information architecture (Home with Continue Watching, left rail, canonical title to version or season to episode to source) and the player interaction model from the D-pad spec do not change. This is a visual and copy redesign, not a new product.

## Scope

In:
- A new visual direction for the web app (`web/`) and the TV client (`clients/tv`), shared tokens where the two can share them.
- Type scale, color tokens, spacing, corner treatment, focus and selection states, artwork treatment, empty and error states, microcopy, and web responsiveness and accessibility.
- Updating `DESIGN.md` and the `PRODUCT.md` Brand Commitments section to the new direction as part of implementation.
- Android TV and webOS inherit the TV client; no separate themes.

Out: new features, new screens, autoplay video backgrounds, profile selectors, platform-specific themes, changes to API or server behavior.

## Constraints that shape the design

- Tizen, webOS and Android all render the same `clients/tv` build; webOS compiles with `cssTarget: 'chrome53'`. Every shipped declaration must be checked against the Tizen validator and the webOS CSS check from the compatibility specs.
- Fonts: the offline WGT and IPK cannot depend on a network font. A custom face must be bundled as a local file, within the size limits of the packaged artifacts, and must render acceptably on Chromium 53. The current choice is platform sans for reliable offline rendering and predictable TV metrics (`DESIGN.md`).
- TV safe area and overscan: text and focus rings stay inside the safe margins at 1920x1080 and scale for 4K output.
- Focus ring and selection state remain the same two-signal system hardened in the webOS spec (shadow plus outline plus border), so a redesign cannot make focus invisible on an old engine.
- The web app has no remote constraint but must stay keyboard-accessible, responsive down to phone width and honor reduced motion.

## Process at implementation

1. Run the `frontend-design` skill for the aesthetic direction: palette (4 to 6 named values), type roles, layout concept, one signature element, reviewed against the generic defaults the skill warns about.
2. Run the `ui-ux-pro-max` skill for the design-system pass: style options, palette, font pairing, UX checks, with `--density` suited to a 3 m TV for the TV client and a separate setting for the web app.
3. Present the direction (mock or screenshot of Home, a detail page, the player controls, the Sources list) to the user for approval before any broad edit.
4. Implement tokens first (CSS custom properties are Chromium 49+, so they are safe), then components, then screens, with a visual-regression capture per screen.
5. Update `DESIGN.md` and `PRODUCT.md`.

## Questions to settle with the user at implementation

- Accent and mood: does teal survive as a reference point or does the new direction break from it entirely?
- Display type: is a bundled custom face acceptable if it fits the size budget and renders on Chromium 53, or should type stay on platform sans with a stronger scale and weight system?
- Artwork treatment: poster-led rails, backdrop-led detail pages, or a mix. Real FileList items often have no artwork, so the no-artwork state must look designed, not broken.
- Web app and TV: one shared visual language, or related but distinct (web denser, TV larger and sparser)?
- Light theme for the web app: required or dark only?

## Design

The direction is not chosen in this spec. The design contract is the list of hard limits above, the process above, and these acceptance criteria:

- Every screen has a designed empty state and a designed error state with a stated cause and next action.
- Source rows keep resolution, source and codec where known, size and seeders, legible at 3 m.
- Focus is visible on every focusable element in the TV client, checked with the declaration-dropping test from the webOS spec.
- Contrast is at least 4.5:1 for body text and 3:1 for large text and focus indicators.
- The web app has no horizontal scroll at 320 px width and every control has a keyboard path and a visible focus style.
- Copy uses plain verbs and names things by what the viewer controls, with one name per action across the flow.

## Test strategy

- CSS source test: no forbidden constructs (the shared forbidden list from the Tizen validator and the webOS check) in `clients/tv/src/*.css`.
- vitest: existing component and navigation tests keep passing; new tests for any behavior added by empty and error states.
- The TV smoke boots the built artifact on the old-engine runtimes with the new CSS and fails on console errors.
- Screenshot capture per key screen in the web app (Playwright or the existing browser tooling if present) at phone and desktop widths, and in the TV client at 1920x1080 on desktop Chromium. Captures are for review, not strict pixel gates.

## Verification

Automated: the build, the validators, vitest, the smoke boots, screenshot capture. Unverified on hardware: legibility at 3 m, overscan and safe areas, focus visibility on both Verified TVs and on any webOS or Android set, font rendering on Chromium 53 and 63, 4K scaling. Each is recorded per TV generation in the verification logs.

## Risks

- The redesign touches the same CSS files as the Chromium 53 hardening and the D-pad fixes. Order matters: land those first so the redesign starts from a hardened base.
- A bundled font adds package size and a Chromium 53 rendering risk with no hardware to confirm it.
- Bold visual change plus old engines is the combination most likely to produce a layout that works on desktop Chromium and breaks on a TV. The old-engine smoke and the forbidden-construct test are the only guards until hardware testing.
- Dropping the teal accent changes how the household recognizes the app. Accepted by Q15 and Q16.

## ADR and glossary impact

No ADR: the visual identity is reversible. `DESIGN.md` is rewritten and `PRODUCT.md` Brand Commitments are updated during implementation. No glossary change unless the redesign renames a user-facing concept.
