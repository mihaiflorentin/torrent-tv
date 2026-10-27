// The TV icon set: one family of line icons on a 24 px grid, 2 px strokes with round caps and joins, drawn in
// currentColor so an icon takes its control's text colour (white at rest, ground-coloured on a focused white pill).
// Play, pause, the rating star, the "more" dots and the app mark are solid shapes, as on the boards. Every icon is
// decorative (aria-hidden): the control beside it always carries a visible label or an aria-label.

type Shape =
  | { d: string; solid?: boolean }
  | { cx: number; cy: number; r: number; solid?: boolean }
  | { x: number; y: number; w: number; h: number; rx: number };

const ICONS: Record<string, Shape[]> = {
 // Rail and hubs.
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
 // Player toolbar (names kept from the Player's first icon set).
 play: [{ d: 'M7 4.5v15l13-7.5z', solid: true }],
 pause: [{ d: 'M6 5h4v14H6zM14 5h4v14h-4z', solid: true }],
 restart: [{ d: 'M5 5v14' }, { d: 'M19 5.5v13L9 12z' }],
 'back-10': [{ d: 'M11 6.5v11L3.5 12zM20.5 6.5v11L13 12z' }],
 'forward-10': [{ d: 'M13 6.5v11l7.5-5.5zM3.5 6.5v11L11 12z' }],
 audio: [{ d: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z' }, { d: 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11' }],
 subtitles: [{ x: 2.5, y: 5, w: 19, h: 14, rx: 2.5 }, { d: 'M6.5 11h4M13 11h4.5M6.5 15h7' }],
 options: [{ d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }, { cx: 16, cy: 7, r: 2 }, { cx: 10, cy: 17, r: 2 }],
 back: [{ d: 'M20 12H5m0 0 6-6m-6 6 6 6' }],
 hide: [{ d: 'M6 9l6 6 6-6' }],
};

export const ICON_NAMES = Object.keys(ICONS);

function shape(item: Shape, index: number) {
 const paint = 'solid' in item && item.solid ? { fill: 'currentColor', stroke: 'none' } : {};
 if ('d' in item) return <path key={index} d={item.d} {...paint} />;
 if ('cx' in item) return <circle key={index} cx={item.cx} cy={item.cy} r={item.r} {...paint} />;
 return <rect key={index} x={item.x} y={item.y} width={item.w} height={item.h} rx={item.rx} />;
}

/** A line icon from the TV set; unknown names draw nothing rather than a stray character. `class` adds a size or tone. */
export function Icon({ name, class: extra }: { name: string; class?: string }) {
 return <svg class={extra ? `tv-icon ${extra}` : 'tv-icon'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{(ICONS[name] || []).map(shape)}</svg>;
}

/** The app mark: a rounded saffron square with a play shape, used by the rail and the Setup screen. */
export function AppMark({ class: extra }: { class?: string }) {
 return <span class={extra ? `tv-mark ${extra}` : 'tv-mark'} aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg></span>;
}
