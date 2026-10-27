// The rail and Home. See ../model.mjs for the map format.
import { header, lines, onRoute, row } from './common.mjs';

export const rail = {
  name: 'rail',
  notes: 'Opened by Left from column 0 of any screen (here: the Home hero). Up/Down walk the routes in screen order and stop at both ends; Right and Back close it and return to the exact control it was opened from.',
  detect: '.tv-app.menu-open',
  regions: ['sidebar'],
  reach: [{ openRail: true }],
  opener: 'home:hero[first]',
  landing: 'menu-home',
  stops: {
    'menu-home': { up: 'stay', down: 'menu[first]', left: 'stay', right: 'return', back: 'return', ok: 'home:hero[first]' },
  },
  groups: {
    menu: { keys: '^menu-(?!home$)', sample: 'all', each: { up: '-1', down: '+1', left: 'stay', right: 'return' }, first: { up: 'menu-home' }, last: { down: 'stay', back: 'return' } },
  },
  bursts: [
    { from: 'menu-home', key: 'down', expect: 'menu[last]' },
    { from: 'menu[last]', key: 'up', expect: 'menu-home' },
  ],
};

export const home = {
  name: 'home',
  route: 'home',
  notes: 'Hero, Continue watching, Recently added, the extra rails (each loads when the rail above it takes focus), My List. Up/Down keep the column; Left from column 0 of any row opens the rail.',
  detect: onRoute('home'),
  regions: ['content'],
  reach: [],
  landing: 'hero[first]',
  stops: header('hero[first]'),
  groups: {
    hero: { keys: '^hero-', each: { up: 'header-retry', down: 'continue[same]', left: '-1', right: '+1', back: 'rail' }, start: { left: 'rail' }, end: { right: 'stay' } },
    continue: row('^library-', { rows: 3, up: 'hero[same]', down: 'recent[same]' }),
    recent: row('^title-', { up: 'continue[same]', down: 'more[same]' }),
    more: lines('^rail-', { up: 'recent[same]', down: 'favorites[same]', optional: true }),
    favorites: row('^library-', { rows: 20, up: 'more[same]', down: 'stay' }),
  },
  bursts: [
    // Pages of 12 load as the cursor nears the end; a held Right must keep going through them.
    { from: 'recent[first]', key: 'right', presses: 40 },
    { from: 'hero[first]', key: 'down', expect: 'favorites[first]', presses: 12 },
    { from: 'favorites[first]', key: 'up', expect: 'header-retry', presses: 12 },
  ],
};
