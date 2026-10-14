import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, RECENT_SEARCHES_KEY, type CatalogTitle, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// Web Search: recent searches under the field, results that follow typing from the cache only (a
// short pause after the last key), and Search as the one action that asks the trackers.

const lanterns: CatalogTitle = { id: 't1', title: 'Lanterns', kind: 'movie', year: 2021, trackers: [], categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 9, largestSizeBytes: 1 };
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];
const pause = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) });
const settle = async () => { for (let i = 0; i < 5; i++) await pause(0) };
const store = new Map<string, string>();

async function mountOnSearch() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')).find(item => item.textContent?.includes('Search'))!;
  await act(async () => { button.click() });
  await settle();
}
const field = () => document.querySelector<HTMLInputElement>('.catalog-tools input[aria-label="Search"]')!;
const type = (value: string) => act(async () => { field().value = value; field().dispatchEvent(new Event('input', { bubbles: true })) });
const chips = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.recent-searches button')).map(button => button.textContent);

describe('Search', () => {
  let titles: ReturnType<typeof vi.spyOn>;
  let searchTitles: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    store.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(API.prototype, 'state').mockResolvedValue(empty);
    vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
    titles = vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [lanterns], nextCursor: null, total: 1 });
    vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
    vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    searchTitles = vi.spyOn(API.prototype, 'searchTitles').mockResolvedValue({ items: [lanterns], nextCursor: null, total: 1, job: {} as never, trackers: [] });
  });
  afterEach(() => { while (hosts.length) render(null, hosts.pop()!); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('lists recent searches, newest first, only while the field is empty', async () => {
    store.set(RECENT_SEARCHES_KEY, JSON.stringify(['vesper', 'lanterns']));
    await mountOnSearch();
    expect(chips()).toEqual(['vesper', 'lanterns', 'Clear recent']);
    await type('la');
    expect(chips()).toEqual([]);
  });

  it('runs a recent search from the cache, not the trackers', async () => {
    store.set(RECENT_SEARCHES_KEY, JSON.stringify(['vesper']));
    await mountOnSearch();
    titles.mockClear();
    await act(async () => { document.querySelector<HTMLButtonElement>('.recent-searches button')!.click() });
    await settle();
    expect(field().value).toBe('vesper');
    expect(titles).toHaveBeenCalledWith(expect.objectContaining({ search: 'vesper' }));
    expect(searchTitles).not.toHaveBeenCalled();
  });

  it('clears the list', async () => {
    store.set(RECENT_SEARCHES_KEY, JSON.stringify(['vesper']));
    await mountOnSearch();
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>('.recent-searches button')).find(button => button.textContent === 'Clear recent')!;
    await act(async () => { clear.click() });
    expect(chips()).toEqual([]);
    expect(store.has(RECENT_SEARCHES_KEY)).toBe(false);
  });

  it('refreshes results from the cache after typing pauses, never asking the trackers', async () => {
    await mountOnSearch();
    titles.mockClear();
    await type('lan');
    expect(titles).not.toHaveBeenCalled();
    await pause(450);
    expect(titles).toHaveBeenCalledWith(expect.objectContaining({ search: 'lan' }));
    expect(searchTitles).not.toHaveBeenCalled();
  });

  it('does not search the cache for fewer than three characters', async () => {
    await mountOnSearch();
    titles.mockClear();
    await type('la');
    await pause(450);
    expect(titles).not.toHaveBeenCalled();
  });

  it('still asks the trackers on Search after the cache already showed the term, and remembers it', async () => {
    await mountOnSearch();
    await type('lantern');
    await pause(450);
    await act(async () => { document.querySelector('.catalog-tools')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) });
    await settle();
    expect(searchTitles).toHaveBeenCalledWith('lantern');
    expect(JSON.parse(store.get(RECENT_SEARCHES_KEY) || '[]')).toEqual(['lantern']);
  });

  it('keeps working when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
    await mountOnSearch();
    await type('lantern');
    await act(async () => { document.querySelector('.catalog-tools')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) });
    await settle();
    expect(searchTitles).toHaveBeenCalledWith('lantern');
  });
});
