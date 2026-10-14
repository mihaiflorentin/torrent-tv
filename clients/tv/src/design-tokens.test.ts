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

// The TV stylesheets read the shared tokens; screens never carry their own palette, the old teal
// variables are gone, and nothing the viewer reads falls under the 26 px TV floor (DESIGN.md).
describe('TV stylesheets use the Velvet Booth tokens', () => {
  const sheets = ['tv.css', 'performance.css'];
  const css = (name: string) => source(name).replace(/\/\*[\s\S]*?\*\//g, '');

  it.each(sheets)('%s defines no legacy palette variables and reads none', name => {
    const text = css(name);
    expect(text).not.toMatch(/--(teal|panel|ink|soft|line|muted|focus)\s*:/);
    expect(text).not.toMatch(/var\(--(teal|panel|ink|soft|line|muted|focus)\)/);
  });

  it.each(sheets)('%s carries no colour of its own beyond video black and subtitle white', name => {
    const hex = css(name).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex.filter(value => !['#000', '#fff'].includes(value.toLowerCase()))).toEqual([]);
  });

  it.each(sheets)('%s uses no grid, which Chromium 53 lacks, no looping motion and no backdrop filter', name => {
    // The webOS pack check requires a `@supports not (display: grid)` block, which spells the word.
    const text = css(name).replace(/@supports not \(display: grid\)/g, '');
    expect(text).not.toMatch(/display\s*:\s*(inline-)?grid|grid-template|grid-auto/);
    expect(text).not.toMatch(/@keyframes|infinite|backdrop-filter/);
  });

  it('keeps every literal font size at or above the 26 px TV floor', () => {
    const sizes = Array.from(css('tv.css').matchAll(/font-size:\s*(\d+)px/g), match => Number(match[1]));
    expect(sizes.filter(size => size < 26)).toEqual([]);
  });

  it('draws the backdrop at half resolution, scaled up, blurred with the TV radius and faded by opacity', () => {
    const art = /\.tv-backdrop-art\s*\{([^{}]*)\}/.exec(css('tv.css'))?.[1] ?? '';
    expect(art).toMatch(/width:\s*960px/);
    expect(art).toMatch(/height:\s*540px/);
    expect(art).toMatch(/blur\(18px\)/);
    expect(art).toMatch(/transform:\s*scale\(2\)/);
    expect(art).toMatch(/transition:\s*opacity var\(--tt-dur-slow\)/);
    expect(art).not.toMatch(/transition:[^;]*(width|height|filter)/);
  });

  it('fades the player bar as one layer and hides it after the fade so it cannot take focus', () => {
    const text = css('tv.css');
    const hidden = /\.player-controls\s*\{([^{}]*)\}/.exec(text)?.[1] ?? '';
    expect(hidden).toMatch(/opacity:\s*0/);
    expect(hidden).toMatch(/visibility:\s*hidden/);
    expect(hidden).toMatch(/transition:\s*opacity var\(--tt-controls-fade\),\s*visibility 0s linear var\(--tt-controls-fade\)/);
    expect(hidden).toMatch(/background:\s*linear-gradient\(transparent, var\(--tt-scrim-bottom\)\)/);
    expect(/\.player-bar\s*\{([^{}]*)\}/.exec(text)?.[1]).toContain('var(--tt-controls-surface)');
  });

  it('puts the player menu on the solid menu surface and every control at the TV target height', () => {
    const text = css('tv.css');
    expect(/\.player-dialog\s*\{([^{}]*)\}/.exec(text)?.[1]).toContain('var(--tt-menu-surface)');
    expect(/\n(?:button,\s*input)\s*\{([^{}]*)\}/.exec(text)?.[1]).toContain('min-height: var(--tt-tv-target)');
  });

  it('reserves the release-name line on a version row and shows it only while the row has focus', () => {
    const text = css('tv.css');
    const base = /\.source-filename\s*\{([^{}]*)\}/.exec(text)?.[1] ?? '';
    expect(base).toMatch(/min-height:\s*34px/);
    expect(base).toMatch(/opacity:\s*0/);
    expect(/\.source-button:focus \.source-filename\s*\{([^{}]*)\}/.exec(text)?.[1]).toMatch(/opacity:\s*1/);
  });

  it('keeps the hero and detail text on their own scrim panel over the backdrop', () => {
    const text = css('tv.css');
    expect(/\.tv-hero-copy\s*\{([^{}]*)\}/.exec(text)?.[1]).toContain('var(--tt-scrim-text)');
    expect(/\.detail-copy\s*\{([^{}]*)\}/.exec(text)?.[1]).toContain('var(--tt-scrim-text)');
  });

  it('grows the focused timeline track to the token height without moving the controls below', () => {
    const text = css('tv.css');
    expect(/\.player-timeline:focus:before,[^{}]*\{([^{}]*)\}/.exec(text)?.[1]).toContain('var(--tt-tv-timeline-height-focus)');
    expect(/\.player-timeline\s*\{([^{}]*)\}/.exec(text)?.[1]).toMatch(/height:\s*36px/);
  });
});
