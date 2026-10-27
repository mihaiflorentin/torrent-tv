// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { openRoute } from './test-nav';
import type { API, CatalogFacets, Download } from '@torrent-tv/shared';
import { withETag } from './test-api';

// The Downloads screen as the viewer drives it (the Downloads board): compact rows with Play, Pause or Resume and
// More on every row; Details, Show files and Delete download live in the More sheet; Delete keeps its confirmation.
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
// Importing main.tsx boots an App into #app; unmount it so its key handlers do not move focus a second time.
render(null, appRoot);

const wait = (ms = 40) => sleep(ms);
const GIB = 1024 ** 3;
const download = (over: Partial<Download> = {}): Download => ({ id: 'd1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', titleId: 't1', displayTitle: 'Alpha · S01E02 · Pilot', releaseName: 'Alpha.S01E02.1080p.WEB-DL-GRP', engineId: 'e1', fileIndex: 3, filePath: 'Alpha.S01/Alpha.S01E02.1080p.mkv', mimeType: 'video/x-matroska', sizeBytes: 3_100_000_000, state: 'downloading', progress: 0.41, playbackMode: 'progressive', downloadedBytes: 1, speedBytesPerSecond: 4_200_000, etaSeconds: 720, peers: 14, seeds: 9, leased: false, streamUrl: '/s', createdAt: '2026-10-14T10:00:00Z', parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'series', resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H264' }, ...over });
const finished = (over: Partial<Download> = {}) => download({ id: 'd2', engineId: 'e2', displayTitle: 'Copper Archive', state: 'uploading', progress: 1, playbackMode: 'local', speedBytesPerSecond: 0, etaSeconds: 0, createdAt: '2026-10-13T10:00:00Z', ...over });
const paused = (over: Partial<Download> = {}) => download({ id: 'd3', engineId: 'e3', displayTitle: 'Orbit Kingdom', state: 'pausedDL', progress: 0.18, speedBytesPerSecond: 0, createdAt: '2026-10-12T10:00:00Z', ...over });
const failed = (over: Partial<Download> = {}) => download({ id: 'd4', engineId: 'e4', displayTitle: 'Meridian Garden', state: 'error', error: 'No seeders for 2 hours', createdAt: '2026-10-11T10:00:00Z', ...over });
// Two episodes of one season pack: one torrent on the engine, so one row with Show files.
const episode = (n: number) => download({ id: `p${n}`, engineId: 'pack', fileIndex: n, displayTitle: `Velvet Witness · S01E0${n}`, filePath: `Velvet.S01/Velvet.S01E0${n}.mkv`, sizeBytes: 1_000_000_000, createdAt: `2026-10-10T10:00:0${9 - n}Z` });

type Props = Parameters<typeof Catalog>[0];
function mount(container: HTMLElement, downloads: Download[], over: Partial<Props> = {}, settings: Record<string, unknown> = {}) {
  render(
    <Catalog
      api={withETag({ titles: async () => ({ items: [], nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => `http://server${p}`, call: async (path: string) => (path === '/settings' ? settings : {}) } as unknown as API)}
      status="Online"
      titles={[]}
      facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={{ favorites: [], continueWatching: [], recent: [], watched: [] }}
      downloads={downloads}
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
      onManageDownload={async () => { }}
      onManageSeasonPack={async () => { }}
      onRefreshDownloads={async () => { }}
      onFavorite={() => { }}
      {...over}
    />,
    container,
  );
}

const KEYS = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13], back: ['Escape', 27] } as const;
function press(name: keyof typeof KEYS) {
  const [key, keyCode] = KEYS[name];
  document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, bubbles: true, cancelable: true }));
}
const key = (focusKey: string) => document.querySelector<HTMLButtonElement>(`[data-focus-key="${focusKey}"]`);
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-download-id="${id}"]`)!;
const sheetRows = () => Array.from(document.querySelectorAll<HTMLElement>('.tv-more [data-focus-region="more-menu"]')).map(row => row.querySelector('b')?.textContent?.trim());

describe('TV Downloads', () => {
  let container: HTMLDivElement;
  const open = async (downloads: Download[], over: Partial<Props> = {}, settings: Record<string, unknown> = {}) => {
    mount(container, downloads, over, settings);
    await wait();
    await openRoute(container, 'downloads', 0);
    await wait(120);
  };
  const openMore = async (id: string) => {
    key(`download-${id}-more`)!.focus();
    press('ok');
    await wait();
  };

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
  });

  it('shows each download as one compact row: title, state, facts and size, with Play, Pause and More', async () => {
    await open([download()]);
    const row = rowOf('d1');
    expect(row.textContent).toContain('Alpha · S01E02 · Pilot');
    expect(row.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('41');
    expect(row.textContent).toContain('41%');
    expect(row.textContent).toContain('4.2 MB/s · 12 min left · Playable now');
    expect(row.textContent).toContain('3.1 GB');
    const actions = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).map(button => button.getAttribute('aria-label') || button.textContent?.trim());
    expect(actions).toEqual(['Play', 'Pause', 'More: Details, Delete download']);
    expect(row.textContent).not.toMatch(/Delete download|Details|Alpha\.S01E02\.1080p|\.mkv|peers/);
  });

  it('draws the title’s picture as the thumbnail once the screen has opened, and none for a download without a title', async () => {
    await open([download(), finished({ titleId: undefined })]);
    expect(rowOf('d1').querySelector('img')).toBeNull();
    await wait(400);
    expect(rowOf('d1').querySelector('img')?.getAttribute('src')).toBe('http://server/api/v1/artwork/t1/backdrop-small');
    expect(rowOf('d2').querySelector('img')).toBeNull();
  });

  it('heads the screen with the storage used against the Allocation', async () => {
    await open([download({ sizeBytes: 100 * GIB }), finished({ sizeBytes: 48 * GIB })], {}, { allocationGb: 500 });
    const use = container.querySelector('.tv-download-use')!;
    // The Allocation is asked for once the screen has opened; until it answers the line says what is stored.
    expect(use.textContent).toBe('148 GB stored');
    await wait(400);
    expect(use.textContent).toContain('148 GB of 500 GB');
    expect(use.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('30');
  });

  it('says only what is stored when no Allocation is set', async () => {
    await open([download({ sizeBytes: 100 * GIB })], {}, { allocationGb: 0 });
    await wait(400);
    expect(container.querySelector('.tv-download-use')!.textContent).toBe('100 GB stored');
  });

  it('filters with chips that carry their counts, and marks the chip in use', async () => {
    await open([download(), finished(), paused(), failed()]);
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-focus-key^="downloads-filter-"]'));
    expect(chips.map(chip => chip.textContent)).toEqual(['All4', 'Active1', 'Downloaded1', 'Paused1', 'Needs attention1']);
    expect(key('downloads-filter-all')!.getAttribute('aria-pressed')).toBe('true');
    key('downloads-filter-paused')!.focus();
    press('ok');
    await wait();
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-download-id]')).map(row => row.dataset.downloadId)).toEqual(['d3']);
    expect(key('downloads-filter-paused')!.getAttribute('aria-pressed')).toBe('true');
    expect(key('downloads-filter-all')!.getAttribute('aria-pressed')).toBe('false');
    expect(focused()).toBe('downloads-filter-paused');
    key('downloads-filter-attention')!.click();
    await wait();
    expect(rowOf('d4').textContent).toContain('Needs attention');
    expect(rowOf('d4').textContent).toContain('No seeders for 2 hours');
  });

  it('Play plays the download; Pause and Resume act on the transfer', async () => {
    const onPlayDownload = vi.fn();
    const onManageDownload = vi.fn(async () => { });
    await open([download(), paused()], { onPlayDownload, onManageDownload });
    key('download-d1-play')!.focus();
    press('ok');
    expect(onPlayDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
    key('download-d1-pause')!.click();
    await wait();
    expect(onManageDownload).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd1' }), 'pause');
    expect(key('download-d3-resume')!.textContent).toBe('Resume');
    key('download-d3-resume')!.click();
    await wait();
    expect(onManageDownload).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd3' }), 'resume');
  });

  it('keeps one focus band per row: Down from More reaches the More below it, Up comes back', async () => {
    await open([download(), paused({ createdAt: '2026-10-13T10:00:00Z' })]);
    key('download-d1-more')!.focus();
    press('down');
    expect(focused()).toBe('download-d3-more');
    press('left');
    expect(focused()).toBe('download-d3-resume');
    press('up');
    expect(focused()).toBe('download-d1-pause');
  });

  it('marks the row that holds focus as the active row, and only that row', async () => {
    await open([download(), finished()]);
    key('download-d1-play')!.focus();
    expect(rowOf('d1').classList.contains('active-row')).toBe(true);
    expect(rowOf('d2').classList.contains('active-row')).toBe(false);
    press('down');
    expect(focused()).toBe('download-d2-play');
    expect(rowOf('d1').classList.contains('active-row')).toBe(false);
    expect(rowOf('d2').classList.contains('active-row')).toBe(true);
    press('up');
    press('up');
    expect(focused()).toMatch(/^downloads-/);
    expect(document.querySelectorAll('.active-row')).toHaveLength(0);
  });

  it('opens More on its first action; Back closes it onto the More button', async () => {
    await open([download()]);
    await openMore('d1');
    expect(sheetRows()).toEqual(['Details', 'Delete download', 'Close']);
    expect(focused()).toBe('more-details');
    press('down');
    expect(focused()).toBe('more-delete');
    press('back');
    await wait();
    expect(document.querySelector('.tv-more')).toBeNull();
    expect(focused()).toBe('download-d1-more');
  });

  it('Details in More shows the release, path and peers on the row, and Hide details takes them away', async () => {
    await open([download()]);
    await openMore('d1');
    press('ok');
    await wait();
    expect(document.querySelector('.tv-more')).toBeNull();
    expect(focused()).toBe('download-d1-more');
    const row = rowOf('d1');
    expect(row.textContent).toContain('Alpha.S01E02.1080p.WEB-DL-GRP');
    expect(row.textContent).toContain('Alpha.S01/Alpha.S01E02.1080p.mkv (file 3)');
    expect(row.textContent).toContain('9 connected seeds · 14 peers');
    await openMore('d1');
    expect(sheetRows()[0]).toBe('Hide details');
    press('ok');
    await wait();
    expect(rowOf('d1').textContent).not.toContain('connected seeds');
  });

  it('Delete download in More asks first; Cancel returns to More, Delete removes the download', async () => {
    const onManageDownload = vi.fn(async () => { });
    await open([download()], { onManageDownload });
    await openMore('d1');
    press('down');
    press('ok');
    await wait();
    expect(document.querySelector('.tv-more')).toBeNull();
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('Delete download?');
    expect(focused()).toBe('download-cancel');
    press('back');
    await wait();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(focused()).toBe('download-d1-more');
    expect(onManageDownload).not.toHaveBeenCalled();
    await openMore('d1');
    key('more-delete')!.click();
    await wait();
    press('down');
    expect(focused()).toBe('download-confirm');
    press('ok');
    await wait();
    expect(onManageDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), 'remove');
  });

  it('gives a multi-file torrent one row, with Show files in More listing each episode to play or remove', async () => {
    const onPlayDownload = vi.fn();
    const onManageDownload = vi.fn(async () => { });
    await open([episode(1), episode(2)], { onPlayDownload, onManageDownload });
    expect(container.querySelectorAll('[data-download-id]')).toHaveLength(1);
    expect(container.querySelector('[data-download-id]')!.textContent).toContain('2 files');
    expect(key('download-p1-more')!.getAttribute('aria-label')).toBe('More: Details, Show files, Delete download');
    await openMore('p1');
    expect(sheetRows()).toEqual(['Details', 'Show files', 'Delete download', 'Close']);
    press('down');
    press('ok');
    await wait();
    expect(focused()).toBe('download-p1-more');
    const files = Array.from(container.querySelectorAll('.tv-download-file')).map(file => file.textContent);
    expect(files).toHaveLength(2);
    expect(files[1]).toContain('Velvet Witness · S01E02');
    press('down');
    expect(focused()).toBe('download-p1-file-1-play');
    press('down');
    press('ok');
    expect(onPlayDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }));
    press('right');
    expect(focused()).toBe('download-p2-file-2-remove');
    press('ok');
    await wait();
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('Remove episode from downloads?');
    press('down');
    press('ok');
    await wait();
    expect(onManageDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }), 'remove-file');
    await openMore('p1');
    expect(sheetRows()[1]).toBe('Hide files');
  });

  it('lands on the first row’s Play, not on the chips or the find field', async () => {
    await open([download(), finished()]);
    expect(focused()).toBe('download-d1-play');
  });
});
