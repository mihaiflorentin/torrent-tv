// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogDetail, CatalogFacets, CatalogSource, CatalogTitle, HouseholdItem, HouseholdState } from '@torrent-tv/shared';

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

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
const release = (id: string, over = {}) => ({ id, trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: `Alpha.${id}`, category: 'Movies HD', sizeBytes: 4_200_000_000, seeders: 50, leechers: 2, freeleech: false, ...over });
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], ...over });
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}, rel = {}, state?: CatalogSource['libraryState']): CatalogSource => ({ release: release(id, rel), parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, fileSizeBytes: 4_200_000_000, libraryState: state });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const resumeItem = (over: Partial<HouseholdItem> = {}): HouseholdItem => ({ profileId: 'h', sourceId: 's1', releaseId: 'rel-1', fileIndex: 0, filePath: 'x.mkv', positionMs: 410, durationMs: 1000, watched: false, updatedAt: '2026-10-14T10:00:00Z', release: release('rel-1'), favorite: false, titleId: 'a', ...over });

function mount(container: HTMLElement, api: Partial<API>, props: { titles: CatalogTitle[]; household?: HouseholdState; onPlay?: (...args: unknown[]) => void }) {
  render(
    <Catalog
      api={{ titles: async () => ({ items: props.titles, nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }), ...api } as unknown as API}
      status="Online"
      titles={props.titles}
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
      expect(play.textContent).toBe('Play and download · 1080p WEB-DL · 4.2 GB');
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
      expect(key('detail-playback')!.textContent).toBe('Resume');
      expect(key('detail-playback')!.getAttribute('aria-label')).toBe('Resume at saved position');
    });
  });
});
