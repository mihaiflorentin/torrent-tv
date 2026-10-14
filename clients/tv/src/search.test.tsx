// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogFacets, CatalogTitle } from '@torrent-tv/shared';

// TV Search: recent searches under the field, results that follow what you typed from the cache only,
// and the Search button as the one action that asks the trackers.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');
const { chooseStructuredTarget } = await import('./navigation');

const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const alpha = { id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], trackers: [], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1 } as CatalogTitle;
const RECENT = 'filelist.recentSearches';

describe('TV search', () => {
  let container: HTMLDivElement;
  let titles: ReturnType<typeof vi.fn>;
  let searchTitles: ReturnType<typeof vi.fn>;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
  const route = async (name: string) => { container.querySelector<HTMLButtonElement>(`[data-menu-route="${name}"]`)!.click(); await wait(); };
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

  it('shows recent searches and a Clear recent chip under an empty field, newest first', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo', 'alpha']));
    mount();
    await route('search');
    const chips = Array.from(container.querySelectorAll('.tv-recent button')).map(button => button.textContent);
    expect(chips).toEqual(['bravo', 'alpha', 'Clear recent']);
    expect(Array.from(container.querySelectorAll('.tv-recent button')).map(button => button.getAttribute('data-focus-row'))).toEqual(['2', '2', '2']);
  });

  it('draws no chips when nothing was searched, and never on Browse', async () => {
    mount();
    await route('search');
    expect(container.querySelector('.tv-recent')).toBeNull();
    localStorage.setItem(RECENT, JSON.stringify(['bravo']));
    await route('browse');
    expect(container.querySelector('.tv-recent')).toBeNull();
    expect(key('sort-newest')!.getAttribute('data-focus-row')).toBe('2');
  });

  it('moves the sort chips to row 3 on Search only', async () => {
    mount();
    await route('search');
    expect(key('sort-newest')!.getAttribute('data-focus-row')).toBe('3');
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
    expect(container.querySelector('.tv-recent')).toBeNull();
  });

  it('clears the recent list', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo show']));
    mount();
    await route('search');
    key('recent-clear')!.click();
    await wait();
    expect(container.querySelector('.tv-recent')).toBeNull();
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

  it('walks field, chips, sort chips, then the cards with Down, and back with Up', async () => {
    localStorage.setItem(RECENT, JSON.stringify(['bravo show']));
    mount();
    await route('search');
    // Geometry does not exist in happy-dom, so walk the same structured chooser the D-pad uses.
    const walk = (from: HTMLElement, direction: 'up' | 'down') => chooseStructuredTarget(from, Array.from(container.querySelectorAll<HTMLElement>('[data-focus-region="content"]')), direction) as HTMLElement;
    const down: string[] = [];
    let at = key('header-retry') as HTMLElement;
    for (let i = 0; i < 4; i++) { at = walk(at, 'down'); down.push(at.dataset.focusKey as string); }
    expect(down).toEqual(['search-input', 'recent-0', 'sort-newest', 'title-a']);
    const up: string[] = [];
    for (let i = 0; i < 4; i++) { at = walk(at, 'up'); up.push(at.dataset.focusKey as string); }
    expect(up).toEqual(['sort-newest', 'recent-0', 'search-input', 'header-retry']);
  });
});
