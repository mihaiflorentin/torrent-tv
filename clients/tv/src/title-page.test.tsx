// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { NavSnapshot } from './nav-snapshot';
import type { API, CatalogDetail, CatalogFacets, CatalogSource, CatalogTitle, HouseholdItem, HouseholdState } from '@torrent-tv/shared';
import { withETag } from './test-api';

// Title page behavior on the TV: the primary action targets the best-ranked version, the page opens
// on it, episode tiles show progress. main.tsx bootstraps against #app during module evaluation.
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
// Importing main.tsx boots an App into #app; its key handlers would move focus a second time on every press here.
render(null, appRoot);

const wait = (ms = 40) => sleep(ms);
const release = (id: string, over = {}) => ({ id, trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: `Alpha.${id}`, category: 'Movies HD', sizeBytes: 4_200_000_000, seeders: 50, leechers: 2, freeleech: false, ...over });
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], ...over });
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}, rel = {}, state?: CatalogSource['libraryState']): CatalogSource => ({ release: release(id, rel), parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, fileSizeBytes: 4_200_000_000, libraryState: state });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const resumeItem = (over: Partial<HouseholdItem> = {}): HouseholdItem => ({ profileId: 'h', sourceId: 's1', releaseId: 'rel-1', fileIndex: 0, filePath: 'x.mkv', positionMs: 410, durationMs: 1000, watched: false, updatedAt: '2026-10-14T10:00:00Z', release: release('rel-1'), favorite: false, titleId: 'a', ...over });

function mount(container: HTMLElement, api: Partial<API>, props: { titles: CatalogTitle[]; household?: HouseholdState; onPlay?: (...args: unknown[]) => void; initialNav?: NavSnapshot; onNav?: (snapshot: NavSnapshot) => void; restoreFocus?: string | null }) {
  render(
    <Catalog
      api={withETag({ titles: async () => ({ items: props.titles, nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }), ...api } as unknown as API)}
      status="Online"
      titles={props.titles}
      facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={props.household || empty}
      downloads={[]}
      jobs={[]}
      restoreFocus={props.restoreFocus ?? null}
      initialNav={props.initialNav}
      onNav={props.onNav}
      portal={null}
      updateStatus={null}
      onUpdateStatus={() => { }}
      onFocus={() => { }}
      onRetry={() => { }}
      onChangeServer={() => { }}
      onForgetServer={() => { }}
      onPlay={props.onPlay || (() => { })}
      onPlayDownload={() => { }}
      onManageDownload={async () => { }}
      onManageSeasonPack={async () => { }}
      onRefreshDownloads={async () => { }}
      onFavorite={() => { }}
    />,
    container,
  );
}

