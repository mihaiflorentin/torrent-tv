# Tizen 5 crash and compatibility gate design

Date: 2026-10-14
Status: Draft, awaiting user review

## Problem

On the household's Tizen 5.0 TV the WGT installs and then fails to run. Tizen 5.0 ships Chromium 63. `TVPromotions` calls `new AbortController()` unguarded, and AbortController needs Chromium 66+. ADR-0006 lists exactly this API as one that must be guarded, but no build gate enforces it.

## Root causes

- `clients/tv/src/main.tsx:864`: `controller = new AbortController()` runs inside `deliver`, called on mount whenever `promotionsVisible` is true. The throw becomes an unhandled rejection and `clients/tv/fatal-error.js` covers Home with the fatal panel. Other call sites already branch on `capabilities.supportsAbortController` (`clients/tv/src/discovery.ts:82`, `clients/tv/src/capability.ts:11`).
- `tools/tizen_wgt.py:24-46` API table has no rule for a bare `new AbortController` and misses several APIs above Chromium 63 (see Design).
- `tools/tizen_wgt.py:250-267` CSS check covers only `gap`-family properties.
- `clients/tv/tsconfig.json` sets `"lib":["ES2020","DOM"]` while `target` is ES2018, so `tsc` accepts ES2019+ runtime APIs (`flatMap`, `trimStart`, `Object.fromEntries`, `Promise.allSettled`).
- `clients/shared/src/index.ts:180` uses `Promise.allSettled` in web-only `PortalSync`. Nothing has confirmed that the TV bundle tree-shakes it away.

## Decisions already made

- Q1: the Tizen 5 TV installs but fails to run.
- Q2: `required_version="5.0"` stays a floor with no ceiling. Tizen 5, 6 and 7 are fixed and tested for; newer platforms are best-effort and should also work.
- Q10: fix the crash, close the gate gap, lower `lib` to ES2018, and grep the built bundle.
- Q4: nothing here counts as hardware-confirmed until observed on a Verified TV.

## Scope

In:
- Guard the promotions `AbortController` through the existing capability module and degrade to no cancellation (timeout only) when absent.
- Extend `tools/tizen_wgt.py` API rules and CSS rules.
- Lower the `lib` in `clients/tv/tsconfig.json` to `["ES2018","DOM"]` and fix the type errors this exposes.
- A bundle check that builds `clients/tv` and fails on banned APIs in `dist`.

Out: performance work, dead-code cleanup, the SSE heartbeat, the discovery fetch leak on Tizen 5 (`clients/tv/src/discovery.ts:64-75`), and any visual change.

## Design

### Promotions guard

`TVPromotions.deliver` reads `detectCapabilities().supportsAbortController`. When true, behavior is unchanged. When false it skips the controller, passes no `signal`, and relies on the existing `cancelDelivery` timer reset so that a late response after unmount is ignored through the `stopped` flag. Any promotion failure is caught locally and never reaches the fatal panel.

### Validator additions

API rules in `tools/tizen_wgt.py` (Chromium version in parentheses, rejected when above 63):
- `trimStart`/`trimEnd` (66), `replaceChildren` (86), `Object.hasOwn` (93), `findLast`/`findLastIndex` (97), `toSorted`/`toReversed`/`with` (110), `Promise.withResolvers` (119), regex named groups and `\p{...}` (64).
- Bare `new AbortController`: allowed only inside a function that also contains a `typeof AbortController` or `supportsAbortController` guard. If a reliable structural check is not feasible in the regex engine the validator uses, reject every occurrence and keep one allowlisted call site in `discovery.ts` with a comment.

CSS rules: reject `inset`, `aspect-ratio`, `:is(`, `:where(`, `:focus-visible`, and `min(`/`max(`/`clamp(` in shipped CSS and inline `<style>`. `accent-color` stays allowed (a no-op on old engines).

The rule list is table-driven so adding a rule needs no new code path. Each rule gets a positive and a negative fixture under `tools/tests`.

### Type gate

`lib: ["ES2018","DOM"]` still allows `Promise.prototype.finally` (Chromium 63). Any error `tsc` reports after the change is fixed in source, not suppressed.

### Bundle check

A script step runs the TV build and greps `clients/tv/dist/app.js` for `allSettled`, `flatMap`, `AbortController` (outside the guarded sites), and un-lowered `?.` and `??`. It runs in the same place as the existing validator gate and the headless old-engine smoke (`tools/smoke_tizen_engine`).

## Test strategy

- vitest: a test for `TVPromotions` with `supportsAbortController: false` that mounts, delivers, and asserts no throw and one request without `signal`. A second test with true asserts `signal` is passed and aborted on unmount.
- Python (`tools/tests`): one fixture per new validator rule, plus a fixture proving the guarded call site passes.
- The headless old-engine smoke boots the built artifact with promotions enabled so the original crash would fail CI.

## Verification

- Automated: validator, `tsc`, vitest, bundle grep, headless old-engine smoke.
- Unverified on hardware: launch on the 2019 Tizen 5.0 TV with promotions enabled. Record the result in the verification log kept in `docs/TIZEN.md`. Behavior on a Tizen 6 and a Tizen 7 set (the S90C is Tizen 7) is checked separately and logged per generation.

## Risks

- Lowering `lib` may surface type errors in `clients/shared`, which also builds for web and Android. Fixes must not change web behavior.
- A stricter bare-`AbortController` rule can reject legitimate guarded code if the structural check is too coarse. The allowlist fallback keeps the gate shut by default.
- The emulated smoke proves bundle boot only, not firmware behavior (ADR-0006).

## ADR and glossary impact

No new ADR. ADR-0006's authoring rules gain the new validator coverage in its Consequences section. No glossary change.
