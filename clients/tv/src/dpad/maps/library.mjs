// Library screens (Dashboard, Continue watching, My List, Watched, Categories: the Library hub's tabs) and
// Downloads. See ../model.mjs for the map format.
import { lines, onRoute, row, tabs } from './common.mjs';
import { moreSheet } from './title.mjs';

// The tab strip is row 0 of every Library tab; Up from the content's top line lands on the selected tab.
const LIBRARY = { hub: 'library', regions: ['content'] };

export const library = {
  name: 'library',
  route: 'library',
  ...LIBRARY,
  notes: 'Library > Dashboard: the tab strip, then the household rails (Continue watching, My List, Watched) stacked; Up/Down keep the column.',
  detect: onRoute('library'),
  reach: [{ go: 'library' }],
  landing: 'rails[first]',
  stops: {},
  groups: { tabs: tabs('rails[first]'), rails: lines('^library-', { up: 'tabs[selected]', down: 'stay' }) },
  bursts: [{ from: 'rails[first]', key: 'down', presses: 4 }, { from: 'tabs[first]', key: 'right', expect: 'tabs[last]' }],
};

const shelf = (route, notes) => ({
  name: route,
  route,
  ...LIBRARY,
  notes,
  detect: onRoute(route),
  reach: [{ go: route }],
  landing: 'items[first]',
  stops: {},
  groups: { tabs: tabs('items[first]'), items: row('^library-', { up: 'tabs[selected]', down: 'stay' }) },
  bursts: [{ from: 'items[first]', key: 'right', expect: 'items[last]' }],
});

export const continueWatching = shelf('continue', 'Library > Continue watching: the tab strip, then one rail of library cards (no heading: the tab names it).');
export const myList = shelf('favorites', 'Library > My List: the tab strip, then one rail of library cards.');
export const watched = shelf('watched', 'Library > Watched: the tab strip, then one rail of library cards.');

// A download row's buttons are "download-<id>-<action>" (Play, Pause / Resume / Retry, More); an opened torrent's
// file rows are "download-<id>-file-<n>-play|remove"; the chips, Sort and the find field start with "downloads-".
const ACTIONS = '^download-(?!cancel$|confirm$)(?!.*-file-\\d+-)';
const FILES = '^download-.*-file-\\d+-(play|remove)$';

export const downloads = {
  name: 'downloads',
  route: 'downloads',
  notes: 'Downloads (its own hub, no tabs): the filter chips (All, Active, Downloaded, Paused, Needs attention), Sort and the find field on one line, then one line per download: Play, Pause or Resume (or Retry), More. Up/Down keep the column (nearest data-focus-col), so More goes to the More below it; a row without a transfer action has Play and More. OK on More opens its sheet (Details, Show files on a multi-file torrent, Delete download). An opened torrent lists its files under the row, Play and Remove each, in the columns of Pause and More so Down from More reaches Play, not Remove.',
  detect: onRoute('downloads'),
  regions: ['content'],
  reach: [{ go: 'downloads' }],
  landing: 'actions[first]',
  stops: {},
  groups: {
    tools: row('^downloads-', { up: 'stay', down: 'actions[same]' }),
    actions: lines(ACTIONS, { up: 'tools[same]', down: 'stay', end: { right: 'stay', ok: 'download-more:rows[first]' } }),
    // Only while a multi-file torrent is opened (Show files); the fixture household has none, the happy-dom tests walk it.
    files: lines(FILES, { up: 'actions[same]', down: 'actions[same]', start: { left: 'stay' }, optional: true }),
  },
  bursts: [{ from: 'actions[first]', key: 'down', presses: 30 }],
};

export const downloadMore = {
  ...moreSheet({
    name: 'download-more',
    notes: 'More on a download row: Details (Hide details), Show files (Hide files) on a multi-file torrent, Delete download, then Close. Details and Show files close the sheet onto the More button and open on the row; Delete download opens its confirmation.',
    opener: 'downloads:actions[2]',
    reach: [{ go: 'downloads' }, { focus: '[data-focus-key$="-more"]' }, { press: 'enter' }],
  }),
  detect: [onRoute('downloads'), '.tv-more'],
};

export const downloadDelete = {
  name: 'download-delete',
  notes: 'Delete confirmation, opened from Delete download in a row\'s More sheet: Cancel first, Confirm below it; Back cancels and returns to the row\'s More button.',
  detect: '[data-focus-region="download-dialog"]',
  regions: ['download-dialog'],
  reach: [{ go: 'downloads' }, { focus: '[data-focus-key$="-more"]' }, { press: 'enter' }, { focus: '[data-focus-key="more-delete"]' }, { press: 'enter' }],
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
  ...LIBRARY,
  notes: 'Library > Categories: the tab strip, then family tiles, three to a line.',
  detect: [onRoute('library-categories'), '.family-tile'],
  reach: [{ go: 'library-categories' }],
  landing: 'tiles[first]',
  stops: {},
  groups: { tabs: tabs('tiles[first]'), tiles: lines(TILES, { up: 'tabs[selected]', down: 'stay' }) },
};

export const libraryFamily = {
  name: 'library-family',
  route: 'library-categories',
  ...LIBRARY,
  notes: 'One Library category: the tab strip, back to the tiles, category chips, then the titles five to a line. Back closes it onto its tile, from any stop.',
  detect: [onRoute('library-categories'), '[data-focus-key="family-back"]'],
  reach: [{ go: 'library-categories' }, { focus: '[data-focus-key^="family-"]' }, { press: 'enter' }],
  landing: 'grid[first]',
  stops: {
    'family-back': { up: 'tabs[selected]', down: 'chips[first]', left: 'rail', right: 'stay', back: 'library-categories:tiles[first]' },
  },
  groups: {
    tabs: tabs('family-back', { back: 'library-categories:tiles[first]' }),
    chips: row('^family-chip-', { up: 'family-back', down: 'grid[same]' }),
    grid: lines('^library-item-', { up: 'chips[same]', down: 'stay' }),
  },
  bursts: [{ from: 'grid[first]', key: 'down', presses: 4 }, { from: 'grid[first]', key: 'right', expect: 'grid[4]' }],
};

export const LIBRARY_MAPS = [library, continueWatching, myList, watched, downloadMore, downloadDelete, downloads, libraryFamily, libraryCategories];
