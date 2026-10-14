import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type CatalogSource, type CatalogTitle, type HouseholdItem, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// App-level checks for the "Information priorities" table in DESIGN.md: each
// screen shows what helps the next decision, demotes the rest and keeps
// technical facts behind a control. The API is mocked at the class boundary;
// the tests read the rendered DOM only.

const lanterns: CatalogTitle = {
  id: 't1', title: 'Lanterns', kind: 'movie', year: 2021, overview: 'Two lighthouse keepers argue about the same night.', genres: ['Drama', 'Mystery'],
  rating: 7.4, ratingVotes: 120, posterUrl: '/p1.jpg', backdropUrl: '/b1.jpg', trackers: [{ id: 'filelist', name: 'FileList' }], categories: ['Filme 4K'],
  resolutions: ['2160p'], sourceCount: 3, bestSeeders: 214, largestSizeBytes: 18_400_000_000, libraryState: { downloadState: 'downloaded', watchState: 'unwatched' },
};
const vesper: CatalogTitle = {
  id: 't2', title: 'Vesper', kind: 'series', year: 2020, seasonCount: 2, posterUrl: '/p2.jpg', backdropUrl: '/b2.jpg', trackers: [{ id: 'filelist', name: 'FileList' }],
  categories: [], resolutions: ['720p'], sourceCount: 5, bestSeeders: 31, largestSizeBytes: 1,
};

const source = (id: string, name: string, parsed: Partial<CatalogSource['parsed']>, seeders: number, size: number): CatalogSource => ({
  release: { id, trackerId: 'filelist', trackerName: 'FileList', providerId: id, categoryId: '4', browseClass: '', name, category: 'Filme 4K', sizeBytes: size, seeders, leechers: 0, freeleech: false },
  parsed: { title: 'Lanterns', sortTitle: 'lanterns', kind: 'movie', ...parsed }, fileIndex: 0, filePath: `${name}.mkv`,
});
const detail: CatalogDetail = {
  title: lanterns, seasons: [],
  sources: [
    source('r1', 'Lanterns.2021.2160p.UHD.BluRay.x265.HDR-GRP', { resolution: '2160p', hdr: 'HDR', quality: 'BluRay', videoCodec: 'HEVC', audio: 'DTS-HD 5.1' }, 214, 18_400_000_000),
    source('r2', 'Lanterns.2021.1080p.WEB-DL.H264-NTb', { resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H.264' }, 40, 5_200_000_000),
  ],
};

const resumeItem: HouseholdItem = {
  profileId: 'p', sourceId: 's1', releaseId: 'r9', fileIndex: 0, filePath: 'Secret.Show.S01E02.1080p.WEB-DL.mkv', positionMs: 410_000, durationMs: 1_000_000, watched: false, updatedAt: '2026-10-14T20:00:00Z',
  favorite: false, titleId: 't1', seasonNumber: 1, episodeNumber: 2, catalog: lanterns,
  release: { id: 'r9', trackerId: 'filelist', trackerName: 'FileList', providerId: '9', categoryId: '4', browseClass: '', name: 'Secret.Show.S01E02.1080p.WEB-DL', category: 'Seriale HD', sizeBytes: 1, seeders: 7, leechers: 0, freeleech: false },
};
const household: HouseholdState = { favorites: [], continueWatching: [resumeItem], recent: [], watched: [] };

class FakeEventSource { addEventListener() { } close() { } }
const mountedHosts: HTMLElement[] = [];

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) });
}
async function mountApp() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountedHosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
}
const sidebarButton = (group: string | null, label: string) => {
  const groups = Array.from(document.querySelectorAll<HTMLElement>('.sidebar .nav-group'));
  const scope: ParentNode = group === null ? document.querySelector('.sidebar nav')! : groups.find(item => item.querySelector('p')?.textContent === group)!;
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(label))!;
};
const goTo = async (group: string | null, label: string) => { await act(async () => { sidebarButton(group, label).click() }); await settle() };
const text = (element: Element | null) => element?.textContent || '';
// Poster cards only: the Continue watching card for the same title carries the same label.
const cardFor = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.media-card:not(.library-card)')).find(button => button.getAttribute('aria-label') === `Open ${name}`)!;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(household);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [lanterns, vesper], nextCursor: null, total: 2 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(detail);
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
});

