// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogDetail, CatalogFacets, CatalogTitle, Download } from '@torrent-tv/shared';
// Static import cannot work here: main.tsx bootstraps and asserts the presence
// of document.getElementById('app') during module evaluation. The #app container
// must be mounted to the DOM before main.tsx evaluates.
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

const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);

const { Catalog } = await import('./main');

const wait = (ms = 30) => sleep(ms);
const lastSort = (fn: { mock: { calls: unknown[][] } }) => (fn.mock.calls[fn.mock.calls.length - 1]?.[0] as { sort?: string } | undefined)?.sort;

const title = (id: string, name: string): CatalogTitle => ({
  id, title: name, kind: 'movie', categories: [], resolutions: ['1080p'], sourceCount: 1, bestSeeders: 10, largestSizeBytes: 1000, trackers: [],
});

const download: Download = {
  id: 'dl-1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', engineId: 'engine-1', fileIndex: 0,
  filePath: 'video.mkv', mimeType: 'video/x-matroska', streamUrl: '/stream/dl-1', sizeBytes: 1000, downloadedBytes: 500,
  progress: 0.5, state: 'downloading', playbackMode: 'progressive', speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0,
  leased: false, error: '', createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
};

type Overrides = Partial<Record<'onManageDownload' | 'onManageSeasonPack', (...args: never[]) => Promise<unknown>>>;

