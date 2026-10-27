// Library screens (Dashboard, Continue watching, My List, Watched, Categories: the Library hub's tabs) and
// Downloads. See ../model.mjs for the map format.
import { lines, onRoute, row, tabs } from './common.mjs';

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

// Download action buttons are "download-<id>-<action>"; the filters start with "downloads-".
const ACTIONS = '^download-(?!cancel$|confirm$)';

export const downloads = {
  name: 'downloads',
  route: 'downloads',
  notes: 'Downloads (its own hub, no tabs): search / filter / sort, then one line of buttons per download (Play, Pause or Resume, Delete, Details, Files). Up/Down keep the column (nearest data-focus-col), so Delete goes to the Delete below it.',
  detect: onRoute('downloads'),
  regions: ['content'],
  reach: [{ go: 'downloads' }],
  landing: 'actions[first]',
  stops: {},
  groups: {
    tools: row('^downloads-', { up: 'stay', down: 'actions[same]' }),
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
  notes: 'One Library category: the tab strip, back to the tiles, category chips (the selected one carries a check mark), then the titles seven to a line (#55, the grid Search and Browse share since #58). Back closes it onto its tile, from any stop.',
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
  bursts: [{ from: 'grid[first]', key: 'down', presses: 4 }, { from: 'grid[first]', key: 'right', expect: 'grid[6]' }],
};

export const LIBRARY_MAPS = [library, continueWatching, myList, watched, downloadDelete, downloads, libraryFamily, libraryCategories];
