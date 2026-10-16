// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogDetail, CatalogFacets, CatalogTitle, HouseholdState } from '@torrent-tv/shared';
import { cardMeta, episodeMeta, heroFacts } from './display';

// Release dates on the TV listing surfaces: cards stay one short line (month and year), the hero and the
// title page carry the full date, series say 'Since <year>', and episode tiles show their air date.
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', trackers: [], categories: [], resolutions: [], sourceCount: 1, bestSeeders: 0, largestSizeBytes: 0, ...over });

describe('card and hero release lines', () => {
  it('shortens a known movie date on poster cards and keeps the year without one', () => {
    expect(cardMeta(title({ year: 2024, releaseDate: '2024-03-14', resolutions: ['1080p'] }))).toBe('Mar 2024 · 1080p');
    expect(cardMeta(title({ year: 2024 }))).toBe('2024');
  });
  it('says Since <year> for a series card', () => {
    expect(cardMeta(title({ kind: 'series', year: 2019, releaseDate: '2019-01-02' }))).toBe('Since 2019');
  });
  it('gives the hero the full date for a movie and Since for a series', () => {
    expect(heroFacts(title({ year: 2024, releaseDate: '2024-03-14' }))).toEqual(['Movie', 'Mar 14, 2024']);
    expect(heroFacts(title({ kind: 'series', seasonCount: 3, year: 2019 }))).toEqual(['3 seasons', 'Since 2019']);
  });
});

describe('episodeMeta', () => {
  const now = new Date(2026, 5, 15);
  it('adds the air date after the version count', () => {
    expect(episodeMeta({ sourceCount: 2, airDate: '2017-05-06' }, 0, now)).toBe('2 versions · May 6, 2017');
  });
  it('marks a future air date Upcoming and keeps watch progress last', () => {
    expect(episodeMeta({ sourceCount: 1, airDate: '2026-07-01' }, 40, now)).toBe('1 version · Upcoming · Jul 1, 2026 · 40% watched');
  });
  it('omits an unknown date', () => {
    expect(episodeMeta({ sourceCount: 1 }, 0, now)).toBe('1 version');
  });
});

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) || null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog } = await import('./main');
const wait = (ms = 40) => sleep(ms);
const empty: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };

describe('TV title page episode air dates', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); });

  it('shows each episode tile air date', async () => {
    const show = title({ kind: 'series', year: 2019, releaseDate: '2019-01-02' });
    const detail: CatalogDetail = { title: show, sources: [], seasons: [{ number: 1, title: 'Season 1', episodeCount: 1, episodes: [{ number: 1, title: 'Pilot', season: 1, airDate: '2019-01-02', sourceCount: 1, sources: [] }] }] } as unknown as CatalogDetail;
    render(
      <Catalog
        api={{ titles: async () => ({ items: [show], nextCursor: null, total: 0 }), title: async () => detail, ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}), jobs: async () => ({ items: [], nextCursor: null, total: 0 }) } as unknown as API}
        status="Online" titles={[show]} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
        household={empty} downloads={[]} jobs={[]} restoreFocus={null} portal={null} updateStatus={null}
        onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }}
        onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }}
      />,
      container,
    );
    await wait();
    container.querySelector<HTMLElement>('[data-focus-key="hero-a"]')!.click();
    await wait();
    expect(container.querySelector('.episode-tile small')!.textContent).toBe('1 version · Jan 2, 2019');
    expect(container.querySelector('.eyebrow')!.textContent).toBe('Series · Since 2019');
  });
});
