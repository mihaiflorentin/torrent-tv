import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type CatalogEpisode, type CatalogSource, type CatalogTitle, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// The series title page on the web: season tabs, then the episode list. Clicking an episode replaces the list with that
// episode's full-width Versions view (breadcrumb, Back, Escape), as on the TV.

const show: CatalogTitle = { id: 'sv', title: 'Vesper', kind: 'series', year: 2021, trackers: [{ id: 'filelist', name: 'FileList' }], categories: [], resolutions: ['1080p'], sourceCount: 3, bestSeeders: 214, largestSizeBytes: 1, overview: 'A series overview.', backdropUrl: '/art/backdrop.jpg' };
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}, state?: CatalogSource['libraryState']): CatalogSource => ({
  release: { id, trackerId: 'filelist', trackerName: 'FileList', providerId: id, categoryId: '4', browseClass: '', name: id, category: 'TV', sizeBytes: 1_200_000_000, seeders: 40, leechers: 0, freeleech: false },
  parsed: { title: 'Vesper', sortTitle: 'vesper', kind: 'series', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, libraryState: state,
});
// Worst version first, so the view has to rank them.
const episode = (season: number, number: number, over: Partial<CatalogEpisode> = {}): CatalogEpisode => ({
  number, title: `Episode ${number}`, season, sourceCount: 2,
  sources: [source(`s${season}e${number}-720`, { resolution: '720p' }), source(`s${season}e${number}-1080`, { resolution: '1080p' })], ...over,
});
const watched = { downloadState: 'downloaded', watchState: 'watched' } as const;
const data = (): CatalogDetail => ({ title: show, sources: [], seasons: [
  { number: 1, title: 'Season 1', episodeCount: 1, episodes: [episode(1, 1)] },
  { number: 2, title: 'Season 2', episodeCount: 3, episodes: [episode(2, 1, { libraryState: watched }), episode(2, 2), episode(2, 3)],
    packSources: [source('pack-1', { seasonStart: 2, seasonEnd: 2, resolution: '1080p' })],
    unknown: [episode(2, 0, { title: 'Loose file', sources: [source('loose')], sourceCount: 1 })] },
] });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };

class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const click = async (element: Element | null) => { await act(async () => { (element as HTMLElement).click() }); await settle() };
const pressEscape = async () => { act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }); await settle() };
const view = () => document.querySelector('.detail .versions-view');
const title = () => view()!.querySelector('.versions-title')!.textContent;
const rows = () => Array.from(view()!.querySelectorAll('.source-row'));
const episodes = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.detail .episode-select'));
const back = () => view()!.querySelector<HTMLButtonElement>('.versions-back')!;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(empty);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [show], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(data());
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
});
afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openDetail() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
  await click(document.querySelector('.media-card:not(.library-card)'));
}
// The page opens on Season 1; most of these checks look at Season 2.
async function openSeason2() {
  await openDetail();
  await click(document.querySelectorAll('.detail .season-tabs button')[1]);
}
// Season 2, then a click on the third episode: its Versions view.
async function openVersions(index = 2) {
  await openSeason2();
  await click(episodes()[index]);
}

describe('Title detail: the episode list', () => {
  it('shows the episodes with the first unwatched one marked, and no Versions view yet', async () => {
    await openSeason2();
    expect(document.querySelector('.detail .episode-pane')).not.toBeNull();
    expect(view()).toBeNull();
    expect(document.querySelector('.detail .episode-list article.selected')!.textContent).toContain('Episode 2');
    expect(document.querySelector('.detail .episode-list .source-row')).toBeNull();
  });

  it('keeps Unknown episodes as the last item of the list', async () => {
    await openSeason2();
    const items = episodes();
    expect(items[items.length - 1].textContent).toContain('Unknown episodes (1)');
  });

  it('keeps the movie versions list as it was', async () => {
    const movie: CatalogDetail = { title: { ...show, kind: 'movie' }, seasons: [], sources: [source('m-720', { resolution: '720p' }), source('m-1080', { resolution: '1080p' })] };
    vi.spyOn(API.prototype, 'title').mockResolvedValue(movie);
    await openDetail();
    expect(document.querySelector('.detail .season-panes')).toBeNull();
    expect(document.querySelectorAll('.detail .source-row')).toHaveLength(2);
  });
});