describe('TV title page', () => {
  let container: HTMLDivElement;
  const key = (focusKey: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="${focusKey}"]`);
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); });
  const open = async (data: CatalogDetail, household?: HouseholdState, onPlay?: (...args: unknown[]) => void) => {
    mount(container, { title: async () => data } as unknown as Partial<API>, { titles: [data.title], household, onPlay });
    await wait();
    key(`hero-${data.title.id}`)!.click();
    await wait();
  };

  describe('backdrop art', () => {
    const layer = () => container.querySelector<HTMLElement>('.detail-screen .tv-backdrop-art.on');
    const root = () => container.querySelector('.detail-screen .tv-backdrop')!;

    it('shows the title backdrop sharp, not the blurred follow-focus layer', async () => {
      await open({ title: title({ backdropUrl: '/art/back.jpg', posterUrl: '/art/poster.jpg' }), seasons: [], sources: [source('only')] });
      expect(root().classList.contains('sharp')).toBe(true);
      expect(root().classList.contains('poster-only')).toBe(false);
      expect(layer()?.style.backgroundImage).toContain('/art/back.jpg');
    });

    it('falls back to the poster, placed rather than stretched, when there is no backdrop', async () => {
      await open({ title: title({ posterUrl: '/art/poster.jpg' }), seasons: [], sources: [source('only')] });
      expect(root().classList.contains('poster-only')).toBe(true);
      expect(layer()?.style.backgroundImage).toContain('/art/poster.jpg');
    });

    it('keeps the designed fallback for a title with no artwork', async () => {
      await open({ title: title(), seasons: [], sources: [source('only')] });
      expect(root().classList.contains('sharp')).toBe(true);
      expect(layer()?.style.backgroundImage ?? '').toBe('');
    });
  });

  describe('best version Play', () => {
    const movie = (): CatalogDetail => ({ title: title(), seasons: [], sources: [
      source('newest-720p', { resolution: '720p' }, { seeders: 90 }),
      source('best-1080p', { resolution: '1080p' }, { seeders: 12 }),
      source('cam', { resolution: '1080p', quality: 'HDCAM' }, { seeders: 500, name: 'Alpha.HDCAM' }),
    ] });

    it('prepares the top-ranked version exactly once, not the first in server order', async () => {
      const onPlay = vi.fn();
      await open(movie(), undefined, onPlay);
      const play = key('detail-playback')!;
      expect(play.textContent).toBe('Play and download · 1080p WEB-DL');
      play.click();
      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 'best-1080p' });
    });

    it('keeps the full version list and a Choose version control reachable', async () => {
      await open(movie());
      expect(container.querySelectorAll('.source-button')).toHaveLength(3);
      const choose = key('detail-versions')!;
      expect(choose.textContent).toBe('Choose version');
      choose.click();
      await wait();
      expect(document.activeElement).toBe(container.querySelector('.source-button'));
    });

    it('plays the first episode of the selected season with the best version of that episode', async () => {
      const episode = (season: number, sources: CatalogSource[]) => ({ number: 1, title: 'Pilot', season, sourceCount: sources.length, sources });
      const data: CatalogDetail = { title: title({ kind: 'series' }), sources: [], seasons: [
        { number: 1, title: 'Season 1', episodeCount: 1, episodes: [episode(1, [source('s1', {}, {})])] },
        { number: 2, title: 'Season 2', episodeCount: 1, episodes: [episode(2, [source('s2-720', { resolution: '720p' }), source('s2-1080', { resolution: '1080p' })])] },
      ] };
      const onPlay = vi.fn();
      await open(data, undefined, onPlay);
      key('season-2')!.click();
      await wait();
      key('detail-playback')!.click();
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's2-1080' });
    });

    it('still lets Resume win over Play', async () => {
      const onPlay = vi.fn();
      const household: HouseholdState = { ...empty, continueWatching: [resumeItem()] };
      await open(movie(), household, onPlay);
      expect(key('detail-playback')!.textContent).toBe('Resume from 0:00');
      expect(key('detail-playback')!.getAttribute('aria-label')).toBe('Resume from 0:00');
    });
  });

  describe('the action row, More and Back', () => {
    const press = (name: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode, bubbles: true, cancelable: true }));
    const back = () => { for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); };
    const focused = () => (document.activeElement as HTMLElement).dataset.focusKey;
    const movie = (state?: CatalogSource['libraryState']): CatalogDetail => ({ title: title(), seasons: [], sources: [
      source('best', { resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H.264' }, { seeders: 312 }, state),
      source('other', { resolution: '720p', quality: 'WEBRip' }, { seeders: 41, sizeBytes: 1_900_000_000 }, undefined),
    ] });
    // happy-dom has no layout: the D-pad sees only elements with a size.
    beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100); vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40); });
    afterEach(() => vi.restoreAllMocks());
    const openMovie = async (over: Partial<API> = {}, household?: HouseholdState, state?: CatalogSource['libraryState']) => {
      mount(container, { title: async () => movie(state), ...over } as unknown as Partial<API>, { titles: [title()], household });
      await wait();
      key('hero-a')!.click();
      await wait();
    };

    it('holds the primary, Choose version, My List, Info and More in one row, in that order, with Refresh data off the page', async () => {
      await openMovie();
      const row = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-row="1"][data-focus-region="content"]')).map(button => button.dataset.focusKey);
      expect(row).toEqual(['detail-playback', 'detail-versions', 'detail-favorite', 'detail-info', 'detail-more']);
      expect(key('detail-refresh')).toBeNull();
      expect(container.textContent).not.toContain('Refresh data');
      expect(key('detail-favorite')!.getAttribute('aria-label')).toBe('Add to My List');
      expect(key('detail-info')!.getAttribute('aria-label')).toBe('Info');
      expect(key('detail-more')!.getAttribute('aria-label')).toBe('More: Refresh data');
    });

    it('names the Best version on Play and says under the row what it will play', async () => {
      await openMovie();
      expect(key('detail-playback')!.textContent).toBe('Play and download · 1080p WEB-DL');
      expect(container.querySelector('.detail-plays')!.textContent).toBe('Plays the Best match: 1080p WEB-DL · 4.2 GB');
    });

    it('says Resume with the saved position, and what it resumes', async () => {
      await openMovie({}, { ...empty, continueWatching: [resumeItem({ release: release('best'), positionMs: 1_880_000, durationMs: 6_000_000 })] }, { downloadState: 'downloaded', watchState: 'inProgress' });
      expect(key('detail-playback')!.textContent).toBe('Resume from 31:20');
      expect(key('detail-playback')!.getAttribute('aria-label')).toBe('Resume from 31:20');
      expect(container.querySelector('.detail-plays')!.textContent).toBe('Plays 1080p WEB-DL · 4.2 GB · Downloaded');
    });

    it('lays the facts on the art: kind, date, runtime, genres, rating and certification, with no boxed header', async () => {
      const titleInfo = vi.fn(async () => ({ titleId: 'a', available: true, runtimeMinutes: 124, certification: 'PG-13' }));
      mount(container, { title: async () => ({ ...movie(), title: title({ releaseDate: '2022-09-14', genres: ['Drama', 'Mystery', 'Crime', 'War'], rating: 7.8, ratingVotes: 900 }) }), titleInfo } as unknown as Partial<API>, { titles: [title()] });
      await wait();
      key('hero-a')!.click();
      await wait(500);
      expect(container.querySelector('.detail-kind')!.textContent).toBe('Movie');
      expect(container.querySelector('.detail-facts')!.textContent).toBe('Sep 14, 2022·2 h 4 min·Drama, Mystery, Crime·7.8·PG-13');
      expect(container.querySelector('.detail-facts [aria-label="Rated 7.8"]')).not.toBeNull();
      expect(titleInfo).toHaveBeenCalledTimes(1);
      key('detail-info')!.click();
      await wait();
      expect(titleInfo).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.info-panel')!.textContent).toContain('2 h 4 min');
    });

    it('walks the row with Left and Right, and Choose version moves focus to the first version', async () => {
      await openMovie();
      for (const expected of ['detail-versions', 'detail-favorite', 'detail-info', 'detail-more', 'detail-more']) { press('ArrowRight', 39); await wait(20); expect(focused()).toBe(expected); }
      key('detail-versions')!.focus();
      key('detail-versions')!.click();
      await wait();
      expect(focused()).toBe('source-best-0');
      press('ArrowUp', 38);
      await wait(20);
      expect(focused()).toBe('detail-playback');
    });

    it('opens More on its own focus region with Refresh data, and Back returns to More', async () => {
      await openMovie();
      key('detail-more')!.focus();
      key('detail-more')!.click();
      await wait();
      const sheet = container.querySelector<HTMLElement>('[role="dialog"].tv-more')!;
      expect(sheet.getAttribute('aria-modal')).toBe('true');
      expect(focused()).toBe('more-refresh');
      expect(Array.from(sheet.querySelectorAll<HTMLElement>('[data-focus-key]')).every(stop => stop.dataset.focusRegion === 'more-menu')).toBe(true);
      press('ArrowDown', 40);
      await wait(20);
      expect(focused()).toBe('more-close');
      press('ArrowDown', 40);
      await wait(20);
      expect(focused()).toBe('more-close');
      press('ArrowLeft', 37);
      await wait(20);
      expect(focused()).toBe('more-close');
      back();
      await wait();
      expect(container.querySelector('.tv-more')).toBeNull();
      expect(container.querySelector('.detail-screen')).not.toBeNull();
      expect(focused()).toBe('detail-more');
    });

    it('runs Refresh data from More once, and Close returns to More', async () => {
      const refreshTitle = vi.fn(async () => ({}));
      await openMovie({ refreshTitle } as unknown as Partial<API>);
      key('detail-more')!.click();
      await wait();
      key('more-refresh')!.click();
      await wait();
      expect(refreshTitle).toHaveBeenCalledTimes(1);
      expect(refreshTitle).toHaveBeenCalledWith('a', 'Alpha', true);
      key('more-close')!.click();
      await wait();
      expect(container.querySelector('.tv-more')).toBeNull();
      expect(focused()).toBe('detail-more');
    });

    it('shows a failed refresh in the sheet, in one sentence', async () => {
      await openMovie({ refreshTitle: async () => { throw new Error('server returned 503') } } as unknown as Partial<API>);
      key('detail-more')!.click();
      await wait();
      key('more-refresh')!.click();
      await wait();
      expect(container.querySelector('.tv-more [role="alert"]')!.textContent).toBe('server returned 503');
    });

    it('closes the page on Back, and on the on-screen Back, onto the card it was opened from', async () => {
      await openMovie();
      back();
      await wait();
      expect(container.querySelector('.detail-screen')).toBeNull();
      expect(focused()).toBe('hero-a');
      key('hero-a')!.click();
      await wait();
      key('detail-back')!.click();
      await wait();
      expect(container.querySelector('.detail-screen')).toBeNull();
      expect(focused()).toBe('hero-a');
    });
  });

  describe('opening focus, resume season and episode progress', () => {
    const episode = (season: number, number: number, state?: CatalogSource['libraryState']) => ({ number, title: `Episode ${number}`, season, sourceCount: 1, sources: [source(`s${season}e${number}`)], libraryState: state });
    const series = (): CatalogDetail => ({ title: title({ kind: 'series' }), sources: [], seasons: [
      { number: 1, title: 'Season 1', episodeCount: 1, episodes: [episode(1, 1)] },
      { number: 2, title: 'Season 2', episodeCount: 3, episodes: [
        episode(2, 1, { downloadState: 'downloaded', watchState: 'watched', positionMs: 900, durationMs: 1000 }),
        episode(2, 2, { downloadState: 'downloaded', watchState: 'inProgress', positionMs: 410, durationMs: 1000 }),
        episode(2, 3),
      ] },
    ] });

    it('opens focused on Play, with Back reachable above it and the row order unchanged', async () => {
      await open({ title: title(), seasons: [], sources: [source('only')] });
      expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('detail-playback');
      const rows = ['detail-back', 'detail-playback', 'detail-versions', 'detail-favorite', 'detail-info', 'detail-more'].map(name => [name, key(name)!.dataset.focusRow, key(name)!.dataset.focusCol]);
      expect(rows).toEqual([['detail-back', '0', '0'], ['detail-playback', '1', '0'], ['detail-versions', '1', '1'], ['detail-favorite', '1', '2'], ['detail-info', '1', '4'], ['detail-more', '1', '5']]);
    });

    it('opens focused on Resume when there is saved progress', async () => {
      await open({ title: title(), seasons: [], sources: [source('only')] }, { ...empty, continueWatching: [resumeItem()] });
      expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('detail-playback');
    });

    it('falls to Favorite when there is nothing to play, never to Back', async () => {
      await open({ title: title(), seasons: [], sources: [] });
      expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('detail-favorite');
      expect(key('detail-back')).not.toBeNull();
    });

    it('opens the season of the saved progress', async () => {
      await open(series(), { ...empty, continueWatching: [resumeItem({ seasonNumber: 2, episodeNumber: 2 })] });
      expect(key('season-2')!.className).toContain('active');
      expect(key('episode-2:2')).not.toBeNull();
    });

    it('opens the first season without saved progress', async () => {
      await open(series());
      expect(key('season-1')!.className).toContain('active');
    });

    it('shows a progress bar and percent only on an episode that is in progress', async () => {
      await open(series(), { ...empty, continueWatching: [resumeItem({ seasonNumber: 2, episodeNumber: 2 })] });
      const tile = (name: string) => key(`episode-${name}`)!;
      expect(tile('2:2').querySelector('.episode-progress b')!.getAttribute('style')).toContain('width: 41%');
      expect(tile('2:2').textContent).toContain('41% watched');
      expect(tile('2:1').querySelector('.episode-progress')).toBeNull();
      expect(tile('2:3').querySelector('.episode-progress')).toBeNull();
    });
  });

  describe('return to where you were (initialNav)', () => {
    const nav = (over: Partial<NavSnapshot> = {}): NavSnapshot => ({ route: 'home', titleId: '', titleName: '', target: {}, query: '', category: '', sort: 'newest', focusKey: '', ...over });
    const movie = (): CatalogDetail => ({ title: title(), seasons: [], sources: [source('only')] });

    it('reopens the title page from a fresh fetch, focused on Play, with Resume reflecting the new position', async () => {
      const fetchTitle = vi.fn(async () => movie());
      mount(container, { title: fetchTitle } as unknown as Partial<API>, { titles: [title()], initialNav: nav({ titleId: 'a', titleName: 'Alpha' }), household: { ...empty, continueWatching: [resumeItem({ positionMs: 900 })] } });
      await wait(80);
      expect(fetchTitle).toHaveBeenCalledWith('a');
      expect(key('detail-playback')!.textContent).toBe('Resume from 0:00');
      expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('detail-playback');
    });

    it('reopens the saved episode target of a series', async () => {
      const ep = (n: number) => ({ number: n, title: `Episode ${n}`, season: 2, sourceCount: 1, sources: [source(`e${n}`)] });
      const data: CatalogDetail = { title: title({ kind: 'series' }), sources: [], seasons: [{ number: 1, title: 'S1', episodeCount: 1, episodes: [{ ...ep(1), season: 1 }] }, { number: 2, title: 'S2', episodeCount: 2, episodes: [ep(1), ep(2)] }] };
      mount(container, { title: async () => data } as unknown as Partial<API>, { titles: [title()], initialNav: nav({ titleId: 'a', titleName: 'Alpha', target: { season: 2, episode: 2 } }) });
      await wait(80);
      expect(key('season-2')!.className).toContain('active');
      expect(key('episode-2:2')!.getAttribute('aria-current')).toBe('true');
    });

    it('restores the list route and focuses the saved card when it is still there', async () => {
      // happy-dom has no layout, so every element reports a zero size and focus restore sees nothing visible.
      const size = { configurable: true, get: () => 100 };
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', size);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', size);
      try {
        mount(container, {}, { titles: [title()], household: { ...empty, continueWatching: [resumeItem()] }, initialNav: nav({ route: 'continue', focusKey: 'library-a-0-0-0' }), restoreFocus: 'library-a-0-0-0' });
        await wait(80);
        expect(container.querySelector('.tv-top h1')!.textContent).toBe('Continue watching');
        expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('library-a-0-0-0');
      } finally {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
    });

    it('restores the search query and its cache results', async () => {
      const titles = vi.fn(async () => ({ items: [title()], nextCursor: null, total: 1 }));
      mount(container, { titles } as unknown as Partial<API>, { titles: [title()], initialNav: nav({ route: 'search', query: 'alpha', sort: 'rating', category: 'Movies' }) });
      await wait(80);
      expect((container.querySelector('[data-focus-key="search-input"]') as HTMLInputElement).value).toBe('alpha');
      expect(titles).toHaveBeenCalledWith(expect.objectContaining({ search: 'alpha', sort: 'rating', category: 'Movies' }));
    });

    it('falls back to the route list with the usual notice when the title cannot be reopened', async () => {
      mount(container, { title: async () => { throw new Error('server returned 503'); } } as unknown as Partial<API>, { titles: [title()], initialNav: nav({ titleId: 'a', titleName: 'Alpha' }) });
      await wait(80);
      expect(container.querySelector('.tv-notice')!.textContent).toBe('Could not open Alpha: server returned 503. Check the server connection and press OK to try again.');
      expect(key('hero-a')).not.toBeNull();
    });

    it('starts on Home as before when there is no initialNav', async () => {
      mount(container, {}, { titles: [title()] });
      await wait(80);
      expect(container.querySelector('.tv-top h1')!.textContent).toBe('Home');
      expect(key('detail-playback')).toBeNull();
    });

    it('reports where the viewer is as they navigate', async () => {
      const onNav = vi.fn();
      mount(container, { title: async () => movie() } as unknown as Partial<API>, { titles: [title()], onNav });
      await wait();
      key('hero-a')!.click();
      await wait();
      const last = onNav.mock.calls[onNav.mock.calls.length - 1][0] as NavSnapshot;
      expect(last).toMatchObject({ route: 'home', titleId: 'a', titleName: 'Alpha', query: '' });
    });
  });

  describe('series detail poll', () => {
    const series = (name = 'Alpha'): CatalogDetail => ({ title: title({ kind: 'series', title: name }), sources: [], seasons: [{ number: 1, title: 'Season 1', episodeCount: 1, episodes: [{ number: 1, title: 'Pilot', season: 1, sourceCount: 1, sources: [source('s1')] }] }] });
    afterEach(() => vi.useRealTimers());

    it('sends the last ETag; a 304 does not re-render the screen or move focus, a new ETag does', async () => {
      let current = { detail: series(), etag: '"e1"' };
      const titleIfChanged = vi.fn(async (_id: string, etag: string) => etag === current.etag ? null : current);
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      mount(container, { titleIfChanged } as unknown as Partial<API>, { titles: [title({ kind: 'series' })] });
      await wait();
      key('hero-a')!.click();
      await wait();
      expect(titleIfChanged).toHaveBeenLastCalledWith('a', '');
      const screen = container.querySelector('.detail-screen')!;
      const focused = document.activeElement;
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(titleIfChanged).toHaveBeenCalledTimes(3);
      expect(titleIfChanged).toHaveBeenLastCalledWith('a', '"e1"');
      expect(container.querySelector('.detail-screen')).toBe(screen);
      expect(document.activeElement).toBe(focused);
      current = { detail: series('Alpha Reloaded'), etag: '"e2"' };
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(titleIfChanged).toHaveBeenLastCalledWith('a', '"e2"');
      expect(container.textContent).toContain('Alpha Reloaded');
    });
  });
});
