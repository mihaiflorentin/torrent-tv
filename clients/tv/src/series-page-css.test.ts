import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The series page in the "Series page" board's look (#57), read as text the way chromium53-css.test.ts reads the sheet:
// no layout engine runs here, so these pin the declarations that carry the design (season pills and episode rows straight
// on the art over a deeper bottom scrim, the still with its progress bar, the state word) and the Chromium 53 TV floor.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of every rule whose selector list contains exactly this selector.
function declarationsOf(selector: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map(part => part.trim()).includes(selector)) bodies.push(match[2]);
  }
  return bodies.join(';');
}
const value = (selector: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(declarationsOf(selector))?.[1].trim();
const px = (selector: string, property: string) => Number(/^(\d+)px$/.exec(value(selector, property) ?? '')?.[1]);

describe('TV series page in the new look', () => {
  const series = ['.season-browser', '.season-tabs', '.season-tabs button', '.season-panes', '.episode-column', '.episode-pane', '.episode-row', '.episode-tile', '.episode-tile .info-still-small', '.episode-tile .episode-progress', '.episode-state'];

  it('draws no card or hairlines: the pills, rows and the list-being-prepared sentence sit on the art', () => {
    for (const selector of ['.season-browser', '.episode-row', '.versions-head', '.season-pack-downloads', '.season-pack-card', '.episode-loading']) {
      const body = declarationsOf(selector);
      expect(body, selector).not.toMatch(/(?:^|[;\s])border(?:-top|-bottom)?\s*:\s*\d/);
      expect(body, selector).not.toMatch(/background\s*:\s*var\(--tt-(card-surface|raised)\)/);
    }
  });

  it('deepens the bottom scrim on a series page so the rows read on the ground, not on a halo', () => {
    const scrim = value('.series-page .tv-backdrop.sharp .tv-backdrop-scrim', 'background') ?? '';
    // Solid ground under the list, fading out above the season pills; the left scrim of the title page stays.
    expect(scrim).toMatch(/linear-gradient\(0deg, var\(--tt-scrim-bottom\) 0, var\(--tt-scrim-bottom\) \d+%, transparent \d+%\)/);
    expect(scrim).toMatch(/linear-gradient\(90deg/);
    expect(css).not.toMatch(/\.season-browser[^{]*\{[^}]*text-shadow/);
  });

  it('draws the season tabs as the board\'s 64 px pills at 28 px', () => {
    expect(px('.season-tabs button', 'height')).toBe(64);
    expect(px('.season-tabs button', 'font-size')).toBe(28);
  });

  it('gives each row the board\'s 256x144 still on a 176 px row, transparent at rest, 10 px apart', () => {
    expect(px('.episode-tile .info-still-small', 'width')).toBe(256);
    expect(px('.episode-tile .info-still-small', 'height')).toBe(144);
    expect(px('.episode-tile', 'height')).toBe(176);
    expect(value('.episode-tile', 'background')).toBe('transparent');
    expect(px('.episode-row', 'margin-bottom')).toBe(10);
  });

  it('marks the selected episode with a fill and a saffron edge, not colour alone, and the focused one with the ring', () => {
    expect(value('.episode-tile.selected', 'background')).toBe('var(--tt-fill-quiet)');
    expect(value('.episode-tile.selected', 'box-shadow')).toMatch(/inset \d+px 0 0 var\(--tt-accent\)/);
    expect(value('.info-stop:focus', 'background')).toBe('var(--tt-fill-selected)');
  });

  it('puts the progress bar on the still, in the accent over a light track', () => {
    expect(value('.episode-tile .episode-progress', 'position')).toBe('absolute');
    expect(value('.episode-tile .episode-progress', 'bottom')).toBe('12px');
    expect(value('.episode-tile .episode-progress', 'left')).toBe('12px');
    expect(value('.episode-tile .episode-progress', 'right')).toBe('12px');
    expect(value('.episode-tile .episode-progress b', 'background')).toBe('var(--tt-accent)');
  });

  it('writes the code in the quiet tone and clamps the synopsis to two lines with a max-height fallback', () => {
    expect(value('.episode-code', 'color')).toBe('var(--tt-text-subtle)');
    expect(value('.episode-tile .episode-synopsis', '-webkit-line-clamp')).toBe('2');
    const lineHeight = Number(value('.episode-tile .episode-synopsis', 'line-height'));
    expect(value('.episode-tile .episode-synopsis', 'max-height')).toBe(`${(lineHeight * 2).toFixed(1)}em`);
    expect(value('.episode-tile .episode-synopsis', 'overflow')).toBe('hidden');
  });

  it('colours the state word by its tone, the word always present', () => {
    expect(value('.episode-state.progress', 'color')).toBe('var(--tt-accent)');
    expect(value('.episode-state.ok', 'color')).toBe('var(--tt-ok)');
    expect(value('.episode-state.danger', 'color')).toBe('var(--tt-danger)');
    expect(value('.episode-state.quiet', 'color')).toBe('var(--tt-text-muted)');
  });

  it('keeps the list a positioned scroll area of two and a half rows, clear of the ring', () => {
    expect(value('.episode-pane', 'position')).toBe('relative');
    expect(value('.episode-pane', 'overflow-y')).toBe('auto');
    const cap = px('.episode-pane', 'max-height');
    expect(cap).toBeGreaterThanOrEqual(2 * 186);
    expect(cap).toBeLessThan(3 * 186);
  });

  it('lets the episode name and facts truncate inside the row', () => {
    expect(value('.info-row-copy', 'min-width')).toBe('0');
    for (const selector of ['.info-row-copy b', '.info-row-copy small']) {
      expect(declarationsOf(selector), selector).toMatch(/text-overflow:\s*ellipsis/);
      expect(declarationsOf(selector), selector).toMatch(/white-space:\s*nowrap/);
    }
  });

  it('draws no blur on the series page', () => {
    for (const selector of series) expect(declarationsOf(selector), selector).not.toMatch(/backdrop-filter|filter\s*:/);
  });

  it('stays on flexbox: no grid, gap, inset or aspect-ratio on the series page (Chromium 53)', () => {
    for (const selector of series) expect(declarationsOf(selector), selector).not.toMatch(/(?:^|[;\s])(?:display\s*:\s*grid|(?:grid-|column-|row-)?gap\s*:|inset\s*:|aspect-ratio\s*:)/);
  });
});
