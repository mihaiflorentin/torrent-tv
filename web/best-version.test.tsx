import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type CatalogSource, type CatalogTitle, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// Best version Play on the web title page: one click prepares the top-ranked version, and the full
// list stays one click away behind Choose version.

const lanterns: CatalogTitle = { id: 't1', title: 'Lanterns', kind: 'movie', year: 2021, trackers: [{ id: 'filelist', name: 'FileList' }], categories: [], resolutions: ['2160p'], sourceCount: 3, bestSeeders: 214, largestSizeBytes: 1 };
const source = (id: string, parsed: Partial<CatalogSource['parsed']>, seeders: number, name = id): CatalogSource => ({
  release: { id, trackerId: 'filelist', trackerName: 'FileList', providerId: id, categoryId: '4', browseClass: '', name, category: 'Movies', sizeBytes: 5_200_000_000, seeders, leechers: 0, freeleech: false },
  parsed: { title: 'Lanterns', sortTitle: 'lanterns', kind: 'movie', ...parsed }, fileIndex: 0, filePath: `${name}.mkv`,
});
const detail: CatalogDetail = { title: lanterns, seasons: [], sources: [
  source('r-720', { resolution: '720p', quality: 'WEB-DL' }, 300),
  source('r-1080', { resolution: '1080p', quality: 'WEB-DL' }, 40),
  source('r-cam', { resolution: '1080p', quality: 'HDCAM' }, 900, 'Lanterns.HDCAM'),
] };
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };

class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const text = (element: Element | null) => element?.textContent || '';

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(empty);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [lanterns], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(detail);
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
  await act(async () => { document.querySelector<HTMLButtonElement>('.media-card:not(.library-card)')!.click() });
  await settle();
}

describe('Title detail best version Play', () => {
  it('names the chosen version on the primary action', async () => {
    await openDetail();
    expect(text(document.querySelector('.detail-copy .actions .primary'))).toBe('Play and download · 1080p WEB-DL · 5.2 GB');
  });

  it('prepares the top-ranked version once, without opening the picker', async () => {
    const prepare = vi.spyOn(API.prototype, 'prepare').mockRejectedValue(new Error('stop here'));
    await openDetail();
    await act(async () => { document.querySelector<HTMLButtonElement>('.detail-copy .actions .primary')!.click() });
    await settle();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toBe('r-1080');
    expect(document.querySelector('.picker')).toBeNull();
  });

  it('opens the full ranked version list from Choose version', async () => {
    await openDetail();
    const choose = Array.from(document.querySelectorAll<HTMLButtonElement>('.detail-copy .actions button')).find(button => text(button).includes('Choose version'))!;
    await act(async () => { choose.click() });
    const picker = document.querySelector('.picker')!;
    expect(picker).not.toBeNull();
    expect(Array.from(picker.querySelectorAll('.source-headline')).map(item => item.textContent)).toHaveLength(3);
  });
});

describe('Title detail season', () => {
  it('opens the season of the saved progress', async () => {
    const ep = (season: number, number: number) => ({ number, title: `Episode ${number}`, season, sourceCount: 1, sources: [source(`s${season}e${number}`, {}, 10)] });
    const show: CatalogTitle = { ...lanterns, id: 'sv', title: 'Vesper', kind: 'series', seasonCount: 2 };
    const data: CatalogDetail = { title: show, sources: [], seasons: [
      { number: 1, title: 'Season 1', episodeCount: 1, episodes: [ep(1, 1)] },
      { number: 2, title: 'Season 2', episodeCount: 1, episodes: [ep(2, 4)] },
    ] };
    vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [show], nextCursor: null, total: 1 });
    vi.spyOn(API.prototype, 'title').mockResolvedValue(data);
    vi.spyOn(API.prototype, 'state').mockResolvedValue({ ...empty, continueWatching: [{
      profileId: 'p', sourceId: 's', releaseId: 'r', fileIndex: 0, filePath: 'x.mkv', positionMs: 5, durationMs: 10, watched: false, updatedAt: '2026-10-14T20:00:00Z', favorite: false, titleId: 'sv', seasonNumber: 2, episodeNumber: 4,
      release: data.seasons[1].episodes[0].sources[0].release,
    }] });
    await openDetail();
    expect(document.querySelector('.detail .season-tabs [aria-pressed="true"]')!.textContent).toContain('Season 2');
  });
});
