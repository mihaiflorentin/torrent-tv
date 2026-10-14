import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

interface Rule { selectors: string[]; body: string; sheet: string }

// Stylesheets in the order main.tsx imports them, which is the order they
// reach the bundled app.css and therefore the cascade order on the TV.
function stylesheetOrder(): string[] {
  const entry = readFileSync(resolve(here, 'main.tsx'), 'utf8');
  return Array.from(entry.matchAll(/^import '\.\/([\w-]+\.css)';/gm), match => match[1]);
}

function rules(sheet: string): Rule[] {
  const css = readFileSync(resolve(here, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), match => ({
    selectors: match[1].split(',').map(selector => selector.trim()),
    body: match[2],
    sheet,
  }));
}

const plainFocus = new Set(['button:focus', 'input:focus', 'select:focus']);
const declaresShadow = (rule: Rule) => /(^|[;\s])box-shadow\s*:/.test(rule.body);

describe('TV focus ring', () => {
  const ordered = stylesheetOrder().flatMap(rules);
  const ringRule = ordered.find(rule => rule.selectors.some(selector => plainFocus.has(selector)) && declaresShadow(rule));

  it('is declared once for buttons, inputs and selects with the focus ring token', () => {
    expect(stylesheetOrder()).toContain('tv.css');
    expect(ringRule?.sheet).toBe('tv.css');
    for (const selector of plainFocus) expect(ringRule?.selectors).toContain(selector);
    expect(ringRule?.body).toContain('var(--tt-focus-ring)');
    expect(ringRule?.body).toContain('var(--tt-focus-edge)');
    expect(ringRule?.body).toContain('var(--tt-focus-shadow-tv)');
  });

  it('is not overridden by any later rule on the same elements', () => {
    const start = ordered.indexOf(ringRule!);
    const overrides = ordered.slice(start + 1)
      .filter(rule => rule.selectors.some(selector => plainFocus.has(selector)) && declaresShadow(rule))
      .map(rule => `${rule.sheet}: ${rule.selectors.join(', ')}`);
    expect(overrides).toEqual([]);
  });
});
