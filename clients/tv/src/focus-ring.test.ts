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

// The focus model (#53): every focusable kind shows two signals that do not depend on one CSS feature, a fill (or
// state) change plus a solid outline drawn outside the element. Compact controls turn white with ground-coloured
// text; rows and posters keep their own fill, lighter, inside the white ring; posters, landscape cards and the hero
// primary lift with a transform; nothing a list is made of changes geometry. Rules nested in @media/@supports are not
// read, and specific selectors win over the bare button ones, which is how tv.css is written.
const tv = rules('tv.css');
const GENERIC = ['button', 'button, input'];
function value(selectors: string[], property: string): string | undefined {
  const pattern = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`);
  let found: string | undefined;
  for (const rule of tv) {
    if (!rule.selectors.some(selector => selectors.includes(selector))) continue;
    const match = pattern.exec(rule.body);
    if (match) found = match[1].trim();
  }
  return found;
}
// The value an element shows: its own rules first, the bare button rules otherwise.
function shown(own: string[], generic: string[], property: string): string | undefined {
  return value(own, property) ?? value(generic, property);
}
const restOf = (own: string[], property: string) => shown(own, ['button'], property);
const focusOf = (own: string[], property: string) => shown(own.map(selector => `${selector}:focus`), ['button:focus'], property) ?? restOf(own, property);

const controls: Record<string, string[]> = {
  button: [],
  'primary button': ['button.primary'],
  chip: ['.tv-filters button'],
  'season tab': ['.season-tabs button'],
  'rail item': ['.tv-sidebar button'],
};
const rows: Record<string, string[]> = {
  'version row': ['.source-button'],
  'episode and info row': ['.info-stop'],
  'setup server row': ['.setup-results button'],
  'player menu row': ['.player-dialog button'],
  'project link': ['.tv-project'],
  poster: ['.poster-card'],
};

describe('TV focus model', () => {
  it('draws the solid outline outside every focused control, row and poster', () => {
    for (const [kind, own] of Object.entries({ ...controls, ...rows })) {
      expect(focusOf(own, 'outline'), kind).toMatch(/^4px solid var\(--tt-focus-ring\)$/);
      expect(focusOf(own, 'outline-offset'), kind).toBe('var(--tt-focus-offset)');
    }
  });

  it('turns a focused button, chip, tab or rail item solid white with ground-coloured text', () => {
    for (const [kind, own] of Object.entries(controls)) {
      expect(focusOf(own, 'background'), kind).toMatch(/var\(--tt-fill-focus\)$/);
      expect(focusOf(own, 'color'), kind).toBe('var(--tt-on-fill-focus)');
      expect(restOf(own, 'background'), kind).not.toMatch(/fill-focus/);
    }
  });

  it('gives a focused row or poster a lighter fill of its own, never the white one', () => {
    for (const [kind, own] of Object.entries(rows)) {
      const rest = restOf(own, 'background');
      const focused = focusOf(own, 'background');
      expect(focused, kind).toBeDefined();
      expect(focused, kind).not.toBe(rest);
      expect(focused, kind).not.toMatch(/fill-focus/);
      expect(focusOf(own, 'color'), kind).toBe('var(--tt-text)');
    }
  });

  it('keeps a destructive button distinct but calm: a word in the danger colour, no border box, a danger fill on focus', () => {
    expect(value(['.danger-button'], 'color')).toBe('var(--tt-danger)');
    expect(value(['.danger-button'], 'border-color')).toBeUndefined();
    expect(value(['.danger-button:focus'], 'background')).toBe('var(--tt-danger)');
    expect(value(['.danger-button:focus'], 'color')).toBe('var(--tt-on-fill-focus)');
  });

  it('draws buttons and chips as rounded pills on a translucent fill, with no hairline border', () => {
    expect(value(['button'], 'border-radius')).toBe('var(--tt-radius-pill)');
    expect(value(['button'], 'background')).toBe('var(--tt-fill)');
    expect(value(['button'], 'border-color')).toBe('transparent');
    for (const chip of ['.source-chip', '.tv-tracker-chip']) expect(value([chip], 'border') ?? 'none', chip).toMatch(/^(0|none)$/);
  });

  it('lifts posters, landscape cards and the hero primary with a transform, and leaves rows and tabs in place', () => {
    expect(value(['.poster-card:focus'], 'transform')).toBe('scale(var(--tt-focus-scale-tv))');
    expect(value(['.tv-hero button.primary:focus'], 'transform')).toBe('scale(var(--tt-focus-scale-tv))');
    for (const own of ['.source-button', '.info-stop', '.season-tabs button', '.tv-sidebar button', '.setup-results button', '.player-dialog button']) {
      const body = tv.filter(rule => rule.selectors.some(selector => selector.startsWith(own) && selector.endsWith(':focus'))).map(rule => rule.body).join(';');
      expect(body, own).not.toMatch(/(^|[;\s])(transform|width|height|padding|margin|border-width|font-size)\s*:/);
    }
  });
});
