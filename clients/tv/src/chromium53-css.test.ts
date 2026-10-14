import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

// webOS TV 4.0 runs Chromium 53 (ADR-0010): 4- and 8-digit hex colors are
// Chromium 62+, so shipped TV CSS authors translucent colors as rgba().
describe('TV CSS authored for Chromium 53', () => {
  const sheets = readdirSync(here).filter(name => name.endsWith('.css'));

  it('finds the shipped stylesheets', () => {
    expect(sheets).toEqual(expect.arrayContaining(['tv.css', 'performance.css']));
  });

  it.each(sheets)('%s has no 4- or 8-digit hex colors', sheet => {
    const css = readFileSync(resolve(here, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{4})(?![0-9a-zA-Z_-])/g) ?? []).toEqual([]);
  });

  it('keeps a solid outline on the focus ring besides the box-shadow', () => {
    const css = readFileSync(resolve(here, 'tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const ring = /button:focus,\s*input:focus,\s*select:focus\s*\{([^{}]*)\}/.exec(css)?.[1] ?? '';
    expect(ring).toMatch(/outline:\s*4px solid var\(--tt-focus-ring\)/);
  });
});
