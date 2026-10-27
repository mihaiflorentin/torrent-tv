// The Player with its controls shown. See ../model.mjs for the map format.
// The Wake model (first key on hidden controls only wakes them) and the seek rules are pinned by
// player-keys.test.ts; this map covers the visible controls: the timeline (Left/Right seek, so
// focus stays) above the toolbar.

export const player = {
  name: 'player',
  notes: 'Player controls: the timeline above the toolbar (Restart, Back 10, Play/Pause, Forward 10, Audio, Subtitles, Options, Back, Hide). Down from the timeline returns to the toolbar control last used (Play by default).',
  detect: '.player.controls-visible',
  regions: ['player-controls'],
  reach: [{ openTitle: 'series' }, { pressUntil: 'down', focused: '[data-focus-region="episodes"]', max: 4 }, { press: 'right' }, { press: 'enter' }, { wait: 1500 }, { press: 'up' }],
  landing: 'player-timeline',
  // Back saves and leaves; the series page comes back with the episode's Versions view.
  stops: { 'player-timeline': { up: 'stay', down: 'toolbar[2]', left: 'stay', right: 'stay', back: 'series-versions:versions[first]' } },
  groups: { toolbar: { keys: '^player-(?!timeline$|retry$)', each: { up: 'player-timeline', down: 'stay', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } } },
  bursts: [{ from: 'toolbar[first]', key: 'right', expect: 'toolbar[last]' }],
};

// A Player panel: its rows top to bottom, Close last (row 99). Back closes it; focus returns to the
// toolbar control that opened it.
const panel = ({ name, opener, first, rows, notes }) => ({
  name,
  notes,
  detect: ['.player-dialog', `[data-focus-key="${first}"]`],
  regions: ['player-menu'],
  reach: [...player.reach, { focus: `[data-focus-key="${opener}"]` }, { press: 'enter' }],
  landing: 'rows[first]',
  stops: { 'player-menu-close': { up: 'rows[last]', down: 'stay', left: 'stay', right: 'stay', back: `player:${opener}`, ok: `player:${opener}` } },
  groups: { rows: { keys: rows, each: { up: '-1', down: '+1', left: 'stay', right: 'stay', back: `player:${opener}` }, first: { up: 'stay' }, last: { down: 'player-menu-close' } } },
});

export const playerAudio = panel({ name: 'player-audio', notes: 'Audio panel: Refresh tracks, then one row per track.', opener: 'player-audio', first: 'player-audio-refresh', rows: '^player-audio-' });
export const playerSubtitles = panel({ name: 'player-subtitles', notes: 'Subtitles panel: Off, Find subtitles, then the tracks.', opener: 'player-subtitles', first: 'player-subtitles-off', rows: '^player-(subtitles-|native-subtitle-|subtitle-)' });
export const playerOptions = panel({ name: 'player-options', notes: 'Options panel: subtitle timing, picture fit, Info.', opener: 'player-options', first: 'player-subtitle-earlier', rows: '^player-(subtitle-(earlier|later|reset)$|aspect-|info$)' });


// Playback information, opened from Options > Playback information: the facts, Back to options, then Close.
export const playerInfo = {
  name: 'player-info',
  notes: 'Playback information (Options > Playback information): Back to options, then Close. Back to options returns to the Options panel on Playback information; Close and Back close the panel onto Options.',
  detect: '.player-dialog[data-player-menu="info"]',
  regions: ['player-menu'],
  reach: [...playerOptions.reach, { focus: '[data-focus-key="player-info"]' }, { press: 'enter' }],
  landing: 'player-info-back',
  stops: {
    'player-info-back': { up: 'stay', down: 'player-menu-close', left: 'stay', right: 'stay', ok: 'player-options:rows[last]', back: 'player:player-options' },
    'player-menu-close': { up: 'player-info-back', down: 'stay', left: 'stay', right: 'stay', ok: 'player:player-options', back: 'player:player-options' },
  },
};

// Find online subtitles (Subtitles > Find online subtitles…): the provider results, then Close. The fixture finds
// none, so the audit sees Close alone; the results are a column like the Subtitles panel's.
export const playerFindSubtitles = {
  name: 'player-find-subtitles',
  notes: 'Download subtitles (Subtitles > Find online subtitles…): one row per provider result, then Close. With no results it lands on Close. Back and Close close the panel onto Subtitles.',
  detect: '.player-dialog[data-player-menu="find-subtitles"]',
  regions: ['player-menu'],
  reach: [...playerSubtitles.reach, { focus: '[data-focus-key="player-subtitles-find"]' }, { press: 'enter' }],
  landing: 'player-menu-close',
  stops: { 'player-menu-close': { up: 'results[last]', down: 'stay', left: 'stay', right: 'stay', ok: 'player:player-subtitles', back: 'player:player-subtitles' } },
  groups: { results: { keys: '^player-subtitle-', optional: true, each: { up: '-1', down: '+1', left: 'stay', right: 'stay', back: 'player:player-subtitles' }, first: { up: 'stay' }, last: { down: 'player-menu-close' } } },
};

export const PLAYER_MAPS = [playerInfo, playerFindSubtitles, playerAudio, playerSubtitles, playerOptions, player];
