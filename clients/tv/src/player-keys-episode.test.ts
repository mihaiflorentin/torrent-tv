import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerKeyController, SEEK_COMMIT_MS, SKIP_STEP_MS } from './player-keys';

function setup(withPort = true, skip?: (direction: 'next' | 'previous') => boolean | void | Promise<boolean | void>) {
  const calls: string[] = [];
  const state = { position: 60_000 };
  const keys = new PlayerKeyController({
    controlsVisible: () => true,
    menuOpen: () => false,
    focused: () => ({ where: 'toolbar', key: 'play', row: '1' }),
    remembered: () => 'play',
    remember: () => {},
    reveal: () => {},
    duration: () => 600_000,
    position: () => state.position,
    setPosition: ms => { state.position = ms; calls.push(`show(${ms})`); },
    announce: () => {},
    avSeekTo: ms => { calls.push(`seekTo(${ms})`); },
    seekFailed: () => {},
    focusControl: () => {},
    activateControl: () => {},
    activateFocused: () => {},
    focusFirstMenuItem: () => {},
    navigate: () => {},
    togglePlayback: () => {},
    back: () => {},
    ...(withPort ? { skipEpisode: (direction: 'next' | 'previous') => { calls.push(`episode(${direction})`); return skip?.(direction); } } : {}),
  });
  return { calls, keys };
}

describe('Channel keys skip episodes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hands next-episode and previous-episode to the player', () => {
    const { calls, keys } = setup();
    keys.handle('next-episode');
    keys.handle('previous-episode');
    expect(calls).toEqual(['episode(next)', 'episode(previous)']);
  });

  it('drops a pending seek target so a stale seek never lands on the new episode', () => {
    const { calls, keys } = setup();
    keys.handle('right');
    keys.handle('next-episode');
    vi.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(calls.some(call => call.startsWith('seekTo'))).toBe(false);
    expect(keys.playtime(1234)).toBe(true);
  });

  it('does nothing when the player offers no episode skipping', () => {
    const { calls, keys } = setup(false);
    expect(() => keys.handle('next-episode')).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('keeps Next and Previous as a 60 second seek', () => {
    const { calls, keys } = setup();
    keys.handle('next');
    expect(calls).toContain(`show(${60_000 + SKIP_STEP_MS})`);
  });

  it('keeps the pending seek when there is no sibling episode to switch to', async () => {
    const { calls, keys } = setup(true, () => Promise.resolve(false));
    keys.handle('fast-forward');
    keys.handle('next-episode');
    await Promise.resolve();
    vi.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(calls).toContain('seekTo(70000)');
  });

  it('keeps the pending seek when the port refuses synchronously', () => {
    const { calls, keys } = setup(true, () => false);
    keys.handle('fast-forward');
    keys.handle('next-episode');
    vi.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(calls).toContain('seekTo(70000)');
  });

  it('drops the pending seek once an asynchronous switch is accepted', async () => {
    const { calls, keys } = setup(true, () => Promise.resolve(true));
    keys.handle('fast-forward');
    keys.handle('next-episode');
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(SEEK_COMMIT_MS * 2);
    expect(calls.some(call => call.startsWith('seekTo'))).toBe(false);
    expect(keys.playtime(1234)).toBe(true);
  });
});
