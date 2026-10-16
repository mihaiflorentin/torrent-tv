import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type CatalogEpisode, type CatalogSource, type CatalogTitle, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// The series title page on the web: season tabs, then the episode list beside the versions of the selected episode.

const show: CatalogTitle = { id: 'sv', title: 'Vesper', kind: 'series', year: 2021, trackers: [{ id: 'filelist', name: 'FileList' }], categories: [], resolutions: ['1080p'], sourceCount: 3, bestSeeders: 214, largestSizeBytes: 1 };
const source = (id: string, parsed: Partial<CatalogSource['parsed']> = {}, state?: CatalogSource['libraryState']): CatalogSource => ({
  release: { id, trackerId: 'filelist', trackerName: 'FileList', providerId: id, categoryId: '4', browseClass: '', name: id, category: 'TV', sizeBytes: 1_200_000_000, seeders: 40, leechers: 0, freeleech: false },
  parsed: { title: 'Vesper', sortTitle: 'vesper', kind: 'series', resolution: '1080p', quality: 'WEB-DL', ...parsed }, fileIndex: 0, filePath: `${id}.mkv`, libraryState: state,
});
// Worst version first, so the pane has to rank them.
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
const pane = () => document.querySelector('.detail .versions-pane')!;
const rows = () => Array.from(pane().querySelectorAll('.source-row'));
const episodes = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.detail .episode-select'));

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

describe('Title detail: episodes and versions side by side', () => {
  it('renders the episode list and the versions pane together, with the first unwatched episode selected', async () => {
    await openSeason2();
    const layout = document.querySelector('.detail .season-panes')!;
    expect(layout.querySelector('.episode-pane')).not.toBeNull();
    expect(layout.querySelector('.versions-pane')).not.toBeNull();
    expect(document.querySelector('.detail .episode-list article.selected')!.textContent).toContain('Episode 2');
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · E02 · Episode 2');
  });

  it('ranks the versions of the selected episode, Best match first', async () => {
    await openSeason2();
    expect(rows().map(row => row.querySelector('.source-headline')!.textContent)).toEqual(['1080p', '720p']);
    expect(rows()[0].querySelector('.best-match')!.textContent).toBe('Best match');
    expect(rows()[1].querySelector('.best-match')).toBeNull();
  });

  it('selecting another episode shows its versions and marks it, with no show/hide toggling', async () => {
    await openSeason2();
    await click(episodes()[2]);
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · E03 · Episode 3');
    expect(episodes()[2].getAttribute('aria-current')).toBe('true');
    expect(episodes()[1].getAttribute('aria-current')).toBeNull();
    expect(document.querySelector('.detail .episode-pane [aria-expanded]')).toBeNull();
    await click(episodes()[2]);
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · E03 · Episode 3');
  });

  it('plays a version straight from the pane', async () => {
    const prepare = vi.spyOn(API.prototype, 'prepare').mockResolvedValue({} as never);
    await openSeason2();
    await click(episodes()[2]);
    await click(rows()[1].querySelector('.source-main'));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toBe('s2e3-720');
  });

  it('lists the season packs below the versions, open, with their actions', async () => {
    await openSeason2();
    const packs = pane().querySelector('.season-pack-actions')!;
    expect(packs.querySelector('h4')!.textContent).toBe('Complete season');
    expect(Array.from(packs.querySelectorAll('button')).map(button => button.textContent)).toContain('Download season');
    expect(rows().length).toBe(2);
  });

  it('keeps Unknown episodes as the last item of the list, showing its files in the pane', async () => {
    await openSeason2();
    const items = episodes();
    expect(items[items.length - 1].textContent).toContain('Unknown episodes (1)');
    await click(items[items.length - 1]);
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · Unknown episodes');
    expect(rows()).toHaveLength(1);
  });

  it('changing season selects that season\'s first episode', async () => {
    await openSeason2();
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · E02 · Episode 2');
    await click(document.querySelectorAll('.detail .season-tabs button')[0]);
    expect(pane().querySelector('h3')!.textContent).toBe('S01 · E01 · Episode 1');
    expect(episodes()[0].getAttribute('aria-current')).toBe('true');
  });

  it('keeps the selected episode when the series refreshes underneath', async () => {
    await openSeason2();
    await click(episodes()[2]);
    const next = data();
    next.seasons[1].episodes[2] = episode(2, 3, { libraryState: { downloadState: 'downloading', watchState: 'unwatched' } });
    vi.spyOn(API.prototype, 'title').mockResolvedValue(next);
    await click(document.querySelectorAll('.detail .season-tabs button')[1]);
    await click(episodes()[2]);
    expect(pane().querySelector('h3')!.textContent).toBe('S02 · E03 · Episode 3');
  });

  it('keeps the movie versions list as it was', async () => {
    const movie: CatalogDetail = { title: { ...show, kind: 'movie' }, seasons: [], sources: [source('m-720', { resolution: '720p' }), source('m-1080', { resolution: '1080p' })] };
    vi.spyOn(API.prototype, 'title').mockResolvedValue(movie);
    await openDetail();
    expect(document.querySelector('.detail .season-panes')).toBeNull();
    expect(document.querySelectorAll('.detail .source-row')).toHaveLength(2);
  });
});