afterEach(() => {
  while (mountedHosts.length) render(null, mountedHosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Home hero', () => {
  it('shows title, year, kind, genre, overview and one action', async () => {
    await mountApp();
    const hero = document.querySelector('.hero')!;
    expect(text(hero.querySelector('h2'))).toBe('Lanterns');
    expect(text(hero.querySelector('.hero-kicker'))).toBe('2021 · Movie');
    expect(text(hero.querySelector('.hero-genres'))).toBe('Drama · Mystery');
    expect(text(hero.querySelector('.hero-overview'))).toContain('lighthouse keepers');
    expect(hero.querySelectorAll('button')).toHaveLength(1);
    expect(text(hero.querySelector('button'))).toBe('View versions');
  });

  it('hides seeders, best resolution and the source count', async () => {
    await mountApp();
    const hero = text(document.querySelector('.hero'));
    expect(hero).not.toMatch(/seed|2160p|214|sources?\b/i);
  });

  it('offers episodes for a series and leaves out an unknown overview and genre', async () => {
    vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [vesper], nextCursor: null, total: 1 });
    await mountApp();
    const hero = document.querySelector('.hero')!;
    expect(text(hero.querySelector('.hero-kicker'))).toBe('2020 · 2 seasons');
    expect(text(hero.querySelector('button'))).toBe('View episodes');
    expect(hero.querySelector('.hero-overview')).toBeNull();
    expect(hero.querySelector('.hero-genres')).toBeNull();
  });

  it('turns an empty catalog into a setup prompt with one action', async () => {
    vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    await mountApp();
    const hero = document.querySelector('.hero')!;
    expect(text(hero.querySelector('h2'))).toBe('Connect your catalog');
    await act(async () => { hero.querySelector<HTMLButtonElement>('button')!.click() });
    expect(document.querySelector('.topbar h1')!.textContent).toBe('Settings');
  });
});

describe('Poster cards', () => {
  it('lead with title, year, library state, best resolution and the rating once', async () => {
    await mountApp();
    const card = cardFor('Lanterns');
    const body = text(card);
    expect(text(card.querySelector('strong'))).toBe('Lanterns');
    expect(text(card.querySelector('small'))).toBe('2021 · 2160p · ★ 7.4');
    expect(body).toContain('Downloaded');
    expect(body.match(/★/g)).toHaveLength(1);
  });

  it('keep seeders, tracker names and source counts off the card', async () => {
    await mountApp();
    const body = text(cardFor('Lanterns'));
    expect(body).not.toMatch(/seed|FileList|sources?\b|214/i);
    expect(cardFor('Lanterns').querySelector('.tracker-badge')).toBeNull();
  });

  it('show seeders only on the Strong swarms row', async () => {
    await mountApp();
    await goTo('Tracker', 'Dashboard');
    const rows = Array.from(document.querySelectorAll('.rail-section'));
    const swarms = rows.find(row => text(row.querySelector('h2')) === 'Strong swarms')!;
    const recent = rows.find(row => text(row.querySelector('h2')) === 'Recently added')!;
    expect(text(swarms.querySelector('.media-card'))).toContain('214 seeders');
    expect(text(recent.querySelector('.media-card'))).not.toMatch(/seeder/);
  });
});

describe('Continue watching cards', () => {
  it('show the episode code and percent watched, with the year as secondary text', async () => {
    await mountApp();
    const card = document.querySelector('.library-card')!;
    expect(text(card.querySelector('strong'))).toBe('Lanterns');
    expect(text(card.querySelector('.library-card-state'))).toBe('S01E02 · 41% watched');
    expect(card.querySelector('.card-progress i')!.getAttribute('style')).toContain('41%');
    expect(text(card)).toContain('2021');
  });

  it('keep release name, file path, tracker and resolution out', async () => {
    await mountApp();
    const body = text(document.querySelector('.library-card'));
    expect(body).not.toMatch(/Secret|\.mkv|FileList|1080p|2160p/);
  });
});

