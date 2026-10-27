import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogTitle, type CategoryFamily, type HouseholdItem } from '@torrent-tv/shared';
import { App } from './src';

// The Categories pages show Category families as wide image tiles; opening one lists its titles with a chip
// per raw tracker category. The server owns the mapping and the art; the app draws what it returns.

const family = (key: string, name: string, count: number, newestTitle: string, categories: string[], source: 'catalog' | 'bundled' = 'bundled'): CategoryFamily => ({
  key, name, count, newestTitle, categories,
  art: { url: source === 'catalog' ? `/api/v1/artwork/t-${key}/backdrop` : `/api/v1/catalog/families/${key}/art.svg`, source },
});
const families = [family('movies', 'Movies', 12, 'Dune', ['Movies HD', 'Movies Blu-Ray'], 'catalog'), family('series', 'Series', 1, 'Silo', ['TV-Series HD']), family('uhd', '4K & UHD', 4, 'Avatar', ['Movies 4K'])];
const title = (id: string, name: string): CatalogTitle => ({ id, title: name, kind: 'movie', year: 2021, posterUrl: `/p-${id}.jpg`, backdropUrl: `/b-${id}.jpg`, trackers: [{ id: 'filelist', name: 'FileList' }], categories: ['Movies HD'], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1 });
const libraryItem = {
  profileId: 'p', sourceId: 's1', releaseId: 'r1', fileIndex: 0, filePath: 'd.mkv', positionMs: 0, durationMs: 0, watched: false, updatedAt: '2026-10-01T00:00:00Z', favorite: false, titleId: 'd', catalog: title('d', 'Dune'),
  release: { id: 'r1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: '', name: 'Dune.2021', category: 'Movies HD', sizeBytes: 1, seeders: 3, leechers: 0, freeleech: false },
} as HouseholdItem;

class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function mountApp() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
}
// The Categories tab of a hub: the rail item, then the tab under the heading.
const goTo = async (hub: string, tab: string) => {
  await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')).find(button => button.textContent === hub)!.click() });
  await settle();
  await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.hub-tabs button')).find(button => button.textContent === tab)!.click() });
  await settle();
};
const tiles = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.family-tile'));
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click() }); await settle() };

let titlesSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue({ favorites: [], continueWatching: [], recent: [], watched: [] });
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: ['Movies HD'], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  titlesSpy = vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [title('a', 'Alpha'), title('b', 'Bravo')], nextCursor: null, total: 2 });
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'families').mockResolvedValue({ items: families, nextCursor: null, total: 3 });
  vi.spyOn(API.prototype, 'libraryFamilies').mockResolvedValue({ items: [{ ...families[0], count: 1 }], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'libraryFamilyItems').mockResolvedValue({ items: [libraryItem], nextCursor: null, total: 1 });
});
afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Tracker > Categories', () => {
  it('shows one wide tile per family with name, count and newest title', async () => {
    await mountApp();
    await goTo('Discover', 'Categories');
    expect(tiles().map(tile => tile.querySelector('strong')!.textContent)).toEqual(['Movies', 'Series', '4K & UHD']);
    expect(tiles()[0].textContent).toContain('12 titles');
    expect(tiles()[0].textContent).toContain('Newest: Dune');
    expect(tiles()[1].textContent).toContain('1 title');
    expect(document.querySelector('.catalog-tools')).toBeNull();
  });

  it('lazy-loads every tile image and keeps the tile readable without it', async () => {
    await mountApp();
    await goTo('Discover', 'Categories');
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.family-tile img'));
    expect(images).toHaveLength(3);
    expect(images.every(image => image.getAttribute('loading') === 'lazy' && image.getAttribute('alt') === '')).toBe(true);
    expect(images[0].getAttribute('src')).toBe('/api/v1/artwork/t-movies/backdrop');
    expect(images[1].getAttribute('src')).toBe('/api/v1/catalog/families/series/art.svg');
    expect(tiles()[0].getAttribute('aria-label')).toBe('Movies, 12 titles. Newest: Dune');
  });

  it('opens a family with chips and its titles, narrows by chip and returns to the tiles', async () => {
    await mountApp();
    await goTo('Discover', 'Categories');
    await click(tiles()[0]);
    expect(titlesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ family: 'movies', sort: 'newest' }));
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.family-chips button'));
    expect(chips.map(chip => chip.textContent)).toEqual(['All', 'Movies HD', 'Movies Blu-Ray']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.media-card')).toHaveLength(2);
    await click(chips[2]);
    expect(titlesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ family: 'movies', category: 'Movies Blu-Ray' }));
    expect(document.querySelectorAll<HTMLButtonElement>('.family-chips button')[2].getAttribute('aria-pressed')).toBe('true');
    await click(document.querySelector('.family-back')!);
    expect(tiles()).toHaveLength(3);
  });

  it('sorts and filters by kind inside a family', async () => {
    await mountApp();
    await goTo('Discover', 'Categories');
    await click(tiles()[0]);
    const sort = document.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!;
    await act(async () => { sort.value = 'seeders'; sort.dispatchEvent(new Event('change', { bubbles: true })) });
    await settle();
    expect(titlesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ family: 'movies', sort: 'seeders' }));
    const kind = document.querySelector<HTMLSelectElement>('select[aria-label="Kind"]')!;
    await act(async () => { kind.value = 'series'; kind.dispatchEvent(new Event('change', { bubbles: true })) });
    await settle();
    expect(titlesSpy).toHaveBeenLastCalledWith(expect.objectContaining({ family: 'movies', kind: 'series' }));
  });
});

describe('My Library > Categories', () => {
  it('shows library families and opens one with its managed items', async () => {
    await mountApp();
    await goTo('Library', 'Categories');
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].textContent).toContain('1 item');
    await click(tiles()[0]);
    expect(API.prototype.libraryFamilyItems).toHaveBeenCalledWith('movies', '');
    expect(document.querySelectorAll('.library-card')).toHaveLength(1);
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('.family-chips button'))[1]);
    expect(API.prototype.libraryFamilyItems).toHaveBeenLastCalledWith('movies', 'Movies HD');
  });
});
