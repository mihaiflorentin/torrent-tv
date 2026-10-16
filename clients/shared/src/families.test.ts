import { describe, expect, it } from 'vitest';
import { familyCountLabel, familyNewestLine, familyTileLabel, CategoryFamily } from './families';

const family = (patch: Partial<CategoryFamily> = {}): CategoryFamily => ({ key: 'movies', name: 'Movies', count: 12, newestTitle: 'Dune', categories: ['Movies HD'], art: { url: '/art.svg', source: 'bundled' }, ...patch });

describe('family tile copy', () => {
  it('counts titles, singular and plural', () => {
    expect(familyCountLabel(family({ count: 1 }))).toBe('1 title');
    expect(familyCountLabel(family({ count: 12 }))).toBe('12 titles');
    expect(familyCountLabel(family({ count: 3 }), 'item')).toBe('3 items');
  });

  it('names the newest title, and drops the line when there is none', () => {
    expect(familyNewestLine(family())).toBe('Newest: Dune');
    expect(familyNewestLine(family({ newestTitle: '' }))).toBe('');
    expect(familyNewestLine(family({ newestTitle: undefined }))).toBe('');
  });

  it('reads as one sentence for assistive tech', () => {
    expect(familyTileLabel(family())).toBe('Movies, 12 titles. Newest: Dune');
    expect(familyTileLabel(family({ newestTitle: '' }))).toBe('Movies, 12 titles');
  });
});
