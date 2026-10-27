// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';
import type { API, CatalogFacets, CatalogTitle, HouseholdItem, HouseholdState } from '@torrent-tv/shared';

// TV Home: the hero resumes what the household is watching, discovery rows load only as focus
// approaches them, and Favorites is called My List on screen.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');
// main.tsx boots an App (the Setup screen) into #app; its key handler would move focus too, so unmount it.
render(null, appRoot);

const wait = (ms = 40) => sleep(ms);
const make = (id: string, over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id, title: id.toUpperCase(), kind: 'movie', year: 2020, trackers: [], categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1, ...over });
const newest = make('new1');
const release = { id: 'rel-9', trackerId: 'f', trackerName: 'F', providerId: '9', categoryId: '4', browseClass: '', name: 'Show.S02E04', category: 'x', sizeBytes: 1, seeders: 1, leechers: 0, freeleech: false };
const resumeItem = { profileId: 'h', sourceId: 's', releaseId: 'rel-9', fileIndex: 3, filePath: 'Show.S02E04.mkv', positionMs: 410_000, durationMs: 1_000_000, watched: false, updatedAt: '2026-10-14T20:00:00Z', favorite: false, titleId: 'show', seasonNumber: 2, episodeNumber: 4, release, catalog: make('show', { kind: 'series', title: 'Severance', overview: 'Work and life.' }) } as unknown as HouseholdItem;
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };

