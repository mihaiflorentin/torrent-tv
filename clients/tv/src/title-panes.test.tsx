// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { NavSnapshot } from './nav-snapshot';
import type { API, CatalogDetail, CatalogEpisode, CatalogFacets, CatalogSource, CatalogTitle, HouseholdItem, HouseholdState } from '@torrent-tv/shared';

// The series title page on the TV: the season bar on top, then either the episode list or, after OK on an episode,
// that episode's full-width Versions view. These tests drive the D-pad (keydown on the focused element) and pin every move.
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
// main.tsx boots the real App into #app; its Setup screen listens for the same keys, so take it down.
render(null, appRoot);

const wait = (ms = 30) => sleep(ms);
const release = (id: string, over = {}) => ({ id, trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: `Show.${id}`, category: 'TV HD', sizeBytes: 1_200_000_000, seeders: 50, leechers: 2, freeleech: false, ...over });
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}): CatalogSource => ({ release: release(id), parsed: { title: 'Show', sortTitle: 'show', kind: 'series', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, fileSizeBytes: 1_200_000_000 });
const series: CatalogTitle = { id: 'show', title: 'Show', kind: 'series', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], overview: 'A series overview.', backdropUrl: '/art/backdrop.jpg' };
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const resumeItem = (over: Partial<HouseholdItem> = {}): HouseholdItem => ({ profileId: 'h', sourceId: 's1', releaseId: 'rel-1', fileIndex: 0, filePath: 'x.mkv', positionMs: 410, durationMs: 1000, watched: false, updatedAt: '2026-10-14T10:00:00Z', release: release('rel-1'), favorite: false, titleId: 'show', ...over });

// Every episode has a 720p and a 1080p version, listed worst first so ranking has to reorder them.
const episode = (season: number, number: number, over: Partial<CatalogEpisode> = {}): CatalogEpisode => ({
  number, title: `Episode ${number}`, season, sourceCount: 2,
  sources: [source(`s${season}e${number}-720`, { resolution: '720p' }), source(`s${season}e${number}-1080`, { resolution: '1080p' })],
  ...over,
});
const watched = { downloadState: 'downloaded', watchState: 'watched', positionMs: 900, durationMs: 1000 } as const;
const pack = (id: string): CatalogSource => ({ ...source(id, { seasonStart: 2, seasonEnd: 2 }), libraryState: undefined });
const detail = (over: { unknown?: CatalogEpisode[]; packs?: CatalogSource[]; s2?: CatalogEpisode[] } = {}): CatalogDetail => ({
  title: series, sources: [], seasons: [
    { number: 1, title: 'Season 1', episodeCount: 2, episodes: [episode(1, 1), episode(1, 2)] },
    { number: 2, title: 'Season 2', episodeCount: 5, episodes: over.s2 || [1, 2, 3, 4, 5].map(n => episode(2, n, n <= 2 ? { libraryState: watched } : {})), unknown: over.unknown, packSources: over.packs },
    { number: 3, title: 'Season 3', episodeCount: 2, episodes: [episode(3, 1), episode(3, 2)] },
  ],
});

type MountProps = { seasonInfo?: (id: string, season: number) => Promise<unknown>; household?: HouseholdState; onPlay?: (...args: unknown[]) => void; initialNav?: NavSnapshot; onNav?: (snapshot: NavSnapshot) => void };
function mount(container: HTMLElement, data: () => CatalogDetail, props: MountProps = {}) {
  render(
    <Catalog
      api={{ titles: async () => ({ items: [series], nextCursor: null, total: 0 }), title: async () => data(), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }), ...(props.seasonInfo ? { seasonInfo: props.seasonInfo } : {}) } as unknown as API}
      status="Online"
      titles={[series]}
      facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={props.household || empty}
      downloads={[]}
      jobs={[]}
      restoreFocus={null}
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
      initialNav={props.initialNav}
      onNav={props.onNav}
    />,
    container,
  );
}

