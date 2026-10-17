// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API, CatalogFacets, CatalogTitle, HouseholdState, InfoEpisode, InfoSeasonDetail, InfoSeasons, TitleInfo } from '@torrent-tv/shared';

// The Info panel's season drill-down on the TV: the Seasons card opens a season list, a season opens its
// episodes and cast, an episode opens its still, credits and guest stars. Back pops one level and puts focus on
// the row it came from; at the top it closes the panel. main.tsx bootstraps against #app during module evaluation.
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
const series = (): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'series', year: 2011, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }] });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const info = (over: Partial<TitleInfo> = {}): TitleInfo => ({ titleId: 'a', available: true, kind: 'series', overview: 'A story.', releaseDate: '2011-04-17', seasons: 2, episodes: 18, cast: [{ name: 'Lead Actor', character: 'Hero' }], ...over });
const seasons = (): InfoSeasons => ({ titleId: 'a', available: true, seasons: [
  { number: 1, name: 'Season 1', airDate: '2011-04-17', episodeCount: 10, posterUrl: '/api/v1/artwork/a/season-1-poster' },
  { number: 2, name: 'Season 2', airDate: '2012-04-01', episodeCount: 8 },
] });
const episodes = (count = 3): InfoEpisode[] => Array.from({ length: count }, (_, index) => ({
  number: index + 1, name: `Episode title ${index + 1}`, airDate: '2011-04-17', runtimeMinutes: 62, rating: 8.1, overview: `Story of episode ${index + 1}.`,
  stillUrl: `/api/v1/artwork/a/season-1-still-${index + 1}`, directors: ['Tim Van Patten'], writers: ['David Benioff', 'D. B. Weiss'],
  guestStars: [{ name: 'Guest One', character: 'Herald', imageUrl: `/api/v1/artwork/a/season-1-guest-${index + 1}-0` }, { name: 'Solo Guest' }],
}));
const season = (count = 3, over: Partial<InfoSeasonDetail> = {}): InfoSeasonDetail => ({ titleId: 'a', available: true, number: 1, name: 'Season 1', overview: 'The first season.', airDate: '2011-04-17', cast: [{ name: 'Season Lead', character: 'Ned', imageUrl: '/api/v1/artwork/a/season-1-cast-0' }], episodes: episodes(count), ...over });

function mount(container: HTMLElement, api: Partial<API>) {
  const titles = [series()];
  render(
    <Catalog
      api={{ titles: async () => ({ items: titles, nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }), ...api } as unknown as API}
      status="Online" titles={titles} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={empty} downloads={[]} jobs={[]} restoreFocus={null} portal={null} updateStatus={null}
      onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }}
      onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }}
    />,
    container,
  );
}

const back = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
const text = (container: HTMLElement) => container.querySelector('.info-panel')!.textContent!;

