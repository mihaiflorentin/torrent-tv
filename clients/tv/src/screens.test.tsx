// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogDetail, CatalogFacets, CatalogSource, CatalogTitle, Download, HouseholdItem, HouseholdState, Job } from '@torrent-tv/shared';
import { withETag } from './test-api';

// DESIGN.md "Information priorities", checked on what the TV screens really render: the primary
// facts are on the screen, the technical ones are not until a details control opens them.
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
const { Catalog, Player } = await import('./main');

const wait = (ms = 40) => sleep(ms);
const release = (over = {}) => ({ id: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: 'Alpha.2019.1080p.WEB-DL.DDP5.1.H264-GRP', category: 'Movies HD', sizeBytes: 4_200_000_000, seeders: 77, leechers: 2, freeleech: false, ...over });
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['2160p', '1080p'], categories: [], sourceCount: 5, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], ...over });
const source = (parsed: Partial<CatalogSource['parsed']> = {}): CatalogSource => ({ release: release(), parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H264', audio: 'DDP 5.1', ...parsed }, fileIndex: 0, filePath: 'Alpha.2019.1080p.WEB-DL.mkv', fileSizeBytes: 4_200_000_000 });
const detail = (over: Partial<CatalogTitle> = {}, sources = [source()]): CatalogDetail => ({ title: title(over), seasons: [], sources });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const download = (over: Partial<Download> = {}): Download => ({ id: 'd1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Alpha · S01E02 · Pilot', releaseName: 'Alpha.S01E02.1080p.WEB-DL-GRP', engineId: 'e1', fileIndex: 3, filePath: 'Alpha.S01/Alpha.S01E02.1080p.mkv', mimeType: 'video/x-matroska', sizeBytes: 3_100_000_000, state: 'downloading', progress: 0.41, playbackMode: 'progressive', downloadedBytes: 1, speedBytesPerSecond: 4_200_000, etaSeconds: 720, peers: 14, seeds: 9, leased: false, streamUrl: '/s', createdAt: '2026-10-14T10:00:00Z', parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'series', resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H264' }, ...over });
const job: Job = { id: 'job-8f31a2', kind: 'catalog-sync', state: 'failed', label: 'Fetch latest', dedupeKey: 'k', progress: 0.5, attempt: 2, error: 'tracker timed out', retryable: true, createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:05:00Z' };
const libraryItem = (over: Partial<HouseholdItem> = {}): HouseholdItem => ({ profileId: 'h', sourceId: 's1', releaseId: 'rel-1', fileIndex: 0, filePath: 'Alpha.S01/Alpha.S01E02.1080p.mkv', positionMs: 410, durationMs: 1000, watched: false, updatedAt: '2026-10-14T10:00:00Z', release: release({ name: 'Alpha.S01E02.1080p.WEB-DL-GRP' }), catalog: title({ kind: 'series' }), favorite: false, titleId: 'a', seasonNumber: 1, episodeNumber: 2, ...over });

interface Props { titles?: CatalogTitle[]; household?: HouseholdState; downloads?: Download[]; jobs?: Job[] }
function mount(container: HTMLElement, api: Partial<API> = {}, props: Props = {}) {
  render(
    <Catalog
      api={withETag({ titles: async () => ({ items: props.titles || [], nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: props.jobs || [], nextCursor: null, total: 0 }), ...api } as unknown as API)}
      status="Online"
      titles={props.titles || []}
      facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={props.household || empty}
      downloads={props.downloads || []}
      jobs={props.jobs || []}
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
    />,
    container,
  );
}

describe('TV screens show what helps the next decision', () => {
  let container: HTMLDivElement;
  const text = (selector: string) => container.querySelector(selector)?.textContent ?? '';
  const route = async (name: string) => { container.querySelector<HTMLButtonElement>(`[data-menu-route="${name}"]`)!.click(); await wait(); };
  const key = (focusKey: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="${focusKey}"]`);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('keeps seeders, tracker names and source counts off the hero and the poster cards', async () => {
    mount(container, {}, { titles: [title()] });
    await wait();
    expect(text('.tv-hero')).toContain('Alpha');
    expect(text('.tv-hero')).toContain('Movie · 2019');
    expect(text('.tv-hero')).not.toMatch(/seeders|FileList|\d+ versions?/i);
    expect(text('.poster-card')).toContain('2019 · 2160p');
    expect(text('.poster-card')).not.toMatch(/seeders|FileList|source/i);
  });

  it('gives a title without a year no placeholder', async () => {
    mount(container, {}, { titles: [title({ year: undefined })] });
    await wait();
    expect(container.textContent).not.toMatch(/Year unknown|—/);
    expect(text('.tv-hero .eyebrow')).toBe('Movie');
  });

  it('shows seeders only on the row defined by them', async () => {
    mount(container, {}, { titles: [title()] });
    await route('tracker');
    const rows = Array.from(container.querySelectorAll('.tv-rows section'));
    const named = (heading: string) => rows.find(row => row.querySelector('h2')?.textContent === heading)?.querySelector('.poster-card')?.textContent ?? '';
    expect(named('Recently added')).not.toContain('seeders');
    expect(named('Strong swarms')).toContain('77 seeders');
  });

  it('prints episode code and progress on a continue-watching card, never the release, tracker or path', async () => {
    mount(container, {}, { titles: [title()], household: { ...empty, continueWatching: [libraryItem()] } });
    await wait();
    const card = text('.library-poster-card');
    expect(card).toContain('Alpha');
    expect(card).toContain('S01E02 · 41% watched');
    expect(card).not.toMatch(/FileList|WEB-DL|\.mkv|GRP/);
    expect(container.querySelector('.tv-card-progress')?.getAttribute('aria-label')).toBe('41% watched');
  });

  it('draws no empty rail on Home but explains an empty library route', async () => {
    mount(container, {}, { titles: [title()] });
    await wait();
    expect(container.textContent).not.toContain('Nothing to resume yet');
    await route('continue');
    expect(text('.tv-muted')).toBe('Nothing to resume yet. Start a title and it appears here.');
  });

  it('says what to do when the catalog is empty or a search finds nothing', async () => {
    mount(container, {}, { titles: [] });
    await wait();
    expect(text('.tv-empty h2')).toBe('No titles to show yet');
    expect(text('.tv-empty p')).toMatch(/Refresh/);
    await route('search');
    expect(text('.tv-empty h2')).toBe('Search the catalog');
  });

  it('leads a download with title, state and actions, and keeps the release, path and peers behind Details', async () => {
    mount(container, {}, { titles: [title()], downloads: [download()] });
    await route('downloads');
    const row = () => container.querySelector('.tv-download-row')!.textContent ?? '';
    expect(row()).toContain('Alpha · S01E02 · Pilot');
    expect(row()).toContain('Downloading 41% · 4.2 MB/s · 12 min left');
    expect(row()).toContain('1080p · WEB-DL · H264 · 3.1 GB · FileList · Playable while downloading');
    expect(row()).not.toMatch(/Alpha\.S01E02\.1080p|\.mkv|peers|connected seeds|file 3/);
    key('download-d1-details')!.click();
    await wait();
    expect(row()).toContain('Alpha.S01E02.1080p.WEB-DL-GRP');
    expect(row()).toContain('Alpha.S01/Alpha.S01E02.1080p.mkv (file 3)');
    expect(row()).toContain('9 connected seeds · 14 peers');
    expect(key('download-d1-details')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('draws a long download list in steps after a route change, so the screen opens without a long task', async () => {
    const many = Array.from({ length: 20 }, (_, index) => download({ id: `d${index}`, engineId: `e${index}`, displayTitle: `Title ${index}` }));
    mount(container, {}, { titles: [title()], downloads: many });
    await route('downloads');
    await wait(120);
    expect(container.querySelectorAll('.tv-download-row')).toHaveLength(20);
    expect(container.querySelector('.tv-download-count')!.textContent).toBe('20 downloads');
  });

  it('tells an empty Downloads screen how to fill it', async () => {
    mount(container, {}, { titles: [title()], downloads: [] });
    await route('downloads');
    expect(text('.tv-empty h2')).toBe('No downloads yet');
    expect(text('.tv-download-count')).toBe('');
  });

  it('names a job by what ran and how it ended, with no job id', async () => {
    mount(container, {}, { titles: [title()], jobs: [job] });
    await route('jobs');
    await wait(60);
    const row = text('.tv-list article');
    expect(row).toContain('Fetch latest');
    expect(row).toContain('Failed · tracker timed out');
    expect(row).not.toContain('job-8f31a2');
  });

  it('keeps the connection tests behind a disclosure on Settings', async () => {
    const call = vi.fn(async (path: string) => path === '/settings' ? { preferredAudioLanguage: 'en', preferredSubtitleLanguage: 'ro', fallbackSubtitleLanguage: 'en', watchedThresholdPercent: 90, fileListEnabled: true, pirateBayEnabled: false, downloadEngine: 'native' } : path === '/settings/schema' ? { items: [] } : []);
    mount(container, { call, trackers: async () => [] } as unknown as Partial<API>, { titles: [title()] });
    await route('settings');
    await wait(60);
    expect(container.querySelector('[data-focus-key^="test-"]')).toBeNull();
    const toggle = key('settings-diagnostics')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await wait();
    expect(container.querySelectorAll('[data-focus-key^="test-"]')).toHaveLength(8);
    expect(key('settings-diagnostics')!.getAttribute('aria-expanded')).toBe('true');
  });

  describe('title detail', () => {
    const open = async (data: CatalogDetail) => {
      mount(container, { title: async () => data } as unknown as Partial<API>, { titles: [data.title] });
      await wait();
      key(`hero-${data.title.id}`)!.click();
      await wait();
    };

    it('draws the version row as aligned columns: resolution, Best match slot, quality and codec, size, seeders, tracker, action; the file name is evidence, not a headline', async () => {
      await open(detail());
      const row = container.querySelector('.source-button')!;
      const columns = Array.from(row.querySelector('.source-main')!.children).map(cell => cell.className.split(' ')[0]);
      expect(columns).toEqual(['source-resolution', 'source-best', 'source-quality', 'source-size', 'source-seeders', 'source-tracker', 'source-action']);
      expect(row.querySelector('.source-resolution')?.textContent).toBe('1080p');
      expect(row.querySelector('.source-quality')?.textContent).toBe('WEB-DL · H264');
      expect(row.querySelector('.source-size')?.textContent).toBe('4.2 GB');
      expect(row.querySelector('.source-seeders')?.textContent).toBe('77 seeders');
      expect(row.querySelector('.source-action-label')?.textContent).toBe('Play and download');
      expect(row.querySelector('.source-tracker')?.textContent).toBe('FileList · DDP 5.1');
      expect(row.querySelector('.source-filename')?.textContent).toBe('Alpha.2019.1080p.WEB-DL.mkv');
    });

    it('omits an unknown codec instead of printing a placeholder', async () => {
      await open(detail({}, [source({ videoCodec: undefined })]));
      expect(container.textContent).not.toMatch(/codec unknown/i);
      expect(container.querySelector('.source-quality')?.textContent).toBe('WEB-DL');
    });

    it('moves tracker names off the header and summarises a series by its seasons', async () => {
      await open(detail({ kind: 'series', seasonCount: 3, genres: ['Drama', 'Mystery'] }));
      const header = text('.detail-copy');
      expect(text('.detail-kind')).toBe('3 seasons');
      expect(text('.detail-facts')).toBe('Since 2019·Drama, Mystery');
      expect(header).not.toMatch(/FileList|seeders/);
    });

    it('says what happened and what to press when a title cannot be opened', async () => {
      mount(container, { title: async () => { throw new Error('server returned 503'); } } as unknown as Partial<API>, { titles: [title()] });
      await wait();
      key('hero-a')!.click();
      await wait();
      expect(text('.tv-notice')).toBe('Could not open Alpha: server returned 503. Check the server connection and press OK to try again.');
    });
  });
});

describe('Player heading', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Opening never completes: the heading and the status line do not depend on it.
    (window as unknown as { webapis: unknown }).webapis = { avplay: { open() { }, setDisplayRect() { }, setDisplayMethod() { }, setListener() { }, prepareAsync() { }, stop() { }, close() { } } };
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    delete (window as unknown as { webapis?: unknown }).webapis;
  });

  it('shows the title with its episode code and the current Audio and Subtitles choice, not the file path', async () => {
    const api = { streamURL: (p: string) => p, playbackPreferences: async () => ({ audioLanguage: 'en', audioTrackIndex: 1, subtitleLanguage: 'ro', subtitleMode: 'selected' }), downloads: async () => ({ items: [], nextCursor: null, total: 0 }), updatePlayback: async () => ({}) } as unknown as API;
    render(<Player api={api} download={download()} resumeMs={0} onClose={() => { }} onStateChanged={() => { }} onComplete={() => { }} />, container);
    await wait();
    expect(container.querySelector('.player-title')?.textContent).toBe('Alpha · S01E02 · Pilot');
    expect(container.querySelector('.player-choice')?.textContent).toBe('Audio English · Subtitles Romanian');
    expect(container.querySelector('.player-heading')?.textContent).not.toMatch(/\.mkv|FileList/);
  });
});
