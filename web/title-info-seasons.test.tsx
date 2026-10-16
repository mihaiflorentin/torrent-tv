import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type CatalogTitle, type HouseholdState, type InfoEpisode, type InfoSeasonDetail, type InfoSeasons, type TitleInfo } from '@torrent-tv/shared';
import { App } from './src';

// The web Info dialog's season drill-down: the Seasons card opens a season list, a season opens its episodes and
// cast, an episode opens its still, credits and guest stars. A breadcrumb (Title › Season 2 › E05) names the
// level; Back, a crumb and Escape pop levels and put focus on the row they came from; at the top Escape closes.

const series: CatalogTitle = { id: 't1', title: 'Alpha', kind: 'series', year: 2011, categories: ['TV'], resolutions: ['1080p'], trackers: [{ id: 'filelist', name: 'FileList' }], sourceCount: 1, bestSeeders: 8, largestSizeBytes: 1024 };
const detail: CatalogDetail = { title: series, seasons: [], sources: [] };
const emptyHousehold: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const info = (over: Partial<TitleInfo> = {}): TitleInfo => ({ titleId: 't1', available: true, kind: 'series', overview: 'A story.', releaseDate: '2011-04-17', seasons: 2, episodes: 18, cast: [{ name: 'Lead Actor', character: 'Hero' }], ...over });
const seasons = (): InfoSeasons => ({ titleId: 't1', available: true, seasons: [
  { number: 1, name: 'Season 1', airDate: '2011-04-17', episodeCount: 10, posterUrl: '/api/v1/artwork/t1/season-1-poster' },
  { number: 2, name: 'Season 2', airDate: '2012-04-01', episodeCount: 8 },
] });
const episodes = (): InfoEpisode[] => [1, 2, 3].map(number => ({
  number, name: `Episode title ${number}`, airDate: '2011-04-17', runtimeMinutes: 62, rating: 8.1, overview: `Story of episode ${number}.`, stillUrl: `/api/v1/artwork/t1/season-2-still-${number}`,
  directors: ['Tim Van Patten'], writers: ['David Benioff', 'D. B. Weiss'],
  guestStars: [{ name: 'Guest One', character: 'Herald', imageUrl: `/api/v1/artwork/t1/season-2-guest-${number}-0` }, { name: 'Solo Guest' }],
}));
const season = (over: Partial<InfoSeasonDetail> = {}): InfoSeasonDetail => ({ titleId: 't1', available: true, number: 2, name: 'Season 2', overview: 'The second season.', airDate: '2012-04-01', cast: [{ name: 'Season Lead', character: 'Ned' }], episodes: episodes(), ...over });

class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];
async function mountApp() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await act(async () => { });
}
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); }
const pressEscape = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) });
const heroInfo = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.hero-copy button')).find(button => button.textContent?.trim() === 'Info')!;
const dialog = () => document.querySelector<HTMLElement>('.info-dialog')!;
const row = (key: string) => dialog().querySelector<HTMLButtonElement>(`[data-info-key="${key}"]`)!;
const crumbs = () => Array.from(dialog().querySelectorAll('.info-crumbs li')).map(item => item.textContent);
const click = (element: HTMLElement) => act(async () => { element.focus(); element.click() });

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(emptyHousehold);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [series], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(detail);
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info());
  vi.spyOn(API.prototype, 'titleSeasons').mockResolvedValue(seasons());
  vi.spyOn(API.prototype, 'seasonInfo').mockResolvedValue(season());
  vi.spyOn(API.prototype, 'episodeInfo').mockResolvedValue(episodes()[0]);
});
afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openInfo() {
  await mountApp();
  await settle();
  await act(async () => { heroInfo().click() });
  await settle();
}