describe('TV series page: episode list, then full-screen Versions', () => {
  let container: HTMLDivElement;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)!;
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  const header = () => container.querySelector('.versions-view .versions-title')?.textContent;
  const versions = () => Array.from(container.querySelectorAll<HTMLElement>('.versions-view .source-button'));
  const selectedEpisode = () => container.querySelector('.episode-tile.selected')?.getAttribute('data-focus-key');
  const listShown = () => container.querySelector('.episode-pane') !== null;
  // One remote press: a keydown on whatever has focus, then the settle time of a render.
  const press = async (name: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'GoBack', settle = 30) => {
    const target = (document.activeElement as HTMLElement) || document.body;
    const keyCodes: Record<string, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, GoBack: 10009 };
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode: keyCodes[name], bubbles: true, cancelable: true }));
    // Back acts on key release in the app (a long press exits), so a real press is down then up.
    if (name === 'GoBack') target.dispatchEvent(new KeyboardEvent('keyup', { key: name, keyCode: keyCodes[name], bubbles: true, cancelable: true }));
    await wait(settle);
  };
  const open = async (data: () => CatalogDetail, props: MountProps = {}) => {
    mount(container, data, props);
    await wait();
    if (!props.initialNav) key('hero-show').click();
    await wait(60);
  };
  // Season 2 with the cursor on an episode, then OK: the Versions view of that episode.
  const openVersions = async (episodeKey: string, data: () => CatalogDetail = () => detail({}), props: MountProps = {}) => {
    await open(data, props);
    key('season-2').click();
    await wait();
    key(episodeKey).focus();
    await press('Enter');
  };
  beforeEach(() => {
    // happy-dom has no layout, so every element reports a zero size and the D-pad sees nothing visible.
    const size = { configurable: true, get: () => 100 };
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', size);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', size);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  });

  describe('the episode list', () => {
    it('opens with the first unwatched episode selected, the list shown and no Versions view', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      expect(selectedEpisode()).toBe('episode-2:3');
      expect(listShown()).toBe(true);
      expect(container.querySelector('.versions-view')).toBeNull();
      expect(container.querySelector('.episode-pane .source-button')).toBeNull();
    });

    it('focusing another episode moves the selection after a short pause, not on every pass', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:4').focus();
      await wait(40);
      expect(selectedEpisode()).toBe('episode-2:3');
      await wait(200);
      expect(selectedEpisode()).toBe('episode-2:4');
    });

    it('changing season selects that season\'s first unwatched episode', async () => {
      await open(() => detail({}));
      key('season-3').click();
      await wait();
      expect(selectedEpisode()).toBe('episode-3:1');
    });

    it('opens on the episode of the saved progress', async () => {
      await open(() => detail({}), { household: { ...empty, continueWatching: [resumeItem({ seasonNumber: 2, episodeNumber: 2 })] } });
      expect(selectedEpisode()).toBe('episode-2:2');
    });

    it('Left does nothing and Down from the last episode stays put', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:5').focus();
      await press('ArrowLeft');
      expect(focused()).toBe('episode-2:5');
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:5');
      expect(listShown()).toBe(true);
    });
  });

  describe('OK or Right on an episode', () => {
    it('opens the full-screen Versions view headed with season, episode and name; the list is hidden', async () => {
      const onPlay = vi.fn();
      await openVersions('episode-2:4', () => detail({}), { onPlay });
      expect(header()).toBe('Versions · S02 · E04 · Episode 4');
      expect(listShown()).toBe(false);
      expect(container.querySelector('.episode-tile')).toBeNull();
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('puts the Best match first, marked, and focuses it', async () => {
      await openVersions('episode-2:3');
      expect(versions().map(row => row.dataset.focusKey)).toEqual(['source-s2e3-1080-0', 'source-s2e3-720-0']);
      expect(versions()[0].querySelector('.source-best')!.textContent).toBe('Best match');
      expect(versions()[1].querySelector('.source-best')).toBeNull();
      expect(focused()).toBe('source-s2e3-1080-0');
    });

    it('Right opens it the same way, even straight after moving to the episode', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:5').focus();
      await press('ArrowRight', 5);
      await wait(60);
      expect(header()).toBe('Versions · S02 · E05 · Episode 5');
      expect(focused()).toBe('source-s2e5-1080-0');
    });

    it('Choose version on the hero opens the Versions view of the target episode', async () => {
      await open(() => detail({}));
      key('detail-versions').focus();
      await press('Enter');
      expect(header()).toBe('Versions · S01 · E01 · Episode 1');
      expect(focused()).toBe('source-s1e1-1080-0');
    });
  });

  describe('inside Versions', () => {
    it('OK on a version plays it', async () => {
      const onPlay = vi.fn();
      await openVersions('episode-2:3', () => detail({}), { onPlay });
      await press('ArrowDown');
      await press('Enter');
      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's2e3-720' });
    });

    it('Left returns to the list with the episode Versions was opened from focused and selected', async () => {
      await openVersions('episode-2:4');
      await press('ArrowLeft');
      expect(listShown()).toBe(true);
      expect(container.querySelector('.versions-view')).toBeNull();
      expect(focused()).toBe('episode-2:4');
      expect(selectedEpisode()).toBe('episode-2:4');
    });

    it('Back pops Versions to the list first, and only a second Back leaves the page', async () => {
      await openVersions('episode-2:4');
      await press('GoBack');
      expect(focused()).toBe('episode-2:4');
      expect(container.querySelector('.detail-screen')).not.toBeNull();
      await press('GoBack');
      expect(container.querySelector('.detail-screen')).toBeNull();
    });

    it('moves Up and Down through the rows and stays put at the ends', async () => {
      await openVersions('episode-2:5');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e5-720-0');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e5-720-0');
      await press('ArrowRight');
      expect(focused()).toBe('source-s2e5-720-0');
      await press('ArrowUp');
      expect(focused()).toBe('source-s2e5-1080-0');
    });

    it('Up from the first row reaches the season bar; Down returns to the first row', async () => {
      await openVersions('episode-2:3');
      await press('ArrowUp');
      expect(focused()).toBe('season-2');
      expect(header()).toBe('Versions · S02 · E03 · Episode 3');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e3-1080-0');
    });

    it('OK on a season tab leaves Versions for that season\'s list', async () => {
      await openVersions('episode-2:3');
      await press('ArrowUp');
      await press('ArrowRight');
      expect(focused()).toBe('season-3');
      await press('Enter');
      expect(container.querySelector('.versions-view')).toBeNull();
      expect(selectedEpisode()).toBe('episode-3:1');
    });

    it('says so when the episode has no versions yet, and Back still returns to the list', async () => {
      const bare = () => detail({ s2: [1, 2, 3].map(n => episode(2, n, { sources: [], sourceCount: 0 })) });
      await openVersions('episode-2:2', bare);
      expect(container.querySelector('.versions-empty')!.textContent).toBe('No versions of this episode yet.');
      expect(focused()).toBe('season-2');
      await press('GoBack');
      expect(focused()).toBe('episode-2:2');
    });
  });

  describe('the Info look: episode rows and the episode block', () => {
    const season2 = (over: Record<string, unknown> = {}) => ({ available: true, number: 2, episodes: [{ number: 4, name: 'Lotus', runtimeMinutes: 55, rating: 8.5, overview: 'They land.', stillUrl: '/still-4.jpg', directors: ['D. Director'] }], ...over });
    const rowOf = (episodeKey: string) => key(`episode-${episodeKey}`);

    it('draws each episode as one row: still, code and name, a facts line and the chevron, with no extra controls', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      const row = rowOf('2:4');
      expect(row.querySelector('.info-row-copy b')!.textContent).toBe('E04 · Episode 4');
      expect(row.querySelector('.info-chevron')!.textContent).toBe('›');
      expect(row.querySelector('.info-still-small')).not.toBeNull();
      expect(row.querySelectorAll('button, a, input')).toHaveLength(0);
    });

    it('shows the title\'s own backdrop as the still when there is no detailed info, and never errors', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      expect(rowOf('2:3').querySelector('.info-still-small img')!.getAttribute('src')).toBe('/art/backdrop.jpg');
    });

    it('fetches the season info once, after the page is up, and adds the still and facts without moving focus', async () => {
      const seasonInfo = vi.fn(async () => season2());
      await open(() => detail({}), { seasonInfo });
      key('season-2').click();
      await wait(600);
      expect(seasonInfo).toHaveBeenCalledTimes(1);
      expect(seasonInfo).toHaveBeenCalledWith('show', 2);
      key('episode-2:4').focus();
      await wait(200);
      expect(rowOf('2:4').querySelector('.info-still-small img')!.getAttribute('src')).toBe('/still-4.jpg');
      expect(rowOf('2:4').querySelector('.info-row-copy small')!.textContent).toContain('55 min');
      expect(focused()).toBe('episode-2:4');
      key('episode-2:3').focus();
      key('episode-2:5').focus();
      await wait(300);
      expect(seasonInfo).toHaveBeenCalledTimes(1);
    });

    it('a failing or empty season info leaves the list as it was', async () => {
      const seasonInfo = vi.fn(async () => { throw new Error('offline') });
      await open(() => detail({}), { seasonInfo });
      key('season-2').click();
      await wait(600);
      expect(rowOf('2:4').querySelector('.info-row-copy small')!.textContent).toBe('2 versions');
      expect(container.querySelector('.info-skeleton, [role="status"]')).toBeNull();
    });

    it('the Versions view opens with the Info episode block: crumbs, still, facts, synopsis and credits above the versions', async () => {
      const seasonInfo = async () => season2();
      await open(() => detail({}), { seasonInfo });
      key('season-2').click();
      await wait(600);
      key('episode-2:4').focus();
      await press('Enter');
      const view = container.querySelector('.versions-view')!;
      expect(view.querySelector('.info-crumbs')!.textContent).toBe('Show › Season 2 › E04');
      expect(view.querySelector('.info-still img')!.getAttribute('src')).toBe('/still-4.jpg');
      expect(view.querySelector('.info-meta')!.textContent).toBe('S02E04 · 55 min · 8.5 / 10');
      expect(view.querySelector('.info-episode-title')!.textContent).toBe('Episode 4');
      expect(view.querySelector('.info-overview')!.textContent).toBe('They land.');
      expect(view.querySelector('.info-credit-line')!.textContent).toBe('Director D. Director');
      expect(view.querySelector('.info-subheading')!.textContent).toBe('Choose a version');
      expect(view.querySelectorAll('[data-focus-key]')).toHaveLength(2);
    });

    it('without detailed info the episode block still has a code, the backdrop and the series overview, and no empty box', async () => {
      await openVersions('episode-2:4');
      const view = container.querySelector('.versions-view')!;
      expect(view.querySelector('.info-meta')!.textContent).toBe('S02E04');
      expect(view.querySelector('.info-still img')!.getAttribute('src')).toBe('/art/backdrop.jpg');
      expect(view.querySelector('.info-overview')!.textContent).toBe('A series overview.');
      expect(view.querySelector('.info-credit-line')).toBeNull();
    });

    it('Unknown episodes and season packs get no episode block', async () => {
      const unknown = [episode(2, 0, { title: 'Loose file', sources: [source('loose', {})], sourceCount: 1 })];
      await open(() => detail({ unknown }));
      key('season-2').click();
      await wait();
      key('unknown-2').focus();
      await press('Enter');
      expect(container.querySelector('.versions-view .info-episode-title')).toBeNull();
      expect(container.querySelector('.versions-view .info-crumbs')!.textContent).toBe('Show › Season 2 › Unknown episodes');
    });
  });

  describe('hero and season bar', () => {
    it('keep their rows and columns, and Down from the hero reaches the bar', async () => {
      await open(() => detail({}));
      const at = (name: string) => [name, key(name).dataset.focusRow, key(name).dataset.focusCol];
      expect(['detail-back', 'detail-playback', 'detail-versions', 'detail-favorite', 'detail-refresh', 'detail-info', 'season-1', 'season-2', 'season-3'].map(at)).toEqual([
        ['detail-back', '0', '0'], ['detail-playback', '1', '0'], ['detail-versions', '1', '1'], ['detail-favorite', '1', '2'], ['detail-refresh', '1', '3'], ['detail-info', '1', '4'],
        ['season-1', '2', '0'], ['season-2', '2', '1'], ['season-3', '2', '2'],
      ]);
      expect(focused()).toBe('detail-playback');
      await press('ArrowDown');
      expect(focused()).toBe('season-1');
    });

    it('Up from the first episode goes to the season bar; Down returns to the selected episode', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:1').focus();
      await wait(200);
      await press('ArrowUp');
      expect(focused()).toBe('season-2');
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:1');
    });
  });

  describe('complete season packs and unknown episodes', () => {
    it('lists the season packs under the versions, always open, with their actions as plain stops', async () => {
      await openVersions('episode-2:3', () => detail({ packs: [pack('pack-1')] }));
      expect(container.querySelector('.versions-view .season-pack-downloads h4')!.textContent).toBe('Complete season');
      expect(container.querySelector('[aria-expanded]')).toBeNull();
      await press('ArrowDown');
      await press('ArrowDown');
      expect(focused()).toBe('season-pack-pack-1-download');
      await press('ArrowUp');
      expect(focused()).toBe('source-s2e3-720-0');
      await press('ArrowDown');
      await press('ArrowLeft');
      expect(listShown()).toBe(true);
      expect(focused()).toBe('episode-2:3');
    });

    it('shows the packs of a season whose episodes are not listed yet, without a list to go back to', async () => {
      const packsOnly = () => detail({ packs: [pack('pack-1')], s2: [] });
      await open(packsOnly);
      key('season-2').click();
      await wait();
      expect(header()).toBe('Versions · Season 2');
      key('season-2').focus();
      await press('ArrowDown');
      expect(focused()).toBe('season-pack-pack-1-download');
      await press('ArrowLeft');
      expect(focused()).toBe('season-pack-pack-1-download');
    });

    it('keeps Unknown episodes as the last stop of the list; OK shows its files in the Versions view', async () => {
      const unknown = [episode(2, 0, { title: 'Loose file', sources: [source('loose', {})], sourceCount: 1 })];
      await open(() => detail({ unknown }));
      key('season-2').click();
      await wait();
      key('episode-2:5').focus();
      await press('ArrowDown');
      expect(focused()).toBe('unknown-2');
      await press('Enter');
      expect(header()).toBe('Versions · S02 · Unknown episodes');
      expect(focused()).toBe('unknown-source-0');
      await press('GoBack');
      expect(focused()).toBe('unknown-2');
    });
  });

  describe('data refresh', () => {
    it('does not move focus or leave Versions when the series is refreshed underneath', async () => {
      let data = detail({});
      await openVersions('episode-2:4', () => data);
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e4-720-0');
      data = detail({ s2: [1, 2, 3, 4, 5].map(n => episode(2, n, { libraryState: n === 4 ? { downloadState: 'downloading', watchState: 'unwatched' } : watched })) });
      window.dispatchEvent(new CustomEvent('catalog-title-updated', { detail: { titleId: 'show' } }));
      await wait(80);
      expect(focused()).toBe('source-s2e4-720-0');
      expect(header()).toBe('Versions · S02 · E04 · Episode 4');
      expect(listShown()).toBe(false);
      expect(key('season-2').className).toContain('active');
    });

    it('falls back to the list when the episode being viewed disappears', async () => {
      let data = detail({});
      await openVersions('episode-2:5', () => data);
      data = detail({ s2: [1, 2, 3].map(n => episode(2, n)) });
      window.dispatchEvent(new CustomEvent('catalog-title-updated', { detail: { titleId: 'show' } }));
      await wait(80);
      expect(container.querySelector('.versions-view')).toBeNull();
      expect(listShown()).toBe(true);
    });
  });

  describe('round trip through the player', () => {
    it('reports the open Versions view in the navigation snapshot and reopens it from one', async () => {
      const snapshots: NavSnapshot[] = [];
      await openVersions('episode-2:4', () => detail({}), { onNav: snapshot => snapshots.push(snapshot) });
      expect(snapshots[snapshots.length - 1].versions).toBe('2:4');
      await press('GoBack');
      expect(snapshots[snapshots.length - 1].versions).toBeUndefined();
      await press('Enter');
      const saved = snapshots[snapshots.length - 1];
      expect(saved.versions).toBe('2:4');
      render(null, container);
      await wait();
      await open(() => detail({}), { initialNav: { ...saved, focusKey: 'source-s2e4-720-0' } });
      expect(header()).toBe('Versions · S02 · E04 · Episode 4');
      expect(listShown()).toBe(false);
      expect(focused()).toBe('source-s2e4-720-0');
      expect(key('season-2').className).toContain('active');
      await press('GoBack');
      expect(focused()).toBe('episode-2:4');
    });

    it('forgets the restored Versions once the viewer has backed out of the title', async () => {
      const snapshots: NavSnapshot[] = [];
      await openVersions('episode-2:4', () => detail({}), { onNav: snapshot => snapshots.push(snapshot) });
      const saved = snapshots[snapshots.length - 1];
      render(null, container);
      await wait();
      const next: NavSnapshot[] = [];
      await open(() => detail({}), { initialNav: saved, onNav: snapshot => next.push(snapshot) });
      await press('GoBack');
      await press('GoBack');
      expect(container.querySelector('.detail-screen')).toBeNull();
      expect(next[next.length - 1].versions).toBeUndefined();
    });
  });

  describe('presses from landing', () => {
    it('land, then play a specific episode: Down to the bar, Down to the episodes, step to it, OK, OK', async () => {
      const onPlay = vi.fn();
      await open(() => detail({}), { household: { ...empty, continueWatching: [resumeItem({ seasonNumber: 2, episodeNumber: 3 })] }, onPlay });
      expect(focused()).toBe('detail-playback');
      await press('ArrowDown');           // season bar (Season 1 is under the Play column)
      await press('ArrowRight');          // Season 2
      await press('Enter');               // switch to Season 2
      await press('ArrowDown');           // selected episode, S02E03
      expect(focused()).toBe('episode-2:3');
      await press('ArrowDown', 200);      // S02E04
      await press('ArrowDown', 200);      // S02E05
      await press('Enter');               // into the versions
      expect(focused()).toBe('source-s2e5-1080-0');
      await press('Enter');               // play the Best match
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's2e5-1080' });
    });

    it('land, then pick the second version of the current episode: Right to Choose version, OK, Down, OK', async () => {
      const onPlay = vi.fn();
      await open(() => detail({}), { onPlay });
      await press('ArrowRight');
      expect(focused()).toBe('detail-versions');
      await press('Enter');
      expect(focused()).toBe('source-s1e1-1080-0');
      await press('ArrowDown');
      await press('Enter');
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's1e1-720' });
    });
  });
});
