import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlsVisibility } from '@torrent-tv/shared';
import { PlayerKeyController, SKIP_STEP_MS, type PlayerFocus } from './player-keys';

const TOOLBAR = ['restart', 'back-10', 'play', 'forward-10', 'audio', 'subtitles', 'options', 'back', 'hide'];

/** A fake AVPlay seek port: requests are recorded and the test decides when the success or error callback fires. */
function fakeAVPlay() {
  const requests: { ms: number; ok: () => void; fail: (error: string) => void }[] = [];
  return { requests, last: () => requests[requests.length - 1] };
}

/** A fake player surface: real ControlsVisibility on fake timers, every port call recorded. */
function setup(initial: { focus?: PlayerFocus; remembered?: string; menu?: boolean } = {}) {
  const calls: string[] = [];
  const av = fakeAVPlay();
  const state = {
    focus: initial.focus ?? ({ where: 'toolbar', key: 'play', row: '1' } as PlayerFocus),
    remembered: initial.remembered ?? 'play',
    menu: initial.menu ?? false,
    position: 60_000,
    duration: 600_000,
    errors: [] as string[],
    seekThrows: null as string | null,
  };
  const controls = new ControlsVisibility({ policy: { armWhilePaused: true, statusHolds: false }, onChange: visible => { if (!visible) keys.controlsHidden(); } });
  const keys = new PlayerKeyController({
    controlsVisible: () => controls.visible,
    menuOpen: () => state.menu,
    focused: () => state.focus,
    remembered: () => state.remembered,
    remember: key => { state.remembered = key; },
    reveal: hold => { calls.push(hold ? 'reveal(hold)' : 'reveal'); controls.reveal(hold); },
    duration: () => state.duration,
    position: () => state.position,
    setPosition: ms => { state.position = ms; calls.push(`show(${ms})`); },
    announce: ms => { calls.push(`osd(${ms})`); },
    avSeekTo: (ms, ok, fail) => { calls.push(`seekTo(${ms})`); if (state.seekThrows) throw new Error(state.seekThrows); av.requests.push({ ms, ok, fail }); },
    seekFailed: error => { state.errors.push(error); },
    focusControl: key => { calls.push(`focus(${key})`); state.focus = key === 'timeline' ? { where: 'timeline', key, row: '0' } : { where: 'toolbar', key, row: '1' }; },
    activateControl: key => { calls.push(`activate(${key})`); },
    activateFocused: () => { calls.push('activate-focused'); },
    focusFirstMenuItem: () => { calls.push('focus-first-menu'); },
    navigate: direction => { calls.push(`navigate(${direction})`); },
    togglePlayback: force => { calls.push(`play(${force})`); },
    back: () => { calls.push('back'); },
  });
  const seekCalls = () => calls.filter(call => /^(show|osd|seekTo)\(/.test(call));
  return { calls, state, controls, keys, seekCalls, av };
}

const lost: PlayerFocus = { where: 'none', key: null, row: null };

/** Controls already hidden with focus gone, as after the hide timer fired on a browser-less TV surface. */
function setupHidden(remembered = 'play') {
  const harness = setup({ focus: lost, remembered });
  harness.controls.hide();
  return harness;
}

/** Let the hide timer fire (controls revealed by a key then left alone). */
const idleUntilHidden = (controls: ControlsVisibility) => { vi.advanceTimersByTime(2000); expect(controls.visible).toBe(false); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Wake: hidden controls', () => {
  for (const action of ['up', 'down'] as const) {
    it(`${action} wakes the controls, restores Control focus and never seeks`, () => {
      const { calls, controls, keys, seekCalls, state } = setupHidden('audio');
      keys.handle(action);
      expect(controls.visible).toBe(true);
      expect(calls).toEqual(['reveal', 'focus(audio)']);
      expect(seekCalls()).toEqual([]);
      expect(state.remembered).toBe('audio');
    });
  }

  for (const action of ['left', 'right'] as const) {
    it(`${action} wakes the controls on the timeline and never seeks on that first press`, () => {
      const { calls, controls, keys, seekCalls, state } = setupHidden('audio');
      keys.handle(action);
      expect(controls.visible).toBe(true);
      expect(calls).toEqual(['reveal', 'focus(timeline)']);
      expect(seekCalls()).toEqual([]);
      expect(state.remembered).toBe('audio');
    });
  }

  it('restores to play by default', () => {
    const { calls, keys } = setupHidden();
    keys.handle('up');
    expect(calls).toContain('focus(play)');
  });

  it('OK wakes the controls and activates the remembered control on the first press', () => {
    const { calls, controls, keys } = setupHidden('subtitles');
    keys.handle('enter');
    expect(controls.visible).toBe(true);
    expect(calls).toEqual(['reveal', 'focus(subtitles)', 'activate(subtitles)']);
  });

  for (const [action, delta] of [['rewind', -10_000], ['fast-forward', 10_000], ['previous', -60_000], ['next', 60_000]] as const) {
    it(`${action} seeks its step and the controls stay hidden`, () => {
      const { calls, controls, keys } = setupHidden();
      keys.handle(action);
      expect(controls.visible).toBe(false);
      expect(calls).toEqual([`show(${60_000 + delta})`, `osd(${60_000 + delta})`]);
    });
  }
});

