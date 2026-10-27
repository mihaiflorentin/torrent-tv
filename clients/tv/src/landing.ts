import { useEffect, useRef } from 'preact/hooks';
import { focusElement, remoteAction, visibleFocusables } from './navigation';

// Landing focus: where the D-pad cursor goes when a screen opens (menu route
// change, closing a title page or dialog, a search finishing). The rule is
// attribute based so any screen gets it by tagging what it draws with
// data-landing:
//   card     a tile or row of the screen's content (poster, category tile,
//            job, download)
//   control  the screen's primary control when it outranks the cards (the
//            Home hero button, the Search field)
//   chrome   screen furniture (a hub's tab strip, the Reload library action of
//            an empty catalog); it is never a landing target while anything
//            else exists, and among it the selected tab comes first
// Candidates are ranked by data-focus-row, then data-focus-col, so the first
// card of the first rail wins whatever the DOM order. An untagged content
// control (the first setting, a project link) is the fallback when a screen
// has no cards.

export type LandingRank = 'primary' | 'fallback' | 'chrome';

const rowOf = (element: HTMLElement) => Number(element.dataset.focusRow);
const colOf = (element: HTMLElement) => Number(element.dataset.focusCol);
const byPosition = (a: HTMLElement, b: HTMLElement) => rowOf(a) - rowOf(b) || colOf(a) - colOf(b);

export function pickLanding(elements: HTMLElement[], options: { cardsOnly?: boolean; allowChrome?: boolean } = {}): { target: HTMLElement | null; rank: LandingRank | null } {
  const content = elements.filter(element => element.dataset.focusRegion === 'content' && Number.isFinite(rowOf(element)) && Number.isFinite(colOf(element)));
  const kind = (element: HTMLElement) => element.dataset.landing;
  const primary = content.filter(element => options.cardsOnly ? kind(element) === 'card' : kind(element) === 'card' || kind(element) === 'control').sort(byPosition)[0];
  if (primary) return { target: primary, rank: 'primary' };
  if (options.cardsOnly) return { target: null, rank: null };
  const fallback = content.filter(element => kind(element) !== 'chrome').sort(byPosition)[0];
  if (fallback) return { target: fallback, rank: 'fallback' };
  const furniture = options.allowChrome ? content.filter(element => kind(element) === 'chrome').sort(byPosition) : [];
  const chrome = furniture.filter(element => element.getAttribute('aria-selected') === 'true')[0] || furniture[0];
  return chrome ? { target: chrome, rank: 'chrome' } : { target: null, rank: null };
}

// Best target for the screen as drawn right now; the chrome counts, so a
// screen with nothing else still gets a cursor.
export function landingTarget(): HTMLElement | null {
  return pickLanding(visibleFocusables(), { allowChrome: true }).target;
}

export interface LandingController {
  // Starts watching for a landing target. since: a mark() taken earlier, for an
  // intent that begins after an async wait (a search): any key pressed since
  // the mark already counts as the viewer taking over.
  arm(options?: { cardsOnly?: boolean; since?: number }): void;
  mark(): number;
  cancel(): void;
  dispose(): void;
}

interface LandingTiming {
  // How long the cursor may not rest on the header chrome while cards could still arrive.
  chromeAfterMs?: number;
  // How long an intent keeps watching the screen for better targets.
  windowMs?: number;
}

// An armed intent lands now and keeps watching while cards load. It lets go
// the moment the viewer presses a navigation key, the cursor is moved by
// anything but the intent itself, or its window runs out, so it never
// competes with the viewer.
export function createLanding(timing: LandingTiming = {}): LandingController {
  const chromeAfterMs = timing.chromeAfterMs ?? 1500;
  const windowMs = timing.windowMs ?? 8000;
  let teardown: (() => void) | null = null;
  // Every navigation key (key repeats of the opening press excluded) and touch counts as the viewer acting.
  let keys = 0;
  const onKey = (event: KeyboardEvent) => { if (!event.repeat && remoteAction(event.key, event.keyCode) !== null) keys++; };
  const onPointer = () => { keys++; };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('touchstart', onPointer, true);

  function cancel() {
    teardown?.();
    teardown = null;
  }

  function arm(options: { cardsOnly?: boolean; since?: number } = {}) {
    cancel();
    const baseline = options.since ?? keys;
    let landedOn: HTMLElement | null = null;
    let pending = 0;
    const started = Date.now();
    const attempt = () => {
      pending = 0;
      if (keys !== baseline || Date.now() - started > windowMs) { cancel(); return; }
      const active = document.activeElement;
      const free = !active || active === document.body || active === document.documentElement;
      if (landedOn) {
        // Our own landing is still under the cursor, or was swapped out by a re-render and nothing took the cursor since.
        if (landedOn.isConnected ? active !== landedOn : !free) { cancel(); return; }
      }
      const { target } = pickLanding(visibleFocusables(), { cardsOnly: options.cardsOnly, allowChrome: Date.now() - started >= chromeAfterMs });
      if (!target || target === landedOn) return;
      focusElement(target);
      landedOn = target;
    };
    const schedule = () => { if (!pending) pending = window.setTimeout(attempt, 0); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // The chrome becomes eligible after its grace period even if nothing else changes the DOM.
    const chromeTimer = window.setTimeout(schedule, chromeAfterMs + 5);
    const endTimer = window.setTimeout(cancel, windowMs);
    schedule();
    teardown = () => {
      observer.disconnect();
      window.clearTimeout(pending);
      window.clearTimeout(chromeTimer);
      window.clearTimeout(endTimer);
    };
  }

  function dispose() {
    cancel();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('touchstart', onPointer, true);
  }

  return { arm, mark: () => keys, cancel, dispose };
}

// One controller per mounted screen host; it lets go when the host unmounts.
export function useLanding(): LandingController {
  const holder = useRef<LandingController | null>(null);
  if (!holder.current) holder.current = createLanding();
  useEffect(() => () => holder.current?.dispose(), []);
  return holder.current;
}

// Screens that open a sub-view on their own (a category's items, a back to the
// category list) ask the host to land again instead of owning focus logic.
export const LANDING_REQUEST_EVENT = 'tv-landing';
export function requestLanding(): void {
  window.dispatchEvent(new CustomEvent(LANDING_REQUEST_EVENT));
}
