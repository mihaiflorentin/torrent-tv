// Pieces every top-level screen shares. See ../model.mjs for the map format.

/** Visible while the shell (not a title page) shows `route`. */
export const onRoute = route => `.tv-app[data-route="${route}"]`;

/**
 * The tab strip of a hub (Library, Discover): one focus row above the content. Left from the first tab opens
 * the rail, Right at the last stays, Up stays (nothing is above it), Down enters the content at `down` (its
 * first stop, whatever tab it left), Back opens the rail like anywhere at the top level of a screen. OK on a
 * tab opens that tab's screen; on the selected tab it does nothing.
 */
export const tabs = (down, rest = {}) => ({ keys: '^tab-', each: { up: 'stay', down, left: '-1', right: '+1', back: 'rail', ...rest }, start: { left: 'rail' }, end: { right: 'stay' } });

/** A horizontal list (a poster rail, a chip row): Left at its start opens the rail, Right at its end stays. */
export const row = (keys, { up, down, ...rest }) => ({ keys, each: { up, down, left: '-1', right: '+1' }, start: { left: 'rail' }, end: { right: 'stay' }, ...rest });

/**
 * Lines of stops stacked top to bottom (a grid, a stack of rails, a list with buttons):
 * Up/Down keep the column (nearest data-focus-col), Left/Right move within the line.
 */
export const lines = (keys, { up, down, ...rest }) => ({ keys, each: { up: '-row', down: '+row', left: '-1', right: '+1' }, top: { up }, bottom: { down }, start: { left: 'rail' }, end: { right: 'stay' }, ...rest });
