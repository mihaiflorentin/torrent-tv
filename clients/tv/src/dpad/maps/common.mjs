// Pieces every top-level screen shares. See ../model.mjs for the map format.

/** Visible while the rail's current route is `route` (the shell, not a title page, is drawn). */
export const onRoute = route => `[data-menu-route="${route}"][aria-current="page"]`;

/**
 * The header Refresh button (chrome: never a landing, row 0 of every screen). Up and Right stay,
 * Left opens the rail, Back opens the rail like anywhere at the top level of a screen.
 */
export const header = down => ({ 'header-retry': { up: 'stay', down, left: 'rail', right: 'stay', back: 'rail' } });

/** A horizontal list (a poster rail, a chip row): Left at its start opens the rail, Right at its end stays. */
export const row = (keys, { up, down, ...rest }) => ({ keys, each: { up, down, left: '-1', right: '+1' }, start: { left: 'rail' }, end: { right: 'stay' }, ...rest });

/**
 * Lines of stops stacked top to bottom (a grid, a stack of rails, a list with buttons):
 * Up/Down keep the column (nearest data-focus-col), Left/Right move within the line.
 */
export const lines = (keys, { up, down, ...rest }) => ({ keys, each: { up: '-row', down: '+row', left: '-1', right: '+1' }, top: { up }, bottom: { down }, start: { left: 'rail' }, end: { right: 'stay' }, ...rest });
