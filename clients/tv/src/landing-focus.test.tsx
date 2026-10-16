// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// App-seam tests for landing focus: entering a screen puts the D-pad cursor on
// the screen's first card (never the header Refresh button), cards that load
// later still receive it, and nothing is ever yanked after the viewer pressed
// a key. main.tsx asserts #app at module evaluation.
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
const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const titleRow = (id: string) => ({ id, title: `Title ${id}`, kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 1, bestSeeders: 50, largestSizeBytes: 4e9, trackers: [{ id: 'filelist', name: 'FileList' }] });
const release = { id: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: 'Alpha.1080p', category: 'Movies', sizeBytes: 4e9, seeders: 50, leechers: 1, freeleech: false };
const detailBody = { title: titleRow('a'), seasons: [], sources: [{ release, parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL' }, fileIndex: 0, filePath: 'a.mkv', fileSizeBytes: 4e9 }] };
const jobRow = { id: 'j1', kind: 'catalog-sync', state: 'completed', label: 'Fetch latest', dedupeKey: 'k', progress: 1, attempt: 1, retryable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const downloadRow = { id: 'dl-1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Alpha', engineId: 'e', fileIndex: 0, filePath: 'a.mkv', mimeType: 'video/x-matroska', streamUrl: '/s/dl-1', sizeBytes: 4e9, downloadedBytes: 4e9, progress: 1, state: 'completed', playbackMode: 'local', speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0, leased: false };
const keyDown = (key: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
const focusKey = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;

describe('landing focus through the app', () => {
  let container: HTMLDivElement;
  let titlesGate: Promise<void> | null;
  let jobItems: unknown[];
  let downloadItems: unknown[];
  beforeEach(() => {
    titlesGate = null;
    jobItems = [];
    downloadItems = [];
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog/search')) return respond({ items: [titleRow('s1'), titleRow('s2')], nextCursor: null, total: 2 });
      if (/\/catalog\/titles\/[^?]/.test(url)) return respond(detailBody);
      if (url.includes('/catalog/titles')) { if (titlesGate) await titlesGate; return respond({ items: url.includes('search=') ? [titleRow('s1'), titleRow('s2')] : [titleRow('a'), titleRow('b')], nextCursor: null, total: 2 }); }
      if (url.includes('/catalog/facets')) return respond({ categories: ['Movies'], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/settings/schema')) return respond({ items: [] });
      if (url.includes('/settings')) return respond({});
      if (url.includes('/trackers')) return respond([]);
      if (url.includes('/jobs')) return respond({ items: jobItems, nextCursor: null, total: jobItems.length });
      if (url.includes('/downloads')) return respond({ items: downloadItems, nextCursor: null, total: downloadItems.length });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: [] });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [], continueWatching: [], recent: [], watched: [] });
      if (url.includes('/info')) return respond({ name: 'torrent-tv', version: '1', instanceName: 'test' });
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
    vi.restoreAllMocks();
  });

  const open = async (route: string) => { container.querySelector<HTMLElement>(`[data-menu-route="${route}"]`)!.click(); await wait(80); };
  const start = async () => { render(h(App, null), container); await wait(150); };

  it('opens Home on the hero button, not on Refresh', async () => {
    await start();
    expect(focusKey()).toBe('hero-a');
  });

  it('lands on the first poster card when a menu choice opens Browse, not on Refresh', async () => {
    await start();
    await open('browse');
    expect(focusKey()).toBe('title-a');
  });

  it('lands on the first card of the first rail on the Tracker dashboard', async () => {
    await start();
    await open('tracker');
    expect(focusKey()).toBe('title-a');
  });

  it('lands on the Search field when Search opens, and on the first result once a submitted search lands', async () => {
    await start();
    await open('search');
    expect(focusKey()).toBe('search-input');
    const field = container.querySelector<HTMLInputElement>('[data-focus-key="search-input"]')!;
    field.value = 'matrix';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(20);
    container.querySelector<HTMLButtonElement>('[data-focus-key="search-submit"]')!.click();
    await wait(100);
    expect(focusKey()).toBe('title-s1');
  });

  it('lands on the first setting, not Refresh or the catalog controls, when Settings opens', async () => {
    await start();
    await open('settings');
    expect(focusKey()).toBe('setting-audio-primary');
  });

  it('lands on the first category tile when Categories opens', async () => {
    await start();
    await open('categories');
    expect(focusKey()).toBe('category-Movies');
  });

  it('lands on the Jobs filters when there are no jobs', async () => {
    await start();
    await open('jobs');
    expect(focusKey()).toBe('jobs-search');
  });

  it('lands on the first job, not the filters, when there are jobs', async () => {
    jobItems = [jobRow];
    await start();
    await open('jobs');
    // The list refetches after its filter debounce; the cursor moves from the filters to the first job once it lands.
    await wait(500);
    expect(focusKey()).toBe('job-j1');
  });

  it('lands on the first download, not its search field, when there are downloads', async () => {
    downloadItems = [downloadRow];
    await start();
    await open('downloads');
    expect(focusKey()).toBe('download-dl-1-play');
  });

  it('returns to the card a title page was opened from when Back closes it', async () => {
    await start();
    await open('browse');
    container.querySelector<HTMLButtonElement>('[data-focus-key="title-b"]')!.focus();
    container.querySelector<HTMLButtonElement>('[data-focus-key="title-b"]')!.click();
    await wait(100);
    expect(container.querySelector('[data-focus-key="detail-playback"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true }));
    await wait(100);
    expect(container.querySelector('[data-focus-key="detail-playback"]')).toBeNull();
    expect(focusKey()).toBe('title-b');
  });

  it('keeps a pending landing for cards that arrive late and moves to the first one', async () => {
    await start();
    await open('library');
    let release!: () => void;
    titlesGate = new Promise<void>(resolve => { release = resolve; });
    await open('browse');
    expect(focusKey()).not.toBe('header-retry');
    expect(container.querySelector('[data-focus-key="title-a"]')).toBeNull();
    release();
    await wait(100);
    expect(focusKey()).toBe('title-a');
  });

  it('never yanks focus to late cards after the viewer pressed a key', async () => {
    await start();
    await open('library');
    let release!: () => void;
    titlesGate = new Promise<void>(resolve => { release = resolve; });
    await open('browse');
    const before = focusKey();
    keyDown('ArrowRight', 39);
    await wait(20);
    const afterKey = focusKey();
    release();
    await wait(100);
    expect(container.querySelector('[data-focus-key="title-a"]')).not.toBeNull();
    expect(focusKey()).toBe(afterKey);
    expect(before).not.toBe('title-a');
  });
});