describe('web Info season drill-down', () => {
  it('offers a Seasons card to series, not to movies', async () => {
    await openInfo();
    expect(row('seasons').textContent).toContain('2 seasons, 18 episodes');
    expect(row('seasons').getAttribute('aria-haspopup')).toBe('true');
    expect(dialog().querySelector('.info-fine')?.textContent || '').not.toContain('seasons');
    await pressEscape();
    await settle();
    vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info({ kind: 'movie', seasons: undefined, episodes: undefined }));
    await act(async () => { heroInfo().click() });
    await settle();
    expect(dialog().querySelector('[data-info-key="seasons"]')).toBeNull();
  });

  it('drills Seasons, Season and Episode with a breadcrumb, and Escape pops one level at a time restoring focus', async () => {
    await openInfo();
    await click(row('seasons'));
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons']);
    expect(dialog().textContent).toContain('2011 · 10 episodes');
    expect(document.activeElement).toBe(row('season-1'));

    await click(row('season-2'));
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons', 'Season 2']);
    expect(dialog().textContent).toContain('The second season.');
    expect(dialog().textContent).toContain('E02 · Episode title 2');
    expect(dialog().textContent).toContain('Season Lead');

    await click(row('episode-2'));
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons', 'Season 2', 'E02']);
    expect(dialog().querySelector('[aria-current="page"]')!.textContent).toBe('E02');

    await pressEscape();
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons', 'Season 2']);
    expect(document.activeElement).toBe(row('episode-2'));
    await pressEscape();
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons']);
    expect(document.activeElement).toBe(row('season-2'));
    await pressEscape();
    await settle();
    expect(dialog().querySelector('.info-crumbs')).toBeNull();
    expect(document.activeElement).toBe(row('seasons'));
    await pressEscape();
    await settle();
    expect(document.querySelector('.info-dialog')).toBeNull();
    expect(document.activeElement).toBe(heroInfo());
  });

  it('shows the episode still, code, facts, story, credits and guest stars with an initials fallback', async () => {
    await openInfo();
    await click(row('seasons'));
    await settle();
    await click(row('season-2'));
    await settle();
    await click(row('episode-1'));
    await settle();
    const text = dialog().textContent!;
    expect(text).toContain('S02E01');
    expect(text).toContain('Apr 17, 2011');
    expect(text).toContain('1 h 2 min');
    expect(text).toContain('8.1 / 10');
    expect(text).toContain('Story of episode 1.');
    expect(text).toContain('Director');
    expect(text).toContain('Tim Van Patten');
    expect(text).toContain('David Benioff, D. B. Weiss');
    const still = dialog().querySelector<HTMLImageElement>('.info-still img')!;
    expect(still.getAttribute('src')).toMatch(/\/api\/v1\/artwork\/t1\/season-2-still-1$/);
    expect(still.getAttribute('loading')).toBe('lazy');
    const guests = Array.from(dialog().querySelectorAll('[aria-label="Guest stars"] li'));
    expect(guests).toHaveLength(2);
    expect(guests[0].querySelector('img')!.getAttribute('src')).toMatch(/season-2-guest-1-0$/);
    expect(guests[1].querySelector('img')).toBeNull();
    expect(guests[1].querySelector('.info-avatar')!.textContent).toBe('SG');
  });

  it('pops with the Back button and with a breadcrumb, and shows season posters and stills lazily', async () => {
    await openInfo();
    await click(row('seasons'));
    await settle();
    expect(row('season-1').querySelector('img')!.getAttribute('loading')).toBe('lazy');
    expect(row('season-2').querySelector('img')).toBeNull();
    await click(row('season-2'));
    await settle();
    expect(row('episode-1').querySelector('img')!.getAttribute('loading')).toBe('lazy');
    await click(row('episode-3'));
    await settle();
    await click(dialog().querySelector<HTMLButtonElement>('.info-back')!);
    await settle();
    expect(crumbs()).toEqual(['Alpha', 'Seasons', 'Season 2']);
    expect(document.activeElement).toBe(row('episode-3'));
    await click(Array.from(dialog().querySelectorAll<HTMLButtonElement>('.info-crumb')).find(button => button.textContent === 'Alpha')!);
    await settle();
    expect(dialog().querySelector('.info-crumbs')).toBeNull();
    expect(document.activeElement).toBe(row('seasons'));
  });

  it('says so calmly when the providers know no seasons, no episodes, or fail', async () => {
    vi.spyOn(API.prototype, 'titleSeasons').mockResolvedValue({ titleId: 't1', available: false, seasons: [] });
    await openInfo();
    await click(row('seasons'));
    await settle();
    expect(dialog().textContent).toContain('No season details from the metadata providers yet');
    await pressEscape();
    await settle();
    await pressEscape();
    await settle();

    vi.spyOn(API.prototype, 'titleSeasons').mockResolvedValue(seasons());
    vi.spyOn(API.prototype, 'seasonInfo').mockRejectedValue(new Error('offline'));
    await act(async () => { heroInfo().click() });
    await settle();
    await click(row('seasons'));
    await settle();
    await click(row('season-1'));
    await settle();
    expect(dialog().textContent).toContain('No episode details from the metadata providers yet');
    await pressEscape();
    await settle();
    expect(document.activeElement).toBe(row('season-1'));
  });

  it('asks the server for a lazy episode synopsis on open', async () => {
    vi.spyOn(API.prototype, 'seasonInfo').mockResolvedValue(season({ number: 1, episodes: [{ number: 1, name: 'Listed', lazyDetail: true }] }));
    const episodeInfo = vi.spyOn(API.prototype, 'episodeInfo').mockResolvedValue({ number: 1, overview: 'The synopsis.', runtimeMinutes: 24 });
    await openInfo();
    await click(row('seasons'));
    await settle();
    await click(row('season-1'));
    await settle();
    await click(row('episode-1'));
    await settle();
    expect(episodeInfo).toHaveBeenCalledWith('t1', 1, 1);
    expect(dialog().textContent).toContain('The synopsis.');
    expect(dialog().textContent).toContain('24 min');
  });
});