describe('Title detail: Versions view', () => {
  it('replaces the list with the episode\'s Versions, headed with season, episode and name', async () => {
    await openVersions();
    expect(title()).toBe('Versions · S02 · E03 · Episode 3');
    expect(document.querySelector('.detail .episode-pane')).toBeNull();
    expect(document.querySelector('.detail .season-tabs')).not.toBeNull();
  });

  it('shows a breadcrumb from the title to Versions, and a Back control', async () => {
    await openVersions();
    const crumbs = view()!.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(Array.from(crumbs.querySelectorAll('li')).map(item => item.textContent)).toEqual(['Vesper', 'Season 2', 'E03', 'Versions']);
    expect(crumbs.querySelector('[aria-current="page"]')!.textContent).toBe('Versions');
    expect(back().textContent).toContain('Back to episodes');
  });

  it('ranks the versions, Best match first', async () => {
    await openVersions();
    expect(rows().map(row => row.querySelector('.source-headline')!.textContent)).toEqual(['1080p', '720p']);
    expect(rows()[0].querySelector('.best-match')!.textContent).toBe('Best match');
    expect(rows()[1].querySelector('.best-match')).toBeNull();
  });

  it('plays a version straight from the view', async () => {
    const prepare = vi.spyOn(API.prototype, 'prepare').mockResolvedValue({} as never);
    await openVersions();
    await click(rows()[1].querySelector('.source-main'));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toBe('s2e3-720');
  });

  it('lists the season packs under the versions, open, with their actions', async () => {
    await openVersions();
    const packs = view()!.querySelector('.season-pack-actions')!;
    expect(packs.querySelector('h4')!.textContent).toBe('Complete season');
    expect(Array.from(packs.querySelectorAll('button')).map(button => button.textContent)).toContain('Download season');
    expect(rows().length).toBe(2);
  });

  it('shows the files of Unknown episodes the same way', async () => {
    await openSeason2();
    const items = episodes();
    await click(items[items.length - 1]);
    expect(title()).toBe('Versions · S02 · Unknown episodes');
    expect(rows()).toHaveLength(1);
  });

  it('says so when the episode has no versions yet', async () => {
    const bare = data();
    bare.seasons[1].episodes[2] = episode(2, 3, { sources: [], sourceCount: 0 });
    vi.spyOn(API.prototype, 'title').mockResolvedValue(bare);
    await openVersions();
    expect(view()!.querySelector('.versions-empty')!.textContent).toBe('No versions of this episode yet.');
  });

  it('moves focus into the view on the Best match', async () => {
    await openVersions();
    expect(document.activeElement).toBe(rows()[0].querySelector('.source-main'));
  });

  it('changing season leaves Versions for that season\'s list', async () => {
    await openVersions();
    await click(document.querySelectorAll('.detail .season-tabs button')[0]);
    expect(view()).toBeNull();
    expect(episodes()[0].getAttribute('aria-current')).toBe('true');
  });

  it('stays in Versions when the series refreshes underneath', async () => {
    await openVersions();
    const next = data();
    next.seasons[1].episodes[2] = episode(2, 3, { libraryState: { downloadState: 'downloading', watchState: 'unwatched' } });
    vi.spyOn(API.prototype, 'title').mockResolvedValue(next);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3200)) });
    await settle();
    expect(title()).toBe('Versions · S02 · E03 · Episode 3');
  }, 10000);
});

