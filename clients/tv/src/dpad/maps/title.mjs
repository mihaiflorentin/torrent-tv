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
const moreSheet = ({ name, opener, reach, notes }) => ({
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

export const TITLE_MAPS = [infoSeason, infoSeasons, movieInfo, seriesInfo, movieMore, seriesMore, movieTitle, seriesVersions, seriesTitle];
