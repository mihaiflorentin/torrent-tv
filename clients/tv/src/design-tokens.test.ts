import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (name: string) => readFileSync(resolve(here, name), 'utf8');

// The TV bundle and the webOS bundle (which imports ./main) both pull the
// shared design tokens and the bundled font from clients/shared/design, the
// same files the browser app imports. Vite strips CSS imports from the module
// graph tests see, so the source text is the guard.
describe('TV design token wiring', () => {
  it('imports the shared font and token sheets before the TV stylesheet', () => {
    const entry = source('main.tsx');
    const fonts = entry.indexOf(`import '@torrent-tv/shared/design/fonts.css';`);
    const tokens = entry.indexOf(`import '@torrent-tv/shared/design/tokens.css';`);
    const tv = entry.indexOf(`import './tv.css';`);
    expect(fonts).toBeGreaterThanOrEqual(0);
    expect(tokens).toBeGreaterThan(fonts);
    expect(tv).toBeGreaterThan(tokens);
  });

  it('sets the page font from the token with the platform sans as the fallback', () => {
    const css = source('tv.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const root = /:root\s*\{([^{}]*)\}/.exec(css)?.[1] ?? '';
    expect(root).toMatch(/font-family:\s*var\(--tt-font-sans,\s*Arial,/);
  });

  // The inline startup style sets font-family on html and body, which beats
  // the :root value by inheritance, so it must name the token too.
  it.each(['../index.html', '../../webos/index.html', '../../android-tv/app/assets/index.html'])('%s startup style uses the token font', name => {
    const html = source(name);
    expect(html).toMatch(/font-family:\s*var\(--tt-font-sans,\s*Arial,\s*sans-serif\)/);
    expect(html).not.toMatch(/font-family:\s*Arial/);
  });
});
