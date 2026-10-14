import { describe, expect, it } from 'vitest';
import { CatalogFacets, HouseholdItem, HouseholdState } from '@torrent-tv/shared';
import { HOME_EXTRA_ROW_LIMIT, HOME_ROW, homeExtraRowsDue, homeHero, homeRowItems, homeRowSpecs, householdSections, nearEnd, trackerCategories } from './catalog-data';

const empty = { favorites: [], continueWatching: [], recent: [], watched: [] } as HouseholdState;

describe('Tizen route data parity', () => {
  it('uses the complete facet response for tracker categories', () => {
    const facets = { categories: ['Movies 4K', 'TV-Series HD'], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets;
    expect(trackerCategories(facets)).toEqual(facets.categories);
  });
  it('matches the website household sections', () => {
    expect(householdSections('home', empty).map(section => section.key)).toEqual(['continue', 'favorites']);
    expect(householdSections('library', empty).map(section => section.key)).toEqual(['continue', 'recent', 'watched']);
    expect(householdSections('favorites', empty).map(section => section.key)).toEqual(['favorites']);
  });
  it('renders one household dashboard card per canonical series title', () => {
    const release = { id: 'silo-pack', name: 'Silo Season 1', category: 'TV-Series HD', sizeBytes: 40_000_000_000, seeders: 20, leechers: 1, freeleech: false };
    const episode = (number: number, updatedAt: string) => ({ profileId: 'household', sourceId: `silo-e${number}`, releaseId: release.id, fileIndex: number, filePath: `Silo.S01E${String(number).padStart(2, '0')}.mkv`, positionMs: 1000, durationMs: 3600000, watched: false, updatedAt, release, favorite: false, titleId: 'silo', seasonNumber: 1, episodeNumber: number }) as HouseholdItem;
    const state = { ...empty, continueWatching: [episode(2, '2026-08-14T10:00:00Z'), episode(3, '2026-08-14T12:00:00Z')] } as HouseholdState;
    const items = householdSections('home', state)[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].episodeNumber).toBe(3);
  });
});

describe('nearEnd', () => {
  it('is true within the lookahead window of the end', () => {
    expect(nearEnd(20, 24)).toBe(true);
    expect(nearEnd(23, 24)).toBe(true);
  });
  it('is false away from the end or for an empty list', () => {
    expect(nearEnd(19, 24)).toBe(false);
    expect(nearEnd(0, 0)).toBe(false);
  });
});

describe('My List', () => {
  it('is the on-screen name of Household favorites, while the section key stays', () => {
    expect(householdSections('home', empty)[1]).toMatchObject({ key: 'favorites', title: 'My List' });
    expect(householdSections('favorites', empty)[0]).toMatchObject({ key: 'favorites', title: 'My List' });
  });
});

describe('Home discovery rows', () => {
  const t = (id: string, over = {}) => ({ id, title: id, kind: 'movie', ...over }) as never;
  it('defines at most four extra rows, each a 10-title query', () => {
    const specs = homeRowSpecs();
    expect(specs.length).toBeLessThanOrEqual(HOME_EXTRA_ROW_LIMIT);
    expect(specs.map(spec => spec.title)).toEqual(['Top rated', 'Movies', 'Series', 'Most seeded']);
    expect(specs.map(spec => spec.query)).toEqual([{ sort: 'rating', pageSize: 10 }, { kind: 'movie', sort: 'newest', pageSize: 10 }, { kind: 'series', sort: 'newest', pageSize: 10 }, { sort: 'seeders', pageSize: 10 }]);
    expect(new Set(specs.map(spec => spec.key)).size).toBe(specs.length);
  });
  it('numbers the rows so render order equals numeric order', () => {
    const rows = [3, HOME_ROW.recent, ...homeRowSpecs().map((_, index) => HOME_ROW.extra + index), HOME_ROW.favorites];
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(new Set(rows).size).toBe(rows.length);
  });
  it('keeps only rated titles in Top rated and caps every row at ten', () => {
    const [rated, movies] = homeRowSpecs();
    expect(homeRowItems(rated, [t('a', { rating: 8, ratingVotes: 10 }), t('b'), t('c', { rating: 7 })]).map(item => item.id)).toEqual(['a']);
    const many = Array.from({ length: 14 }, (_, i) => t(`m${i}`));
    expect(homeRowItems(movies, many)).toHaveLength(10);
  });
  it('asks for a row only once focus reaches the row before it', () => {
    const specs = homeRowSpecs();
    expect(homeExtraRowsDue(0, specs)).toEqual([]);
    expect(homeExtraRowsDue(3, specs)).toEqual([]);
    expect(homeExtraRowsDue(HOME_ROW.recent, specs).map(spec => spec.key)).toEqual([specs[0].key]);
    expect(homeExtraRowsDue(HOME_ROW.extra + 1, specs)).toHaveLength(3);
    expect(homeExtraRowsDue(99, specs)).toHaveLength(specs.length);
  });
});

describe('Home hero', () => {
  const item = (id: string, withCatalog: boolean, over = {}) => ({ profileId: 'h', sourceId: id, releaseId: id, fileIndex: 0, filePath: 'x', positionMs: 410, durationMs: 1000, watched: false, updatedAt: '', favorite: false, release: { id }, titleId: id, catalog: withCatalog ? { id, title: id, kind: 'movie' } : undefined, ...over }) as unknown as HouseholdItem;
  const fallback = { id: 'new', title: 'New', kind: 'movie' } as never;
  it('is the first Continue watching item that has a catalog title, with a Resume action', () => {
    const hero = homeHero([item('raw', false), item('a', true)], fallback);
    expect(hero.title?.id).toBe('a');
    expect(hero.resume?.titleId).toBe('a');
  });
  it('falls back to the newest title, without Resume, when nothing is in progress', () => {
    expect(homeHero([], fallback)).toEqual({ title: fallback });
    expect(homeHero([item('raw', false)], fallback)).toEqual({ title: fallback });
  });
  it('is absent when there is nothing at all', () => expect(homeHero([], undefined)).toEqual({ title: undefined }));
});
