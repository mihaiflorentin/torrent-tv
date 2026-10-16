import { useEffect, useState } from 'preact/hooks';

// Poster artwork follows focus. Chromium before 76 ignores loading="lazy" and IntersectionObserver clips at
// scroll containers, so every poster of every rail would be requested and decoded at once. Instead the focused
// grid position is published here (Catalog, on content focus) and each rail loads artwork only for the rails
// next to the focused one and the cards around the focused column. The window never shrinks while a rail is
// mounted, so artwork already on screen is never dropped. Nothing here touches focus or the DOM.

/** Cards loaded either side of the focused column; a 1920px screen shows about six. */
export const ART_COLUMN_REACH = 9;

interface FocusPoint { row: number; col: number }
let point: FocusPoint = { row: -1, col: -1 };
const listeners = new Set<() => void>();

export function setFocusPoint(row: number, col: number): void {
  if (!Number.isFinite(row) || !Number.isFinite(col) || (point.row === row && point.col === col)) return;
  point = { row, col };
  Array.from(listeners).forEach(listener => listener());
}
export const resetFocusPoint = () => setFocusPoint(-1, -1);
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

function reachFor(span: RailWindow, current: FocusPoint, previous: ArtReach): ArtReach {
  if (!railNear(span, current.row)) return previous;
  const col = Math.max(0, current.col);
  const lo = Math.max(0, col - ART_COLUMN_REACH);
  const hi = col + ART_COLUMN_REACH;
  if (previous && previous[0] <= lo && previous[1] >= hi) return previous;
  return previous ? [Math.min(previous[0], lo), Math.max(previous[1], hi)] : [lo, hi];
}

/** The inclusive column range of a rail whose artwork should be loaded, or null while focus is far away. Re-renders only when the range grows. */
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
export type RowReach = [number, number];

function rowReachFor(firstRow: number, current: FocusPoint, previous: RowReach | null): RowReach {
  const row = current.row < 0 ? firstRow : current.row;
  const lo = row - ART_ROW_REACH;
  const hi = row + ART_ROW_REACH;
  if (previous && previous[0] <= lo && previous[1] >= hi) return previous;
  return previous ? [Math.min(previous[0], lo), Math.max(previous[1], hi)] : [lo, hi];
}

/** The inclusive row range of a grid whose artwork should be loaded. Starts around `firstRow` and only ever grows. */
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
