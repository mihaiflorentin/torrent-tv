import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Ticket #62: Setup, the empty and error states and the getting-ready surfaces in the Night Screen look, read as
// text the way the other CSS contract tests read the sheet (no layout engine runs here). They pin what carries the
// design: no box inside a box, no hairlines, rows like the Settings board's rows, the board's type roles.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const main = readFileSync(resolve(here, 'main.tsx'), 'utf8');

// The declarations of every rule whose selector list contains exactly this selector.
function declarationsOf(selector: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map(part => part.trim()).includes(selector)) bodies.push(match[2]);
  }
  return bodies.join(';');
}
const value = (selector: string, property: string) => {
  const all = Array.from(declarationsOf(selector).matchAll(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'g')), match => match[1].trim());
  return all[all.length - 1];
};
const noBox = (selector: string) => {
  for (const property of ['background', 'border', 'border-left', 'border-top', 'box-shadow']) {
    expect(value(selector, property) ?? 'none', `${selector} ${property}`).toMatch(/^(0|none|transparent)$/);
  }
};

describe('empty and error states', () => {
  it('draw an empty state straight on the screen: a lead heading and a muted line, no panel', () => {
    noBox('.tv-empty');
    expect(value('.tv-empty', 'padding') ?? '0').toBe('0');
    expect(value('.tv-empty h2', 'font-size')).toBe('var(--tt-tv-text-lead)');
    expect(value('.tv-empty p', 'font-size')).toBe('var(--tt-tv-text-body)');
    expect(value('.tv-empty p', 'color')).toBe('var(--tt-text-muted)');
  });

  it('show a screen notice as a quiet rounded banner with no hairline edge', () => {
    expect(value('.tv-notice', 'background')).toBe('var(--tt-fill)');
    expect(value('.tv-notice', 'border-radius')).toBe('var(--tt-radius-xl)');
    expect(value('.tv-notice', 'border-left') ?? 'none').toBe('none');
  });
});

describe('Setup', () => {
  it('starts at the content edge with the screen heading of the boards', () => {
    expect(value('.setup', 'padding-left')).toBe('168px');
    expect(value('.setup>h1', 'font-size')).toBe('var(--tt-tv-text-heading)');
    expect(value('.setup>h1', 'letter-spacing')).toBe('var(--tt-tracking-heading)');
    expect(value('.setup-lead', 'font-size')).toBe('var(--tt-tv-text-lead)');
  });

  it('lists found servers as one column of Settings rows: name on the left, address and version muted on the right', () => {
    expect(value('.setup-results>*', 'flex') ?? '').not.toMatch(/50%/);
    expect(value('.setup-results button', 'flex-direction')).toBe('row');
    expect(value('.setup-results button', 'border-radius')).toBe('var(--tt-radius-xl)');
    expect(value('.setup-results button', 'min-height')).toBe('var(--tt-tv-target)');
    expect(value('.setup-results strong', 'font-size')).toBe('var(--tt-tv-text-body)');
    expect(value('.setup-results span', 'margin-left')).toBe('auto');
  });

  it('separates Manual address by space and a section label, not a hairline', () => {
    expect(value('.setup-manual', 'border-top') ?? 'none').toBe('none');
    expect(value('.setup-manual h2', 'font-size')).toBe('var(--tt-tv-text-meta)');
    expect(value('.setup-manual h2', 'color')).toBe('var(--tt-text-subtle)');
  });
});

describe('getting ready', () => {
  it('opens the preparing dialog on its own solid sheet, not the Settings panel', () => {
    const dialog = /<section role="dialog"[^>]*aria-labelledby="tv-prepare-heading"[^>]*>/.exec(main)?.[0] ?? '';
    expect(dialog).toMatch(/class="tv-prepare-confirm"/);
    expect(value('.tv-prepare-confirm', 'background')).toBe('var(--tt-overlay)');
    expect(value('.tv-prepare-confirm', 'border-radius')).toBe('var(--tt-radius-xl)');
    expect(value('.tv-prepare-confirm', 'border') ?? 'none').toBe('none');
  });

  it('draws the Player getting-ready panel with no hairline, its bar on the translucent fill', () => {
    expect(value('.player-ready', 'border') ?? 'none').toBe('none');
    expect(value('.player-ready', 'border-radius')).toBe('var(--tt-radius-xl)');
    expect(value('.player-ready-bar', 'background')).toBe('var(--tt-fill)');
    expect(value('.player-ready-fill', 'background')).toBe('var(--tt-accent)');
  });
});