describe('toolbar control focused', () => {
  it('Left and Right move focus along the toolbar and never seek', () => {
    const { calls, keys, seekCalls } = setup();
    keys.handle('left');
    keys.handle('right');
    expect(calls.filter(call => call.startsWith('navigate'))).toEqual(['navigate(left)', 'navigate(right)']);
    expect(seekCalls()).toEqual([]);
  });

  it('Up moves to the timeline', () => {
    const { calls, keys } = setup();
    keys.handle('up');
    expect(calls).toContain('focus(timeline)');
  });

  it('OK activates the focused control', () => {
    const { calls, keys } = setup({ focus: { where: 'toolbar', key: 'audio', row: '1' } });
    keys.handle('enter');
    expect(calls).toEqual(['reveal', 'activate-focused']);
  });
});

describe('Timeline focus', () => {
  const onTimeline: PlayerFocus = { where: 'timeline', key: 'timeline', row: '0' };

  it('Left and Right seek one Seek step and focus stays on the timeline', () => {
    const { calls, keys, state } = setup({ focus: onTimeline });
    keys.handle('left');
    keys.handle('right');
    expect(calls.filter(call => call.startsWith('show'))).toEqual(['show(50000)', 'show(60000)']);
    expect(calls.some(call => call.startsWith('focus('))).toBe(false);
    expect(state.focus.where).toBe('timeline');
  });

  it('Down returns to the remembered toolbar control', () => {
    const { calls, keys } = setup({ focus: onTimeline, remembered: 'subtitles' });
    keys.handle('down');
    expect(calls).toContain('focus(subtitles)');
  });

  it('Down never lands on the timeline itself', () => {
    const { calls, keys } = setup({ focus: onTimeline, remembered: 'timeline' });
    keys.handle('down');
    expect(calls).toContain('focus(play)');
  });
});

describe('FF and RW in every state', () => {
  for (const focus of [
    { where: 'toolbar', key: 'audio', row: '1' },
    { where: 'timeline', key: 'timeline', row: '0' },
    { where: 'none', key: null, row: null },
  ] as PlayerFocus[]) {
    it(`seek one Seek step without moving focus (${focus.where})`, () => {
      const { calls, keys } = setup({ focus });
      keys.handle('fast-forward');
      keys.handle('rewind');
      expect(calls.filter(call => call.startsWith('show'))).toEqual(['show(70000)', 'show(60000)']);
      expect(calls.some(call => call.startsWith('focus(') || call.startsWith('navigate'))).toBe(false);
    });
  }
});

describe('Play, Pause, Back', () => {
  it('act without moving focus', () => {
    const { calls, keys } = setup({ focus: { where: 'toolbar', key: 'audio', row: '1' } });
    keys.handle('play');
    keys.handle('pause');
    keys.handle('play-pause');
    expect(calls).toEqual(['play(true)', 'play(false)', 'play(undefined)']);
  });

  it('Back closes a Player panel, else leaves, through one port', () => {
    const { calls, keys } = setup();
    keys.handle('back');
    keys.handle('stop');
    expect(calls).toEqual(['back', 'back']);
  });
});

