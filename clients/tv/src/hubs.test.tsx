// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';

// The six-hub rail (ticket #54) through the whole app: what the rail holds, the Library and Discover
// tab strips, where the remote's keys go around them, and the chrome that left every screen.
// main.tsx asserts #app at module evaluation.
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
const streams: FakeEventSource[] = [];
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { streams.push(this); }
  close() { }
  addEventListener() { }
  removeEventListener() { }
}
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { App } = await import('./main');
// Importing main.tsx boots an app into #app (the Setup screen here); only the app under test may hear the keys.
render(null, appRoot);

const wait = (ms = 80) => sleep(ms);
const respond = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const titleRow = (id: string) => ({ id, title: `Title ${id}`, kind: 'movie', year: 2019, resolutions: ['1080p'], categories: ['Movies'], sourceCount: 1, bestSeeders: 50, largestSizeBytes: 4e9, trackers: [{ id: 'filelist', name: 'FileList' }] });
const release = { id: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: 'Alpha.1080p', category: 'Movies', sizeBytes: 4e9, seeders: 50, leechers: 1, freeleech: false };
const detailBody = { title: titleRow('a'), seasons: [], sources: [{ release, parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL' }, fileIndex: 0, filePath: 'a.mkv', fileSizeBytes: 4e9 }] };
const libraryItem = (id: string, over: Record<string, unknown> = {}) => ({ profileId: 'h', sourceId: `s-${id}`, releaseId: `rel-${id}`, fileIndex: 0, filePath: `${id}.mkv`, positionMs: 400, durationMs: 1000, watched: false, updatedAt: '2026-10-14T10:00:00Z', release: { ...release, id: `rel-${id}` }, catalog: titleRow(id), favorite: false, titleId: id, ...over });
const download = (id: string, state: string, progress: number) => ({ id, releaseId: `rel-${id}`, trackerId: 'filelist', trackerName: 'FileList', displayTitle: `Download ${id}`, engineId: 'e', fileIndex: 0, filePath: `${id}.mkv`, mimeType: 'video/x-matroska', streamUrl: `/s/${id}`, sizeBytes: 4e9, downloadedBytes: 4e9 * progress, progress, state, playbackMode: 'local', speedBytesPerSecond: 1e6, etaSeconds: 60, peers: 3, seeds: 3, leased: false });
const keyDown = (key: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
const press = async (key: 'left' | 'right' | 'up' | 'down') => { keyDown({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[key], { left: 37, right: 39, up: 38, down: 40 }[key]); await wait(40); };
const back = async () => { keyDown('XF86Back', 10009); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true })); await wait(); };
const focusKey = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;

describe('the six-hub rail', () => {
  let container: HTMLDivElement;
  let downloads: unknown[];
  let trackers: unknown[];
  let portalLinks: unknown[];
  beforeEach(() => {
    streams.length = 0;
    downloads = [];
    trackers = [{ id: 'filelist', name: 'FileList', enabled: true, configured: true }];
    portalLinks = [{ id: 'blog', title: 'Blog', description: 'Our notes', url: 'https://blog.example.test' }];
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    (window as unknown as { webapis: unknown }).webapis = { avplay: { open() { }, setDisplayRect() { }, setDisplayMethod() { }, setListener() { }, prepareAsync() { }, stop() { }, close() { }, setStreamingProperty() { }, getState: () => 'IDLE' } };
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/prepare')) return respond(download('dl-a', 'completed', 1));
      if (/\/catalog\/titles\/[^?]/.test(url)) return respond(detailBody);
      if (url.includes('/catalog/titles')) return respond({ items: [titleRow('a'), titleRow('b')], nextCursor: null, total: 2 });
      if (url.includes('/catalog/families') || url.includes('/library/families')) return respond({ items: [{ key: 'movies', name: 'Movies', count: 3, newestTitle: 'Alpha', categories: ['Movies'], art: { url: '/api/v1/catalog/families/movies/art.svg', source: 'bundled' } }], nextCursor: null, total: 1 });
      if (url.includes('/catalog/facets')) return respond({ categories: ['Movies'], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/settings/schema')) return respond({ items: [] });
      if (url.includes('/settings')) return respond({});
      if (url.includes('/trackers')) return respond(trackers);
      if (url.includes('/jobs')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/downloads')) return respond({ items: downloads, nextCursor: null, total: downloads.length });
      if (url.includes('/playback/')) return respond({ positionMs: 0, durationMs: 0, watched: false });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: portalLinks });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [libraryItem('f', { favorite: true, positionMs: 0 })], continueWatching: [libraryItem('c')], recent: [], watched: [libraryItem('w', { watched: true, positionMs: 1000 })] });
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
    delete (window as unknown as { webapis?: unknown }).webapis;
  });

  const start = async () => { render(h(App, null), container); await wait(150); };
  const railLabels = () => Array.from(container.querySelectorAll<HTMLElement>('.tv-sidebar [data-menu-hub]')).map(item => item.querySelector('b')!.textContent);
  const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[data-hub-tab]'));
  const selectedTab = () => container.querySelector<HTMLElement>('[data-hub-tab][aria-selected="true"]')?.textContent;
  const currentRoute = () => container.querySelector<HTMLElement>('.tv-app')?.dataset.route;

  it('holds six destinations, Home to Settings, with Jobs and Other projects gone from it', async () => {
    await start();
    expect(railLabels()).toEqual(['Home', 'Search', 'Library', 'Discover', 'Downloads', 'Settings']);
    expect(container.querySelector('.tv-sidebar')!.textContent).not.toMatch(/Jobs|Other projects|Dashboard/);
  });

  it('opens Library on its Dashboard tab and draws the five tabs as a focus row above the content', async () => {
    await start();
    await openRoute(container, 'library');
    expect(tabs().map(tab => tab.textContent)).toEqual(['Dashboard', 'Continue watching', 'My List', 'Watched', 'Categories']);
    expect(selectedTab()).toBe('Dashboard');
    expect(tabs().map(tab => tab.dataset.focusRow)).toEqual(['0', '0', '0', '0', '0']);
    expect(container.querySelector('[data-menu-hub="library"]')!.getAttribute('aria-current')).toBe('page');
  });

  it('reaches every Library and Discover route from its tab and lands on the first card, never on a tab', async () => {
    await start();
    const expected: Array<[string, string, string]> = [
      ['continue', 'Continue watching', 'library-c'],
      ['favorites', 'My List', 'library-f'],
      ['watched', 'Watched', 'library-w'],
      ['library-categories', 'Categories', 'family-movies'],
      ['tracker', 'Highlights', 'title-a'],
      ['browse', 'Browse', 'title-a'],
      ['categories', 'Categories', 'family-movies'],
    ];
    for (const [route, label, landing] of expected) {
      await openRoute(container, route, 120);
      expect(currentRoute(), route).toBe(route);
      expect(selectedTab(), route).toBe(label);
      expect(`${route}: ${focusKey()}`).toMatch(new RegExp(`^${route}: ${landing}`));
    }
  });

  it('opens Discover on Highlights, then each hub on its last-used tab', async () => {
    await start();
    container.querySelector<HTMLElement>('[data-menu-hub="discover"]')!.click();
    await wait();
    expect(currentRoute()).toBe('tracker');
    await openRoute(container, 'browse');
    await openRoute(container, 'favorites');
    await openRoute(container, 'home');
    container.querySelector<HTMLElement>('[data-menu-hub="discover"]')!.click();
    await wait();
    expect(currentRoute()).toBe('browse');
    container.querySelector<HTMLElement>('[data-menu-hub="library"]')!.click();
    await wait();
    expect(currentRoute()).toBe('favorites');
  });

  it('moves between the tabs and the content: Down to the first card, Up back to the selected tab', async () => {
    await start();
    await openRoute(container, 'watched');
    expect(focusKey()).toMatch(/^library-w/);
    await press('up');
    expect(focusKey()).toBe('tab-watched');
    await press('left');
    expect(focusKey()).toBe('tab-favorites');
    await press('up');
    expect(focusKey()).toBe('tab-favorites');
    await press('down');
    expect(focusKey()).toMatch(/^library-w/);
  });

  it('opens the rail with Left from the first tab and returns to that tab with Right', async () => {
    await start();
    await openRoute(container, 'library');
    container.querySelector<HTMLElement>('[data-focus-key="tab-library"]')!.focus();
    await press('left');
    expect(container.querySelector('.tv-app.menu-open')).not.toBeNull();
    expect(focusKey()).toBe('menu-library');
    await press('right');
    expect(container.querySelector('.tv-app.menu-open')).toBeNull();
    expect(focusKey()).toBe('tab-library');
  });

  it('walks the rail with Up and Down, stopping at both ends', async () => {
    await start();
    await press('left');
    expect(focusKey()).toBe('menu-home');
    await press('up');
    expect(focusKey()).toBe('menu-home');
    for (let i = 0; i < 7; i++) await press('down');
    expect(focusKey()).toBe('menu-settings');
  });

  it('reaches Background jobs and Other projects from Settings, and Back returns to the entry', async () => {
    await start();
    await openRoute(container, 'jobs');
    expect(currentRoute()).toBe('jobs');
    expect(container.querySelector('[data-menu-hub="settings"]')!.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.tv-content h1')!.textContent).toBe('Background jobs');
    await back();
    expect(currentRoute()).toBe('settings');
    expect(focusKey()).toBe('settings-jobs');
    expect(container.querySelector('[data-settings-pane]')!.getAttribute('data-settings-pane')).toBe('jobs');
    container.querySelector<HTMLElement>('[data-focus-key="settings-group-projects"]')!.click();
    await wait();
    container.querySelector<HTMLElement>('[data-focus-key="settings-projects"]')!.click();
    await wait();
    expect(currentRoute()).toBe('projects');
    expect(focusKey()).toBe('project-blog');
    await back();
    expect(focusKey()).toBe('settings-projects');
  });

  it('keeps Other projects out of Settings while the server publishes no links', async () => {
    portalLinks = [];
    await start();
    await openRoute(container, 'settings');
    expect(container.querySelector('[data-focus-key="settings-group-jobs"]')).not.toBeNull();
    expect(container.querySelector('[data-focus-key="settings-group-projects"]')).toBeNull();
  });

  it('draws no header Refresh and no connection text on any screen, and no duplicate section heading', async () => {
    await start();
    for (const route of ['home', 'search', 'library', 'continue', 'tracker', 'browse', 'downloads', 'settings', 'jobs']) {
      await openRoute(container, route);
      const content = container.querySelector('.tv-content')!;
      expect(content.querySelector('[data-focus-key="header-retry"]'), route).toBeNull();
      expect(content.textContent, route).not.toMatch(/Server connected/);
      const headings = Array.from(content.querySelectorAll('h1, h2')).map(heading => heading.textContent);
      expect(new Set(headings).size, `${route}: ${headings.join(' | ')}`).toBe(headings.length);
    }
    await openRoute(container, 'home');
    expect(container.querySelector('.tv-content h1'), 'Home has no page title').toBeNull();
  });

  it('offers a manual reload in Settings', async () => {
    await start();
    await openRoute(container, 'settings');
    container.querySelector<HTMLElement>('[data-focus-key="settings-group-server"]')!.click();
    await wait();
    expect(container.querySelector('[data-focus-key="settings-reload"] .tv-setting-name')!.textContent).toBe('Reload library');
  });

  it('shows the server connection at the foot of the rail and a banner only while it is lost', async () => {
    await start();
    streams[streams.length - 1].onopen?.();
    await wait();
    expect(container.querySelector('.tv-rail-connection')!.textContent).toBe('Connected to server.lan');
    expect(container.querySelector('.tv-banner')).toBeNull();
    streams[streams.length - 1].onerror?.();
    await wait();
    expect(container.querySelector('.tv-banner')!.textContent).toMatch(/Server connection lost/);
    expect(container.querySelector('.tv-rail-connection')!.textContent).toMatch(/Reconnecting/);
  });

  it('shows a banner while an enabled tracker needs setting up', async () => {
    trackers = [{ id: 'filelist', name: 'FileList', enabled: true, configured: false }];
    await start();
    expect(container.querySelector('.tv-banner')!.textContent).toMatch(/FileList/);
  });

  it('counts active transfers on the Downloads rail item, and shows no count when none are moving', async () => {
    downloads = [download('d1', 'downloading', 0.4), download('d2', 'downloading', 0.2), download('d3', 'completed', 1)];
    await start();
    expect(container.querySelector('[data-menu-hub="downloads"] .tv-rail-count')!.textContent).toBe('2');
    render(null, container);
    downloads = [download('d3', 'completed', 1)];
    await start();
    expect(container.querySelector('[data-menu-hub="downloads"] .tv-rail-count')).toBeNull();
  });

  it('comes back to the same hub and tab after the Player closes', async () => {
    await start();
    await openRoute(container, 'browse');
    container.querySelector<HTMLButtonElement>('[data-focus-key="title-a"]')!.click();
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="detail-playback"]')!.click();
    await wait(150);
    expect(container.querySelector('.player-heading')).not.toBeNull();
    await back();
    await wait(100);
    expect(focusKey()).toBe('detail-playback');
    await back();
    await wait(100);
    expect(currentRoute()).toBe('browse');
    expect(selectedTab()).toBe('Browse');
    expect(focusKey()).toBe('title-a');
  });
});
