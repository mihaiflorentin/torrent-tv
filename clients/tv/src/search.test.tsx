// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';
import type { API, CatalogFacets, CatalogTitle } from '@torrent-tv/shared';

// TV Search (the "Search" board, #58): the field with the result count, one line of chips (Sort, then Recent),
// the results as a grid seven to a line, results that follow what you typed from the cache only, and the
// Search button as the one action that asks the trackers.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');
const { chooseStructuredTarget } = await import('./navigation');

const wait = (ms = 40) => sleep(ms);
const alpha = { id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], trackers: [], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1 } as CatalogTitle;
const RECENT = 'filelist.recentSearches';
const many = (count: number) => Array.from({ length: count }, (_, index) => ({ ...alpha, id: `t${index}`, title: `Title ${index}` }) as CatalogTitle);
const press = (key: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));

describe('TV search', () => {
  let container: HTMLDivElement;
  let titles: ReturnType<typeof vi.fn>;
  let searchTitles: ReturnType<typeof vi.fn>;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
  const route = async (name: string) => { await openRoute(container, name, 0); await wait(); };
  const mount = () => render(
    <Catalog
      api={{ titles, searchTitles, ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}) } as unknown as API}
      status="Online" titles={[alpha]} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={{ favorites: [], continueWatching: [], recent: [], watched: [] }} downloads={[]} jobs={[]} restoreFocus={null} portal={null} updateStatus={null}
      onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }}
      onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }}
    />, container);
  const type = async (value: string) => { const input = key('search-input') as HTMLInputElement; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('blur')); await wait(); };

  beforeEach(() => {
    localStorage.removeItem(RECENT);
    container = document.createElement('div');
    document.body.appendChild(container);
    titles = vi.fn().mockResolvedValue({ items: [alpha], nextCursor: null, total: 1 });
    searchTitles = vi.fn().mockResolvedValue({ items: [alpha], nextCursor: null, total: 1 });
  });
  afterEach(() => { render(null, container); container.remove(); });

  const chipLine = () => Array.from(container.querySelectorAll<HTMLElement>('[data-focus-region="content"][data-focus-row="2"]')).map(element => [element.dataset.focusKey, element.dataset.focusCol, element.textContent]);

  it('puts the sort chips and the recent searches on one line after their labels, newest first, with Clear recent last', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo', 'alpha']));
    mount();
    await route('search');
    expect(chipLine()).toEqual([
      ['sort-newest', '0', 'Newest'], ['sort-seeders', '1', 'Most seeded'], ['sort-rating', '2', 'Rating'], ['sort-title', '3', 'A–Z'],
      ['recent-0', '4', 'bravo'], ['recent-1', '5', 'alpha'], ['recent-clear', '6', 'Clear recent'],
    ]);
    const labels = Array.from(container.querySelectorAll('.tv-chip-label')).map(label => label.textContent);
    expect(labels).toEqual(['Sort', 'Recent']);
  });

  it('draws no recent chips when nothing was searched, and never on Browse', async () => {
    mount();
    await route('search');
    expect(container.querySelector('[data-focus-key^="recent-"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('.tv-chip-label')).map(label => label.textContent)).toEqual(['Sort']);
    localStorage.setItem(RECENT, JSON.stringify(['bravo']));
    await route('browse');
    expect(container.querySelector('[data-focus-key^="recent-"]')).toBeNull();
    expect(key('sort-newest')!.getAttribute('data-focus-row')).toBe('2');
  });

  it('keeps the other recent searches beside a query, at most two', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['delta', 'charlie', 'bravo', 'alpha one', 'echo']));
    mount();
    await route('search');
    key('recent-1')!.click();
    await wait();
    expect((key('search-input') as HTMLInputElement).value).toBe('charlie');
    const recent = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-key^="recent-"]')).map(element => element.textContent);
    // The term searched again moves to the front of the stored list, so the chips show the next two.
    expect(recent).toEqual(['delta', 'bravo', 'Clear recent']);
  });

  it('shows how many titles a query found inside the field, and nothing without a query', async () => {
    titles.mockResolvedValue({ items: many(3), nextCursor: 'next', total: 24 });
    mount();
    await route('search');
    expect(container.querySelector('.tv-search-count')?.textContent || '').toBe('');
    await type('alpha');
    expect(container.querySelector('.tv-search-count')!.textContent).toBe('24 results');
    searchTitles.mockResolvedValue({ items: [alpha], nextCursor: null, total: 1 });
    key('search-submit')!.click();
    await wait();
    expect(container.querySelector('.tv-search-count')!.textContent).toBe('1 result');
  });

  it('draws the results as a grid seven to a line, numbered as drawn', async () => {
    titles.mockResolvedValue({ items: many(9), nextCursor: null, total: 9 });
    mount();
    await route('search');
    await type('alpha');
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.tv-poster-grid .poster-card'));
    expect(cards.map(card => `${card.dataset.focusRow}:${card.dataset.focusCol}`)).toEqual(['10:0', '10:1', '10:2', '10:3', '10:4', '10:5', '10:6', '11:0', '11:1']);
    expect(cards.every(card => card.dataset.landing === 'card')).toBe(true);
  });

  it('draws Browse as the same grid', async () => {
    titles.mockResolvedValue({ items: many(8), nextCursor: null, total: 8 });
    mount();
    await route('browse');
    key('sort-seeders')!.click();
    await wait();
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.tv-poster-grid .poster-card'));
    expect(cards).toHaveLength(8);
    expect(cards[7].dataset.focusRow).toBe('11');
    expect(cards[7].dataset.focusCol).toBe('0');
  });

  it('pages in more results as the cursor moves down the grid, and keeps the cursor where it was', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    titles.mockImplementation(async (query: { cursor?: string }) => query.cursor ? { items: many(21).slice(14), nextCursor: null, total: 21 } : { items: many(14), nextCursor: 'page-2', total: 21 });
    mount();
    await route('browse');
    key('sort-seeders')!.click();
    await wait();
    key('title-t3')!.focus();
    press('ArrowDown', 40);
    await wait();
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('title-t10');
    expect(titles).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page-2' }));
    expect(container.querySelectorAll('.tv-poster-grid .poster-card')).toHaveLength(21);
    press('ArrowDown', 40);
    await wait();
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('title-t17');
    vi.restoreAllMocks();
  });

  it('runs a recent search from the cache, not the trackers', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo show']));
    mount();
    await route('search');
    titles.mockClear();
    key('recent-0')!.click();
    await wait();
    expect((key('search-input') as HTMLInputElement).value).toBe('bravo show');
    expect(titles).toHaveBeenCalledWith(expect.objectContaining({ search: 'bravo show' }));
    expect(searchTitles).not.toHaveBeenCalled();
    // The term now in the field leaves the chips; Clear recent stays.
    expect(key('recent-0')).toBeNull();
    expect(key('recent-clear')!.textContent).toBe('Clear recent');
  });

  it('clears the recent list', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo show']));
    mount();
    await route('search');
    key('recent-clear')!.click();
    await wait();
    expect(container.querySelector('[data-focus-key^="recent-"]')).toBeNull();
    expect(localStorage.getItem(RECENT)).toBeNull();
  });

  it('refreshes results from the cache once typing ends, with three or more characters, and never asks the trackers', async () => {
    mount();
    await route('search');
    titles.mockClear();
    await type('al');
    expect(titles).not.toHaveBeenCalled();
    await type('alpha');
    expect(titles).toHaveBeenCalledWith(expect.objectContaining({ search: 'alpha' }));
    expect(searchTitles).not.toHaveBeenCalled();
  });

  it('asks the trackers and remembers the term only when Search is pressed', async () => {
    mount();
    await route('search');
    await type('alpha');
    expect(localStorage.getItem(RECENT)).toBeNull();
    key('search-submit')!.click();
    await wait();
    expect(searchTitles).toHaveBeenCalledWith('alpha');
    expect(JSON.parse(localStorage.getItem(RECENT) || '[]')).toEqual(['alpha']);
  });

  it('keeps working when storage is blocked', async () => {
    const spy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    mount();
    await route('search');
    await type('alpha');
    key('search-submit')!.click();
    await wait();
    expect(searchTitles).toHaveBeenCalledWith('alpha');
    spy.mockRestore();
  });

  it('walks field, the chip line, then the cards with Down, and back with Up', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo show']));
    mount();
    await route('search');
    // Geometry does not exist in happy-dom, so walk the same structured chooser the D-pad uses.
    const walk = (from: HTMLElement, direction: 'up' | 'down') => chooseStructuredTarget(from, Array.from(container.querySelectorAll<HTMLElement>('[data-focus-region="content"]')), direction) as HTMLElement;
    const down: string[] = [];
    let at = key('search-input') as HTMLElement;
    for (let i = 0; i < 2; i++) { at = walk(at, 'down'); down.push(at.dataset.focusKey as string); }
    expect(down).toEqual(['sort-newest', 'title-a']);
    const up: string[] = [];
    for (let i = 0; i < 2; i++) { at = walk(at, 'up'); up.push(at.dataset.focusKey as string); }
    expect(up).toEqual(['sort-newest', 'search-input']);
    // The field is the top of the screen: there is no header row above it any more.
    expect(walk(at, 'up')).toBeNull();
  });
});
