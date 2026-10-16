// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogFacets, CatalogTitle, HouseholdState } from '@torrent-tv/shared';
import { ART_COLUMN_REACH, inReach, railNear, railWindows, resetFocusPoint, setFocusPoint } from './lazy-art';

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');

describe('rail windows', () => {
  it('loads a rail while focus is on the rail before it, on it, or after it', () => {
    const windows = railWindows([3, 10, 11, 12, 13]);
    const near = (index: number, row: number) => railNear(windows[index], row);
    // Focus above every rail (hero, header) counts as the first rail: rails 0 and 1 load.
    expect([0, 1, 2, 3, 4].map(index => near(index, 1))).toEqual([true, true, false, false, false]);
    expect([0, 1, 2, 3, 4].map(index => near(index, 10))).toEqual([true, true, true, false, false]);
    expect([0, 1, 2, 3, 4].map(index => near(index, 12))).toEqual([false, false, true, true, true]);
    expect([0, 1, 2, 3, 4].map(index => near(index, 13))).toEqual([false, false, false, true, true]);
  });

  it('has an open window for a lone rail', () => {
    const [only] = railWindows([10]);
    expect(railNear(only, 1)).toBe(true);
    expect(railNear(only, 99)).toBe(true);
  });

  it('tests a column against its reach range', () => {
    expect(inReach(null, 0)).toBe(false);
    expect(inReach([2, 5], 1)).toBe(false);
    expect(inReach([2, 5], 5)).toBe(true);
  });
});

describe('lazy poster artwork in the catalog', () => {
  let container: HTMLDivElement;
  const make = (id: string): CatalogTitle => ({ id, title: id.toUpperCase(), kind: 'movie', year: 2020, trackers: [], categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1, posterUrl: `/art/${id}.jpg` });
  const many = Array.from({ length: 30 }, (_, index) => make(`t${index}`));
  const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
  const images = () => Array.from(container.querySelectorAll('.poster-card img')).map(node => node.getAttribute('src'));
  const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
  const mount = () => render(
    <Catalog
      api={{ titles: vi.fn(async () => ({ items: many, nextCursor: null, total: 30 })), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}) } as unknown as API}
      status="Online" titles={many.slice(0, 12)} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={empty} downloads={[]} jobs={[]} restoreFocus={null} portal={null} updateStatus={null}
      onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }}
      onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }}
    />, container);

  beforeEach(() => { resetFocusPoint(); container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); resetFocusPoint(); });

  it('requests only the first cards of a rail and keeps a placeholder for the rest', async () => {
    mount();
    await wait();
    expect(container.querySelectorAll('.poster-card').length).toBeGreaterThan(ART_COLUMN_REACH + 1);
    expect(images()).toEqual(Array.from({ length: ART_COLUMN_REACH + 1 }, (_, index) => `/art/t${index}.jpg`));
    expect(container.querySelectorAll('.poster-card .poster-pending').length).toBeGreaterThan(0);
  });

  it('loads the cards around the column focus reaches, and never drops the ones already loaded', async () => {
    mount();
    await wait();
    const card = (id: string) => container.querySelector<HTMLElement>(`[data-focus-key="title-${id}"]`)!;
    card('t15').focus();
    await wait();
    const loaded = images();
    expect(loaded).toContain('/art/t0.jpg');
    expect(loaded).toContain('/art/t15.jpg');
    expect(loaded).toContain(`/art/t${15 + ART_COLUMN_REACH}.jpg`);
    expect(loaded).not.toContain(`/art/t${15 + ART_COLUMN_REACH + 1}.jpg`);
    card('t4').focus();
    await wait();
    expect(images()).toEqual(loaded);
  });

  it('keeps every card focusable and in order while artwork is pending', async () => {
    mount();
    await wait();
    const cols = Array.from(container.querySelectorAll<HTMLElement>('.poster-card')).map(node => node.dataset.focusCol);
    expect(cols).toEqual(cols.map((_, index) => String(index)));
  });
});
