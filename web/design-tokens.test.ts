import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The browser app and the desktop shell import the same shared token and font
// sheets as the TV client. Vite strips CSS imports from the module graph tests
// see, so the source text is the guard. vitest runs from web/.
const read = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8');

describe('web design token wiring', () => {
  it('imports the shared font and token sheets before style.css', () => {
    const entry = read('src.tsx');
    const fonts = entry.indexOf(`import '@torrent-tv/shared/design/fonts.css';`);
    const tokens = entry.indexOf(`import '@torrent-tv/shared/design/tokens.css';`);
    const style = entry.indexOf(`import './style.css';`);
    expect(fonts).toBeGreaterThanOrEqual(0);
    expect(tokens).toBeGreaterThan(fonts);
    expect(style).toBeGreaterThan(tokens);
  });

  it('sets the page font from the token', () => {
    const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const root = /:root\s*\{([^{}]*)\}/.exec(css)?.[1] ?? '';
    expect(root).toMatch(/font-family:\s*var\(--tt-font-sans,/);
  });

  it('gives the desktop shell the same sheets ahead of the web stylesheet', () => {
    const app = read('..', 'desktop', 'src', 'App.tsx');
    const tokens = app.indexOf(`import '@torrent-tv/shared/design/tokens.css';`);
    expect(app.indexOf(`import '@torrent-tv/shared/design/fonts.css';`)).toBeGreaterThanOrEqual(0);
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(app.indexOf(`import '@torrent-tv/web/style.css';`)).toBeGreaterThan(tokens);
  });
});
