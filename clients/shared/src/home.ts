// Shared, framework-free Home decisions for the TV and the browser: which discovery rows follow
// Recently added and what a row keeps, and which title the hero shows. Pure, so both clients agree.
import type { CatalogTitle, HouseholdItem } from './index';

export const HOME_EXTRA_ROW_LIMIT = 4;
export const HOME_ROW_PAGE_SIZE = 10;

export type HomeRowSpec = { key: string; title: string; query: Record<string, string | number>; ratedOnly?: boolean };

/** Discovery rows after Recently added. Old TVs decode every poster at once, so the list is capped and each row is ten titles. */
export function homeRowSpecs(): HomeRowSpec[] {
  const specs: HomeRowSpec[] = [
    { key: 'rated', title: 'Top rated', query: { sort: 'rating', pageSize: HOME_ROW_PAGE_SIZE }, ratedOnly: true },
    { key: 'movies', title: 'Movies', query: { kind: 'movie', sort: 'newest', pageSize: HOME_ROW_PAGE_SIZE } },
    { key: 'series', title: 'Series', query: { kind: 'series', sort: 'newest', pageSize: HOME_ROW_PAGE_SIZE } },
    { key: 'seeded', title: 'Most seeded', query: { sort: 'seeders', pageSize: HOME_ROW_PAGE_SIZE } },
  ];
  return specs.slice(0, HOME_EXTRA_ROW_LIMIT);
}

/** What a row shows: Top rated drops titles without a rating that has votes; every row stops at ten. */
export function homeRowItems(spec: HomeRowSpec, items: CatalogTitle[]): CatalogTitle[] {
  const kept = spec.ratedOnly ? items.filter(item => Boolean(item.rating && item.rating > 0 && item.ratingVotes && item.ratingVotes > 0)) : items;
  return kept.slice(0, HOME_ROW_PAGE_SIZE);
}

/** The Home hero: the first Continue watching item with a catalog title (so the viewer resumes), else the newest title. */
export function homeHero(continueWatching: HouseholdItem[], fallback: CatalogTitle | undefined): { title: CatalogTitle | undefined; resume?: HouseholdItem } {
  const resume = continueWatching.filter(item => Boolean(item.catalog) && !item.watched && item.positionMs > 0)[0];
  return resume ? { title: resume.catalog, resume } : { title: fallback };
}
