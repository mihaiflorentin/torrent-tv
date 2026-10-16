// Category families: the household-facing groups the Categories pages show instead of the raw tracker
// categories. The server owns the mapping and the art; clients only draw what /catalog/families and
// /library/families return.

export interface FamilyArt { url: string; source: 'catalog' | 'bundled'; titleId?: string }
export interface CategoryFamily { key: string; name: string; count: number; newestTitle?: string; newestTitleId?: string; categories: string[]; art: FamilyArt }

export function familyCountLabel(family: CategoryFamily, unit = 'title'): string {
  return `${family.count} ${unit}${family.count === 1 ? '' : 's'}`;
}

export function familyNewestLine(family: CategoryFamily): string {
  return family.newestTitle ? `Newest: ${family.newestTitle}` : '';
}

/** The tile read aloud as one phrase. */
export function familyTileLabel(family: CategoryFamily, unit = 'title'): string {
  const newest = familyNewestLine(family);
  return `${family.name}, ${familyCountLabel(family, unit)}${newest ? `. ${newest}` : ''}`;
}
