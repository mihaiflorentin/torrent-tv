// Title pages (movie and series) and the Info panel. See ../model.mjs for the map format.
// A title page replaces the shell: there is no rail, Left at the start of a row stays, and Back
// returns to the card the page was opened from: the audit opens each title from its first card on
// Home, which for the fixture's movie is Continue watching's first and for its series the fourth.

const ACTIONS = '^detail-(playback|versions|favorite|info|more)$';
const MOVIE_OPENER = 'home:continue[0]';
const SERIES_OPENER = 'home:continue[3]';

export const movieTitle = {
  name: 'movie-title',
  notes: 'Movie page: Back, the action row (Resume or Play best, Choose version, My List, Info, More), then the versions list. Lands on the primary. OK on More opens its sheet (Refresh data).',
  detect: ['.detail-screen', '.source-list'],
  regions: ['content'],
  reach: [{ openTitle: 'movie' }],
  landing: 'actions[first]',
  stops: { 'detail-back': { up: 'stay', down: 'actions[first]', left: 'stay', right: 'stay', back: MOVIE_OPENER } },
  groups: {
    actions: { keys: ACTIONS, each: { up: 'detail-back', down: 'versions[first]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay', ok: 'movie-more:rows[first]' } },
    versions: { keys: '^source-', each: { up: '-1', down: '+1', left: 'stay', right: 'stay' }, first: { up: 'actions[first]' }, last: { down: 'stay' } },
  },
  bursts: [{ from: 'versions[first]', key: 'down', expect: 'versions[last]' }, { from: 'actions[first]', key: 'right', expect: 'actions[last]' }],
};

// The More sheet (more-menu.tsx): the page's secondary actions in their own focus region, then Close. Back (or Close)
// returns to the More button.
export const moreSheet = ({ name, opener, reach, notes }) => ({
  name,
  notes,
  detect: '.tv-more',
  regions: ['more-menu'],
  reach,
  opener,
  landing: 'rows[first]',
  stops: { 'more-close': { up: 'rows[last]', down: 'stay', left: 'stay', right: 'stay', back: 'return', ok: 'return' } },
  groups: { rows: { keys: '^more-(?!close$)', each: { up: '-1', down: '+1', left: 'stay', right: 'stay', back: 'return' }, first: { up: 'stay' }, last: { down: 'more-close' } } },
});

export const movieMore = moreSheet({
  name: 'movie-more',
  notes: 'More over a movie page: Refresh data, then Close.',
  opener: 'movie-title:detail-more',
  reach: [{ openTitle: 'movie' }, { focus: '[data-focus-key="detail-more"]' }, { press: 'enter' }],
});

export const seriesMore = moreSheet({
  name: 'series-more',
  notes: 'More over a series page: Refresh data, then Close.',
  opener: 'series-title:detail-more',
  reach: [{ openTitle: 'series' }, { focus: '[data-focus-key="detail-more"]' }, { press: 'enter' }],
});

// The Info panel: a column of stops; Back (or Close) returns to the Info button.
export const infoPanel = ({ name, opener, reach, notes }) => ({
  name,
  notes,
  detect: '.info-panel',
  regions: ['info-panel'],
  reach,
  opener,
  landing: 'info-close',
  stops: { 'info-close': { up: 'stay', down: 'rows[first]', left: 'stay', right: 'stay', back: 'return', ok: 'return' } },
  groups: { rows: { keys: '^info-(?!close$|back$)', each: { up: '-1', down: '+1', left: 'stay', right: 'stay' }, first: { up: 'info-close', back: 'return' }, last: { down: 'stay' } } },
  bursts: [{ from: 'rows[first]', key: 'down', expect: 'rows[last]' }],
});

export const movieInfo = infoPanel({
  name: 'movie-info',
  notes: 'Info panel over a movie page: summary, cast, fine print.',
  opener: 'movie-title:detail-info',
  reach: [{ openTitle: 'movie' }, { focus: '[data-focus-key="detail-info"]' }, { press: 'enter' }],
});

export const seriesInfo = infoPanel({
  name: 'series-info',
  notes: 'Info panel over a series page: summary, Seasons (OK drills into the seasons), cast, fine print.',
  opener: 'series-title:detail-info',
  reach: [{ openTitle: 'series' }, { focus: '[data-focus-key="detail-info"]' }, { press: 'enter' }],
});