function mount(container: HTMLElement, api: Partial<API>, props: { titles?: CatalogTitle[]; downloads?: Download[] } & Overrides = {}) {
  const view = (titles: CatalogTitle[]) => (
    <Catalog
      api={{ titles: async () => ({ items: [], nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), ...api } as unknown as API}
      status="Online"
      titles={titles}
      facets={{} as CatalogFacets}
      household={{ favorites: [], continueWatching: [], recent: [], watched: [] }}
      downloads={props.downloads || []}
      jobs={[]}
      restoreFocus={null}
      portal={null}
      updateStatus={null}
      onUpdateStatus={() => { }}
      onFocus={() => { }}
      onRetry={() => { }}
      onChangeServer={() => { }}
      onForgetServer={() => { }}
      onPlay={() => { }}
      onPlayDownload={() => { }}
      onManageDownload={(props.onManageDownload || (async () => { })) as never}
      onManageSeasonPack={(props.onManageSeasonPack || (async () => { })) as never}
      onRefreshDownloads={async () => { }}
      onFavorite={() => { }}
    />
  );
  render(view(props.titles || []), container);
  return { rerender: (titles: CatalogTitle[]) => render(view(titles), container) };
}

describe('calm action errors', () => {
  let container: HTMLDivElement;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    render(null, container);
    container.remove();
  });

  const key = (focusKey: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="${focusKey}"]`);

  it('shows a rejected download action in the downloads list instead of escaping', async () => {
    const onManageDownload = vi.fn(async () => { throw new Error('Pause failed: 409 conflict'); });
    mount(container, {}, { downloads: [download], onManageDownload });
    container.querySelector<HTMLButtonElement>('[data-menu-route="downloads"]')?.click();
    await wait();

    key('download-dl-1-pause')?.click();
    await wait();

    expect(onManageDownload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.tv-download-list [role="status"]')?.textContent).toBe('Pause failed: 409 conflict');
    expect(key('download-dl-1-pause')?.hasAttribute('disabled')).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('keeps the removal dialog open and shows the message when a delete is rejected', async () => {
    const onManageDownload = vi.fn(async () => { throw new Error('Delete failed: 409 conflict'); });
    mount(container, {}, { downloads: [download], onManageDownload });
    container.querySelector<HTMLButtonElement>('[data-menu-route="downloads"]')?.click();
    await wait();

    key('download-dl-1-delete')?.click();
    await wait();
    key('download-confirm')?.click();
    await wait();

    expect(onManageDownload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Delete failed: 409 conflict');
    expect(key('download-confirm')?.hasAttribute('disabled')).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('shows a rejected season pack action in the detail area instead of escaping', async () => {
    const series = { ...title('series-1', 'Sample Series'), kind: 'series' as const };
    const detail: CatalogDetail = {
      title: series,
      sources: [],
      seasons: [{
        number: 1, title: 'Season 1', episodeCount: 0, episodes: [],
        packSources: [{
          release: { id: 'rel-pack-1', trackerId: 'piratebay', trackerName: 'The Pirate Bay', providerId: '1', categoryId: '2', browseClass: 'video', name: 'Sample.Series.S01', category: 'Video', sizeBytes: 1000, seeders: 2, leechers: 1, freeleech: false },
          parsed: { title: 'Sample Series', sortTitle: 'sample series', kind: 'series', seasonStart: 1, seasonEnd: 1 },
          libraryState: { downloadState: 'downloading', transferState: 'active', watchState: 'unwatched', downloadId: 'dl-pack', progress: 0.1 },
        }],
      }],
    } as unknown as CatalogDetail;
    const onManageSeasonPack = vi.fn(async () => { throw new Error('Pause failed: 409 conflict'); });
    mount(container, { titles: async () => ({ items: [series], nextCursor: null, total: 1 }), title: async () => detail } as Partial<API>, { titles: [series], onManageSeasonPack });
    await wait();

    key('hero-series-1')?.click();
    await wait(40);
    key('season-pack-rel-pack-1-toggle')?.click();
    await wait(40);

    expect(onManageSeasonPack).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.detail-message')?.textContent).toBe('Pause failed: 409 conflict');
    expect(unhandled).toEqual([]);
  });

  it('absorbs a rejected metadata ensure instead of escaping', async () => {
    const films = [title('a', 'Alpha'), title('b', 'Bravo')];
    let ensured = 0;
    // A plain function: a vi.fn wrapper observes its rejection and would hide an unhandled one.
    const ensureMetadata = async () => { ensured++; throw new Error('Metadata ensure failed: 503'); };
    mount(container, { titles: async () => ({ items: films, nextCursor: null, total: 2 }), ensureMetadata } as Partial<API>, { titles: films });
    await wait();

    expect(ensured).toBeGreaterThan(0);
    expect(container.textContent).toContain('Alpha');
    expect(unhandled).toEqual([]);
  });
});

describe('stable catalog lists', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const catalogApi = () => {
    const titles = vi.fn(async (_options?: { sort?: string; search?: string }) => ({ items: [title('a', 'Alpha'), title('b', 'Bravo')], nextCursor: null, total: 2 }));
    return { titles };
  };

  it('patches a metadata update into the matching card and keeps the list and sort', async () => {
    const api = catalogApi();
    mount(container, api as unknown as Partial<API>, { titles: [title('a', 'Alpha'), title('b', 'Bravo')] });
    container.querySelector<HTMLButtonElement>('[data-menu-route="browse"]')?.click();
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="sort-seeders"]')?.click();
    await wait();
    const callsBefore = api.titles.mock.calls.length;
    expect(lastSort(api.titles)).toBe('seeders');

    window.dispatchEvent(new CustomEvent('catalog-metadata-updated', { detail: { title: { ...title('b', 'Bravo (2024)'), year: 2024 } } }));
    await wait();

    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Bravo (2024)');
    expect(container.textContent).not.toContain('Bravo—');
    expect(api.titles.mock.calls.length).toBe(callsBefore);
    expect(container.querySelector('[data-focus-key="sort-seeders"]')?.className).toContain('active');
  });

  it('ignores a metadata update for a title that is not in the list', async () => {
    const api = catalogApi();
    mount(container, api as unknown as Partial<API>, { titles: [title('a', 'Alpha'), title('b', 'Bravo')] });
    await wait();

    window.dispatchEvent(new CustomEvent('catalog-metadata-updated', { detail: { title: title('zzz', 'Stranger') } }));
    await wait();

    expect(container.textContent).not.toContain('Stranger');
    expect(container.textContent).toContain('Alpha');
  });

  it('reapplies the current sort when an explicit refresh replaces the snapshot', async () => {
    const api = catalogApi();
    const view = mount(container, api as unknown as Partial<API>, { titles: [title('a', 'Alpha'), title('b', 'Bravo')] });
    container.querySelector<HTMLButtonElement>('[data-menu-route="browse"]')?.click();
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="sort-seeders"]')?.click();
    await wait();
    const callsBefore = api.titles.mock.calls.length;

    view.rerender([title('a', 'Alpha'), title('b', 'Bravo'), title('c', 'Charlie')]);
    await wait();

    expect(api.titles.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(lastSort(api.titles)).toBe('seeders');
    expect(container.querySelector('[data-focus-key="sort-seeders"]')?.className).toContain('active');
  });
});