describe('TV home', () => {
  let container: HTMLDivElement;
  let titles: ReturnType<typeof vi.fn>;
  let onPlay: ReturnType<typeof vi.fn>;
  let onFavorite: ReturnType<typeof vi.fn>;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
  const heading = (name: string) => Array.from(container.querySelectorAll('.row-heading h2')).find(node => node.textContent === name);
  const mount = (household: HouseholdState = empty) => render(
    <Catalog
      api={{ titles, ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), titleInfo: async () => ({ cast: [], genres: [] }) } as unknown as API}
      status="Online" titles={[newest]} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={household} downloads={[]} jobs={[]} restoreFocus={null} portal={null} updateStatus={null}
      onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={onPlay as unknown as () => void} onPlayDownload={() => { }}
      onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={onFavorite as unknown as () => void}
    />, container);
  const asked = (field: string, value: string) => titles.mock.calls.some(call => (call[0] as Record<string, unknown>)[field] === value);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onPlay = vi.fn();
    onFavorite = vi.fn();
    titles = vi.fn().mockImplementation(async (query: Record<string, unknown>) => {
      if (query.sort === 'rating') return { items: [make('r1', { rating: 8.1, ratingVotes: 50 }), make('r2')], nextCursor: null, total: 2 };
      if (query.kind === 'movie') return { items: [make('m1'), make('m2')], nextCursor: null, total: 2 };
      if (query.kind === 'series') return { items: [make('s1', { kind: 'series' })], nextCursor: null, total: 1 };
      if (query.sort === 'seeders') return { items: [make('h1'), make('new1')], nextCursor: 'more', total: 9 };
      return { items: [newest], nextCursor: 'next', total: 1 };
    });
  });
  afterEach(() => { render(null, container); container.remove(); vi.restoreAllMocks(); });

  it('keeps the newest title and View versions when nothing is in progress', async () => {
    mount();
    await wait();
    expect(container.querySelector('.tv-hero h2')?.textContent).toBe('NEW1');
    expect(key('hero-new1')?.textContent).toBe('View versions');
  });

  it('makes the first Continue watching item the hero, with a Resume that says what is left', async () => {
    mount({ ...empty, continueWatching: [resumeItem] });
    await wait();
    const hero = container.querySelector('.tv-hero') as HTMLElement;
    expect(hero.querySelector('h2')?.textContent).toBe('Severance');
    expect(container.querySelector('.tv-hero-kind')?.textContent).toBe('Continue watching');
    expect(hero.querySelector('.tv-hero-overview')?.textContent).toBe('Work and life.');
    const button = key('hero-show') as HTMLElement;
    expect(button.textContent).toBe('Resume S02E04 · 10 min left');
    button.click();
    expect(onPlay).toHaveBeenCalledWith(release, 3, 410_000);
  });

  it('puts Info and My List beside the primary as icon buttons in the next columns', async () => {
    mount({ ...empty, continueWatching: [resumeItem] });
    await wait();
    const cols = Array.from(container.querySelectorAll<HTMLElement>('.tv-hero [data-focus-row="1"]')).map(node => [node.dataset.focusCol, node.dataset.focusKey, node.getAttribute('aria-label') || node.textContent]);
    expect(cols).toEqual([['0', 'hero-show', 'Resume S02E04 · 10 min left'], ['1', 'hero-info-show', 'Info'], ['2', 'hero-favorite-show', 'Add to My List']]);
    key('hero-favorite-show')!.click();
    expect(onFavorite).toHaveBeenCalledWith(resumeItem.catalog, true);
    key('hero-info-show')!.click();
    await wait();
    expect(container.querySelector('.info-panel')).not.toBeNull();
  });

  it('shows the hero title as already on My List when it is', async () => {
    mount({ ...empty, continueWatching: [resumeItem], favorites: [{ ...resumeItem, favorite: true } as HouseholdItem] });
    await wait();
    const list = key('hero-favorite-show')!;
    expect(list.getAttribute('aria-pressed')).toBe('true');
    expect(list.getAttribute('aria-label')).toBe('In My List');
    list.click();
    expect(onFavorite).toHaveBeenCalledWith(resumeItem.catalog, false);
  });

  it('walks the hero actions with Left and Right, stops at My List, and goes Down into Continue watching', async () => {
    // happy-dom lays nothing out; give every control a size so the navigation counts it as visible.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    mount({ ...empty, continueWatching: [resumeItem] });
    await wait();
    const press = (name: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode, bubbles: true, cancelable: true }));
    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
    key('hero-show')!.focus();
    press('ArrowRight', 39); await wait(10);
    expect(focused()).toBe('hero-info-show');
    press('ArrowRight', 39); await wait(10);
    expect(focused()).toBe('hero-favorite-show');
    press('ArrowRight', 39); await wait(10);
    expect(focused()).toBe('hero-favorite-show');
    press('ArrowDown', 40); await wait(10);
    expect(focused()).toMatch(/^library-show-2-4-/);
  });

  it('splits a long title at its colon into a title and a subtitle line', async () => {
    titles.mockResolvedValue({ items: [make('qe', { title: 'Quiet Echo: The Ember Archive' })], nextCursor: null, total: 1 });
    mount();
    await wait();
    const h2 = container.querySelector('.tv-hero h2')!;
    expect(h2.getAttribute('aria-label')).toBe('Quiet Echo: The Ember Archive');
    expect(h2.querySelector('.tv-hero-title')?.textContent).toBe('Quiet Echo');
    expect(h2.querySelector('.tv-hero-subtitle')?.textContent).toBe('The Ember Archive');
  });

  it('draws Continue watching as landscape cards with the episode code, the time left and a progress bar', async () => {
    mount({ ...empty, continueWatching: [resumeItem] });
    await wait();
    const card = container.querySelector<HTMLElement>('[data-focus-key^="library-show-"]')!;
    expect(card.classList.contains('landscape-card')).toBe(true);
    expect(card.querySelector('.poster-copy')?.textContent).toBe('SeveranceS02E04 · 10 min left');
    expect(card.querySelector('.tv-card-progress')?.getAttribute('aria-label')).toBe('41% watched');
  });

  it('loads no discovery row at mount, and only the next one as focus reaches the previous row', async () => {
    mount();
    await wait();
    expect(asked('kind', 'movie') || asked('sort', 'rating') || asked('sort', 'seeders')).toBe(false);
    expect(heading('Top rated')).toBeUndefined();
    key('title-new1')!.focus();
    await wait();
    expect(asked('sort', 'rating')).toBe(true);
    expect(asked('kind', 'movie')).toBe(false);
    expect(heading('Top rated')).toBeDefined();
    key('rail-rated-r1')!.focus();
    await wait();
    expect(asked('kind', 'movie')).toBe(true);
    expect(asked('kind', 'series')).toBe(false);
  });

  it('numbers rows 10, 11 and up in render order, and caps the extra rows at four of ten titles', async () => {
    mount({ ...empty, favorites: [{ ...resumeItem, favorite: true, titleId: 'fav', catalog: make('fav') } as HouseholdItem] });
    await wait();
    key('title-new1')!.focus(); await wait();
    key('rail-rated-r1')!.focus(); await wait();
    key('rail-movies-m1')!.focus(); await wait();
    key('rail-series-s1')!.focus(); await wait();
    const names = Array.from(container.querySelectorAll('.row-heading h2')).map(node => node.textContent);
    expect(names).toEqual(['Recently added', 'Top rated', 'Movies', 'Series', 'Most seeded', 'My List']);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.tv-content [data-focus-row]')).map(node => Number(node.dataset.focusRow));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(Array.from(new Set(rows))).toEqual([1, 10, 11, 12, 13, 14, 20]);
    expect(container.querySelectorAll('.tv-rows .poster-card').length).toBeLessThanOrEqual(5 * 10);
  });

  it('shows Top rated only with rated titles and never repeats a focus key', async () => {
    mount();
    await wait();
    key('title-new1')!.focus(); await wait();
    expect(container.querySelectorAll('[data-focus-key="rail-rated-r2"]').length).toBe(0);
    key('rail-rated-r1')!.focus(); await wait();
    key('rail-movies-m1')!.focus(); await wait();
    key('rail-series-s1')!.focus(); await wait();
    const keys = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-key]')).map(node => node.dataset.focusKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('drops a row whose fetch fails without a message', async () => {
    titles.mockImplementation(async (query: Record<string, unknown>) => { if (query.sort === 'rating') throw new Error('boom'); return { items: [newest], nextCursor: null, total: 1 }; });
    mount();
    await wait();
    key('title-new1')!.focus(); await wait();
    expect(heading('Top rated')).toBeUndefined();
    expect(container.querySelector('.tv-notice')).toBeNull();
  });

  it('does not page the Recently added rail when focus nears the end of a discovery row', async () => {
    mount();
    await wait();
    key('title-new1')!.focus(); await wait();
    key('rail-rated-r1')!.focus(); await wait();
    key('rail-movies-m1')!.focus(); await wait();
    key('rail-series-s1')!.focus(); await wait();
    titles.mockClear();
    const card = key('rail-seeded-h1')!;
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true }));
    await wait();
    expect(titles.mock.calls.some(call => (call[0] as Record<string, unknown>).cursor)).toBe(false);
  });

  it('calls Favorites My List on Home, in the menu and when it is empty', async () => {
    mount({ ...empty, favorites: [{ ...resumeItem, favorite: true, titleId: 'fav', catalog: make('fav') } as HouseholdItem] });
    await wait();
    expect(heading('My List')).toBeDefined();
    expect(container.querySelector('[data-hub-tab="favorites"]')).toBeNull();
    await openRoute(container, 'library', 0);
    expect(container.querySelector('[data-hub-tab="favorites"]')?.textContent).toBe('My List');
    expect(container.textContent).not.toContain('Favorites');
    render(null, container);
    mount();
    await wait();
    await openRoute(container, 'favorites', 0);
    await wait();
    expect(container.querySelector('.tv-muted')?.textContent).toBe('Your list is empty. Open a title and choose Add to My List.');
  });
});