// The Info panel's drill-down: Seasons, then one season (its episodes and cast). Back and Close sit
// on the first row; Back (the key or the button) pops one level onto the row it was opened from.
const toSeriesInfo = [{ openTitle: 'series' }, { focus: '[data-focus-key="detail-info"]' }, { press: 'enter' }, { wait: 600 }];
const drillLevel = ({ name, notes, detect, reach, rows, back }) => ({
  name,
  notes,
  detect: ['.info-panel', '[data-focus-key="info-back"]', detect],
  regions: ['info-panel'],
  reach,
  landing: 'rows[first]',
  stops: {
    'info-back': { up: 'stay', down: 'rows[first]', left: 'stay', right: 'info-close', back, ok: back },
    'info-close': { up: 'stay', down: 'rows[first]', left: 'info-back', right: 'stay', back },
  },
  groups: { rows: { keys: rows, each: { up: '-1', down: '+1', left: 'stay', right: 'stay' }, first: { up: 'info-back', back }, last: { down: 'stay' } } },
  bursts: [{ from: 'rows[first]', key: 'down', expect: 'rows[last]' }],
});

export const infoSeasons = drillLevel({
  name: 'info-seasons',
  notes: 'Info > Seasons: one row per season.',
  detect: '[data-focus-key="info-season-1"]',
  reach: [...toSeriesInfo, { focus: '[data-focus-key="info-seasons"]' }, { press: 'enter' }],
  rows: '^info-season-\\d+$',
  back: 'series-info:info-seasons',
});

export const infoSeason = drillLevel({
  name: 'info-season',
  notes: 'Info > Seasons > a season: its summary, episodes and cast. The cursor stays on Back or Close once the viewer moves there (the level\'s late data or artwork no longer pulls it into the list).',
  detect: '[data-focus-key="info-season-summary"]',
  reach: [...toSeriesInfo, { focus: '[data-focus-key="info-seasons"]' }, { press: 'enter' }, { wait: 600 }, { focus: '[data-focus-key="info-season-1"]' }, { press: 'enter' }],
  rows: '^info-(season-summary$|episode-|season-cast-)',
  back: 'info-seasons:info-season-1',
});

export const infoEpisode = drillLevel({
  name: 'info-episode',
  notes: 'Info > Seasons > a season > an episode: its summary (code, meta, title, overview, credits), then its guest stars when it has any.',
  detect: '[data-focus-key="info-episode-summary"]',
  reach: [...toSeriesInfo, { focus: '[data-focus-key="info-seasons"]' }, { press: 'enter' }, { wait: 600 }, { focus: '[data-focus-key="info-season-1"]' }, { press: 'enter' }, { wait: 600 }, { focus: '[data-focus-key="info-episode-1"]' }, { press: 'enter' }],
  rows: '^info-(episode-summary$|guest-)',
  back: 'info-season:info-episode-1',
});

// The preparing dialog (main.tsx), over the title page whose version was chosen. The audit's fixture (scenarios)
// holds the prepare of the first movie's first version open and refuses its second (tools/tv_perf/fixture.mjs,
// scenarioReleases: releases 1000000 and 1000001, file 0). Back cancels and returns to the version.
const prepareVersion = release => [{ openTitle: 'movie' }, { pressUntil: 'down', focused: '.source-list .source-button', max: 3 }, { focus: `[data-focus-key="source-${release}-0"]` }, { press: 'enter' }];

export const prepareWait = {
  name: 'prepare-wait',
  notes: 'Preparing a version: the elapsed seconds and Cancel, the only control. Every arrow stays on Cancel; OK on Cancel and Back cancel and return to the version.',
  detect: ['.tv-prepare-confirm', '[data-focus-key="prepare-cancel"]'],
  regions: ['prepare-dialog'],
  reach: prepareVersion('1000000'),
  // Ranked third on the movie page.
  opener: 'movie-title:versions[2]',
  landing: 'prepare-cancel',
  stops: { 'prepare-cancel': { up: 'stay', down: 'stay', left: 'stay', right: 'stay', ok: 'return', back: 'return' } },
};

