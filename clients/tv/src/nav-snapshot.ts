// Where the viewer was in the catalog when playback started. App keeps the latest one while the
// Player owns the screen and hands it back to Catalog (optional `initialNav`) when the Player
// closes, so Back from the Player lands on the same route, title page, query and focus instead
// of Home. Pure data: Catalog does the rehydrating, App only stores it.
export type NavSort = 'newest' | 'seeders' | 'title' | 'rating';
export interface NavTarget { season?: number; episode?: number }
export interface NavSnapshot {
  route: string;
  titleId: string;
  titleName: string;
  target: NavTarget;
  query: string;
  category: string;
  sort: NavSort;
  focusKey: string;
  /** The open Category family on a Categories page, and its raw-category chip. */
  family?: string;
  familyCategory?: string;
}

export function navSort(value: string): NavSort {
  return value === 'seeders' || value === 'title' || value === 'rating' ? value : 'newest';
}

export function captureNav(state: { route: string; detail: { id: string; title: string } | null; target: NavTarget; query: string; category: string; sort: string; family?: string; familyCategory?: string }): NavSnapshot {
  const snapshot: NavSnapshot = {
    route: state.route,
    titleId: state.detail ? state.detail.id : '',
    titleName: state.detail ? state.detail.title : '',
    target: { season: state.target.season, episode: state.target.episode },
    query: state.query,
    category: state.category,
    sort: navSort(state.sort),
    focusKey: '',
  };
  if (state.family) { snapshot.family = state.family; snapshot.familyCategory = state.familyCategory || '' }
  return snapshot;
}

// The card to focus on a restored list. An open title page focuses its own Play or Resume.
export function restoredFocusKey(snapshot: NavSnapshot): string | null {
  return snapshot.titleId || !snapshot.focusKey ? null : snapshot.focusKey;
}
