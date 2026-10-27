// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, CatalogFacets, CatalogTitle } from '@torrent-tv/shared';

// What the viewer sees of the shared TV vocabulary (#53): line icons drawn as SVG instead of type characters,
// the app mark instead of a letter block, and a rating that carries its star as a drawing, not a glyph.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => { store.set(key, val); }, removeItem: (key: string) => { store.delete(key); }, clear: () => { store.clear(); }, get length() { return store.size; }, key: () => null } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { Catalog, Setup } = await import('./main');

const here = dirname(fileURLToPath(import.meta.url));
const wait = (ms = 40) => sleep(ms);
// Characters the old client drew as icons: rail glyphs, arrows, the rating star, chevrons and checks.
const GLYPH_ICONS = /[⌂⌕◫◉▦≡↻⚙↗↓←→▶★☆✓✔✕×]/;
const rated = { id: 'r', title: 'Rated', kind: 'movie', year: 2019, resolutions: ['1080p'], rating: 7.44, ratingVotes: 120, categories: [], trackers: [], sourceCount: 1, bestSeeders: 5, largestSizeBytes: 1 } as unknown as CatalogTitle;

describe('TV icons and app mark', () => {
  let container: HTMLDivElement;
  const mount = (portal: unknown = null) => render(
    <Catalog
      api={{ titles: vi.fn().mockResolvedValue({ items: [rated], nextCursor: null, total: 1 }), searchTitles: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }), ensureMetadata: async () => ({ queued: 0 }), streamURL: (p: string) => p, call: async () => ({}) } as unknown as API}
      status="Online" titles={[rated]} facets={{ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] } as CatalogFacets}
      household={{ favorites: [], continueWatching: [], recent: [], watched: [] }} downloads={[]} jobs={[]} restoreFocus={null} portal={portal as never} updateStatus={null}
      onUpdateStatus={() => { }} onFocus={() => { }} onRetry={() => { }} onChangeServer={() => { }} onForgetServer={() => { }} onPlay={() => { }} onPlayDownload={() => { }}
      onManageDownload={async () => { }} onManageSeasonPack={async () => { }} onRefreshDownloads={async () => { }} onFavorite={() => { }}
    />, container);

  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { render(null, container); container.remove(); });

  it('draws every rail item as a line icon beside its label, with no glyph character', async () => {
    mount({ links: [{ id: 'p', name: 'Other', url: 'https://example.test' }], promotions: [] });
    await wait();
    const items = Array.from(container.querySelectorAll<HTMLElement>('.tv-sidebar [data-menu-route]'));
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) {
      const icon = item.querySelector('svg');
      expect(icon, item.dataset.menuRoute).not.toBeNull();
      expect(icon!.getAttribute('aria-hidden')).toBe('true');
      expect(item.textContent).toBe(item.querySelector('span')!.textContent);
      expect(item.textContent).not.toMatch(GLYPH_ICONS);
    }
    // Hubs that look alike in words still get different drawings.
    const drawing = (route: string) => container.querySelector(`[data-menu-route="${route}"] svg`)!.innerHTML;
    expect(new Set(['home', 'search', 'library', 'continue', 'favorites', 'watched', 'downloads', 'tracker', 'browse', 'jobs', 'settings', 'projects'].map(drawing)).size).toBe(12);
  });

  it('shows the app mark, a drawn play shape, instead of the TT letters', async () => {
    mount();
    await wait();
    const brand = container.querySelector('.tv-brand')!;
    expect(brand.querySelector('svg')).not.toBeNull();
    expect(brand.textContent).toBe('Torrent TV');
  });

  it('uses the same app mark on the server setup screen', async () => {
    render(<Setup draft="" server="" status="" onDraft={() => { }} onConnect={() => { }} onForget={() => { }} />, container);
    await wait();
    const mark = container.querySelector('.setup-mark')!;
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.textContent).toBe('');
  });

  it('draws the rating star on a poster card and keeps the number as text', async () => {
    mount();
    await wait();
    const card = container.querySelector<HTMLElement>('[data-focus-key="title-r"]')!;
    const meta = card.querySelector('.poster-copy span')!;
    expect(meta.textContent).toContain('7.4');
    expect(meta.textContent).not.toMatch(GLYPH_ICONS);
    expect(meta.querySelector('svg')).not.toBeNull();
  });

  it('leaves no glyph icon anywhere in the TV screens, including the back buttons and the row chevrons', () => {
    // Every screen is markup in these modules; a glyph in a string here is a glyph on a screen. Breadcrumb
    // separators (›) and the middle dot are typography, not icons, and stay.
    for (const file of ['main.tsx', 'families.tsx', 'title-info-panel.tsx', 'display.ts']) {
      const code = readFileSync(resolve(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code.match(new RegExp(GLYPH_ICONS.source, 'g')) ?? [], file).toEqual([]);
    }
    const panel = readFileSync(resolve(here, 'title-info-panel.tsx'), 'utf8') + readFileSync(resolve(here, 'main.tsx'), 'utf8');
    expect(panel).not.toMatch(/info-chevron" aria-hidden="true">›/);
  });
});