export const prepareError = {
  name: 'prepare-error',
  notes: 'A prepare the tracker refused: the reason, then Retry and Close on one row (Left and Right move and stop at its ends, Up and Down stay). Lands on Retry; Close and Back return to the version.',
  detect: ['.tv-prepare-confirm', '[data-focus-key="prepare-retry"]'],
  regions: ['prepare-dialog'],
  reach: prepareVersion('1000001'),
  // Ranked first (the Best match) on the movie page.
  opener: 'movie-title:versions[first]',
  landing: 'prepare-retry',
  stops: {
    'prepare-retry': { up: 'stay', down: 'stay', left: 'stay', right: 'prepare-close', back: 'return' },
    'prepare-close': { up: 'stay', down: 'stay', left: 'prepare-retry', right: 'stay', ok: 'return', back: 'return' },
  },
};

const seriesStops = back => ({
  'detail-back': { up: 'stay', down: 'actions[first]', left: 'stay', right: 'stay', back },
});
const seriesActions = { keys: ACTIONS, each: { up: 'detail-back', down: 'seasons[same]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay', ok: 'series-more:rows[first]' } };

export const seriesTitle = {
  name: 'series-title',
  notes: 'Series page: Back, the action row, the season tabs, the episode list of the shown season. Down from a season tab goes to the selected episode; Up from the first episode to the shown season\'s tab; Right on an episode opens its Versions.',
  detect: ['.detail-screen', '.season-tabs', '.episode-pane'],
  regions: ['content', 'episodes'],
  reach: [{ openTitle: 'series' }],
  landing: 'actions[first]',
  stops: seriesStops(SERIES_OPENER),
  groups: {
    actions: seriesActions,
    seasons: { keys: '^season-\\d+$', each: { up: 'actions[same]', down: 'episodes[selected]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
    episodes: { keys: '^episode-', region: 'episodes', each: { up: '-1', down: '+1', left: 'stay', right: 'series-versions:versions[first]', back: SERIES_OPENER }, first: { up: 'seasons[selected]' }, last: { down: 'stay' } },
  },
  bursts: [{ from: 'episodes[first]', key: 'down', expect: 'episodes[last]' }, { from: 'episodes[last]', key: 'up', expect: 'seasons[selected]', presses: 4 }],
};

export const seriesVersions = {
  name: 'series-versions',
  notes: 'An episode\'s Versions view (replaces the episode list): versions and season packs. Left and Back close it onto the episode; Up from the first version reaches the season tab.',
  detect: ['.detail-screen', '.versions-view'],
  regions: ['content', 'versions'],
  reach: [{ openTitle: 'series' }, { pressUntil: 'down', focused: '[data-focus-region="episodes"]', max: 4 }, { press: 'right' }],
  landing: 'versions[first]',
  // Back closes the Versions view first, from any stop.
  stops: seriesStops('series-title:episodes[selected]'),
  groups: {
    actions: seriesActions,
    seasons: { keys: '^season-\\d+$', each: { up: 'actions[same]', down: 'versions[first]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
    versions: { keys: '^(source-|season-pack-)', region: 'versions', each: { up: '-1', down: '+1', left: 'series-title:episodes[selected]', right: 'stay', back: 'series-title:episodes[selected]' }, first: { up: 'seasons[selected]' }, last: { down: 'stay' } },
  },
  bursts: [{ from: 'versions[first]', key: 'down', expect: 'versions[last]' }],
};

// The season-pack delete confirmation, from Delete download on a downloaded pack in an episode's Versions view (the
// audit's fixture downloads season 1's pack). Cancel first, the delete below it; Back cancels onto Delete download.
export const seasonPackDelete = {
  name: 'season-pack-delete',
  notes: 'Delete season download? Cancel, then Delete download below it. Lands on Cancel; OK on Cancel and Back return to the pack\'s Delete download.',
  detect: '.tv-season-pack-confirm',
  regions: ['season-pack-dialog'],
  reach: [...seriesVersions.reach, { focus: '[data-focus-key^="season-pack-"][data-focus-key$="-delete"]' }, { press: 'enter' }],
  opener: 'series-versions:versions[last]',
  landing: 'season-pack-delete-cancel',
  stops: {
    'season-pack-delete-cancel': { up: 'stay', down: 'season-pack-delete-confirm', left: 'stay', right: 'stay', ok: 'return', back: 'return' },
    'season-pack-delete-confirm': { up: 'season-pack-delete-cancel', down: 'stay', left: 'stay', right: 'stay', back: 'return' },
  },
};

export const TITLE_MAPS = [prepareWait, prepareError, seasonPackDelete, infoEpisode, infoSeason, infoSeasons, movieInfo, seriesInfo, movieMore, seriesMore, movieTitle, seriesVersions, seriesTitle];
