// The browser app's icon component, drawing the TV client's line icon set (clients/tv/src/icons.tsx, #53)
// so both apps speak one visual vocabulary: a 24 px grid, 2 px strokes with round caps and joins, drawn in
// currentColor. Play, pause, the rating star and the "more" dots are solid shapes. The shapes are copied
// here rather than imported, because the browser app does not depend on the TV client; keep the two sets in
// step when an icon changes (web/icons.test.tsx checks the shared names draw the same shapes). A few icons
// only the browser needs (alert, clock, refresh, user, bug, close, trash) follow the same rules. Every
// icon is decorative (aria-hidden): the control beside it carries a visible label or an aria-label.

type Shape =
  | { d: string; solid?: boolean }
  | { cx: number; cy: number; r: number; solid?: boolean }
  | { x: number; y: number; w: number; h: number; rx: number };

export const ICONS: Record<string, Shape[]> = {
  // Rail and hubs (same names and shapes as the TV).
  home: [{ d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }],
  search: [{ cx: 11, cy: 11, r: 7 }, { d: 'm20 20-3.5-3.5' }],
  library: [{ x: 3, y: 3, w: 7, h: 7, rx: 1.5 }, { x: 14, y: 3, w: 7, h: 7, rx: 1.5 }, { x: 3, y: 14, w: 7, h: 7, rx: 1.5 }, { x: 14, y: 14, w: 7, h: 7, rx: 1.5 }],
  continue: [{ cx: 12, cy: 12, r: 9 }, { d: 'M10 8.5v7l6-3.5z' }],
  'my-list': [{ d: 'M6.5 3.5h11a1 1 0 0 1 1 1V21L12 16.5 5.5 21V4.5a1 1 0 0 1 1-1z' }],
  watched: [{ cx: 12, cy: 12, r: 9 }, { d: 'm8 12.5 2.8 2.8L16.5 9.5' }],
  download: [{ d: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14' }],
  categories: [{ d: 'm12 3 9 4.5-9 4.5-9-4.5z' }, { d: 'm3 12 9 4.5 9-4.5' }, { d: 'm3 16.5 9 4.5 9-4.5' }],
  discover: [{ cx: 12, cy: 12, r: 9 }, { d: 'm15.5 8.5-2 5-5 2 2-5z' }],
  browse: [{ x: 3, y: 4, w: 18, h: 16, rx: 2 }, { d: 'M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5' }],
  jobs: [{ d: 'M3 12h4l3-7 4 14 3-7h4' }],
  settings: [{ d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }, { cx: 16, cy: 7, r: 2 }, { cx: 10, cy: 17, r: 2 }],
  external: [{ d: 'M14 4h6v6M20 4l-9 9' }, { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }],
  // Navigation inside a screen.
  'chevron-left': [{ d: 'M15 6l-6 6 6 6' }],
  'chevron-right': [{ d: 'M9 6l6 6-6 6' }],
  'chevron-down': [{ d: 'M6 9l6 6 6-6' }],
  info: [{ cx: 12, cy: 12, r: 9 }, { d: 'M12 11v6M12 7.5v.2' }],
  more: [{ cx: 5, cy: 12, r: 2, solid: true }, { cx: 12, cy: 12, r: 2, solid: true }, { cx: 19, cy: 12, r: 2, solid: true }],
  star: [{ d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z', solid: true }],
  play: [{ d: 'M7 4.5v15l13-7.5z', solid: true }],
  pause: [{ d: 'M6 5h4v14H6zM14 5h4v14h-4z', solid: true }],
  // Browser-only icons, drawn by the same rules.
  check: [{ d: 'm5 12.5 4.5 4.5L19 7.5' }],
  alert: [{ d: 'M12 4 2.8 19.5a.5.5 0 0 0 .4.5h17.6a.5.5 0 0 0 .4-.5z' }, { d: 'M12 10v4.5M12 17.3v.2' }],
  clock: [{ cx: 12, cy: 12, r: 9 }, { d: 'M12 7v5l3 2' }],
  refresh: [{ d: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5' }],
  user: [{ cx: 12, cy: 8, r: 4 }, { d: 'M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5' }],
  bug: [{ x: 7, y: 7, w: 10, h: 13, rx: 5 }, { d: 'M9.5 7V6a2.5 2.5 0 0 1 5 0v1M12 11v9M3.5 13H7M17 13h3.5M4.5 8.5 7.5 10M19.5 8.5 16.5 10M4.5 19l3-2M19.5 19l-3-2' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  trash: [{ d: 'M4 7h16M10 11v6M14 11v6M5.5 7l1 12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1l1-12M9 7V4.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V7' }],
};

function shape(item: Shape, index: number) {
  const paint = 'solid' in item && item.solid ? { fill: 'currentColor', stroke: 'none' } : {};
  if ('d' in item) return <path key={index} d={item.d} {...paint} />;
  if ('cx' in item) return <circle key={index} cx={item.cx} cy={item.cy} r={item.r} {...paint} />;
  return <rect key={index} x={item.x} y={item.y} width={item.w} height={item.h} rx={item.rx} />;
}

/** A line icon; unknown names draw nothing rather than a stray shape. */
export function Icon({ name }: { name: string }) {
  return <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{(ICONS[name] || []).map(shape)}</svg>;
}

/** The app mark: a rounded saffron square with a play shape, as on the TV rail. */
export function AppMark() {
  return <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg></span>;
}
