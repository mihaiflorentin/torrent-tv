// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogFacets, CatalogTitle, HouseholdState } from '@torrent-tv/shared';
import { ART_COLUMN_KEEP, ART_SETTLE_MS, ART_COLUMN_REACH, ART_LIST_KEEP, ART_LIST_REACH, ART_ROW_KEEP, ART_ROW_REACH, inReach, inRowReach, railNear, railWindows, resetFocusPoint, setFocusPoint, slideListReach, slideReach, useArtReach, useRowReach, type ArtReach, type RowReach } from './lazy-art';

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');

describe('list reach (Info panel lists)', () => {
  it('opens on the first rows and slides down the list with focus', () => {
    const top = slideListReach(null, 0);
    expect(top).toEqual([0, ART_LIST_REACH]);
    expect(inReach(top, ART_LIST_REACH)).toBe(true);
    expect(inReach(top, ART_LIST_REACH + 1)).toBe(false);
    expect(slideListReach(top, 40)).toEqual([40 - ART_LIST_REACH, 40 + ART_LIST_REACH]);
  });

  it('keeps earlier rows until they are further than the keep distance, then drops them', () => {
    const down = slideListReach(slideListReach(null, 0), 40);
    expect(down).toEqual([40 - ART_LIST_REACH, 40 + ART_LIST_REACH]);
    // Walking on keeps the top of the window while it is within the keep distance of the focused row.
    expect(slideListReach(down, 40 + ART_LIST_KEEP - ART_LIST_REACH)![0]).toBe(40 - ART_LIST_REACH);
    expect(slideListReach(down, 40 + ART_LIST_KEEP - ART_LIST_REACH + 1)![0]).toBe(40 + ART_LIST_KEEP - ART_LIST_REACH + 1 - ART_LIST_REACH);
    // Walking back keeps the bottom the same way.
    expect(slideListReach(down, 40 - ART_LIST_KEEP + ART_LIST_REACH)![1]).toBe(40 + ART_LIST_REACH);
    expect(slideListReach(down, 40 - ART_LIST_KEEP + ART_LIST_REACH - 1)![1]).toBe(40 - ART_LIST_KEEP + ART_LIST_REACH - 1 + ART_LIST_REACH);
  });

  it('returns the same range for a move that changes nothing, so a state setter can bail out', () => {
    const range = slideListReach(null, 20);
    expect(slideListReach(range, 20)).toBe(range);
    expect(slideListReach(slideListReach(range, 21), 20)).toEqual(slideListReach(range, 21));
  });
});

describe('column reach', () => {
  it('slides with the focused column and drops what it left far behind', () => {
    let reach: ArtReach = slideReach(null, 0, ART_COLUMN_REACH, ART_COLUMN_KEEP);
    expect(reach).toEqual([0, ART_COLUMN_REACH]);
    reach = slideReach(reach, 30, ART_COLUMN_REACH, ART_COLUMN_KEEP);
    expect(reach).toEqual([30 - ART_COLUMN_REACH, 30 + ART_COLUMN_REACH]);
    expect(inReach(reach, 0)).toBe(false);
    expect(inReach(reach, 30 + ART_COLUMN_REACH + 1)).toBe(false);
  });

  it('does not churn on one-column moves: nothing already loaded is dropped', () => {
    let reach: ArtReach = slideReach(null, 20, ART_COLUMN_REACH, ART_COLUMN_KEEP);
    const first = reach;
    for (const center of [21, 20, 21, 22, 21, 20, 19, 20]) {
      const next = slideReach(reach, center, ART_COLUMN_REACH, ART_COLUMN_KEEP);
      expect(next![0]).toBeLessThanOrEqual(reach![0]);
      expect(next![1]).toBeGreaterThanOrEqual(reach![1]);
      reach = next;
    }
    expect(reach![0]).toBeLessThanOrEqual(first![0]);
    expect(slideReach(reach, 20, ART_COLUMN_REACH, ART_COLUMN_KEEP)).toBe(reach);
  });

  it('never drops a column the screen shows, however focus walks, and stays bounded', () => {
    const onScreen = 6;
    let reach: ArtReach = slideReach(null, 0, ART_COLUMN_REACH, ART_COLUMN_KEEP);
    const walk = [...Array.from({ length: 60 }, (_, index) => index), ...Array.from({ length: 20 }, (_, index) => 59 - index * 3), 5, 0, 70, 3];
    for (const center of walk) {
      reach = slideReach(reach, center, ART_COLUMN_REACH, ART_COLUMN_KEEP);
      for (let col = Math.max(0, center - onScreen); col <= center + onScreen; col++) expect(inReach(reach, col), `col ${col} at ${center}`).toBe(true);
      expect(reach![1] - reach![0]).toBeLessThanOrEqual(2 * ART_COLUMN_KEEP);
    }
  });
});

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

