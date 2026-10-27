// Search and the Tracker screens. See ../model.mjs for the map format.
import { lines, onRoute, row, tabs } from './common.mjs';

const searchScreen = ({ name, detect, reach, landing, notes }) => ({
  name,
  route: 'search',
  notes,
  detect,
  regions: ['content'],
  reach,
  landing,
  stops: {},
  groups: {
    field: row('^search-(input|submit|clear)$', { up: 'stay', down: 'chips[same]' }),
    // One line (the Search board): the sort chips, then the recent searches and Clear recent when there are any.
    chips: row('^(sort-|clear-category$|recent-)', { up: 'field[same]', down: 'results[same]' }),
    // The results grid, seven to a line (#58). Up and Down keep the column; nearing the end pages in more lines.
    results: lines('^title-', { up: 'chips[same]', down: 'stay' }),
  },
  bursts: [{ from: 'results[first]', key: 'right', expect: 'results[6]' }, { from: 'results[first]', key: 'down', presses: 4 }],
});

export const search = searchScreen({
  name: 'search',
  notes: 'Search before a query: the field (OK starts typing), one line of chips (Sort, then Recent when there are recent searches), the catalog as a grid seven to a line.',
  detect: [onRoute('search'), '[data-focus-key="search-input"]'],
  reach: [{ go: 'search' }],
  landing: 'field[first]',
});

export const searchResults = searchScreen({
  name: 'search-results',
  notes: 'A submitted search: Clear joins the field row and the field shows the result count, the chip line keeps the sort chips and the other recent searches, the cursor lands on the first result of the grid.',
  detect: [onRoute('search'), '[data-focus-key="search-clear"]'],
  reach: [{ go: 'search' }, { input: '[data-focus-key="search-input"]', text: 'Kingdom' }, { click: '[data-focus-key="search-submit"]' }, { wait: 800 }],
  landing: 'results[first]',
});

// Discover: Highlights (route tracker), Browse, Categories. The tab strip is row 0 of each.
const DISCOVER = { hub: 'discover', regions: ['content'] };

export const tracker = {
  name: 'tracker',
  route: 'tracker',
  ...DISCOVER,
  notes: 'Discover > Highlights (the tracker dashboard): the tab strip, sort chips, then Recently added (pages in more titles as the cursor nears its end) and Strong swarms (the loaded titles by seeders: its own focus keys, so restoring focus never jumps rails, and it does not page, so it never re-sorts under the cursor).',
  detect: onRoute('tracker'),
  reach: [{ go: 'tracker' }],
  landing: 'recent[first]',
  stops: {},
  groups: {
    tabs: tabs('sorts[first]'),
    sorts: row('^sort-', { up: 'tabs[selected]', down: 'recent[same]' }),
    recent: row('^title-', { up: 'sorts[same]', down: 'swarms[same]' }),
    swarms: row('^tracker-seeded-', { up: 'recent[same]', down: 'stay' }),
  },
  bursts: [{ from: 'recent[first]', key: 'right', presses: 40 }, { from: 'swarms[first]', key: 'right', expect: 'swarms[last]' }, { from: 'tabs[first]', key: 'right', expect: 'tabs[last]' }],
};

export const browse = {
  name: 'browse',
  route: 'browse',
  ...DISCOVER,
  notes: 'Discover > Browse: the tab strip, sort chips (and the category chip when one is set), then every title as a grid seven to a line with no heading of its own (the tab names it). Nearing the end pages in more lines.',
  detect: onRoute('browse'),
  reach: [{ go: 'browse' }],
  landing: 'results[first]',
  stops: {},
  groups: {
    tabs: tabs('sorts[first]'),
    sorts: row('^(sort-|clear-category$)', { up: 'tabs[selected]', down: 'results[same]' }),
    results: lines('^title-', { up: 'sorts[same]', down: 'stay' }),
  },
  bursts: [{ from: 'results[first]', key: 'right', expect: 'results[6]' }, { from: 'results[first]', key: 'down', presses: 4 }],
};

// Category tiles: data-focus-key "family-<key>"; the family page's own controls also start with "family-".
const TILES = '^family-(?!back$|more$|chip-|sort-|title-)';

export const categories = {
  name: 'categories',
  route: 'categories',
  ...DISCOVER,
  notes: 'Discover > Categories: the tab strip, then a grid of family tiles, three to a line.',
  detect: [onRoute('categories'), '.family-tile'],
  reach: [{ go: 'categories' }],
  landing: 'tiles[first]',
  stops: {},
  groups: { tabs: tabs('tiles[first]'), tiles: lines(TILES, { up: 'tabs[selected]', down: 'stay' }) },
  bursts: [{ from: 'tiles[first]', key: 'down' }, { from: 'tiles[first]', key: 'right', expect: 'tiles[2]' }],
};

export const catalogFamily = {
  name: 'catalog-family',
  route: 'categories',
  ...DISCOVER,
  notes: 'One Discover category: the tab strip, back to the tiles, category chips (the selected one carries a check mark), sort chips, its titles as a grid seven to a line, then Show more titles when the family has more. Back closes it onto the tile it was opened from, from any stop.',
  detect: [onRoute('categories'), '[data-focus-key="family-back"]'],
  reach: [{ go: 'categories' }, { focus: '[data-focus-key^="family-"]' }, { press: 'enter' }],
  landing: 'titles[first]',
  stops: {
    'family-back': { up: 'tabs[selected]', down: 'chips[first]', left: 'rail', right: 'stay', back: 'categories:tiles[first]' },
    'family-more': { optional: true, up: 'titles[same]', down: 'stay', left: 'rail', right: 'stay' },
  },
  groups: {
    tabs: tabs('family-back', { back: 'categories:tiles[first]' }),
    chips: row('^family-chip-', { up: 'family-back', down: 'sorts[same]' }),
    sorts: row('^family-sort-', { up: 'chips[same]', down: 'titles[same]' }),
    titles: lines('^family-title-', { up: 'sorts[same]', down: 'family-more' }),
  },
  bursts: [{ from: 'titles[first]', key: 'right', expect: 'titles[6]' }, { from: 'titles[first]', key: 'down', presses: 4 }],
};

export const CATALOG_MAPS = [searchResults, search, tracker, browse, catalogFamily, categories];
