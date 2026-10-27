// My Library screens. See ../model.mjs for the map format.
import { header, lines, onRoute, row } from './common.mjs';

export const library = {
  name: 'library',
  route: 'library',
  notes: 'Library dashboard: the household rails (Continue watching, My List, Watched) stacked; Up/Down keep the column.',
  detect: onRoute('library'),
  regions: ['content'],
  reach: [{ go: 'library' }],
  landing: 'rails[first]',
  stops: header('rails[first]'),
  groups: { rails: lines('^library-', { up: 'header-retry', down: 'stay' }) },
  bursts: [{ from: 'rails[first]', key: 'down', presses: 4 }],
};

const shelf = (route, notes) => ({
  name: route,
  route,
  notes,
  detect: onRoute(route),
  regions: ['content'],
  reach: [{ go: route }],
  landing: 'items[first]',
  stops: header('items[first]'),
  groups: { items: row('^library-', { up: 'header-retry', down: 'stay' }) },
  bursts: [{ from: 'items[first]', key: 'right', expect: 'items[last]' }],
});

export const continueWatching = shelf('continue', 'Continue watching: one rail of library cards.');
export const myList = shelf('favorites', 'My List: one rail of library cards.');
export const watched = shelf('watched', 'Watched: one rail of library cards.');

// Download action buttons are "download-<id>-<action>"; the filters start with "downloads-".
const ACTIONS = '^download-(?!cancel$|confirm$)';

export const downloads = {
  name: 'downloads',
  route: 'downloads',
  notes: 'Downloads: search / filter / sort, then one line of buttons per download (Play, Pause or Resume, Delete, Details, Files). Up/Down keep the column (nearest data-focus-col), so Delete goes to the Delete below it.',
  detect: onRoute('downloads'),
  regions: ['content'],
  reach: [{ go: 'downloads' }],
  landing: 'actions[first]',
  stops: header('tools[first]'),
  groups: {
    tools: row('^downloads-', { up: 'header-retry', down: 'actions[same]' }),
    actions: lines(ACTIONS, { up: 'tools[same]', down: 'stay' }),
  },
  bursts: [{ from: 'actions[first]', key: 'down', presses: 30 }],
};

export const downloadDelete = {
  name: 'download-delete',
  notes: 'Delete confirmation: Cancel first, Confirm below it; Back cancels and returns to the Delete button.',
  detect: '[data-focus-region="download-dialog"]',
  regions: ['download-dialog'],
  reach: [{ go: 'downloads' }, { focus: '[data-focus-key$="-delete"]' }, { press: 'enter' }],
  opener: 'downloads:actions[2]',
  landing: 'download-cancel',
  stops: {
    'download-cancel': { up: 'stay', down: 'download-confirm', left: 'stay', right: 'stay', back: 'return' },
    'download-confirm': { up: 'download-cancel', down: 'stay', left: 'stay', right: 'stay', back: 'return' },
  },
};

const TILES = '^family-(?!back$|more$|chip-|sort-|title-)';

export const libraryCategories = {
  name: 'library-categories',
  route: 'library-categories',
  notes: 'Library categories: family tiles, three to a line.',
  detect: [onRoute('library-categories'), '.family-tile'],
  regions: ['content'],
  reach: [{ go: 'library-categories' }],
  landing: 'tiles[first]',
  stops: header('tiles[first]'),
  groups: { tiles: lines(TILES, { up: 'header-retry', down: 'stay' }) },
};

export const libraryFamily = {
  name: 'library-family',
  route: 'library-categories',
  notes: 'One library category: back to the tiles, category chips, then the titles five to a line. Back closes it onto its tile.',
  detect: [onRoute('library-categories'), '[data-focus-key="family-back"]'],
  regions: ['content'],
  reach: [{ go: 'library-categories' }, { focus: '[data-focus-key^="family-"]' }, { press: 'enter' }],
  landing: 'grid[first]',
  stops: {
    // Back closes the category first, from any stop, before the rail.
    'header-retry': { ...header('family-back')['header-retry'], back: 'library-categories:tiles[first]' },
    'family-back': { up: 'header-retry', down: 'chips[first]', left: 'rail', right: 'stay', back: 'library-categories:tiles[first]' },
  },
  groups: {
    chips: row('^family-chip-', { up: 'family-back', down: 'grid[same]' }),
    grid: lines('^library-item-', { up: 'chips[same]', down: 'stay' }),
  },
  bursts: [{ from: 'grid[first]', key: 'down', presses: 4 }, { from: 'grid[first]', key: 'right', expect: 'grid[4]' }],
};

export const LIBRARY_MAPS = [library, continueWatching, myList, watched, downloadDelete, downloads, libraryFamily, libraryCategories];