describe('hooks', () => {
  let host: HTMLDivElement;
  beforeEach(() => { resetFocusPoint(); host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { render(null, host); host.remove(); resetFocusPoint(); });
  const settle = () => sleep(ART_SETTLE_MS + 20);

  it('waits for focus to rest before a mounted rail follows it, so a held key mounts no artwork per press', async () => {
    const [span] = railWindows([10]);
    let renders = 0;
    let reach: ArtReach = null;
    const Probe = () => { renders++; reach = useArtReach(span); return null; };
    render(<Probe />, host);
    await settle();
    setFocusPoint(10, 0);
    await settle();
    const base = renders;
    for (let col = 1; col <= 12; col++) { setFocusPoint(10, col); await sleep(ART_SETTLE_MS / 3); }
    expect(renders).toBe(base);
    await settle();
    expect(renders).toBe(base + 1);
    expect(reach).toEqual([Math.max(0, 12 - ART_COLUMN_KEEP), 12 + ART_COLUMN_REACH]);
  });

  it('drops a rail to null once focus is more than one rail away and reloads it when focus comes back', async () => {
    const windows = railWindows([10, 11, 12, 13, 14]);
    const seen: Array<ArtReach[]> = [];
    const Probe = () => {
      const reaches = windows.map(span => useArtReach(span));
      seen.push(reaches);
      return null;
    };
    render(<Probe />, host);
    const latest = () => seen[seen.length - 1];
    await settle();
    expect(latest().map(reach => reach !== null)).toEqual([true, true, false, false, false]);
    setFocusPoint(12, 3);
    await settle();
    expect(latest().map(reach => reach !== null)).toEqual([false, true, true, true, false]);
    expect(latest()[2]).toEqual([0, 3 + ART_COLUMN_REACH]);
    setFocusPoint(10, 3);
    await settle();
    expect(latest().map(reach => reach !== null)).toEqual([true, true, false, false, false]);
    setFocusPoint(14, 3);
    await settle();
    expect(latest().map(reach => reach !== null)).toEqual([false, false, false, true, true]);
  });

  it('re-renders only when a range changes: a one-column move inside the window does not', async () => {
    const [span] = railWindows([10]);
    let renders = 0;
    const Probe = () => { renders++; useArtReach(span); return null; };
    render(<Probe />, host);
    await settle();
    setFocusPoint(10, 20);
    await settle();
    const base = renders;
    setFocusPoint(10, 21);
    await settle();
    const afterSlide = renders;
    setFocusPoint(10, 20);
    setFocusPoint(10, 21);
    await settle();
    expect(afterSlide).toBe(base + 1);
    expect(renders).toBe(afterSlide);
  });

  it('slides the wrapped grid rows with focus, keeps rows near it and drops the far ones', async () => {
    let reach: RowReach = [0, 0];
    let renders = 0;
    const Probe = () => { renders++; reach = useRowReach(1); return null; };
    render(<Probe />, host);
    await settle();
    expect(reach).toEqual([1 - ART_ROW_REACH, 1 + ART_ROW_REACH]);
    setFocusPoint(9, 0);
    await settle();
    expect(reach).toEqual([9 - ART_ROW_REACH, 9 + ART_ROW_REACH]);
    expect(inRowReach(reach, 1)).toBe(false);
    const settled = renders;
    setFocusPoint(8, 1);
    await settle();
    expect(inRowReach(reach, 9 + ART_ROW_REACH)).toBe(true);
    expect(reach[0]).toBe(8 - ART_ROW_REACH);
    setFocusPoint(9, 0);
    await settle();
    expect(reach).toEqual([8 - ART_ROW_REACH, 9 + ART_ROW_REACH]);
    expect(renders).toBe(settled + 1);
    setFocusPoint(9 + ART_ROW_KEEP + 1, 0);
    await settle();
    expect(inRowReach(reach, 8 - ART_ROW_REACH)).toBe(false);
  });
});

describe('lazy poster artwork in the catalog', () => {
  let container: HTMLDivElement;
  const make = (id: string): CatalogTitle => ({ id, title: id.toUpperCase(), kind: 'movie', year: 2020, trackers: [], categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1, posterUrl: `/art/${id}.jpg` });
  const many = Array.from({ length: 30 }, (_, index) => make(`t${index}`));
  const wait = (ms = ART_SETTLE_MS + 40) => sleep(ms);
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

  it('slides the loaded cards with column focus: it loads ahead, keeps the near ones and drops the far ones', async () => {
    mount();
    await wait();
    const card = (id: string) => container.querySelector<HTMLElement>(`[data-focus-key="title-${id}"]`)!;
    const has = (loaded: Array<string | null>, index: number) => loaded.includes(`/art/t${index}.jpg`);
    card('t15').focus();
    await wait();
    const loaded = images();
    expect(has(loaded, 15)).toBe(true);
    expect(has(loaded, 15 + ART_COLUMN_REACH)).toBe(true);
    expect(has(loaded, 15 + ART_COLUMN_REACH + 1)).toBe(false);
    // The first cards are far behind now and are released.
    expect(has(loaded, 0)).toBe(false);
    // One step back keeps everything that was loaded.
    card('t14').focus();
    await wait();
    for (const src of loaded) expect(images()).toContain(src);
    card('t15').focus();
    await wait();
    for (const src of loaded) expect(images()).toContain(src);
    // A long way back loads the start again and releases the far end.
    card('t2').focus();
    await wait();
    expect(has(images(), 0)).toBe(true);
    expect(has(images(), 15 + ART_COLUMN_REACH)).toBe(false);
  });

  it('keeps every card focusable and in order while artwork is pending', async () => {
    mount();
    await wait();
    const cols = Array.from(container.querySelectorAll<HTMLElement>('.poster-card')).map(node => node.dataset.focusCol);
    expect(cols).toEqual(cols.map((_, index) => String(index)));
  });
});
