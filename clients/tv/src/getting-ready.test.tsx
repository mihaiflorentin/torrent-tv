// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogFacets, Download } from '@torrent-tv/shared';

// The calm "getting ready" experience: the Prepare modal counts seconds and, after 15 s, says why it
// is slow; the Player shows real progress while it opens, buffers or waits. Both are render-only.

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) || null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog, Player } = await import('./main');
render(null, appRoot);

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

describe('Prepare modal elapsed counter', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); vi.useRealTimers(); });

  const catalog = (preparing: { trackerName: string; label: string; seeders?: number }) => h(Catalog, {
    api: { titles: async () => ({ items: [], nextCursor: null }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}) } as unknown as API,
    status: 'Online', titles: [], facets: {} as CatalogFacets, household: { favorites: [], continueWatching: [], recent: [], watched: [] }, downloads: [], jobs: [], restoreFocus: null, portal: null, updateStatus: null,
    onUpdateStatus: () => { }, onFocus: () => { }, onRetry: () => { }, onChangeServer: () => { }, onForgetServer: () => { }, onPlay: () => { }, onPlayDownload: () => { }, onManageDownload: async () => { }, onManageSeasonPack: async () => { }, onRefreshDownloads: async () => { }, onFavorite: () => { },
    preparing, onCancelPrepare: () => { },
  });

  it('counts seconds, keeps Cancel the only control and adds the hint after 15 s', async () => {
    vi.useFakeTimers();
    render(catalog({ trackerName: 'FileList', label: 'Alpha.1080p', seeders: 7 }), container);
    await vi.advanceTimersByTimeAsync(50);
    const dialog = () => container.querySelector<HTMLElement>('.tv-prepare-confirm') as HTMLElement;
    expect(dialog().querySelector('.tv-prepare-elapsed')?.textContent).toBe('0 s');
    expect(dialog().textContent).not.toContain('Still looking');
    await vi.advanceTimersByTimeAsync(3000);
    expect(dialog().querySelector('.tv-prepare-elapsed')?.textContent).toBe('3 s');
    await vi.advanceTimersByTimeAsync(13000);
    expect(dialog().querySelector('.tv-prepare-elapsed')?.textContent).toBe('16 s');
    expect(dialog().textContent).toContain('This release has 7 seeders');
    expect(dialog().querySelectorAll('button').length).toBe(1);
    expect(dialog().querySelector('[data-focus-key="prepare-cancel"]')).not.toBeNull();
  });

  it('stops its interval when the modal goes away', async () => {
    vi.useFakeTimers();
    render(catalog({ trackerName: 'FileList', label: 'Alpha.1080p' }), container);
    await vi.advanceTimersByTimeAsync(50);
    render(null, container);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Player getting ready panel', () => {
  const live: Download = { id: 'dl-1', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Severance', parsed: { title: 'Severance', sortTitle: 'severance', kind: 'series', seasonStart: 2, episodeStart: 4 }, engineId: 'e', fileIndex: 0, filePath: 'v.mkv', mimeType: 'video/x-matroska', streamUrl: '/s/1', sizeBytes: 1000, downloadedBytes: 370, progress: 0.37, state: 'downloading', playbackMode: 'progressive', speedBytesPerSecond: 2_100_000, etaSeconds: 240, peers: 12, seeds: 9, leased: false };
  type Listener = { onbufferingcomplete?: () => void };
  let container: HTMLDivElement;
  let listener: Listener;
  let downloads: ReturnType<typeof vi.fn>;
  let api: API;
  const mount = () => render(h(Player, { api, download: { ...live, progress: 0, peers: 0, speedBytesPerSecond: 0, etaSeconds: 0 }, resumeMs: 0, preferences: { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' }, onClose: () => { }, onStateChanged: () => { }, onComplete: () => { } }), container);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listener = {};
    let prepared: (() => void) | null = null;
    (window as unknown as { webapis: unknown }).webapis = { avplay: { open: vi.fn(), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(), setListener: (l: Listener) => { listener = l; }, prepareAsync: (ok: () => void) => { prepared = ok; (window as unknown as { __prepare: () => void }).__prepare = () => prepared?.(); }, play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), stop: vi.fn(), close: vi.fn(), getDuration: () => 120_000, getTotalTrackInfo: () => [], setSelectTrack: vi.fn(), setSilentSubtitle: vi.fn() } };
    downloads = vi.fn().mockResolvedValue({ items: [live], nextCursor: null, total: 1 });
    api = { base: 'http://s', streamURL: (p: string) => p, updatePlayback: vi.fn().mockResolvedValue({}), playbackPreferences: vi.fn(), updatePlaybackPreferences: vi.fn().mockResolvedValue({}), downloads, subtitles: vi.fn().mockResolvedValue({ items: [] }), diagnostic: vi.fn(), call: vi.fn() } as unknown as API;
  });
  afterEach(() => { render(null, container); container.remove(); delete (window as unknown as { webapis?: unknown }).webapis; });

  it('shows title with episode code, percent, peers, speed and time left while opening', async () => {
    mount();
    await tick(60);
    const panel = container.querySelector<HTMLElement>('.player-ready') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Severance · S02E04');
    expect(panel.textContent).toContain('37%');
    expect(panel.textContent).toContain('12 peers · 2.1 MB/s · 4 min left');
    expect((panel.querySelector('.player-ready-fill') as HTMLElement).style.width).toBe('37%');
    expect(panel.querySelector('button, [tabindex], a')).toBeNull();
  });

  it('does not take focus and disappears once playing, ending the poll', async () => {
    mount();
    await tick(60);
    const focused = document.activeElement;
    expect(container.querySelector('.player-ready')?.contains(focused)).toBe(false);
    (window as unknown as { __prepare: () => void }).__prepare();
    await tick(30);
    expect(container.querySelector('.player-ready')).toBeNull();
    const calls = downloads.mock.calls.length;
    await tick(60);
    expect(downloads.mock.calls.length).toBe(calls);
  });

  it('keeps the plain status when the poll fails', async () => {
    downloads.mockRejectedValue(new Error('offline'));
    mount();
    await tick(60);
    expect(container.querySelector('.player-message')?.textContent).toContain('Opening progressive stream');
    expect(container.querySelector('.player-ready-fill')).toBeNull();
  });
});
