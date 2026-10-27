import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type CatalogDetail, type HouseholdState } from '@torrent-tv/shared';
import { App } from './src';

// Secondary actions behind icon buttons and a More menu (#63), by the TV boards' rules: on the
// title overlay My List and Info are round icon buttons with spoken names and Refresh data sits
// in More; on a Downloads card Delete download sits in More. The menu opens on the More button,
// moves focus into its items, and Escape closes only the menu, handing focus back to More.

const detail: CatalogDetail = {
  title: { id: 't1', title: 'Alpha', kind: 'movie', year: 1999, categories: ['Movies'], resolutions: ['1080p'], trackers: [{ id: 'filelist', name: 'FileList' }], sourceCount: 1, bestSeeders: 8, largestSizeBytes: 1024 },
  seasons: [],
  sources: [{ release: { id: 'r1', trackerId: 'filelist', trackerName: 'FileList', providerId: 'r1', categoryId: '4', browseClass: 'video', name: 'release-r1', category: 'Movies', sizeBytes: 1024, seeders: 8, leechers: 0, freeleech: false, doubleUp: false, internal: false, moderated: false, comments: 0, fileCount: 1 }, parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p' } }] as unknown as CatalogDetail['sources'],
};
const emptyHousehold: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const download = {
  id: 'd2', releaseId: 'r2', engineId: 'qb:xyz789', fileIndex: 0, filePath: 'Silo.S02E01.1080p.mkv', mimeType: 'video/x-matroska',
  sizeBytes: 3889493092, state: 'seeding', progress: 1, playbackMode: 'local', downloadedBytes: 3889493092, speedBytesPerSecond: 0, etaSeconds: 0,
  peers: 0, seeds: 0, leased: false, error: '', streamUrl: '/api/v1/downloads/d2/stream',
};

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
const text = (element: Element) => (element.textContent || '').trim();
const named = (root: ParentNode, name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => (button.getAttribute('aria-label') || text(button)) === name);
const press = (key: string) => act(() => { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) });

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(API.prototype, 'state').mockResolvedValue(emptyHousehold);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [detail.title], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'title').mockResolvedValue(detail);
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [download] as never[], nextCursor: null, total: 1 });
});
afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openTitle() {
  await mountApp();
  await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.media-card')).find(button => button.getAttribute('aria-label') === 'Open Alpha')!.click() });
  await settle();
  return document.querySelector<HTMLElement>('.detail .actions')!;
}

describe('title overlay actions', () => {
  it('shows My List and Info as named icon buttons and keeps Refresh data in More', async () => {
    const actions = await openTitle();
    const myList = named(actions, 'Add to My List')!;
    const info = named(actions, 'Info')!;
    expect(myList).toBeTruthy();
    expect(info).toBeTruthy();
    expect(text(myList)).toBe('');
    expect(text(info)).toBe('');
    expect(myList.querySelector('svg')).not.toBeNull();
    expect(Array.from(actions.querySelectorAll('button')).map(text)).not.toContain('Refresh data');
    const more = named(actions, 'More actions')!;
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens More into a menu whose Refresh data refreshes the title', async () => {
    const refresh = vi.spyOn(API.prototype, 'refreshTitle').mockResolvedValue(undefined as never);
    const actions = await openTitle();
    const more = named(actions, 'More actions')!;
    await act(async () => { more.click() });
    await settle();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map(text)).toEqual(['Refresh data']);
    expect(document.activeElement).toBe(items[0]);
    await act(async () => { items[0].click() });
    await settle();
    expect(refresh).toHaveBeenCalledWith('t1', 'Alpha', true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes only the menu on Escape and returns focus to More', async () => {
    const actions = await openTitle();
    const more = named(actions, 'More actions')!;
    await act(async () => { more.click() });
    await settle();
    await press('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('.detail')).not.toBeNull();
    expect(document.activeElement).toBe(more);
  });
});

describe('downloads card actions', () => {
  it('keeps Delete download in More and asks before deleting', async () => {
    await mountApp();
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')).find(button => button.textContent?.includes('Downloads'))!.click() });
    await settle();
    const card = document.querySelector<HTMLElement>('[data-download-id="d2"]')!;
    expect(Array.from(card.querySelectorAll('button')).map(text)).not.toContain('Delete download');
    const more = named(card, 'More actions')!;
    await act(async () => { more.click() });
    await settle();
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find(element => text(element) === 'Delete download')!;
    expect(item).toBeTruthy();
    await act(async () => { item.click() });
    await settle();
    expect(document.querySelector('#web-download-delete-heading')?.textContent).toBe('Delete download?');
  });
});
