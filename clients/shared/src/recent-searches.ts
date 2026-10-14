// Shared, framework-free recent searches: the last few distinct search terms, newest first, kept per
// device. Storage is injected (clients pass localStorage, tests a plain object) and every access is
// best-effort, so private mode, a full store or corrupt data leaves search working without the list.
export interface RecentSearchStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const RECENT_SEARCHES_KEY = 'filelist.recentSearches';
export const RECENT_SEARCH_LIMIT = 8;
// The cache query needs three characters; shorter terms are not worth remembering.
const MIN_TERM = 3;

export function loadRecentSearches(storage: RecentSearchStorage | null | undefined): string[] {
  try {
    const parsed = JSON.parse((storage && storage.getItem(RECENT_SEARCHES_KEY)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length >= MIN_TERM).slice(0, RECENT_SEARCH_LIMIT);
  } catch { return []; }
}

/** Puts the term first, drops an earlier copy (case-insensitive) and the oldest beyond the cap. Returns the new list. */
export function recordRecentSearch(storage: RecentSearchStorage | null | undefined, term: string): string[] {
  const value = term.trim();
  const current = loadRecentSearches(storage);
  if (value.length < MIN_TERM) return current;
  const next = [value].concat(current.filter(item => item.toLowerCase() !== value.toLowerCase())).slice(0, RECENT_SEARCH_LIMIT);
  try { if (storage) storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { }
  return next;
}

export function clearRecentSearches(storage: RecentSearchStorage | null | undefined): void {
  try { if (storage) storage.removeItem(RECENT_SEARCHES_KEY); } catch { }
}

/** The browser's localStorage, or null where reading it throws (blocked storage). */
export function deviceStorage(): RecentSearchStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