describe('Title detail', () => {
  async function openDetail() {
    await mountApp();
    await act(async () => { cardFor('Lanterns').click() });
    await settle();
  }

  it('drops the summed seeders and the tracker badges from the header', async () => {
    await openDetail();
    const header = document.querySelector('.detail-hero')!;
    expect(text(header.querySelector('h2'))).toBe('Lanterns');
    expect(text(header.querySelector('.detail-facts'))).toBe('2021 · Movie');
    expect(text(header.querySelector('.title-genres'))).toBe('Drama · Mystery');
    expect(text(header)).not.toMatch(/214|seed|FileList/i);
    expect(header.querySelector('.tracker-badge')).toBeNull();
  });

  it('leads a version row with resolution, quality, codec, size and seeders, then the tracker and audio', async () => {
    await openDetail();
    const row = document.querySelector('.source-row')!;
    expect(text(row.querySelector('.source-headline'))).toBe('2160p HDR');
    expect(Array.from(row.querySelectorAll('.chip')).map(chip => chip.textContent)).toEqual(['BluRay', 'HEVC']);
    expect(text(row.querySelector('.source-facts'))).toContain('18.4 GB');
    expect(text(row.querySelector('.source-facts'))).toContain('214 seeders');
    expect(text(row.querySelector('.source-audio'))).toBe('DTS-HD 5.1');
    expect(text(row.querySelector('.tracker-badge'))).toBe('FileList');
    expect(text(row.querySelector('.source-action b'))).toBe('Play and download');
  });

  it('keeps the release name, file name, id and category behind a Details control', async () => {
    await openDetail();
    const row = document.querySelector('.source-row')!;
    const toggle = row.querySelector<HTMLButtonElement>('.details-toggle')!;
    expect(text(row)).not.toContain('Lanterns.2021.2160p');
    expect(row.querySelector('.source-details')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { toggle.click() });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = text(row.querySelector('.source-details'));
    expect(details).toContain('Lanterns.2021.2160p.UHD.BluRay.x265.HDR-GRP');
    expect(details).toContain('Filme 4K');
    expect(details).toContain('r1');
    expect(toggle.getAttribute('aria-controls')).toBe(row.querySelector('.source-details')!.id);
  });

  it('makes the version action a separate control from the details toggle, never nested', async () => {
    await openDetail();
    const row = document.querySelector('.source-row')!;
    expect(row.querySelector('button button')).toBeNull();
    expect(row.querySelectorAll(':scope > button')).toHaveLength(2);
  });
});

describe('Browse and Search', () => {
  it('puts search and media type first and drops the tracker sync prose', async () => {
    await mountApp();
    await goTo('Tracker', 'Browse');
    const tools = document.querySelector('.catalog-tools')!;
    expect(tools.querySelector('.tools-primary input[aria-label="Search"]')).not.toBeNull();
    expect(tools.querySelector('.tools-primary select[aria-label="Media type"]')).not.toBeNull();
    expect(Array.from(tools.querySelectorAll('.tools-secondary select')).map(select => select.getAttribute('aria-label'))).toEqual(['Category', 'Resolution', 'Sort']);
    expect(text(tools)).not.toMatch(/contacts enabled trackers|local cache/i);
  });

  it('shows the tracker strip only for a tracker that needs setup or is disabled', async () => {
    vi.spyOn(API.prototype, 'searchTitles').mockResolvedValue({
      items: [lanterns], nextCursor: null, total: 1, job: {} as never,
      trackers: [{ id: 'filelist', name: 'FileList', enabled: true, configured: true }, { id: 'piratebay', name: 'The Pirate Bay', enabled: false, configured: true }, { id: 'other', name: 'Other', enabled: true, configured: false }] as never,
    });
    await mountApp();
    await goTo('Tracker', 'Browse');
    const input = document.querySelector<HTMLInputElement>('.catalog-tools input[aria-label="Search"]')!;
    await act(async () => { input.value = 'lanterns'; input.dispatchEvent(new Event('input', { bubbles: true })) });
    await act(async () => { document.querySelector('.catalog-tools')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) });
    await settle();
    const strip = text(document.querySelector('.tracker-strip'));
    expect(strip).toContain('The Pirate Bay is disabled');
    expect(strip).toContain('Other needs setup');
    expect(strip).not.toContain('FileList');
  });

  it('says what happened and what to do when the catalog is empty', async () => {
    vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    await mountApp();
    await goTo('Tracker', 'Browse');
    const empty = document.querySelector('.empty-state')!;
    expect(text(empty.querySelector('h2'))).toBe('The catalog is empty');
    expect(text(empty.querySelector('p'))).toContain('Enable a tracker in Settings');
    await act(async () => { empty.querySelector<HTMLButtonElement>('button')!.click() });
    expect(document.querySelector('.topbar h1')!.textContent).toBe('Settings');
  });

  it('explains an empty search with its cause and a way back', async () => {
    vi.spyOn(API.prototype, 'searchTitles').mockResolvedValue({ items: [], nextCursor: null, total: 0, job: {} as never, trackers: [] });
    await mountApp();
    await goTo('Tracker', 'Browse');
    const input = document.querySelector<HTMLInputElement>('.catalog-tools input[aria-label="Search"]')!;
    vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    await act(async () => { input.value = 'zzz'; input.dispatchEvent(new Event('input', { bubbles: true })) });
    await act(async () => { document.querySelector('.catalog-tools')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) });
    await settle();
    const empty = document.querySelector('.empty-state')!;
    expect(text(empty.querySelector('h2'))).toBe('No titles match “zzz”');
    expect(text(empty)).toContain('Searching asks every enabled tracker');
    expect(Array.from(empty.querySelectorAll('button')).map(button => button.textContent)).toEqual(['Clear search']);
  });
});

