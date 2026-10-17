import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The series page's card surfaces and episode column, read as text the way chromium53-css.test.ts reads the sheet:
// no layout engine runs here, so these pin the declarations that carry the design (translucent token surfaces so the
// title's sharp backdrop shows, a narrow centred list) and the limits of the Chromium 53 TV floor.
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

describe('TV series page surfaces', () => {
  const series = ['.season-browser', '.season-panes', '.episode-column', '.episode-heading', '.episode-pane', '.episode-row', '.episode-tile'];

  it('puts the season browser on the translucent card token so the title art shows through', () => {
    expect(value('.season-browser', 'background')).toBe('var(--tt-card-surface)');
  });

  it('draws no blur and no extra shadow on the series page cards', () => {
    for (const selector of series) {
      const body = declarationsOf(selector);
      expect(body, selector).not.toMatch(/backdrop-filter|filter\s*:/);
      expect(body, selector).not.toMatch(/box-shadow/);
    }
  });

  it('keeps the selected row\'s facts at full text colour on its saffron tint', () => {
    expect(value('.episode-tile.selected small', 'color')).toBe('var(--tt-text)');
  });

  it('centres a list that is sized to its content, not a fixed 760px pane', () => {
    expect(value('.season-panes', 'justify-content')).toBe('center');
    expect(declarationsOf('.episode-pane')).not.toMatch(/flex\s*:\s*0 0 760px/);
    expect(value('.episode-column', 'flex')).toBe('0 1 auto');
    expect(value('.episode-column', 'max-width')).toMatch(/^\d+px$/);
    expect(value('.episode-column', 'min-width')).toMatch(/^\d+px$/);
  });

  it('heads the list with a heading that matches the Versions title', () => {
    expect(value('.episode-heading', 'font-size')).toBe(value('.versions-title', 'font-size'));
    expect(value('.episode-heading', 'font-weight')).toBe(value('.versions-title', 'font-weight'));
    expect(value('.episode-heading-label', 'color')).toBe('var(--tt-accent)');
  });

  it('stays on flexbox: no grid, gap or aspect-ratio on the series page (Chromium 53)', () => {
    for (const selector of series) expect(declarationsOf(selector), selector).not.toMatch(/(?:^|[;\s])(?:display\s*:\s*grid|(?:grid-|column-|row-)?gap\s*:|aspect-ratio\s*:)/);
  });
});
