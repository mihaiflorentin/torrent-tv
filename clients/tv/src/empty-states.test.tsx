// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogDetail, CatalogFacets, CatalogTitle, Download, HouseholdState } from '@torrent-tv/shared';
import { withETag } from './test-api';
import { openRoute } from './test-nav';

// Ticket #62 (spec #51 story 66): an empty or error state says what happened and what to do next, one sentence
// each, as a heading and a line on the screen, never a box inside a box. Checked on what the screens render.
// main.tsx bootstraps against #app during module evaluation, so mount it first.
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

const wait = (ms = 40) => sleep(ms);
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 1, bestSeeders: 7, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], ...over });
const download = (over: Partial<Download> = {}): Download => ({ id: 'd1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Alpha', releaseName: 'Alpha.2019.1080p', engineId: 'e1', fileIndex: 0, filePath: 'Alpha.mkv', mimeType: 'video/x-matroska', sizeBytes: 1, state: 'completed', progress: 1, playbackMode: 'progressive', downloadedBytes: 1, speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0, leased: false, streamUrl: '/s', createdAt: '2026-10-14T10:00:00Z', ...over });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const page = { items: [], nextCursor: null, total: 0 };

function mount(container: HTMLElement, props: { titles?: CatalogTitle[]; downloads?: Download[] } = {}, extra: Partial<API> = {}) {
  const api = withETag({ ...extra as object, titles: async () => page, searchTitles: async () => page, families: async () => ({ items: [] }), libraryFamilies: async () => ({ items: [] }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => page, ...extra } as unknown as API);
  render(<Catalog api={api} status="Online" titles={props.titles || []} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets} household={empty} downloads={props.downloads || []} jobs={[]} restoreFocus={null} portal={null} updateStatus={null} onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }} onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }} />, container);
}

// A sentence ends at . ! or ? followed by more text; a heading or a line with a second sentence fails.
const sentences = (text: string) => text.trim().split(/(?<=[.!?])\s+(?=\S)/).length;

describe('TV empty states: the cause, then the next action, one sentence each', () => {
  let container: HTMLDivElement;
  const route = (name: string) => openRoute(container, name);
  const state = () => {
    const box = container.querySelector('[role="status"].tv-empty');
    expect(box, 'an empty state on screen').not.toBeNull();
    return { cause: box!.querySelector('h2')!.textContent ?? '', action: box!.querySelector('p')!.textContent ?? '' };
  };
  const oneEach = (expected: { cause: string; action: RegExp }) => {
    const { cause, action } = state();
    expect(cause).toBe(expected.cause);
    expect(action).toMatch(expected.action);
    expect(sentences(cause), cause).toBe(1);
    expect(sentences(action), action).toBe(1);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('on an empty catalog says to wait for the sync and Reload library, or turn on a tracker', async () => {
    mount(container);
    await wait();
    oneEach({ cause: 'No titles to show yet', action: /Reload library.*tracker in Settings/ });
  });

  it('on Search says how to search, and when nothing matches, how to widen it', async () => {
    mount(container, { titles: [title()] });
    await route('search');
    oneEach({ cause: 'Search the catalog', action: /type a title/ });
    const input = container.querySelector<HTMLInputElement>('[data-focus-key="search-input"]')!;
    input.value = 'zzqx';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="search-submit"]')!.click();
    await wait(80);
    oneEach({ cause: 'No titles match “zzqx”', action: /Clear/ });
  });

  it('on Downloads says how to start one, and when the search hides them all, how to see them again', async () => {
    mount(container, { titles: [title()] });
    await route('downloads');
    oneEach({ cause: 'No downloads yet', action: /Play and download/ });
    render(null, container);
    mount(container, { titles: [title()], downloads: [download()] });
    await route('downloads');
    const search = container.querySelector<HTMLInputElement>('[data-focus-key="downloads-search"]')!;
    search.value = 'zzqx';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    oneEach({ cause: 'No downloads match', action: /clear the search/ });
  });

  it('on both Categories screens says what fills them', async () => {
    mount(container, { titles: [title()] });
    await route('categories');
    oneEach({ cause: 'No categories yet', action: /Fetch latest/ });
    await route('library-categories');
    oneEach({ cause: 'No library categories yet', action: /Download or watch a title/ });
  });

  it('on a title with no versions says the trackers have none and to refresh it through More', async () => {
    const detail: CatalogDetail = { title: title(), seasons: [], sources: [] };
    mount(container, { titles: [title()] }, { title: async () => detail } as unknown as Partial<API>);
    await wait();
    container.querySelector<HTMLButtonElement>('[data-focus-key="hero-a"]')!.click();
    await wait();
    oneEach({ cause: 'No versions yet', action: /More.*Refresh data/ });
  });
});