describe('Title detail: the Info look', () => {
  const season2Info = { titleId: 'sv', available: true, number: 2, episodes: [{ number: 3, name: 'Lotus', runtimeMinutes: 55, rating: 8.5, overview: 'They land.', stillUrl: '/still-3.jpg', directors: ['D. Director'] }] };
  const wait = async (ms: number) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) }); await settle() };

  it('draws each episode as an Info-style row: still, code and name, facts and the chevron', async () => {
    await openSeason2();
    const row = episodes()[2];
    expect(row.querySelector('.info-row-copy strong')!.textContent).toBe('E03 · Episode 3');
    expect(row.querySelector('.info-chevron')!.textContent).toBe('›');
    expect(row.querySelector('.info-still-small img')!.getAttribute('src')).toContain('/art/backdrop.jpg');
  });

  it('asks for the season info once, shortly after the season shows, and adds the still and facts', async () => {
    const info = vi.spyOn(API.prototype, 'seasonInfo').mockResolvedValue(season2Info as never);
    await openSeason2();
    await wait(600);
    expect(info).toHaveBeenCalledWith('sv', 2);
    expect(info.mock.calls.filter(call => call[1] === 2)).toHaveLength(1);
    expect(episodes()[2].querySelector('.info-still-small img')!.getAttribute('src')).toContain('/still-3.jpg');
    expect(episodes()[2].querySelector('.info-row-copy small')!.textContent).toContain('55 min');
  });

  it('leaves the list as it was when the season info fails', async () => {
    vi.spyOn(API.prototype, 'seasonInfo').mockRejectedValue(new Error('offline'));
    await openSeason2();
    await wait(600);
    expect(episodes()[2].querySelector('.info-row-copy small')!.textContent).toBe('2 versions');
    expect(document.querySelector('.detail .info-skeleton')).toBeNull();
  });

  it('opens Versions with the episode block: still, facts, name, synopsis and credits', async () => {
    vi.spyOn(API.prototype, 'seasonInfo').mockResolvedValue(season2Info as never);
    await openSeason2();
    await wait(600);
    await click(episodes()[2]);
    const block = view()!.querySelector('.versions-episode')!;
    expect(block.querySelector('.info-still img')!.getAttribute('src')).toContain('/still-3.jpg');
    expect(block.querySelector('.info-meta')!.textContent).toBe('S02E03 · 55 min · 8.5 / 10');
    expect(block.querySelector('.info-episode-title')!.textContent).toBe('Episode 3');
    expect(block.querySelector('.info-overview')!.textContent).toBe('They land.');
    expect(block.querySelector('.info-credits')!.textContent).toContain('Director');
  });

  it('without detailed info the block still shows the code, the backdrop and the series overview', async () => {
    await openVersions();
    const block = view()!.querySelector('.versions-episode')!;
    expect(block.querySelector('.info-meta')!.textContent).toBe('S02E03');
    expect(block.querySelector('.info-still img')!.getAttribute('src')).toContain('/art/backdrop.jpg');
    expect(block.querySelector('.info-overview')!.textContent).toBe('A series overview.');
    expect(block.querySelector('.info-credits')).toBeNull();
  });

  it('shows no episode block for Unknown episodes', async () => {
    await openSeason2();
    const items = episodes();
    await click(items[items.length - 1]);
    expect(view()!.querySelector('.versions-episode')).toBeNull();
  });
});

describe('Title detail: leaving Versions', () => {
  it('Back returns to the episode list with that episode focused', async () => {
    await openVersions();
    await click(back());
    expect(view()).toBeNull();
    expect(document.activeElement).toBe(episodes()[2]);
    expect(episodes()[2].getAttribute('aria-current')).toBe('true');
  });

  it('Escape pops Versions first and closes the overlay only on the second press', async () => {
    await openVersions();
    await pressEscape();
    expect(view()).toBeNull();
    expect(document.querySelector('.detail')).not.toBeNull();
    expect(document.activeElement).toBe(episodes()[2]);
    await pressEscape();
    expect(document.querySelector('.detail')).toBeNull();
  });

  it('Close still closes the whole overlay from Versions', async () => {
    await openVersions();
    await click(document.querySelector('.detail .close'));
    expect(document.querySelector('.detail')).toBeNull();
  });
});
