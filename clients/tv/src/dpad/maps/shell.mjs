// The rail and Home. See ../model.mjs for the map format.
import { lines, onRoute, row } from './common.mjs';
import { infoPanel } from './title.mjs';

export const rail = {
  name: 'rail',
  notes: 'The six hubs: Home, Search, Library, Discover, Downloads, Settings. Opened by Left from column 0 of any screen (here: the Home hero) with the current hub focused. Up/Down walk the hubs and stop at both ends; OK opens a hub (Library and Discover on their last-used tab); Right and Back close it and return to the exact control it was opened from.',
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
  notes: 'Hero (the primary, then Info and My List as icon buttons in columns 1 and 2), Continue watching (landscape cards), Recently added, the extra rails (each loads when the rail above it takes focus), My List. Lands on the hero primary. Up/Down keep the column (Down from Info or My List enters Continue watching at that column; Up from a card past column 2 comes back to My List); Left from column 0 of any row opens the rail; Right at the end of a row stays. OK on Info opens the Info panel (map home-info); OK on My List toggles it in place.',
  detect: onRoute('home'),
  regions: ['content'],
  reach: [],
  landing: 'hero[first]',
  stops: {},
  groups: {
    hero: { keys: '^hero-', each: { up: 'stay', down: 'continue[same]', left: '-1', right: '+1', back: 'rail' }, start: { left: 'rail' }, end: { right: 'stay' } },
    continue: row('^library-', { rows: 3, up: 'hero[same]', down: 'recent[same]' }),
    recent: row('^title-', { up: 'continue[same]', down: 'more[same]' }),
    more: lines('^rail-', { up: 'recent[same]', down: 'favorites[same]', optional: true }),
    favorites: row('^library-', { rows: 20, up: 'more[same]', down: 'stay' }),
  },
  bursts: [
    // Pages of 12 load as the cursor nears the end; a held Right must keep going through them.
    { from: 'recent[first]', key: 'right', presses: 40 },
    { from: 'hero[first]', key: 'right', expect: 'hero[last]' },
    { from: 'hero[first]', key: 'down', expect: 'favorites[first]', presses: 12 },
    { from: 'favorites[first]', key: 'up', expect: 'hero[first]', presses: 12 },
  ],
};

export const homeInfo = infoPanel({
  name: 'home-info',
  notes: 'Info panel over Home, opened from the hero Info button: summary, cast, fine print. Back or Close returns to Info.',
  opener: 'home:hero[1]',
  reach: [{ focus: '[data-focus-key^="hero-info-"]' }, { press: 'enter' }],
});
