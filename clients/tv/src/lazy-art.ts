import { useEffect, useState } from 'preact/hooks';

// Poster artwork follows focus. Chromium before 76 ignores loading="lazy" and IntersectionObserver clips at
// scroll containers, so every poster of every rail would be requested and decoded at once. Instead the focused
// grid position is published here (Catalog, on content focus) and each rail loads artwork only for the rails
// next to the focused one and the cards around the focused column.
//
// The loaded window slides with focus and has hysteresis. Cards within a LOAD distance of the focus always load
// (wider than a 1920px screen shows, so art on screen is never dropped). Cards that already loaded stay loaded
// until they are more than a wider KEEP distance away, so small back-and-forth moves never drop and re-request
// art, while a long walk releases what it left behind (decoded posters are GPU texture memory on a TV). A rail
// more than one rail away from the focused one drops all its art. A hook only sets state when its range changes.
// Nothing here touches focus or the DOM.

/** Cards loaded either side of the focused column; a 1920px screen shows about seven posters (#55) or four landscape cards. */
export const ART_COLUMN_REACH = 8;
/** Loaded cards further than this from the focused column are dropped. */
export const ART_COLUMN_KEEP = 14;

/** Mounted rails follow focus only once it rests this long. A held D-pad key repeats faster, so a walk along a rail
    mounts and decodes no new artwork per press (measured on a 2023 Samsung: each new poster cost 50-280 ms there);
    the cards LOAD-distance ahead were loaded before the walk began, and the window catches up when focus stops. */
export const ART_SETTLE_MS = 180;

interface FocusPoint { row: number; col: number }
let point: FocusPoint = { row: -1, col: -1 };
const listeners = new Set<() => void>();
let settle: ReturnType<typeof setTimeout> | undefined;

function notify(): void { settle = undefined; Array.from(listeners).forEach(listener => listener()); }

/** Publishes the focused grid position. Rails that mount read it at once; mounted ones hear of it after ART_SETTLE_MS of rest. */
export function setFocusPoint(row: number, col: number): void {
  if (!Number.isFinite(row) || !Number.isFinite(col) || (point.row === row && point.col === col)) return;
  point = { row, col };
  if (settle !== undefined) clearTimeout(settle);
  settle = setTimeout(notify, ART_SETTLE_MS);
}
/** Forgets the focus position (route change, unmount) and tells mounted rails at once. */
export const resetFocusPoint = () => {
  if (point.row === -1 && point.col === -1) return;
  point = { row: -1, col: -1 };
  if (settle !== undefined) clearTimeout(settle);
  notify();
};
export const focusPoint = (): FocusPoint => point;

export interface RailWindow { from: number; until: number }

/** Rail windows from the ascending rows of the rendered rails: a rail loads while focus is on the rail before it, on it, or on the one after it. Focus above the first rail counts as the first rail. */
export function railWindows(rows: number[]): RailWindow[] {
  const sorted = rows.slice().sort((a, b) => a - b);
  return rows.map(row => {
    const index = sorted.indexOf(row);
    return { from: index >= 2 ? sorted[index - 1] : -Infinity, until: index + 2 < sorted.length ? sorted[index + 2] : Infinity };
  });
}

export function railNear(span: RailWindow, row: number): boolean { return row >= span.from && row < span.until; }

export type ArtReach = [number, number] | null;

function sameReach(a: ArtReach, b: ArtReach): boolean { return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]); }

/**
 * The window around `center` that was `previous`: always `center` +/- `load`, plus whatever of `previous` still lies
 * within `keep` of the center. Returns `previous` itself when nothing changes, so a state setter can bail out.
 */
export function slideReach(previous: ArtReach, center: number, load: number, keep: number, floor = 0): ArtReach {
  const loadLo = Math.max(floor, center - load);
  const loadHi = center + load;
  const lo = previous && previous[0] >= center - keep && previous[0] <= loadLo ? previous[0] : loadLo;
  const hi = previous && previous[1] <= center + keep && previous[1] >= loadHi ? previous[1] : loadHi;
  return previous && previous[0] === lo && previous[1] === hi ? previous : [lo, hi];
}

function reachFor(span: RailWindow, current: FocusPoint, previous: ArtReach): ArtReach {
  if (!railNear(span, current.row)) return null;
  return slideReach(previous, Math.max(0, current.col), ART_COLUMN_REACH, ART_COLUMN_KEEP);
}

/** Rows loaded either side of the focused row of a long vertical list (the Info panel's seasons, episodes and cast). */
export const ART_LIST_REACH = 8;
/** Loaded rows further than this from the focused row are dropped. */
export const ART_LIST_KEEP = 16;

/** Slides the loaded window of a vertical list to `focused`: it loads around it and keeps earlier rows until they are far. */
export function slideListReach(previous: ArtReach, focused: number): ArtReach {
  return slideReach(previous, Math.max(0, focused), ART_LIST_REACH, ART_LIST_KEEP);
}

/** The loaded window of one vertical list: starts at the top rows, slides with `focus(index)`, restarts with `reset()` when the list changes. Sets state only when the window changes. */
export function useListArtReach(): { reach: ArtReach; focus: (index: number) => void; reset: () => void } {
  const [reach, setReach] = useState<ArtReach>(() => slideListReach(null, 0));
  return {
    reach,
    focus: (index: number) => setReach(previous => slideListReach(previous, index)),
    reset: () => setReach(previous => { const top = slideListReach(null, 0); return sameReach(previous, top) ? previous : top }),
  };
}

/** The inclusive column range of a rail whose artwork should be loaded, or null while focus is far away. Re-renders only when the range changes: it follows the focused column, keeps what is still near, and is null once focus is more than one rail away. */
export function useArtReach(span: RailWindow): ArtReach {
  const [reach, setReach] = useState<ArtReach>(() => reachFor(span, point, null));
  useEffect(() => {
    const update = () => setReach(previous => reachFor(span, point, previous));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [span.from, span.until]);
  return reach;
}

export const inReach = (reach: ArtReach, col: number): boolean => reach !== null && col >= reach[0] && col <= reach[1];

/** Grid rows loaded either side of the focused row for a wrapped grid (Category tiles, library cards). */
export const ART_ROW_REACH = 2;
/** Loaded grid rows further than this from the focused row are dropped. */
export const ART_ROW_KEEP = 4;
export type RowReach = [number, number];

function rowReachFor(firstRow: number, current: FocusPoint, previous: RowReach | null): RowReach {
  // Focus above the grid (its chips, the search field) counts as its first line, so the lines on screen stay loaded.
  return slideReach(previous, current.row < firstRow ? firstRow : current.row, ART_ROW_REACH, ART_ROW_KEEP, -Infinity) as RowReach;
}

/** The inclusive row range of a grid whose artwork should be loaded. Starts around `firstRow`, slides with focus, and sets state only when it changes. */
export function useRowReach(firstRow: number): RowReach {
  const [reach, setReach] = useState<RowReach>(() => rowReachFor(firstRow, point, null));
  useEffect(() => {
    const update = () => setReach(previous => rowReachFor(firstRow, point, previous));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [firstRow]);
  return reach;
}

export const inRowReach = (reach: RowReach, row: number): boolean => row >= reach[0] && row <= reach[1];
