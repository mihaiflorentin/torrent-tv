// Search and the Tracker screens. See ../model.mjs for the map format.
import { header, lines, onRoute, row } from './common.mjs';

const searchScreen = ({ name, detect, reach, landing, notes }) => ({
  name,
  route: 'search',
  notes,
  detect,
  regions: ['content'],
  reach,
  landing,
  stops: header('field[first]'),
  groups: {
    field: row('^search-(input|submit|clear)$', { up: 'header-retry', down: 'recent[same]' }),
    recent: { ...row('^recent-', { up: 'field[same]', down: 'sorts[same]' }), optional: true },
    sorts: row('^sort-', { up: 'recent[same]', down: 'results[same]' }),
    results: row('^title-', { up: 'sorts[same]', down: 'stay' }),
  },
  bursts: [{ from: 'results[first]', key: 'right', presses: 40 }],
});

export const search = searchScreen({
  name: 'search',
  notes: 'Search before a query: the field (OK starts typing), the sort chips, the catalog as one rail.',
  detect: [onRoute('search'), '[data-focus-key="search-input"]'],
  reach: [{ go: 'search' }],
  landing: 'field[first]',
});

export const searchResults = searchScreen({
  name: 'search-results',
  notes: 'A submitted search: Clear joins the field row, recent searches appear as chips, the cursor lands on the first result.',
  detect: [onRoute('search'), '[data-focus-key="search-clear"]'],
  reach: [{ go: 'search' }, { input: '[data-focus-key="search-input"]', text: 'Kingdom' }, { click: '[data-focus-key="search-submit"]' }, { wait: 800 }],
  landing: 'results[first]',
});

export const tracker = {
  name: 'tracker',
  route: 'tracker',
  notes: 'Tracker dashboard: sort chips, then Recently added (pages in more titles as the cursor nears its end) and Strong swarms (the loaded titles by seeders: its own focus keys, so restoring focus never jumps rails, and it does not page, so it never re-sorts under the cursor).',
  detect: onRoute('tracker'),
  regions: ['content'],
  reach: [{ go: 'tracker' }],
  landing: 'recent[first]',
  stops: header('sorts[first]'),
  groups: {
    sorts: row('^sort-', { up: 'header-retry', down: 'recent[same]' }),
    recent: row('^title-', { up: 'sorts[same]', down: 'swarms[same]' }),
    swarms: row('^tracker-seeded-', { up: 'recent[same]', down: 'stay' }),
  },
  bursts: [{ from: 'recent[first]', key: 'right', presses: 40 }, { from: 'swarms[first]', key: 'right', expect: 'swarms[last]' }],
};

export const browse = {
  name: 'browse',
  route: 'browse',
  notes: 'Browse: sort chips (and the category chip when one is set), then every title as one rail.',
  detect: onRoute('browse'),
  regions: ['content'],
  reach: [{ go: 'browse' }],
  landing: 'results[first]',
  stops: header('sorts[first]'),
  groups: {
    sorts: row('^(sort-|clear-category$)', { up: 'header-retry', down: 'results[same]' }),
    results: row('^title-', { up: 'sorts[same]', down: 'stay' }),
  },
  bursts: [{ from: 'results[first]', key: 'right', presses: 40 }],
};

// Category tiles: data-focus-key "family-<key>"; the family page's own controls also start with "family-".
const TILES = '^family-(?!back$|more$|chip-|sort-|title-)';

export const categories = {
  name: 'categories',
  route: 'categories',
  notes: 'Tracker categories: a grid of family tiles, three to a line.',
  detect: [onRoute('categories'), '.family-tile'],
  regions: ['content'],
  reach: [{ go: 'categories' }],
  landing: 'tiles[first]',
  stops: header('tiles[first]'),
  groups: { tiles: lines(TILES, { up: 'header-retry', down: 'stay' }) },
  bursts: [{ from: 'tiles[first]', key: 'down' }, { from: 'tiles[first]', key: 'right', expect: 'tiles[2]' }],
};

export const catalogFamily = {
  name: 'catalog-family',
  route: 'categories',
  notes: 'One tracker category: back to the tiles, category chips, sort chips, its titles as one rail. Back closes it onto the tile it was opened from.',
  detect: [onRoute('categories'), '[data-focus-key="family-back"]'],
  regions: ['content'],
  reach: [{ go: 'categories' }, { focus: '[data-focus-key^="family-"]' }, { press: 'enter' }],
  landing: 'titles[first]',
  stops: {
    // Back closes the category first, from any stop, before the rail.
    'header-retry': { ...header('family-back')['header-retry'], back: 'categories:tiles[first]' },
    'family-back': { up: 'header-retry', down: 'chips[first]', left: 'rail', right: 'stay', back: 'categories:tiles[first]' },
    'family-more': { optional: true, up: 'titles[first]', down: 'stay', left: 'rail', right: 'stay' },
  },
  groups: {
    chips: row('^family-chip-', { up: 'family-back', down: 'sorts[same]' }),
    sorts: row('^family-sort-', { up: 'chips[same]', down: 'titles[same]' }),
    titles: row('^family-title-', { up: 'sorts[same]', down: 'stay' }),
  },
  bursts: [{ from: 'titles[first]', key: 'right', expect: 'titles[last]' }],
};

export const CATALOG_MAPS = [searchResults, search, tracker, browse, catalogFamily, categories];