describe('Backdrop that follows focus', () => {
  const art = () => Array.from(document.querySelectorAll<HTMLImageElement>('.backdrop-art')).map(img => ({ src: img.getAttribute('src'), active: img.dataset.active }));

  it('rests on the featured title and moves to the hovered title once its artwork loads', async () => {
    await mountApp();
    // The featured title's artwork fades in once the image has loaded.
    expect(art()).toEqual([{ src: '/b1.jpg', active: 'false' }]);
    await act(async () => { document.querySelector('.backdrop-art')!.dispatchEvent(new Event('load')) });
    expect(art()).toEqual([{ src: '/b1.jpg', active: 'true' }]);
    await act(async () => { cardFor('Vesper').dispatchEvent(new Event('pointerenter')) });
    const incoming = Array.from(document.querySelectorAll<HTMLImageElement>('.backdrop-art')).find(img => img.getAttribute('src') === '/b2.jpg')!;
    expect(incoming.dataset.active).toBe('false');
    await act(async () => { incoming.dispatchEvent(new Event('load')) });
    expect(art().filter(item => item.active === 'true')).toEqual([{ src: '/b2.jpg', active: 'true' }]);
  });

  it('follows keyboard focus too', async () => {
    await mountApp();
    await act(async () => { cardFor('Vesper').dispatchEvent(new Event('focus')) });
    expect(art().some(item => item.src === '/b2.jpg')).toBe(true);
  });

  it('resets to the resting art when the view changes', async () => {
    await mountApp();
    await act(async () => { cardFor('Vesper').dispatchEvent(new Event('pointerenter')) });
    await act(async () => { Array.from(document.querySelectorAll<HTMLImageElement>('.backdrop-art')).find(img => img.getAttribute('src') === '/b2.jpg')!.dispatchEvent(new Event('load')) });
    await goTo(null, 'Jobs');
    expect(document.querySelector('.backdrop')!.getAttribute('data-art')).toBe('false');
  });
});

describe('Screen chrome', () => {
  it('offers a skip link to the main content and no profile placeholder', async () => {
    await mountApp();
    const skip = document.querySelector<HTMLAnchorElement>('a.skip-link')!;
    expect(skip.getAttribute('href')).toBe('#content');
    expect(document.getElementById('content')).not.toBeNull();
    expect(document.querySelector('.avatar')).toBeNull();
  });

  it('gives every rail item an accessible name and a tooltip for the icon-only rail', async () => {
    await mountApp();
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))) {
      expect(button.querySelector('.nav-label')!.textContent!.length).toBeGreaterThan(0);
      expect(button.getAttribute('title')).toBe(button.querySelector('.nav-label')!.textContent);
    }
  });
});
