import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type HouseholdState, type TitleInfo } from '@torrent-tv/shared';
import { App } from './src';

// The web Info dialog: an Info button on the title detail and on the Home hero opens an accessible
// dialog (aria-labelledby, focus trap, Escape closes only it) that loads TitleInfo and renders the
// same ordered content as the TV panel, with a calm loading state and a calm "no details" state.

const detail: CatalogDetail = {
  title: { id: 't1', title: 'Alpha', kind: 'movie', year: 1999, categories: ['Movies'], resolutions: ['1080p'], trackers: [{ id: 'filelist', name: 'FileList' }], sourceCount: 1, bestSeeders: 8, largestSizeBytes: 1024 },
  seasons: [],
  sources: [{ release: { id: 'r1', trackerId: 'filelist', trackerName: 'FileList', providerId: 'r1', categoryId: '4', browseClass: 'video', name: 'release-r1', category: 'Movies', sizeBytes: 1024, seeders: 8, leechers: 0, freeleech: false, doubleUp: false, internal: false, moderated: false, comments: 0, fileCount: 1 }, parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p' } }] as unknown as CatalogDetail['sources'],
};
const emptyHousehold: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const info = (over: Partial<TitleInfo> = {}): TitleInfo => ({
  titleId: 't1', available: true, kind: 'movie', tagline: 'Welcome to the Real World.', overview: 'A hacker learns the truth.', releaseDate: '1999-03-30', runtimeMinutes: 136, rating: 8.2,
  genres: ['Action'], directors: ['Lana Wachowski'], countries: ['United States of America'],
  cast: [{ name: 'Keanu Reeves', character: 'Neo', imageUrl: '/api/v1/artwork/t1/cast-0' }, { name: 'Carrie-Anne Moss', character: 'Trinity' }],
  ...over,
});

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
const card = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.media-card')).find(button => button.getAttribute('aria-label') === 'Open Alpha')!;
const infoDialog = () => document.querySelector<HTMLElement>('.info-dialog')!.closest<HTMLElement>('[role="dialog"]')!;
const detailInfoButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.detail .actions button')).find(button => button.getAttribute('aria-label') === 'Info')!;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(emptyHousehold);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [detail.title], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(detail);
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
});
afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openInfoFromDetail() {
  await mountApp();
  await act(async () => { card().click() });
  await act(async () => { detailInfoButton().click() });
}

describe('web Info dialog', () => {
  it('opens an accessible dialog labelled by the title with the details in priority order', async () => {
    const spy = vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info());
    await openInfoFromDetail();
    await settle();
    expect(spy).toHaveBeenCalledWith('t1');
    const dialog = infoDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Alpha');
    const text = dialog.textContent!;
    expect(text).toContain('Mar 30, 1999');
    expect(text).toContain('2 h 16 min');
    expect(text.indexOf('Welcome to the Real World.')).toBeLessThan(text.indexOf('Keanu Reeves'));
    expect(text.indexOf('Keanu Reeves')).toBeLessThan(text.indexOf('United States of America'));
    expect(text).toContain('Directed by');
    const photo = dialog.querySelector('img')!;
    expect(photo.getAttribute('loading')).toBe('lazy');
    expect(dialog.querySelectorAll('.info-avatar')[1].textContent).toBe('CM');
  });

  it('moves focus into the dialog, closes on Escape leaving the detail open, and returns focus to Info', async () => {
    vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info());
    await openInfoFromDetail();
    await settle();
    expect(infoDialog().contains(document.activeElement)).toBe(true);
    await pressEscape();
    await settle();
    expect(document.querySelector('.info-dialog')).toBeNull();
    expect(document.querySelector('.detail')).not.toBeNull();
    expect(document.activeElement).toBe(detailInfoButton());
  });

  it('closes from its Close button', async () => {
    vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info());
    await openInfoFromDetail();
    await settle();
    await act(async () => { document.querySelector<HTMLButtonElement>('.info-dialog .close')!.click() });
    await settle();
    expect(document.querySelector('.info-dialog')).toBeNull();
  });

  it('shows a calm loading state first', async () => {
    let finish: (value: TitleInfo) => void = () => { };
    vi.spyOn(API.prototype, 'titleInfo').mockReturnValue(new Promise<TitleInfo>(resolve => { finish = resolve }));
    await openInfoFromDetail();
    expect(infoDialog().textContent).toContain('Loading details…');
    await act(async () => { finish(info()) });
    await settle();
    expect(infoDialog().textContent).not.toContain('Loading details…');
  });

  it('says there are no extra details when the server has none or the request fails', async () => {
    vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue({ titleId: 't1', available: false });
    await openInfoFromDetail();
    await settle();
    expect(infoDialog().textContent).toContain('No extra details available');
    await pressEscape();
    await settle();
    vi.spyOn(API.prototype, 'titleInfo').mockRejectedValue(new Error('offline'));
    await act(async () => { detailInfoButton().click() });
    await settle();
    expect(infoDialog().textContent).toContain('No extra details available');
  });

  it('offers Info on the Home hero', async () => {
    vi.spyOn(API.prototype, 'titleInfo').mockResolvedValue(info());
    await mountApp();
    await settle();
    const heroInfo = Array.from(document.querySelectorAll<HTMLButtonElement>('.hero-copy button')).find(button => button.textContent?.trim() === 'Info')!;
    expect(heroInfo).toBeDefined();
    await act(async () => { heroInfo.click() });
    await settle();
    expect(infoDialog().textContent).toContain('A hacker learns the truth.');
    await pressEscape();
    await settle();
    expect(document.activeElement).toBe(heroInfo);
  });
});
