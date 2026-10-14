// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Play from a title page, press Back in the Player, and the same title page comes back (focused
// on Play/Resume, with fresh data) instead of Home. main.tsx asserts #app at module evaluation.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: () => null,
  } as Storage;
}
class FakeEventSource { onopen = null; onerror = null; close() { } addEventListener() { } removeEventListener() { } }
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { App } = await import('./main');

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const rel = { id: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: 'Alpha.1080p', category: 'Movies', sizeBytes: 4e9, seeders: 50, leechers: 1, freeleech: false };
const titleRow = { id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 1, bestSeeders: 50, largestSizeBytes: 4e9, trackers: [{ id: 'filelist', name: 'FileList' }] };
const detailBody = { title: titleRow, seasons: [], sources: [{ release: rel, parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL' }, fileIndex: 0, filePath: 'a.mkv', fileSizeBytes: 4e9 }] };
const download = { id: 'dl-1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Alpha', engineId: 'e', fileIndex: 0, filePath: 'a.mkv', mimeType: 'video/x-matroska', streamUrl: '/s/dl-1', sizeBytes: 4e9, downloadedBytes: 4e9, progress: 1, state: 'completed', playbackMode: 'local', speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0, leased: false };

function respond(body: unknown) { return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; }

describe('App returns to the title page after the Player closes', () => {
  let container: HTMLDivElement;
  let titleFetches = 0;
  beforeEach(() => {
    titleFetches = 0;
    (window as unknown as { webapis: unknown }).webapis = { avplay: { open() { }, setDisplayRect() { }, setDisplayMethod() { }, setListener() { }, prepareAsync() { }, stop() { }, close() { }, setStreamingProperty() { }, getState: () => 'IDLE' } };
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/prepare')) return respond(download);
      if (url.includes('/catalog/titles/a')) { titleFetches++; return respond(detailBody); }
      if (url.includes('/catalog/titles')) return respond({ items: [titleRow], nextCursor: null, total: 1 });
      if (url.includes('/catalog/facets')) return respond({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/downloads') || url.includes('/jobs')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/playback/')) return respond({ positionMs: 0, durationMs: 0, watched: false });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: [] });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [], continueWatching: [], recent: [], watched: [] });
      if (url.includes('/info')) return respond({ name: 'torrent-tv', version: '1', instanceName: 'test' });
      void init;
      return respond({});
    });
    localStorage.setItem('filelist.serverUrl', 'http://server.lan:8097');
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    localStorage.clear();
    delete (window as unknown as { webapis?: unknown }).webapis;
  });

  it('reopens the title page the viewer played from, focused on Play, and not Home', async () => {
    render(h(App, null), container);
    await wait(120);
    container.querySelector<HTMLButtonElement>('[data-focus-key="hero-a"]')!.click();
    await wait();
    const play = container.querySelector<HTMLButtonElement>('[data-focus-key="detail-playback"]')!;
    expect(play).not.toBeNull();
    play.click();
    await wait(120);
    expect(container.querySelector('.player-title, .player-heading')).not.toBeNull();
    expect(container.querySelector('[data-focus-key="detail-playback"]')).toBeNull();
    const fetchesBefore = titleFetches;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true }));
    await wait(160);
    expect(container.querySelector('.player-heading')).toBeNull();
    expect(titleFetches).toBeGreaterThan(fetchesBefore);
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('detail-playback');
    expect(container.querySelector('.detail-copy h1')!.textContent).toBe('Alpha');
  });
});
