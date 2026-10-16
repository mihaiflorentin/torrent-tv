// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogDetail, CatalogEpisode, CatalogFacets, CatalogSource, CatalogTitle, HouseholdItem, HouseholdState } from '@torrent-tv/shared';

// The series title page on the TV: season bar on top, episodes on the left, the selected episode's versions on the right.
// These tests drive the D-pad (keydown on the focused element) and pin every move between the three areas.
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

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const release = (id: string, over = {}) => ({ id, trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: `Show.${id}`, category: 'TV HD', sizeBytes: 1_200_000_000, seeders: 50, leechers: 2, freeleech: false, ...over });
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}): CatalogSource => ({ release: release(id), parsed: { title: 'Show', sortTitle: 'show', kind: 'series', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, fileSizeBytes: 1_200_000_000 });
const series: CatalogTitle = { id: 'show', title: 'Show', kind: 'series', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }] };
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

function mount(container: HTMLElement, data: () => CatalogDetail, props: { household?: HouseholdState; onPlay?: (...args: unknown[]) => void } = {}) {
  render(
    <Catalog
      api={{ titles: async () => ({ items: [series], nextCursor: null, total: 0 }), title: async () => data(), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }) } as unknown as API}
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
    />,
    container,
  );
}

describe('TV series page: episodes left, versions right', () => {
  let container: HTMLDivElement;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)!;
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  const header = () => container.querySelector('.versions-head h3')!.textContent;
  const versions = () => Array.from(container.querySelectorAll<HTMLElement>('.versions-pane .source-button'));
  const selectedEpisode = () => container.querySelector('.episode-tile.selected')?.getAttribute('data-focus-key');
  // One remote press: a keydown on whatever has focus, then the settle time of a render.
  const press = async (name: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'GoBack', settle = 30) => {
    const target = (document.activeElement as HTMLElement) || document.body;
    const keyCodes: Record<string, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, GoBack: 10009 };
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode: keyCodes[name], bubbles: true, cancelable: true }));
    // Back acts on key release in the app (a long press exits), so a real press is down then up.
    if (name === 'GoBack') target.dispatchEvent(new KeyboardEvent('keyup', { key: name, keyCode: keyCodes[name], bubbles: true, cancelable: true }));
    await wait(settle);
  };
  const open = async (data: () => CatalogDetail, props: { household?: HouseholdState; onPlay?: (...args: unknown[]) => void } = {}) => {
    mount(container, data, props);
    await wait();
    key('hero-show').click();
    await wait(60);
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

  describe('selection follows focus', () => {
    it('opens with the first unwatched episode selected and its versions on the right, Best match first', async () => {
      await open(() => detail({}), { household: empty });
      key('season-2').click();
      await wait();
      expect(selectedEpisode()).toBe('episode-2:3');
      expect(header()).toBe('S02 · E03 · Episode 3');
      expect(versions().map(row => row.dataset.focusKey)).toEqual(['source-s2e3-1080-0', 'source-s2e3-720-0']);
      expect(versions()[0].querySelector('.source-best')!.textContent).toBe('Best match');
      expect(versions()[1].querySelector('.source-best')).toBeNull();
    });

    it('focusing another episode shows its versions after a short pause, not on every pass', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:4').focus();
      await wait(40);
      expect(header()).toBe('S02 · E03 · Episode 3');
      await wait(200);
      expect(header()).toBe('S02 · E04 · Episode 4');
      expect(selectedEpisode()).toBe('episode-2:4');
      expect(versions()[0].dataset.focusKey).toBe('source-s2e4-1080-0');
    });

    it('keeps the selected episode marked while focus is in the versions pane', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:4').focus();
      await wait(200);
      await press('ArrowRight');
      expect(focused()).toBe('source-s2e4-1080-0');
      expect(selectedEpisode()).toBe('episode-2:4');
      expect(key('episode-2:4').getAttribute('aria-current')).toBe('true');
    });

    it('changing season selects that season\'s first unwatched episode and shows its versions', async () => {
      await open(() => detail({}));
      key('season-3').click();
      await wait();
      expect(selectedEpisode()).toBe('episode-3:1');
      expect(header()).toBe('S03 · E01 · Episode 1');
    });

    it('opens on the episode of the saved progress', async () => {
      await open(() => detail({}), { household: { ...empty, continueWatching: [resumeItem({ seasonNumber: 2, episodeNumber: 2 })] } });
      expect(selectedEpisode()).toBe('episode-2:2');
    });
  });

  describe('D-pad between the areas', () => {
    it('Right and OK on an episode enter the versions pane at the Best match; neither plays', async () => {
      const onPlay = vi.fn();
      await open(() => detail({}), { onPlay });
      key('season-2').click();
      await wait();
      key('episode-2:3').focus();
      await press('ArrowRight');
      expect(focused()).toBe('source-s2e3-1080-0');
      key('episode-2:3').focus();
      await press('Enter');
      expect(focused()).toBe('source-s2e3-1080-0');
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('Right straight after moving to an episode still opens that episode\'s versions', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:5').focus();
      await press('ArrowRight', 5);
      await wait(60);
      expect(focused()).toBe('source-s2e5-1080-0');
      expect(header()).toBe('S02 · E05 · Episode 5');
    });

    it('OK on a version plays it', async () => {
      const onPlay = vi.fn();
      await open(() => detail({}), { onPlay });
      key('season-2').click();
      await wait();
      key('episode-2:3').focus();
      await press('ArrowRight');
      await press('ArrowDown');
      await press('Enter');
      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's2e3-720' });
    });

    it('Left and Back from a version return to the selected episode; Back from the list leaves the page', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:4').focus();
      await wait(200);
      await press('ArrowRight');
      await press('ArrowLeft');
      expect(focused()).toBe('episode-2:4');
      await press('ArrowRight');
      await press('GoBack');
      expect(focused()).toBe('episode-2:4');
      expect(container.querySelector('.detail-screen')).not.toBeNull();
      await press('GoBack');
      expect(container.querySelector('.detail-screen')).toBeNull();
    });

    it('moves Up and Down inside each pane and stays put at the ends', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:1').focus();
      await wait(200);
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:2');
      await press('ArrowLeft');
      expect(focused()).toBe('episode-2:2');
      key('episode-2:5').focus();
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:5');
      await press('ArrowRight');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e5-720-0');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e5-720-0');
      await press('ArrowRight');
      expect(focused()).toBe('source-s2e5-720-0');
    });

    it('Up from the first episode or the first version goes to the season bar; Down returns to the selected episode', async () => {
      await open(() => detail({}));
      key('season-2').click();
      await wait();
      key('episode-2:1').focus();
      await press('Enter', 5);
      await press('ArrowUp');
      expect(focused()).toBe('season-2');
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:1');
      await press('ArrowUp');
      expect(focused()).toBe('season-2');
      key('episode-2:3').focus();
      await wait(200);
      await press('ArrowRight');
      await press('ArrowUp');
      expect(focused()).toBe('season-2');
      await press('ArrowDown');
      expect(focused()).toBe('episode-2:3');
    });

    it('leaves the hero and the season bar as they were: same rows and columns, Down from the hero reaches the bar', async () => {
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
  });

  describe('complete season packs and unknown episodes', () => {
    it('lists the season packs under the versions, always open, with their actions as plain stops', async () => {
      await open(() => detail({ packs: [pack('pack-1')] }));
      key('season-2').click();
      await wait();
      expect(container.querySelector('.season-pack-downloads h4')!.textContent).toBe('Complete season');
      expect(container.querySelector('[aria-expanded]')).toBeNull();
      key('episode-2:3').focus();
      await press('ArrowRight');
      await press('ArrowDown');
      await press('ArrowDown');
      expect(focused()).toBe('season-pack-pack-1-download');
      await press('ArrowLeft');
      expect(focused()).toBe('episode-2:3');
    });

    it('keeps Unknown episodes as the last stop of the episode list, showing its files on the right', async () => {
      const unknown = [episode(2, 0, { title: 'Loose file', sources: [source('loose', {})], sourceCount: 1 })];
      await open(() => detail({ unknown }));
      key('season-2').click();
      await wait();
      key('episode-2:5').focus();
      await press('ArrowDown');
      expect(focused()).toBe('unknown-2');
      await wait(200);
      expect(header()).toBe('S02 · Unknown episodes');
      await press('ArrowRight');
      expect(focused()).toBe('unknown-source-0');
    });
  });

  describe('data refresh', () => {
    it('does not move focus or selection when the series is refreshed underneath', async () => {
      let data = detail({});
      await open(() => data);
      key('season-2').click();
      await wait();
      key('episode-2:4').focus();
      await wait(200);
      await press('ArrowRight');
      await press('ArrowDown');
      expect(focused()).toBe('source-s2e4-720-0');
      data = detail({ s2: [1, 2, 3, 4, 5].map(n => episode(2, n, { libraryState: n === 4 ? { downloadState: 'downloading', watchState: 'unwatched' } : watched })) });
      window.dispatchEvent(new CustomEvent('catalog-title-updated', { detail: { titleId: 'show' } }));
      await wait(80);
      expect(focused()).toBe('source-s2e4-720-0');
      expect(selectedEpisode()).toBe('episode-2:4');
      expect(key('season-2').className).toContain('active');
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

    it('land, then change to season 3 and reach its first episode\'s versions: Down, Right, Right, OK, Down, OK', async () => {
      const onPlay = vi.fn();
      await open(() => detail({}), { onPlay });
      await press('ArrowDown');
      await press('ArrowRight');
      await press('ArrowRight');
      expect(focused()).toBe('season-3');
      await press('Enter');
      await press('ArrowDown');
      expect(focused()).toBe('episode-3:1');
      await press('Enter');
      expect(focused()).toBe('source-s3e1-1080-0');
      await press('Enter');
      expect(onPlay.mock.calls[0][0]).toMatchObject({ id: 's3e1-1080' });
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