describe('TV Info season drill-down', () => {
  let container: HTMLDivElement;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
  const focused = () => (document.activeElement as HTMLElement).dataset.focusKey;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); });
  const open = async (api: Partial<API> = {}) => {
    mount(container, { titleInfo: async () => info(), titleSeasons: async () => seasons(), seasonInfo: async () => season(), episodeInfo: async () => episodes()[0], ...api });
    await wait();
    key('hero-info-a')!.click();
    await wait();
  };

  it('makes the Seasons fact a focusable card in the info region, for series only', async () => {
    await open();
    const card = key('info-seasons')!;
    expect(card.dataset.focusRegion).toBe('info-panel');
    expect(card.textContent).toContain('2 seasons, 18 episodes');
    expect(card.getAttribute('aria-haspopup')).toBe('true');
    expect(container.querySelector('.info-fine')?.textContent || '').not.toContain('seasons');
    render(null, container);
    container.innerHTML = '';
    mount(container, { titleInfo: async () => info({ kind: 'movie', seasons: undefined, episodes: undefined }) });
    await wait();
    key('hero-info-a')!.click();
    await wait();
    expect(key('info-seasons')).toBeNull();
  });

  it('opens Seasons, Season and Episode, and Back restores focus level by level before closing', async () => {
    await open();
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    expect(text(container)).toContain('Season 1');
    expect(text(container)).toContain('2011 · 10 episodes');
    expect(text(container)).toContain('Season 2');
    expect(container.querySelector('.info-crumbs')!.textContent).toBe('Alpha › Seasons');
    expect(focused()).toBe('info-season-1');

    key('info-season-2')!.focus();
    key('info-season-2')!.click();
    await wait();
    expect(container.querySelector('.info-crumbs')!.textContent).toBe('Alpha › Seasons › Season 2');
    expect(text(container)).toContain('The first season.');
    expect(text(container)).toContain('Episode title 2');
    expect(text(container)).toContain('E02 · Episode title 2');
    expect(text(container)).toContain('Season Lead');
    expect(focused()).toBe('info-season-summary');

    key('info-episode-2')!.focus();
    key('info-episode-2')!.click();
    await wait();
    expect(container.querySelector('.info-crumbs')!.textContent).toBe('Alpha › Seasons › Season 2 › E02');
    expect(focused()).toBe('info-episode-summary');

    back();
    await wait();
    expect(container.querySelector('.info-crumbs')!.textContent).toBe('Alpha › Seasons › Season 2');
    expect(focused()).toBe('info-episode-2');
    back();
    await wait();
    expect(container.querySelector('.info-crumbs')!.textContent).toBe('Alpha › Seasons');
    expect(focused()).toBe('info-season-2');
    back();
    await wait();
    expect(container.querySelector('.info-crumbs')).toBeNull();
    expect(container.querySelector('.info-panel')).not.toBeNull();
    expect(focused()).toBe('info-seasons');
    back();
    await wait();
    expect(container.querySelector('.info-panel')).toBeNull();
    expect(focused()).toBe('hero-info-a');
  });

  it('shows the episode still, code, date, runtime, rating, story, credits and guest stars with an initials fallback', async () => {
    await open();
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    key('info-season-1')!.focus();
    key('info-season-1')!.click();
    await wait();
    key('info-episode-1')!.focus();
    key('info-episode-1')!.click();
    await wait();
    const panel = text(container);
    expect(panel).toContain('S01E01');
    expect(panel).toContain('Apr 17, 2011');
    expect(panel).toContain('1 h 2 min');
    expect(panel).toContain('8.1 / 10');
    expect(panel).toContain('Story of episode 1.');
    expect(panel).toContain('Director');
    expect(panel).toContain('Tim Van Patten');
    expect(panel).toContain('Writers');
    expect(panel).toContain('David Benioff, D. B. Weiss');
    expect(container.querySelector('.info-still img')!.getAttribute('src')).toBe('/api/v1/artwork/a/season-1-still-1');
    expect(key('info-guest-0')!.querySelector('img')!.getAttribute('src')).toBe('/api/v1/artwork/a/season-1-guest-1-0');
    expect(key('info-guest-1')!.querySelector('img')).toBeNull();
    expect(key('info-guest-1')!.querySelector('.info-avatar')!.textContent).toBe('SG');
    const stops = Array.from(container.querySelectorAll<HTMLElement>('.info-panel [data-focus-region]'));
    expect(stops.every(stop => stop.dataset.focusRegion === 'info-panel')).toBe(true);
    const rows = stops.map(stop => Number(stop.dataset.focusRow));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('keeps Back and Close on the first row and returns Back through the Back button too', async () => {
    await open();
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    expect([key('info-back')!.dataset.focusRow, key('info-back')!.dataset.focusCol]).toEqual(['0', '0']);
    expect([key('info-close')!.dataset.focusRow, key('info-close')!.dataset.focusCol]).toEqual(['0', '1']);
    key('info-back')!.click();
    await wait();
    expect(container.querySelector('.info-crumbs')).toBeNull();
    expect(focused()).toBe('info-seasons');
  });

  it('says so calmly when no provider knows the seasons, the season or the episode', async () => {
    await open({ titleSeasons: async () => ({ titleId: 'a', available: false, seasons: [] }) });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    expect(text(container)).toContain('No season details from the metadata providers yet');
    back();
    await wait();
    back();
    await wait();
    render(null, container);
    container.innerHTML = '';
    await open({ seasonInfo: async () => ({ titleId: 'a', available: false, number: 1, episodes: [] }) });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    key('info-season-1')!.focus();
    key('info-season-1')!.click();
    await wait();
    expect(text(container)).toContain('No episode details from the metadata providers yet');
    back();
    await wait();
    expect(focused()).toBe('info-season-1');
    render(null, container);
    container.innerHTML = '';
    await open({ seasonInfo: async () => season(1, { episodes: [{ number: 1, name: 'Bare' }] }) });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    key('info-season-1')!.focus();
    key('info-season-1')!.click();
    await wait();
    key('info-episode-1')!.focus();
    key('info-episode-1')!.click();
    await wait();
    expect(text(container)).toContain('Bare');
    expect(text(container)).toContain('No episode details from the metadata providers yet');
  });

  it('shows a calm loading state per level and survives a failed request', async () => {
    let finish: (value: InfoSeasons) => void = () => { };
    await open({ titleSeasons: () => new Promise<InfoSeasons>(resolve => { finish = resolve; }) });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    expect(text(container)).toContain('Loading seasons…');
    expect(focused()).toBe('info-back');
    finish(seasons());
    await wait();
    expect(text(container)).not.toContain('Loading seasons…');
    expect(focused()).toBe('info-season-1');
    back();
    await wait();
    back();
    await wait();
    render(null, container);
    container.innerHTML = '';
    await open({ titleSeasons: async () => { throw new Error('offline'); } });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    expect(text(container)).toContain('No season details from the metadata providers yet');
    back();
    await wait();
    expect(focused()).toBe('info-seasons');
  });

  it('asks the server for a lazy episode synopsis once, on open', async () => {
    const episodeInfo = vi.fn(async () => ({ number: 1, name: 'Listed', overview: 'The synopsis.', runtimeMinutes: 24 }) as InfoEpisode);
    await open({ seasonInfo: async () => season(1, { episodes: [{ number: 1, name: 'Listed', lazyDetail: true, rating: 4.5 }] }), episodeInfo });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    key('info-season-1')!.focus();
    key('info-season-1')!.click();
    await wait();
    key('info-episode-1')!.focus();
    key('info-episode-1')!.click();
    await wait();
    expect(episodeInfo).toHaveBeenCalledWith('a', 1, 1);
    expect(text(container)).toContain('The synopsis.');
    expect(text(container)).toContain('24 min');
    back();
    await wait();
    key('info-episode-1')!.focus();
    key('info-episode-1')!.click();
    await wait();
    expect(episodeInfo).toHaveBeenCalledTimes(1);
  });

  it('loads artwork only for rows near focus in a long episode list and slides the window as focus moves', async () => {
    await open({ seasonInfo: async () => season(60) });
    key('info-seasons')!.focus();
    key('info-seasons')!.click();
    await wait();
    key('info-season-1')!.focus();
    key('info-season-1')!.click();
    await wait();
    const hasImage = (episode: number) => key(`info-episode-${episode}`)!.querySelector('img') !== null;
    expect(hasImage(1)).toBe(true);
    expect(hasImage(8)).toBe(true);
    expect(hasImage(40)).toBe(false);
    key('info-episode-40')!.focus();
    await wait();
    expect(hasImage(40)).toBe(true);
    // The top rows are far behind now and are released.
    expect(hasImage(1)).toBe(false);
    // A step back keeps what is near, and a long way back releases the far end.
    key('info-episode-39')!.focus();
    await wait();
    expect(hasImage(40)).toBe(true);
    expect(hasImage(39)).toBe(true);
    key('info-episode-1')!.focus();
    await wait();
    expect(hasImage(1)).toBe(true);
    expect(hasImage(40)).toBe(false);
  });
});