describe('Player panel open', () => {
  it('Left and Right do nothing and never seek', () => {
    const { calls, keys } = setup({ menu: true, focus: { where: 'menu', key: null, row: '1' } });
    keys.handle('left');
    keys.handle('right');
    expect(calls.filter(call => /^(show|seekTo)\(/.test(call) || call.startsWith('navigate'))).toEqual([]);
  });

  it('Up and Down move through the panel and OK activates', () => {
    const { calls, keys } = setup({ menu: true, focus: { where: 'menu', key: null, row: '1' } });
    keys.handle('down');
    keys.handle('enter');
    expect(calls.filter(call => call.startsWith('navigate') || call.startsWith('activate'))).toEqual(['navigate(down)', 'activate-focused']);
  });

  it('holds the hide timer open while the panel is open', () => {
    const { controls, keys } = setup({ menu: true, focus: { where: 'menu', key: null, row: '1' } });
    controls.setPanelOpen(true);
    keys.handle('down');
    vi.advanceTimersByTime(10_000);
    expect(controls.visible).toBe(true);
  });
});

describe('focus fallback', () => {
  it('falls back to the remembered control, never the first, when the active element is not in the control list', () => {
    const { calls, keys } = setup({ focus: { where: 'none', key: null, row: null }, remembered: 'options' });
    keys.handle('left');
    expect(calls).toContain('focus(options)');
    expect(calls).not.toContain('focus(timeline)');
    expect(calls.filter(call => call.startsWith('navigate') || /^(show|seekTo)\(/.test(call))).toEqual([]);
  });

  it('OK with focus outside the list restores the remembered control without activating anything', () => {
    const { calls, keys } = setup({ focus: { where: 'none', key: null, row: null }, remembered: 'options' });
    keys.handle('enter');
    expect(calls).toContain('focus(options)');
    expect(calls.some(call => call.startsWith('activate'))).toBe(false);
  });

  it('inside the menu, falls back to the first panel item', () => {
    const { calls, keys } = setup({ menu: true, focus: { where: 'none', key: null, row: null } });
    keys.handle('down');
    expect(calls).toContain('focus-first-menu');
  });
});

describe('hide timer', () => {
  it('arms after the last key press by the existing timeout, even with a control focused', () => {
    const { controls, keys } = setup();
    keys.handle('left');
    vi.advanceTimersByTime(1500);
    keys.handle('right');
    vi.advanceTimersByTime(1999);
    expect(controls.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controls.visible).toBe(false);
  });

  it('a seek does not hold it open', () => {
    const { controls, keys } = setup({ focus: { where: 'timeline', key: 'timeline', row: '0' } });
    keys.handle('right');
    idleUntilHidden(controls);
  });

  it('FF and RW re-arm it like any key', () => {
    const { controls, keys } = setup();
    keys.handle('left');
    vi.advanceTimersByTime(1500);
    keys.handle('fast-forward');
    vi.advanceTimersByTime(1999);
    expect(controls.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controls.visible).toBe(false);
  });

  it('records the focused control when it fires and restores it on the next Wake', () => {
    const { calls, controls, keys, state } = setup({ focus: { where: 'toolbar', key: 'subtitles', row: '1' }, remembered: 'play' });
    keys.handle('left');
    idleUntilHidden(controls);
    expect(state.remembered).toBe('subtitles');
    calls.length = 0;
    keys.handle('down');
    expect(calls).toEqual(['reveal', 'focus(subtitles)']);
  });

  it('does not record the timeline as the remembered control', () => {
    const { controls, keys, state } = setup({ focus: { where: 'timeline', key: 'timeline', row: '0' }, remembered: 'audio' });
    keys.handle('left');
    idleUntilHidden(controls);
    expect(state.remembered).toBe('audio');
  });
});

describe('seek commit', () => {
  const onTimeline: PlayerFocus = { where: 'timeline', key: 'timeline', row: '0' };

  it('accumulates Seek steps and commits one seek to AVPlay after the idle pause', () => {
    const { keys, av, state } = setup({ focus: onTimeline });
    keys.handle('right');
    keys.handle('right');
    keys.handle('right');
    expect(state.position).toBe(90_000);
    expect(av.requests).toEqual([]);
    vi.advanceTimersByTime(549);
    expect(av.requests).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(av.requests.map(request => request.ms)).toEqual([90_000]);
  });

  it('clamps the target to the media bounds', () => {
    const { keys, av } = setup({ focus: onTimeline });
    for (let i = 0; i < 10; i++) keys.handle('left');
    vi.advanceTimersByTime(550);
    expect(av.last().ms).toBe(0);
  });
});

describe('pending seek target', () => {
  const onTimeline: PlayerFocus = { where: 'timeline', key: 'timeline', row: '0' };

  /** A committed seek to 70 s that AVPlay has not resolved yet. */
  function pendingSeek() {
    const harness = setup({ focus: onTimeline });
    harness.keys.handle('right');
    vi.advanceTimersByTime(550);
    expect(harness.av.last().ms).toBe(70_000);
    return harness;
  }

  it('accepts playtime when no seek is pending', () => {
    const { keys } = setup();
    expect(keys.playtime(61_000)).toBe(true);
  });

  it('ignores stale playtime while a Seek step is still accumulating', () => {
    const { keys } = setup({ focus: onTimeline });
    keys.handle('right');
    expect(keys.playtime(60_200)).toBe(false);
  });

  it('ignores stale playtime until the seek success callback fires', () => {
    const { keys, av, state } = pendingSeek();
    expect(keys.playtime(60_200)).toBe(false);
    expect(keys.playtime(60_700)).toBe(false);
    expect(state.position).toBe(70_000);
    av.last().ok();
    expect(keys.playtime(70_100)).toBe(true);
    expect(keys.playtime(60_000)).toBe(true);
  });

  it('releases playtime once the reported time is within 1 second of the target', () => {
    const { keys, state } = pendingSeek();
    expect(keys.playtime(68_999)).toBe(false);
    expect(keys.playtime(69_000)).toBe(true);
    expect(keys.playtime(65_000)).toBe(true);
    expect(state.position).toBe(70_000);
  });

  it('releases playtime after the 2 second timeout', () => {
    const { keys } = pendingSeek();
    vi.advanceTimersByTime(1999);
    expect(keys.playtime(60_300)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(keys.playtime(60_400)).toBe(true);
  });

  it('keeps the shown position and current time on the target while pending', () => {
    const { keys, state } = pendingSeek();
    keys.playtime(60_100);
    expect(state.position).toBe(70_000);
  });

  it('builds the next Seek step on the pending target, not on the stale time', () => {
    const { keys, av } = pendingSeek();
    keys.handle('right');
    vi.advanceTimersByTime(550);
    expect(av.last().ms).toBe(80_000);
  });

  it('passes a seek error through, releases the pending target and keeps the aimed position', () => {
    const { keys, av, state } = pendingSeek();
    av.last().fail('PLAYER_ERROR_SEEK_FAILED');
    expect(state.errors).toEqual(['PLAYER_ERROR_SEEK_FAILED']);
    expect(keys.playtime(60_000)).toBe(true);
    expect(state.position).toBe(70_000);
  });

  it('reports a seekTo that throws instead of swallowing it', () => {
    const { keys, state } = setup({ focus: onTimeline });
    state.seekThrows = 'InvalidStateError';
    keys.handle('right');
    vi.advanceTimersByTime(550);
    expect(state.errors).toEqual(['InvalidStateError']);
    expect(keys.playtime(60_000)).toBe(true);
  });

  it('does not report an error from a superseded seek', () => {
    const { keys, av, state } = pendingSeek();
    const first = av.last();
    keys.handle('right');
    vi.advanceTimersByTime(550);
    first.fail('late');
    expect(state.errors).toEqual([]);
    expect(keys.playtime(60_000)).toBe(false);
  });

  it('an audio-track switch resumes at the pending target', () => {
    const { keys } = pendingSeek();
    expect(keys.resumeTarget()).toBe(70_000);
  });

  it('an audio-track switch resumes at the pending target while a Seek step is still accumulating', () => {
    const { keys } = setup({ focus: onTimeline });
    keys.handle('left');
    expect(keys.resumeTarget()).toBe(50_000);
  });

  it('an audio-track switch resumes at the current time when nothing is pending', () => {
    const { keys, av, state } = pendingSeek();
    av.last().ok();
    state.position = 71_500;
    expect(keys.resumeTarget()).toBe(71_500);
  });

  it('a late callback from a superseded seek does not release the newer one', () => {
    const { keys, av } = pendingSeek();
    const first = av.last();
    keys.handle('right');
    vi.advanceTimersByTime(550);
    first.ok();
    expect(keys.playtime(60_000)).toBe(false);
    av.last().ok();
    expect(keys.playtime(60_000)).toBe(true);
  });
});

describe('direct seeks', () => {
  it('seekBy commits at once relative to the pending target and tracks it like a Seek step', () => {
    const { keys, av, state } = setup();
    keys.seekBy(-10_000);
    expect(av.requests.map(request => request.ms)).toEqual([50_000]);
    expect(state.position).toBe(50_000);
    expect(keys.playtime(60_000)).toBe(false);
    keys.seekBy(-10_000);
    expect(av.last().ms).toBe(40_000);
  });

  it('seekTo commits at once, clamped, and a Seek step waiting for its pause is folded in', () => {
    const { keys, av } = setup({ focus: { where: 'timeline', key: 'timeline', row: '0' } });
    keys.handle('right');
    keys.seekTo(0);
    expect(av.requests.map(request => request.ms)).toEqual([0]);
    vi.advanceTimersByTime(550);
    expect(av.requests.map(request => request.ms)).toEqual([0]);
  });

  it('dispose drops the pending target and its timers', () => {
    const { keys, av, state } = setup({ focus: { where: 'timeline', key: 'timeline', row: '0' } });
    keys.handle('right');
    keys.dispose();
    vi.advanceTimersByTime(5000);
    expect(av.requests).toEqual([]);
    expect(keys.playtime(1)).toBe(true);
    expect(keys.resumeTarget()).toBe(state.position);
  });
});

describe('held keys', () => {
  for (const action of ['enter', 'back', 'stop', 'play-pause'] as const) {
    it(`event.repeat is ignored for ${action}`, () => {
      const { calls, keys } = setup({ focus: { where: 'toolbar', key: 'audio', row: '1' } });
      keys.handle(action, true);
      expect(calls).toEqual([]);
    });
  }

  it('event.repeat is ignored for Enter on hidden controls: no Wake activation', () => {
    const { calls, controls, keys } = setupHidden('audio');
    keys.handle('enter', true);
    expect(calls).toEqual([]);
    expect(controls.visible).toBe(false);
  });

  it('the first press of Enter, Back and Play/Pause still acts', () => {
    const { calls, keys } = setup({ focus: { where: 'toolbar', key: 'audio', row: '1' } });
    keys.handle('enter', false);
    keys.handle('back', false);
    keys.handle('play-pause', false);
    expect(calls).toEqual(['reveal', 'activate-focused', 'back', 'play(undefined)']);
  });

  it('directional repeats keep moving focus along the toolbar', () => {
    const { calls, keys } = setup();
    keys.handle('right', false);
    keys.handle('right', true);
    keys.handle('right', true);
    expect(calls.filter(call => call.startsWith('navigate'))).toEqual(['navigate(right)', 'navigate(right)', 'navigate(right)']);
  });

  it('repeats on the timeline accumulate fixed Seek steps and commit once after release', () => {
    const { keys, av, state } = setup({ focus: { where: 'timeline', key: 'timeline', row: '0' } });
    keys.handle('right', false);
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(40); keys.handle('right', true); }
    expect(av.requests).toEqual([]);
    expect(state.position).toBe(60_000 + 21 * 10_000);
    vi.advanceTimersByTime(550);
    expect(av.requests.map(request => request.ms)).toEqual([60_000 + 21 * 10_000]);
  });

  it('repeats of FF and RW accumulate the same way', () => {
    const { keys, av } = setup();
    keys.handle('fast-forward', false);
    keys.handle('fast-forward', true);
    keys.handle('fast-forward', true);
    vi.advanceTimersByTime(550);
    expect(av.requests.map(request => request.ms)).toEqual([90_000]);
  });
});

describe('Next and Previous skip a larger step (no episode queue in the player)', () => {
  it('SKIP_STEP_MS is 60 seconds', () => { expect(SKIP_STEP_MS).toBe(60_000); });

  for (const focus of [
    { where: 'toolbar', key: 'audio', row: '1' },
    { where: 'timeline', key: 'timeline', row: '0' },
    { where: 'none', key: null, row: null },
  ] as PlayerFocus[]) {
    it(`skip without moving Control focus and keep visible controls up (${focus.where})`, () => {
      const { calls, keys, controls } = setup({ focus });
      keys.handle('next');
      keys.handle('previous');
      expect(calls.filter(call => call.startsWith('show'))).toEqual(['show(120000)', 'show(60000)']);
      expect(calls.some(call => call.startsWith('focus(') || call.startsWith('navigate'))).toBe(false);
      expect(controls.visible).toBe(true);
    });
  }

  it('accumulates on the pending target and commits once; rewind and next mix', () => {
    const { calls, keys } = setup();
    keys.handle('next');
    keys.handle('fast-forward');
    vi.advanceTimersByTime(600);
    expect(calls.filter(call => call.startsWith('seekTo'))).toEqual(['seekTo(130000)']);
  });

  it('clamps at the start', () => {
    const { calls, keys } = setup();
    keys.handle('previous');
    keys.handle('previous');
    expect(calls.filter(call => call.startsWith('show')).pop()).toBe('show(0)');
  });
});
