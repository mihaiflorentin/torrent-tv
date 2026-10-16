import type { CategoryFamily } from '@torrent-tv/shared';
import { familyCountLabel, familyNewestLine, familyTileLabel } from '@torrent-tv/shared';

// Category family tiles and chips, shared by Tracker > Categories and My Library > Categories. The server
// owns the family mapping and the art (a title's backdrop, or the family's bundled artwork); the app draws
// what it returns. Every image is lazy-loaded, and the tile text sits on its own scrim so it reads over any art.

export function FamilyTiles({ families, unit, onOpen }: { families: CategoryFamily[]; unit: string; onOpen: (key: string) => void }) {
  return <section class="family-grid" aria-label="Category families">
    {families.map(family => {
      const newest = familyNewestLine(family);
      return <button key={family.key} class="family-tile" data-family={family.key} aria-label={familyTileLabel(family, unit)} onClick={() => onOpen(family.key)}>
        <img src={family.art.url} alt="" loading="lazy" decoding="async" />
        <span class="family-copy"><strong>{family.name}</strong><span>{familyCountLabel(family, unit)}{newest ? ` · ${newest}` : ''}</span></span>
      </button>;
    })}
  </section>;
}

/** One chip per raw tracker category inside the family, plus All. */
export function FamilyChips({ name, categories, active, onPick }: { name: string; categories: string[]; active: string; onPick: (category: string) => void }) {
  return <div class="family-chips" role="group" aria-label={`Categories in ${name}`}>
    {['', ...categories].map(category => <button key={category || 'all'} aria-pressed={active === category ? 'true' : 'false'} onClick={() => onPick(category)}>{category || 'All'}</button>)}
  </div>;
}
