import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlsVisibility } from '@torrent-tv/shared';
import { PlayerKeyController, type PlayerFocus } from './player-keys';

const TOOLBAR = ['restart', 'back-10', 'play', 'forward-10', 'audio', 'subtitles', 'options', 'back', 'hide'];

/** A fake player surface: real ControlsVisibility on fake timers, every port call recorded. */
function setup(initial: { focus?: PlayerFocus; remembered?: string; menu?: boolean } = {}) {
  const calls: string[] = [];
  const state = {
    focus: initial.focus ?? ({ where: 'toolbar', key: 'play', row: '1' } as PlayerFocus),
    remembered: initial.remembered ?? 'play',
    menu: initial.menu ?? false,
  };
  const controls = new ControlsVisibility({ policy: { armWhilePaused: true, statusHolds: false }, onChange: visible => { if (!visible) keys.controlsHidden(); } });
  const keys = new PlayerKeyController({
    controlsVisible: () => controls.visible,
    menuOpen: () => state.menu,
    focused: () => state.focus,
    remembered: () => state.remembered,
    remember: key => { state.remembered = key; },
    reveal: hold => { calls.push(hold ? 'reveal(hold)' : 'reveal'); controls.reveal(hold); },
    seek: (delta, hidden) => { calls.push(`seek(${delta},${hidden ? 'hidden' : 'visible'})`); },
    focusControl: key => { calls.push(`focus(${key})`); state.focus = key === 'timeline' ? { where: 'timeline', key, row: '0' } : { where: 'toolbar', key, row: '1' }; },
    activateControl: key => { calls.push(`activate(${key})`); },
    activateFocused: () => { calls.push('activate-focused'); },
    focusFirstMenuItem: () => { calls.push('focus-first-menu'); },
    navigate: direction => { calls.push(`navigate(${direction})`); },
    togglePlayback: force => { calls.push(`play(${force})`); },
    back: () => { calls.push('back'); },
  });
  const seekCalls = () => calls.filter(call => call.startsWith('seek'));
  return { calls, state, controls, keys, seekCalls };
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
  for (const action of ['left', 'right', 'up', 'down'] as const) {
    it(`${action} wakes the controls, restores Control focus and never seeks`, () => {
      const { calls, controls, keys, seekCalls, state } = setupHidden('audio');
      keys.handle(action);
      expect(controls.visible).toBe(true);
      expect(calls).toEqual(['reveal', 'focus(audio)']);
      expect(seekCalls()).toEqual([]);
      expect(state.remembered).toBe('audio');
    });
  }

  it('restores to play by default', () => {
    const { calls, controls, keys } = setupHidden();
    keys.handle('left');
    expect(calls).toContain('focus(play)');
  });

  it('OK wakes the controls and activates the remembered control on the first press', () => {
    const { calls, controls, keys } = setupHidden('subtitles');
    keys.handle('enter');
    expect(controls.visible).toBe(true);
    expect(calls).toEqual(['reveal', 'focus(subtitles)', 'activate(subtitles)']);
  });

  for (const [action, delta] of [['rewind', -10_000], ['fast-forward', 10_000], ['previous', -10_000], ['next', 10_000]] as const) {
    it(`${action} seeks one Seek step and the controls stay hidden`, () => {
      const { calls, controls, keys } = setupHidden();
      keys.handle(action);
      expect(controls.visible).toBe(false);
      expect(calls).toEqual([`seek(${delta},hidden)`]);
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
    expect(calls.filter(call => call.startsWith('seek'))).toEqual(['seek(-10000,visible)', 'seek(10000,visible)']);
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
      expect(calls.filter(call => call.startsWith('seek'))).toEqual(['seek(10000,visible)', 'seek(-10000,visible)']);
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
    expect(calls.filter(call => call.startsWith('seek') || call.startsWith('navigate'))).toEqual([]);
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
    expect(calls.filter(call => call.startsWith('navigate') || call.startsWith('seek'))).toEqual([]);
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
