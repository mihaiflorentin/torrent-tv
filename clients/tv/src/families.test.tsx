// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';

// The Categories pages show Category families as wide image tiles. Opening one lists its titles with
// a chip per raw tracker category; Back returns to the tile that opened it.
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

const wait = (ms = 60) => sleep(ms);
function respond(body: unknown) { return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }; }
// Back is a short press: the catalog treats a held Back as exit, so the action runs on key up.
const back = () => { for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true })) };

const family = (key: string, name: string, count: number, newestTitle: string, categories: string[], source: 'catalog' | 'bundled' = 'bundled') => ({ key, name, count, newestTitle, categories, art: { url: source === 'catalog' ? `/api/v1/artwork/t-${key}/backdrop` : `/api/v1/catalog/families/${key}/art.svg`, source } });
const families = [
  family('movies', 'Movies', 12, 'Dune', ['Movies HD', 'Movies Blu-Ray'], 'catalog'),
  family('series', 'Series', 1, 'Silo', ['TV-Series HD']),
  family('uhd', '4K & UHD', 4, 'Avatar', ['Movies 4K']),
  family('anime', 'Anime', 2, 'Frieren', ['Anime']),
];
const title = (id: string, name: string) => ({ id, title: name, kind: 'movie', year: 2021, resolutions: ['1080p'], categories: ['Movies HD'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1e9, trackers: [{ id: 'filelist', name: 'FileList' }], posterUrl: `/api/v1/artwork/${id}/poster` });
const libraryItem = { release: { id: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: 'Dune.2021.1080p', category: 'Movies HD', sizeBytes: 1e9, seeders: 3, leechers: 0, freeleech: false }, catalog: title('d', 'Dune'), favorite: false, titleId: 'd', positionMs: 0, durationMs: 0, watched: false, sourceId: 's1', fileIndex: 0, filePath: 'd.mkv', updatedAt: '2026-10-01T00:00:00Z', releaseId: 'rel-1', profileId: 'p' };

describe('Categories pages show Category families', () => {
  let container: HTMLDivElement;
  let requests: string[] = [];
  beforeEach(() => {
    // happy-dom lays nothing out; landing and D-pad targeting only consider elements with a size.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    requests = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/catalog/families')) return respond({ items: families, nextCursor: null, total: families.length });
      if (url.includes('/library/families?family=')) return respond({ items: [libraryItem], nextCursor: null, total: 1 });
      if (url.includes('/library/families')) return respond({ items: [{ ...families[0], count: 1 }], nextCursor: null, total: 1 });
      if (url.includes('/catalog/titles/a')) return respond({ title: title('a', 'Alpha'), seasons: [], sources: [] });
      if (url.includes('/catalog/titles')) return respond({ items: [title('a', 'Alpha'), title('b', 'Bravo')], nextCursor: null, total: 2 });
      if (url.includes('/catalog/facets')) return respond({ categories: ['Movies HD', 'FLAC', 'CAM/TS'], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/downloads') || url.includes('/jobs')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: [] });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [], continueWatching: [], recent: [], watched: [] });
      if (url.includes('/info')) return respond({ name: 'torrent-tv', version: '1', instanceName: 'test' });
      return respond({ items: [], nextCursor: null, total: 0 });
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

  const openScreen = async (menuKey: string) => {
    render(h(App, null), container);
    await wait(120);
    await openRoute(container, menuKey, 0);
    await wait();
  };
  const tile = (key: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="family-${key}"]`)!;

  it('draws one wide tile per family with the name, count and newest title', async () => {
    await openScreen('categories');
    const tiles = Array.from(container.querySelectorAll<HTMLButtonElement>('.family-tile'));
    expect(tiles.map(t => t.querySelector('strong')!.textContent)).toEqual(['Movies', 'Series', '4K & UHD', 'Anime']);
    expect(tiles[0].textContent).toContain('12 titles');
    expect(tiles[0].textContent).toContain('Newest: Dune');
    expect(tiles[1].textContent).toContain('1 title');
    expect(requests.some(url => url.includes('/catalog/families'))).toBe(true);
  });

  it('lays the tiles out for the D-pad and tags them as landing cards', async () => {
    await openScreen('categories');
    const tiles = Array.from(container.querySelectorAll<HTMLButtonElement>('.family-tile'));
    expect(tiles.every(t => t.classList.contains('poster-card') && t.dataset.focusRegion === 'content')).toBe(true);
    expect(tiles.map(t => [t.dataset.focusRow, t.dataset.focusCol])).toEqual([['1', '0'], ['1', '1'], ['1', '2'], ['2', '0']]);
    expect(tiles.map(t => t.dataset.landing)).toEqual(['card', 'card', 'card', 'card']);
  });

  it('loads tile art through the server and keeps the tile when a family has only bundled art', async () => {
    await openScreen('categories');
    const images = Array.from(container.querySelectorAll<HTMLImageElement>('.family-tile img'));
    expect(images.length).toBeGreaterThan(0);
    expect(images[0].getAttribute('src')).toBe('http://server.lan:8097/api/v1/artwork/t-movies/backdrop');
    expect(images[1].getAttribute('src')).toBe('http://server.lan:8097/api/v1/catalog/families/series/art.svg');
    expect(container.querySelector('.family-tile img')!.getAttribute('alt')).toBe('');
  });

  it('opens a family with its titles and one chip per raw category, and Back returns to the tile', async () => {
    await openScreen('categories');
    tile('series').click();
    await wait();
    expect(requests.some(url => url.includes('/catalog/titles') && url.includes('family=series'))).toBe(true);
    expect(container.querySelector('.family-tile')).toBeNull();
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-focus-key^="family-chip-"]')).map(c => c.textContent);
    expect(chips).toEqual(['All', 'TV-Series HD']);
    expect(container.querySelectorAll('.poster-card').length).toBe(2);
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('family-title-a');
    back();
    await wait();
    expect(container.querySelectorAll('.family-tile').length).toBe(4);
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('family-series');
  });

  it('narrows to one raw category with a chip', async () => {
    await openScreen('categories');
    tile('movies').click();
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="family-chip-Movies Blu-Ray"]')!.click();
    await wait();
    expect(requests.some(url => url.includes('family=movies') && url.includes('category=Movies+Blu-Ray'))).toBe(true);
    expect(container.querySelector('[data-focus-key="family-chip-Movies Blu-Ray"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the library families on My Library > Categories and opens one', async () => {
    await openScreen('library-categories');
    expect(container.querySelectorAll('.family-tile').length).toBe(1);
    expect(container.querySelector('.family-tile')!.textContent).toContain('1 item');
    tile('movies').click();
    await wait();
    expect(requests.some(url => url.includes('/library/families?family=movies'))).toBe(true);
    expect(container.querySelector('.library-poster-card')).not.toBeNull();
    back();
    await wait();
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('family-movies');
  });

  it('keeps the family open across a title page and marks its first card as the landing card', async () => {
    await openScreen('categories');
    tile('movies').click();
    await wait();
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.poster-card'));
    expect(cards.map(c => c.dataset.landing)).toEqual(['card', 'card']);
    expect(Number(cards[0].dataset.focusRow)).toBeGreaterThan(3);
    cards[0].focus();
    cards[0].click();
    await wait();
    expect(container.querySelector('.detail-copy h1')!.textContent).toBe('Alpha');
    back();
    await wait();
    expect(container.querySelector('.family-tile')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('family-title-a');
  });
});
