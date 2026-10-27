// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, Download } from '@torrent-tv/shared';

// The Player in the Night Screen look (#61): what the viewer reads on the controls. The Control, Wake and Seek rules
// and every focus row and column are pinned by player-keys.test.ts and lifecycle.test.tsx; this file covers the words,
// the times and the drawn ranges.

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) || null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Player } = await import('./main');
render(null, appRoot);

const tick = (ms = 25) => sleep(ms);
type Listener = { oncurrentplaytime?: (ms: number) => void };

describe('Player controls in the new look', () => {
  const episode: Download = { id: 'dl-1', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Velvet Witness · S01E04 · The Lantern Room', parsed: { title: 'Velvet Witness', sortTitle: 'velvet witness', kind: 'series', seasonStart: 1, episodeStart: 4 }, engineId: 'e', fileIndex: 0, filePath: 'v.mkv', mimeType: 'video/x-matroska', streamUrl: '/s/1', sizeBytes: 1000, downloadedBytes: 620, progress: 0.62, state: 'downloading', playbackMode: 'progressive', speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0, leased: false };
  let container: HTMLDivElement;
  let listener: Listener;

  const mount = async (download: Download = episode) => {
    render(h(Player, { api: { base: 'http://s', streamURL: (p: string) => p, updatePlayback: vi.fn().mockResolvedValue({}), playbackPreferences: vi.fn(), updatePlaybackPreferences: vi.fn().mockResolvedValue({}), downloads: vi.fn().mockResolvedValue({ items: [download], nextCursor: null, total: 1 }), subtitles: vi.fn().mockResolvedValue({ items: [] }), diagnostic: vi.fn(), call: vi.fn() } as unknown as API, download, resumeMs: 0, preferences: { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' }, onClose: () => { }, onStateChanged: () => { }, onComplete: () => { } }), container);
    await tick(40);
    listener.oncurrentplaytime?.((17 * 60 + 51) * 1000);
    await tick(10);
  };
  const toolbar = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.player-toolbar button'));

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listener = {};
    (window as unknown as { webapis: unknown }).webapis = { avplay: { open: vi.fn(), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(), setListener: (l: Listener) => { listener = l; }, prepareAsync: (ok: () => void) => ok(), play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), stop: vi.fn(), close: vi.fn(), getDuration: () => 51 * 60_000, getTotalTrackInfo: () => [{ index: 1, type: 'AUDIO', extra_info: '{"language":"eng","channels":"6"}' }], setSelectTrack: vi.fn(), setSilentSubtitle: vi.fn() } };
  });
  afterEach(() => { render(null, container); container.remove(); delete (window as unknown as { webapis?: unknown }).webapis; });

  it('labels the round controls under them, in the toolbar order', async () => {
    await mount();
    expect(toolbar().map(button => button.querySelector('.player-label')?.textContent)).toEqual(['Restart', '−10 s', 'Pause', '+10 s', 'Audio', 'Subtitles', 'Options', 'Back', 'Hide']);
    expect(toolbar().map(button => button.dataset.focusCol)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    for (const button of toolbar()) expect(button.querySelector('.player-glyph svg'), button.dataset.playerControl).not.toBeNull();
  });

  it('keeps the track counts in the names the screen reader announces', async () => {
    await mount();
    expect(container.querySelector('[data-player-control="audio"]')?.getAttribute('aria-label')).toBe('Audio, 1 track');
    expect(container.querySelector('[data-player-control="subtitles"]')?.getAttribute('aria-label')).toBe('Subtitles, 0 tracks');
  });

  it('heads the screen with the show and code over the episode name, and the current choice', async () => {
    await mount();
    expect(container.querySelector('.player-kicker')?.textContent).toBe('Velvet Witness · S01E04');
    expect(container.querySelector('.player-title')?.textContent).toBe('The Lantern Room');
    expect(container.querySelector('.player-choice')?.textContent).toBe('Audio English · Subtitles Auto');
  });

  it('heads a movie with its title alone', async () => {
    await mount({ ...episode, displayTitle: 'Dune', parsed: { title: 'Dune', sortTitle: 'dune', kind: 'movie' } });
    expect(container.querySelector('.player-kicker')).toBeNull();
    expect(container.querySelector('.player-title')?.textContent).toBe('Dune');
  });

  it('shows the elapsed and the remaining time', async () => {
    await mount();
    expect(Array.from(container.querySelectorAll('.player-time span')).map(span => span.textContent)).toEqual(['17:51', '−33:09']);
  });

  it('draws the downloaded range under the played range on the timeline', async () => {
    await mount();
    expect(container.querySelector<HTMLElement>('.player-fill')?.style.width).toBe('35%');
    expect(container.querySelector<HTMLElement>('.player-buffered')?.style.width).toBe('62%');
    // Later siblings paint on top: the played range covers the downloaded one.
    expect(Array.from(container.querySelector('.player-timeline')!.children).map(child => child.className)).toEqual(['player-buffered', 'player-fill']);
  });
});
