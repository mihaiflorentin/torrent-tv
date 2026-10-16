import type { API, CategoryFamily } from '@torrent-tv/shared';
import { familyCountLabel, familyNewestLine, familyTileLabel } from '@torrent-tv/shared';
import { inRowReach, useRowReach } from './lazy-art';

// Category family tiles: wide 16:9 image tiles in a wrapped flex grid (no CSS grid on webOS 4). The tiles
// are poster cards in the content focus region, three to a row, from row 1 under the header Refresh button,
// so the first tile is the screen's landing card. Images load by grid row around focus (lazy-art.ts).

export const FAMILY_COLUMNS = 3;
export const FAMILY_FIRST_ROW = 1;

export function FamilyTiles({ api, families, unit, onOpen }: { api: API; families: CategoryFamily[]; unit: string; onOpen: (key: string) => void }) {
  const reach = useRowReach(FAMILY_FIRST_ROW);
  return <section class="tv-family-grid" aria-label="Category families">
    {families.map((family, index) => {
      const row = FAMILY_FIRST_ROW + Math.floor(index / FAMILY_COLUMNS);
      const art = api.streamURL(family.art.url);
      const newest = familyNewestLine(family);
      return <button key={family.key} class="poster-card family-tile" data-focus-region="content" data-focus-row={row} data-focus-col={index % FAMILY_COLUMNS} data-focus-key={`family-${family.key}`} data-landing={index === 0 ? 'true' : undefined} data-art={art} aria-label={familyTileLabel(family, unit)} onClick={() => onOpen(family.key)}>
        {inRowReach(reach, row) ? <img src={art} alt="" decoding="async" /> : <div class="poster-pending" />}
        <span class="family-copy"><strong>{family.name}</strong><span>{familyCountLabel(family, unit)}{newest ? ` · ${newest}` : ''}</span></span>
      </button>;
    })}
  </section>;
}

/** One chip per raw tracker category inside the family, plus All. */
export function FamilyChips({ name, categories, active, row, onPick }: { name: string; categories: string[]; active: string; row: number; onPick: (category: string) => void }) {
  return <div class="tv-filters tv-family-chips" role="group" aria-label={`Categories in ${name}`}>
    {['', ...categories].map((category, index) => <button key={category || 'all'} class={active === category ? 'active' : ''} aria-pressed={active === category ? 'true' : 'false'} data-focus-region="content" data-focus-row={row} data-focus-col={index} data-focus-key={`family-chip-${category || 'all'}`} onClick={() => onPick(category)}>{category || 'All'}</button>)}
  </div>;
}
