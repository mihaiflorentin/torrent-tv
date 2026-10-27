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

export const PLAYER_MAPS = [playerAudio, playerSubtitles, playerOptions, player];
