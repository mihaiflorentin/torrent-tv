// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { API, CatalogDetail, CatalogFacets, CatalogSource, CatalogTitle, HouseholdState, TitleInfo } from '@torrent-tv/shared';

// The Info panel on the TV: an Info button on the title page and on the Home hero opens a
// focus-trapped panel (own focus region) that loads TitleInfo, scrolls its cast by D-pad rows,
// and returns focus to the button on Back. main.tsx bootstraps against #app during module evaluation.
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
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 2, bestSeeders: 77, largestSizeBytes: 1000, trackers: [{ id: 'filelist', name: 'FileList' }], ...over });
const source = (id: string): CatalogSource => ({ release: { id, trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '4', browseClass: 'video', name: `Alpha.${id}`, category: 'Movies HD', sizeBytes: 4_200_000_000, seeders: 50, leechers: 2, freeleech: false, doubleUp: false, internal: false, moderated: false, comments: 0, fileCount: 1 } as CatalogSource['release'], parsed: { title: 'Alpha', sortTitle: 'alpha', kind: 'movie', resolution: '1080p', quality: 'WEB-DL' }, fileIndex: 0, filePath: `${id}.mkv`, fileSizeBytes: 4_200_000_000 });
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const info = (over: Partial<TitleInfo> = {}): TitleInfo => ({
  titleId: 'a', available: true, kind: 'movie', tagline: 'Welcome to the Real World.', overview: 'A hacker learns the truth.', releaseDate: '1999-03-30', runtimeMinutes: 136, rating: 8.2, genres: ['Action'],
  directors: ['Lana Wachowski'], countries: ['United States of America'],
  cast: [{ name: 'Keanu Reeves', character: 'Neo', imageUrl: '/api/v1/artwork/a/cast-0' }, { name: 'Carrie-Anne Moss', character: 'Trinity' }, { name: 'Cher' }],
  ...over,
});

function mount(container: HTMLElement, api: Partial<API>, titles: CatalogTitle[]) {
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

describe('TV Info panel', () => {
  let container: HTMLDivElement;
  const key = (focusKey: string) => container.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); });
  const openDetail = async (titleInfo: () => Promise<TitleInfo>) => {
    const data: CatalogDetail = { title: title(), seasons: [], sources: [source('only')] };
    mount(container, { title: async () => data, titleInfo } as unknown as Partial<API>, [data.title]);
    await wait();
    key('hero-a')!.click();
    await wait();
  };

  it('puts Info at the end of the actions row without moving the others', async () => {
    await openDetail(async () => info());
    const cols = ['detail-playback', 'detail-versions', 'detail-favorite', 'detail-refresh', 'detail-info'].map(name => [name, key(name)!.dataset.focusRow, key(name)!.dataset.focusCol]);
    expect(cols).toEqual([['detail-playback', '1', '0'], ['detail-versions', '1', '1'], ['detail-favorite', '1', '2'], ['detail-refresh', '1', '3'], ['detail-info', '1', '4']]);
  });

  it('shows a calm loading state, then the details in priority order', async () => {
    let finish: (value: TitleInfo) => void = () => { };
    await openDetail(() => new Promise<TitleInfo>(resolve => { finish = resolve; }));
    key('detail-info')!.click();
    await wait();
    const panel = container.querySelector('[role="dialog"].info-panel')!;
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector(`#${panel.getAttribute('aria-labelledby')}`)!.textContent).toBe('Alpha');
    expect(panel.textContent).toContain('Loading details…');
    finish(info());
    await wait();
    const text = panel.textContent!;
    expect(text).not.toContain('Loading details…');
    expect(text.indexOf('Mar 30, 1999')).toBeGreaterThan(-1);
    expect(text.indexOf('Welcome to the Real World.')).toBeLessThan(text.indexOf('Keanu Reeves'));
    expect(text.indexOf('A hacker learns the truth.')).toBeLessThan(text.indexOf('Keanu Reeves'));
    expect(text.indexOf('Keanu Reeves')).toBeLessThan(text.indexOf('United States of America'));
    expect(text).toContain('2 h 16 min');
    expect(text).toContain('Directed by');
  });

  it('keeps every stop in its own focus region, with Close first and cast rows in order', async () => {
    await openDetail(async () => info());
    key('detail-info')!.click();
    await wait();
    const stops = Array.from(container.querySelectorAll<HTMLElement>('.info-panel [data-focus-region]'));
    expect(stops.every(stop => stop.dataset.focusRegion === 'info-panel')).toBe(true);
    const rows = stops.map(stop => Number(stop.dataset.focusRow));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(new Set(rows).size).toBe(rows.length);
    expect(stops[0].dataset.focusKey).toBe('info-close');
    expect(stops.filter(stop => (stop.dataset.focusKey || '').indexOf('info-cast-') === 0)).toHaveLength(3);
    expect((document.activeElement as HTMLElement).closest('.info-panel')).not.toBeNull();
  });

  it('renders cast photos lazily and falls back to initials without one', async () => {
    await openDetail(async () => info());
    key('detail-info')!.click();
    await wait();
    const first = key('info-cast-0')!;
    expect(first.querySelector('img')!.getAttribute('loading')).toBe('lazy');
    expect(first.querySelector('img')!.getAttribute('src')).toBe('/api/v1/artwork/a/cast-0');
    expect(key('info-cast-1')!.querySelector('img')).toBeNull();
    expect(key('info-cast-1')!.querySelector('.info-avatar')!.textContent).toBe('CM');
  });

  it('closes on Back and returns focus to the Info button without leaving the title page', async () => {
    await openDetail(async () => info());
    key('detail-info')!.click();
    await wait();
    back();
    await wait();
    expect(container.querySelector('.info-panel')).toBeNull();
    expect(container.querySelector('.detail-screen')).not.toBeNull();
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('detail-info');
  });

  it('says so calmly when the server has no extra details, and survives a failed request', async () => {
    await openDetail(async () => ({ titleId: 'a', available: false }));
    key('detail-info')!.click();
    await wait();
    expect(container.querySelector('.info-panel')!.textContent).toContain('No extra details available');
    back();
    await wait();
    render(null, container);
    container.innerHTML = '';
    await openDetail(async () => { throw new Error('offline'); });
    key('detail-info')!.click();
    await wait();
    expect(container.querySelector('.info-panel')!.textContent).toContain('No extra details available');
  });

  it('offers Info on the Home hero beside View versions and returns to it on Back', async () => {
    mount(container, { titleInfo: async () => info() } as unknown as Partial<API>, [title()]);
    await wait();
    const hero = key('hero-a')!;
    const button = key('hero-info-a')!;
    expect([hero.dataset.focusRow, hero.dataset.focusCol]).toEqual(['1', '0']);
    expect([button.dataset.focusRow, button.dataset.focusCol]).toEqual(['1', '1']);
    button.click();
    await wait();
    expect(container.querySelector('.info-panel')!.textContent).toContain('Welcome to the Real World.');
    back();
    await wait();
    expect(container.querySelector('.info-panel')).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('hero-info-a');
  });
});
