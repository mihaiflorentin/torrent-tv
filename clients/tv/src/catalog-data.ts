import { canonicalHouseholdItems, CatalogFacets, HomeRowSpec, HouseholdItem, HouseholdState } from '@torrent-tv/shared';

export type HouseholdSection = { key: 'continue' | 'favorites' | 'recent' | 'watched'; title: string; items: HouseholdItem[] };

export function householdSections(route: string, state: HouseholdState): HouseholdSection[] {
  if (route === 'home') return [{ key: 'continue', title: 'Continue watching', items: canonicalHouseholdItems(state.continueWatching) }, { key: 'favorites', title: 'My List', items: canonicalHouseholdItems(state.favorites) }];
  if (route === 'library') return [{ key: 'continue', title: 'Continue watching', items: canonicalHouseholdItems(state.continueWatching) }, { key: 'recent', title: 'Recently viewed', items: canonicalHouseholdItems(state.recent) }, { key: 'watched', title: 'Watched', items: canonicalHouseholdItems(state.watched) }];
  if (route === 'continue') return [{ key: 'continue', title: 'Continue watching', items: canonicalHouseholdItems(state.continueWatching) }];
  if (route === 'favorites') return [{ key: 'favorites', title: 'My List', items: canonicalHouseholdItems(state.favorites) }];
  if (route === 'watched') return [{ key: 'watched', title: 'Watched', items: canonicalHouseholdItems(state.watched) }];
  return [];
}


export function nearEnd(index: number, total: number, lookahead = 4): boolean { return total > 0 && index >= total - lookahead; }
export function trackerCategories(facets: CatalogFacets): string[] { return facets.categories; }

// Home rows, top to bottom. Render order equals numeric order because structured movement sorts by row number.
// 3 is Continue watching, 10 Recently added, 11 to 14 the discovery rows, 20 My List.
export const HOME_ROW = { continue: 3, recent: 10, extra: 11, favorites: 20 } as const;
/** Rows to have loaded once focus has reached `deepestRow`: row n is asked for when focus reaches the row before it. */
export function homeExtraRowsDue(deepestRow: number, specs: HomeRowSpec[]): HomeRowSpec[] {
  return specs.slice(0, Math.max(0, Math.min(specs.length, deepestRow - HOME_ROW.recent + 1)));
}

export { HOME_EXTRA_ROW_LIMIT, HOME_ROW_PAGE_SIZE, homeHero, homeRowItems, homeRowSpecs } from '@torrent-tv/shared';
export type { HomeRowSpec } from '@torrent-tv/shared';
