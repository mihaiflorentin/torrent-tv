// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';
import type { API, CatalogDetail, CatalogFacets, CatalogTitle, Download, MediaState, UpdateStatus } from '@torrent-tv/shared';
import { withETag } from './test-api';
import type { TVPlatformHooks } from './platform';
// main.tsx asserts #app during module evaluation, so the container exists first.
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

const { Catalog, Setup } = await import('./main');
// Importing main.tsx also boots the real app into #app; unmount it so only the
// component under test talks to the faked platform.
render(null, appRoot);

const testWindow = window as unknown as { FileListTVPlatform?: TVPlatformHooks };

const settle = () => sleep(20);
const control = (container: ParentNode, key: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`);

// A busy control stays in the focus set: it is announced as disabled but is
// never `disabled`, so the remote keeps focus on it and Enter reaches a guard.
function expectBusyAndFocusable(element: HTMLButtonElement | null) {
  expect(element).not.toBeNull();
  expect(element!.getAttribute('aria-disabled')).toBe('true');
  expect(element!.hasAttribute('disabled')).toBe(false);
}

function expectIdle(element: HTMLButtonElement | null) {
  expect(element).not.toBeNull();
  expect(element!.hasAttribute('aria-disabled')).toBe(false);
  expect(element!.hasAttribute('disabled')).toBe(false);
}

type CatalogProps = Parameters<typeof Catalog>[0];

function catalogProps(api: Partial<API>, overrides: Partial<CatalogProps> = {}): CatalogProps {
  return {
    api: withETag({
      titles: async () => ({ items: [], nextCursor: null }),
      ensureMetadata: async () => ({ queued: 0 }),
      streamURL: (path: string) => path,
      call: async () => ({}),
      ...api,
    } as unknown as API),
    status: 'Online',
    titles: [],
    facets: {} as CatalogFacets,
    household: { favorites: [], continueWatching: [], recent: [], watched: [] },
    downloads: [],
    jobs: [],
    restoreFocus: null,
    portal: null,
    updateStatus: null,
    onUpdateStatus: () => { },
    onFocus: () => { },
    onRetry: () => { },
    onChangeServer: () => { },
    onForgetServer: () => { },
    onPlay: () => { },
    onPlayDownload: () => { },
    onManageDownload: async () => { },
    onManageSeasonPack: async () => { },
    onRefreshDownloads: async () => { },
    onFavorite: () => { },
    ...overrides,
  };
}

const seriesTitle: CatalogTitle = {
  id: 'series-1',
  title: 'Sample Series',
  kind: 'series',
  categories: [],
  resolutions: ['1080p'],
  sourceCount: 1,
  bestSeeders: 10,
  largestSizeBytes: 1000,
  trackers: [{ id: 'piratebay', name: 'The Pirate Bay' }],
};

function seriesDetail(libraryState?: MediaState): CatalogDetail {
  return {
    title: seriesTitle,
    seasons: [{
      number: 1,
      title: 'Season 1',
      episodeCount: 0,
      episodes: [],
      packSources: [{
        release: {
          id: 'rel-pack-1',
          trackerId: 'piratebay',
          trackerName: 'The Pirate Bay',
          providerId: '101',
          categoryId: '201',
          browseClass: 'video',
          name: 'Sample.Series.S01.1080p',
          category: 'Video',
          sizeBytes: 10_000_000_000,
          seeders: 20,
          leechers: 2,
          freeleech: true,
        },
        parsed: { title: 'Sample Series', sortTitle: 'sample series', kind: 'series', seasonStart: 1, seasonEnd: 1, resolution: '1080p' },
        libraryState,
      }],
    }],
    sources: [],
  };
}

async function openSeriesDetail(container: HTMLElement, api: Partial<API>, overrides: Partial<CatalogProps>, libraryState?: MediaState) {
  render(<Catalog {...catalogProps({ titles: async () => ({ items: [seriesTitle], nextCursor: null, total: 1 }), title: async () => seriesDetail(libraryState), ...api }, { titles: [seriesTitle], ...overrides })} />, container);
  await settle();
  control(container, 'hero-series-1')!.click();
  await settle();
}

async function openSeasonPack(container: HTMLElement) {
}

const activeDownload: Download = {
  id: 'dl-1',
  releaseId: 'rel-1',
  trackerId: 'piratebay',
  trackerName: 'The Pirate Bay',
  displayTitle: 'Sample Movie',
  releaseName: 'Sample.Movie.1080p',
  engineId: 'engine-1',
  fileIndex: 0,
  filePath: 'Sample.Movie.1080p.mkv',
  mimeType: 'video/x-matroska',
  sizeBytes: 1_000_000,
  state: 'downloading',
  progress: 0.4,
  playbackMode: 'local',
  downloadedBytes: 400_000,
  speedBytesPerSecond: 1000,
  etaSeconds: 60,
  peers: 3,
  seeds: 5,
  leased: false,
  streamUrl: '/stream/dl-1',
};

async function openDownloads(container: HTMLElement, onManageDownload: CatalogProps['onManageDownload']) {
  render(<Catalog {...catalogProps({}, { downloads: [activeDownload], onManageDownload })} />, container);
  await settle();
  await openRoute(container, 'downloads', 0);
  await settle();
}

describe('busy controls keep focus and ignore their action', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    delete testWindow.FileListTVPlatform;
  });

  it('Rescan keeps focus while searching, runs once, and is the same focused control afterwards', async () => {
    let resolveNetwork: (value: null) => void = () => { };
    const getNetworkInfo = vi.fn(() => new Promise<null>(resolve => { resolveNetwork = resolve; }));
    testWindow.FileListTVPlatform = {
      getNetworkInfo,
      openExternal: async () => false,
      exit: () => { },
      onKeyboardVisibility: () => () => { },
      onVisibility: () => () => { },
    };

    render(<Setup draft="http://192.168.1.100:8097" server="" status="" onDraft={() => { }} onConnect={() => { }} onForget={() => { }} />, container);
    await settle();

    const rescan = control(container, 'setup-rescan');
    expectBusyAndFocusable(rescan);
    expect(document.activeElement).toBe(rescan);

    rescan!.click();
    await settle();
    expect(getNetworkInfo).toHaveBeenCalledTimes(1);

    resolveNetwork(null);
    await settle();
    expectIdle(rescan);
    expect(control(container, 'setup-rescan')).toBe(rescan);
    expect(document.activeElement).toBe(rescan);
  });

  it('Search keeps focus while searching, runs once, and is the same focused control afterwards', async () => {
    let resolveSearch: (value: { items: never[]; nextCursor: null }) => void = () => { };
    const searchTitles = vi.fn(() => new Promise<{ items: never[]; nextCursor: null }>(resolve => { resolveSearch = resolve; }));
    render(<Catalog {...catalogProps({ searchTitles } as unknown as Partial<API>)} />, container);
    await settle();
    await openRoute(container, 'search', 0);
    await settle();

    const input = control(container, 'search-input') as unknown as HTMLInputElement;
    input.value = 'bunny';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const search = control(container, 'search-submit');
    expectIdle(search);
    search!.focus();
    search!.click();
    await settle();
    expectBusyAndFocusable(search);
    expect(document.activeElement).toBe(search);

    search!.click();
    await settle();
    expect(searchTitles).toHaveBeenCalledTimes(1);

    resolveSearch({ items: [], nextCursor: null });
    await settle();
    expectIdle(search);
    expect(control(container, 'search-submit')).toBe(search);
    expect(document.activeElement).toBe(search);
  });

  it('Refresh data (in More) keeps focus while refreshing, runs once, and is the same focused control afterwards', async () => {
    let finish: () => void = () => { };
    const refreshTitle = vi.fn(() => new Promise<unknown>(resolve => { finish = () => resolve({}); }));
    await openSeriesDetail(container, { refreshTitle } as unknown as Partial<API>, {});
    // Opening a series without an episode list already asks for one refresh.
    refreshTitle.mockClear();

    control(container, 'detail-more')!.click();
    await settle();
    const refresh = control(container, 'more-refresh');
    expectIdle(refresh);
    refresh!.focus();
    refresh!.click();
    await settle();
    expectBusyAndFocusable(refresh);
    expect(document.activeElement).toBe(refresh);

    refresh!.click();
    await settle();
    expect(refreshTitle).toHaveBeenCalledTimes(1);

    finish();
    await settle();
    expectIdle(refresh);
    expect(control(container, 'more-refresh')).toBe(refresh);
    expect(document.activeElement).toBe(refresh);
  });

  it('Download season keeps focus while starting and runs once', async () => {
    let finish: (ok: boolean) => void = () => { };
    const onManageSeasonPack = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await openSeriesDetail(container, {}, { onManageSeasonPack });
    await openSeasonPack(container);

    const download = control(container, 'season-pack-rel-pack-1-download');
    expectIdle(download);
    download!.focus();
    download!.click();
    await settle();
    expectBusyAndFocusable(download);
    expect(document.activeElement).toBe(download);

    download!.click();
    await settle();
    expect(onManageSeasonPack).toHaveBeenCalledTimes(1);

    finish(true);
    await settle();
    expectIdle(download);
    expect(control(container, 'season-pack-rel-pack-1-download')).toBe(download);
    expect(document.activeElement).toBe(download);
  });

  it('Pause keeps focus while pending and blocks Delete download from opening its dialog', async () => {
    let finish: (ok: boolean) => void = () => { };
    const onManageSeasonPack = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const running: MediaState = { downloadState: 'downloading', transferState: 'active', watchState: 'unwatched', downloadId: 'dl-1' };
    await openSeriesDetail(container, {}, { onManageSeasonPack }, running);
    await openSeasonPack(container);

    const pause = control(container, 'season-pack-rel-pack-1-toggle');
    const remove = control(container, 'season-pack-rel-pack-1-delete');
    expectIdle(pause);
    pause!.focus();
    pause!.click();
    await settle();
    expectBusyAndFocusable(pause);
    expectBusyAndFocusable(remove);
    expect(document.activeElement).toBe(pause);

    pause!.click();
    remove!.click();
    await settle();
    expect(onManageSeasonPack).toHaveBeenCalledTimes(1);
    expect(control(container, 'season-pack-delete-confirm')).toBeNull();

    finish(true);
    await settle();
    expectIdle(pause);
    expectIdle(remove);
    expect(document.activeElement).toBe(pause);
  });

  it('season download delete dialog keeps focus on Delete while deleting and ignores Cancel and repeat presses', async () => {
    let finish: (ok: boolean) => void = () => { };
    const onManageSeasonPack = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const running: MediaState = { downloadState: 'downloading', transferState: 'active', watchState: 'unwatched', downloadId: 'dl-1' };
    await openSeriesDetail(container, {}, { onManageSeasonPack }, running);
    await openSeasonPack(container);
    control(container, 'season-pack-rel-pack-1-delete')!.click();
    await settle();

    const confirm = control(container, 'season-pack-delete-confirm');
    const cancel = control(container, 'season-pack-delete-cancel');
    expect(confirm).not.toBeNull();
    expectIdle(confirm);
    confirm!.focus();
    confirm!.click();
    await settle();
    expectBusyAndFocusable(confirm);
    expectBusyAndFocusable(cancel);
    expect(document.activeElement).toBe(confirm);

    cancel!.click();
    confirm!.click();
    await settle();
    expect(onManageSeasonPack).toHaveBeenCalledTimes(1);
    expect(control(container, 'season-pack-delete-confirm')).toBe(confirm);

    finish(true);
    await settle();
    expect(control(container, 'season-pack-delete-confirm')).toBeNull();
  });

  it('download Pause keeps focus while pending, runs once, and is the same focused control afterwards', async () => {
    let finish: () => void = () => { };
    const onManageDownload = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await openDownloads(container, onManageDownload);

    const pause = control(container, 'download-dl-1-pause');
    expectIdle(pause);
    pause!.focus();
    pause!.click();
    await settle();
    expectBusyAndFocusable(pause);
    expect(document.activeElement).toBe(pause);

    pause!.click();
    await settle();
    expect(onManageDownload).toHaveBeenCalledTimes(1);

    finish();
    await settle();
    expectIdle(pause);
    expect(control(container, 'download-dl-1-pause')).toBe(pause);
    expect(document.activeElement).toBe(pause);
  });

  it('download delete dialog keeps focus on Delete while deleting and ignores Cancel and repeat presses', async () => {
    let finish: () => void = () => { };
    const onManageDownload = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await openDownloads(container, onManageDownload);
    control(container, 'download-dl-1-delete')!.click();
    await settle();

    const confirm = control(container, 'download-confirm');
    const cancel = control(container, 'download-cancel');
    expectIdle(confirm);
    confirm!.focus();
    confirm!.click();
    await settle();
    expectBusyAndFocusable(confirm);
    expectBusyAndFocusable(cancel);
    expect(document.activeElement).toBe(confirm);

    cancel!.click();
    confirm!.click();
    await settle();
    expect(onManageDownload).toHaveBeenCalledTimes(1);
    expect(control(container, 'download-confirm')).toBe(confirm);

    finish();
    await settle();
    expect(control(container, 'download-confirm')).toBeNull();
  });
});

describe('release link on the Settings screen', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // happy-dom does no layout; the remote only considers laid-out controls.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    render(null, container);
    container.remove();
    delete testWindow.FileListTVPlatform;
  });

  const press = (key: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));

  it('is reached with the D-pad and opens through the platform external-open path', async () => {
    const releaseUrl = 'https://github.com/example/releases/v1.2.3';
    const openExternal = vi.fn(async () => true);
    testWindow.FileListTVPlatform = {
      getNetworkInfo: async () => null,
      openExternal,
      exit: () => { },
      onKeyboardVisibility: () => () => { },
      onVisibility: () => () => { },
    };
    const updateStatus: UpdateStatus = { currentVersion: '1.2.2', latest: '1.2.3', available: true, releasesUrl: releaseUrl, selfUpdate: false, applying: false };

    render(<Catalog {...catalogProps({}, { updateStatus })} />, container);
    await settle();
    await openRoute(container, 'settings', 0);
    await settle();

    const save = control(container, 'settings-save');
    expect(save).not.toBeNull();
    save!.focus();
    press('ArrowDown', 40);

    const link = control(container, 'update-release-link');
    expect(link).not.toBeNull();
    expect(link!.tagName).toBe('BUTTON');
    expect(link!.textContent).toContain(releaseUrl);
    expect(document.activeElement).toBe(link);

    press('Enter', 13);
    await settle();
    expect(openExternal).toHaveBeenCalledWith(releaseUrl);

    // Down continues to the connection tests disclosure, so the link is not a dead end.
    press('ArrowDown', 40);
    const diagnostics = control(container, 'settings-diagnostics');
    expect(document.activeElement).toBe(diagnostics);
    expect(control(container, 'test-filelist')).toBeNull();
    press('Enter', 13);
    await settle();
    // Opened, the tests follow it and Up walks back to the same controls.
    press('ArrowDown', 40);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('test-filelist');
    press('ArrowUp', 38);
    expect(document.activeElement).toBe(diagnostics);
    press('ArrowUp', 38);
    expect(document.activeElement).toBe(link);
  });
});
