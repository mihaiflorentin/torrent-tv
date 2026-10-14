import { describe, expect, it } from 'vitest';
import { captureNav, navSort, restoredFocusKey } from './nav-snapshot';

describe('captureNav', () => {
  it('records the route, the open title with its target, and the list filters', () => {
    const target = { season: 2, episode: 3 };
    const snapshot = captureNav({ route: 'search', detail: { id: 't1', title: 'Alpha' }, target, query: 'alp', category: 'Movies', sort: 'rating' });
    expect(snapshot).toEqual({ route: 'search', titleId: 't1', titleName: 'Alpha', target: { season: 2, episode: 3 }, query: 'alp', category: 'Movies', sort: 'rating', focusKey: '' });
    target.season = 9;
    expect(snapshot.target.season).toBe(2);
  });

  it('records no title when none is open', () => {
    const snapshot = captureNav({ route: 'continue', detail: null, target: {}, query: '', category: '', sort: 'newest' });
    expect(snapshot.titleId).toBe('');
    expect(snapshot.titleName).toBe('');
  });
});

describe('restoredFocusKey', () => {
  it('lets an open title page focus its own Play, and otherwise returns the saved key', () => {
    const base = captureNav({ route: 'home', detail: null, target: {}, query: '', category: '', sort: 'newest' });
    expect(restoredFocusKey({ ...base, focusKey: 'title-9' })).toBe('title-9');
    expect(restoredFocusKey({ ...base, titleId: 't1', focusKey: 'source-x' })).toBeNull();
    expect(restoredFocusKey({ ...base, focusKey: '' })).toBeNull();
  });
});

describe('navSort', () => {
  it('accepts the known sorts and falls back to newest', () => {
    expect(navSort('seeders')).toBe('seeders');
    expect(navSort('title')).toBe('title');
    expect(navSort('bogus')).toBe('newest');
  });
});
