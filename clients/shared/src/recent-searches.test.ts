import { describe, expect, it } from 'vitest';
import { RECENT_SEARCHES_KEY, RECENT_SEARCH_LIMIT, clearRecentSearches, loadRecentSearches, recordRecentSearch } from './recent-searches';

// Recent searches are a convenience: they keep the last eight distinct terms, newest first, and
// a blocked, full or corrupt store never throws.

const memory = (initial: Record<string, string> = {}) => {
  const data: Record<string, string> = { ...initial };
  return { data, getItem: (key: string) => (key in data ? data[key] : null), setItem: (key: string, value: string) => { data[key] = value; }, removeItem: (key: string) => { delete data[key]; } };
};
const broken = { getItem: (): string | null => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };

describe('recent searches', () => {
  it('starts empty', () => expect(loadRecentSearches(memory())).toEqual([]));
  it('records newest first', () => {
    const store = memory();
    recordRecentSearch(store, 'alpha');
    expect(recordRecentSearch(store, 'bravo')).toEqual(['bravo', 'alpha']);
    expect(loadRecentSearches(store)).toEqual(['bravo', 'alpha']);
  });
  it('moves a repeated term to the front, ignoring case and spaces', () => {
    const store = memory();
    recordRecentSearch(store, 'alpha');
    recordRecentSearch(store, 'bravo');
    expect(recordRecentSearch(store, '  ALPHA ')).toEqual(['ALPHA', 'bravo']);
  });
  it('ignores terms shorter than three characters', () => {
    const store = memory();
    expect(recordRecentSearch(store, ' ab ')).toEqual([]);
    expect(store.data[RECENT_SEARCHES_KEY]).toBeUndefined();
  });
  it('keeps at most eight', () => {
    const store = memory();
    for (let i = 1; i <= 12; i++) recordRecentSearch(store, `term ${i}`);
    const list = loadRecentSearches(store);
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list[0]).toBe('term 12');
    expect(list[7]).toBe('term 5');
  });
  it('clears', () => {
    const store = memory();
    recordRecentSearch(store, 'alpha');
    clearRecentSearches(store);
    expect(loadRecentSearches(store)).toEqual([]);
  });
  it('survives corrupt data', () => {
    expect(loadRecentSearches(memory({ [RECENT_SEARCHES_KEY]: '{oops' }))).toEqual([]);
    expect(loadRecentSearches(memory({ [RECENT_SEARCHES_KEY]: '[1,"okay",null]' }))).toEqual(['okay']);
  });
  it('never throws when storage is blocked or missing', () => {
    expect(loadRecentSearches(broken)).toEqual([]);
    expect(recordRecentSearch(broken, 'alpha')).toEqual(['alpha']);
    expect(() => clearRecentSearches(broken)).not.toThrow();
    expect(loadRecentSearches(null)).toEqual([]);
    expect(recordRecentSearch(undefined, 'alpha')).toEqual(['alpha']);
  });
});
