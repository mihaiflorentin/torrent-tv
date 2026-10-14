import { describe, expect, it } from 'vitest';
import { HOME_EXTRA_ROW_LIMIT, homeHero, homeRowItems, homeRowSpecs } from '@torrent-tv/shared';
import type { CatalogTitle, HouseholdItem } from '@torrent-tv/shared';

// Home decisions both clients share: the discovery rows after Recently added and the hero.

const title = (id: string, over: Partial<CatalogTitle> = {}) => ({ id, title: id, kind: 'movie', ...over }) as CatalogTitle;
const item = (id: string, catalog: boolean, over: Partial<HouseholdItem> = {}) => ({ sourceId: id, releaseId: id, positionMs: 410, durationMs: 1000, watched: false, titleId: id, catalog: catalog ? title(id) : undefined, ...over }) as unknown as HouseholdItem;

describe('home rows', () => {
  it('are at most four, each a ten-title cache query', () => {
    const specs = homeRowSpecs();
    expect(specs.length).toBeLessThanOrEqual(HOME_EXTRA_ROW_LIMIT);
    expect(specs.map(spec => spec.title)).toEqual(['Top rated', 'Movies', 'Series', 'Most seeded']);
    for (const spec of specs) expect(spec.query.pageSize).toBe(10);
  });
  it('keep only titles with a rated vote count in Top rated, and ten per row', () => {
    const [rated, movies] = homeRowSpecs();
    expect(homeRowItems(rated, [title('a', { rating: 8, ratingVotes: 3 }), title('b'), title('c', { rating: 6 })]).map(entry => entry.id)).toEqual(['a']);
    expect(homeRowItems(movies, Array.from({ length: 15 }, (_, i) => title(`m${i}`)))).toHaveLength(10);
  });
});

describe('home hero', () => {
  const fallback = title('new');
  it('is the first unfinished Continue watching item with a catalog title', () => {
    expect(homeHero([item('raw', false), item('done', true, { watched: true }), item('a', true)], fallback).resume?.titleId).toBe('a');
  });
  it('is the newest title when nothing is in progress', () => {
    expect(homeHero([item('fresh', true, { positionMs: 0 })], fallback)).toEqual({ title: fallback });
    expect(homeHero([], undefined)).toEqual({ title: undefined });
  });
});
