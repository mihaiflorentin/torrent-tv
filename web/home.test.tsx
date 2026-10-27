import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogTitle, type HouseholdItem, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// Web Home: the hero resumes what the household is watching, discovery rows load only as the
// page nears them, and Favorites is called My List on screen.

const make = (id: string, over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id, title: id.toUpperCase(), kind: 'movie', year: 2020, trackers: [], categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1, ...over });
const newest = make('new1');
const release = { id: 'rel-9', trackerId: 'f', trackerName: 'F', providerId: '9', categoryId: '4', browseClass: '', name: 'Show.S02E04', category: 'x', sizeBytes: 1, seeders: 1, leechers: 0, freeleech: false };
const resumeItem = { profileId: 'h', sourceId: 's', releaseId: 'rel-9', fileIndex: 3, filePath: 'Show.S02E04.mkv', positionMs: 410_000, durationMs: 1_000_000, watched: false, updatedAt: '2026-10-14T20:00:00Z', favorite: false, titleId: 'show', seasonNumber: 2, episodeNumber: 4, release, catalog: make('show', { kind: 'series', title: 'Severance', overview: 'Work and life.' }) } as unknown as HouseholdItem;
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };

class FakeEventSource { addEventListener() { } close() { } }
const observers: Array<{ fire: () => void; target: Element | null }> = [];
class FakeObserver {
  target: Element | null = null;
  constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(this as unknown as { fire: () => void; target: Element | null }); }
  observe(element: Element) { this.target = element; }
  disconnect() { this.target = null; }
  unobserve() { }
  fire() { this.callback([{ isIntersecting: true }]); }
}
const hosts: HTMLElement[] = [];
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) };
async function mountHome(household: HouseholdState) {
  vi.spyOn(API.prototype, 'state').mockResolvedValue(household);
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
}
// The newest observer still watching a sentinel is the one the next row waits on.
const fireDiscovery = async () => { const live = observers.filter(observer => observer.target?.classList.contains('home-sentinel')); await act(async () => { live[live.length - 1]?.fire() }); await settle() };
const headings = () => Array.from(document.querySelectorAll('.section-heading h2')).map(node => node.textContent);

describe('Home', () => {
  let titles: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    observers.length = 0;
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
    titles = vi.spyOn(API.prototype, 'titles').mockImplementation((async (query: Record<string, unknown> = {}) => {
      if (query.sort === 'rating') return { items: [make('r1', { rating: 8.1, ratingVotes: 50 }), make('r2')], nextCursor: null, total: 2 };
      if (query.kind === 'movie') return { items: [make('m1')], nextCursor: null, total: 1 };
      if (query.kind === 'series') return { items: [make('s1', { kind: 'series' })], nextCursor: null, total: 1 };
      if (query.sort === 'seeders') return { items: [make('h1')], nextCursor: null, total: 1 };
      return { items: [newest], nextCursor: null, total: 1 };
    }) as never);
    vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
    vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  });
  afterEach(() => { while (hosts.length) render(null, hosts.pop()!); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const asked = (field: string, value: string) => titles.mock.calls.some((call: unknown[]) => (call[0] as Record<string, unknown> | undefined)?.[field] === value);

  it('keeps the newest title and View versions when nothing is in progress', async () => {
    await mountHome(empty);
    expect(document.querySelector('.hero h2')?.textContent).toBe('NEW1');
    expect(document.querySelector('.hero button.primary')?.textContent).toBe('View versions');
  });

  it('makes the first Continue watching item the hero, resuming it with one press', async () => {
    const prepare = vi.spyOn(API.prototype, 'prepare').mockRejectedValue(new Error('stop here'));
    await mountHome({ ...empty, continueWatching: [resumeItem] });
    const hero = document.querySelector('.hero') as HTMLElement;
    expect(hero.querySelector('h2')?.textContent).toBe('Severance');
    expect(hero.textContent).toContain('S02E04 · 41% watched');
    const button = hero.querySelector('button.primary') as HTMLButtonElement;
    expect(button.textContent).toBe('Resume S02E04');
    await act(async () => { button.click() });
    await settle();
    expect(prepare).toHaveBeenCalledWith('rel-9', 3, expect.anything());
  });

  it('loads no discovery row until the page nears it, then one row at a time, at most four', async () => {
    await mountHome(empty);
    expect(asked('sort', 'rating') || asked('kind', 'movie') || asked('sort', 'seeders')).toBe(false);
    await fireDiscovery();
    expect(asked('sort', 'rating')).toBe(true);
    expect(asked('kind', 'movie')).toBe(false);
    expect(headings()).toContain('Top rated');
    for (let i = 0; i < 6; i++) await fireDiscovery();
    expect(headings().filter(name => ['Top rated', 'Movies', 'Series', 'Most seeded'].includes(name as string))).toEqual(['Top rated', 'Movies', 'Series', 'Most seeded']);
    expect(document.querySelector('.home-sentinel')).toBeNull();
  });

  it('shows only rated titles in Top rated', async () => {
    await mountHome(empty);
    await fireDiscovery();
    const cards = Array.from(document.querySelectorAll('.media-card')).map(card => card.getAttribute('aria-label'));
    expect(cards).toContain('Open R1');
    expect(cards).not.toContain('Open R2');
  });

  it('drops a row whose fetch fails, without an error', async () => {
    titles.mockImplementation((async (query: Record<string, unknown> = {}) => { if (query.sort === 'rating') throw new Error('boom'); return { items: [newest], nextCursor: null, total: 1 }; }) as never);
    await mountHome(empty);
    await fireDiscovery();
    expect(headings()).not.toContain('Top rated');
    expect(document.querySelector('[role="alert"], .error-banner')).toBeNull();
  });

  it('calls Favorites My List on Home, in the Library tabs and when empty', async () => {
    await mountHome({ ...empty, favorites: [{ ...resumeItem, favorite: true, titleId: 'fav', catalog: make('fav') } as HouseholdItem] });
    expect(headings()).toContain('My List');
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar button')).find(button => button.textContent === 'Library')!.click() });
    await settle();
    const entry = Array.from(document.querySelectorAll<HTMLButtonElement>('.hub-tabs button')).find(button => button.textContent === 'My List');
    expect(entry).toBeDefined();
    expect(document.body.textContent).not.toContain('Favorites');
    await act(async () => { entry!.click() });
    await settle();
    document.body.innerHTML = '';
  });
});
