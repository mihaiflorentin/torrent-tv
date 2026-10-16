import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const designDir = resolve(dirname(fileURLToPath(import.meta.url)), '../design');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (name: string) => strip(readFileSync(resolve(designDir, name), 'utf8'));
const sheets = ['tokens.css', 'fonts.css'];

// The token sheet is the one source of design values for the browser app and
// the TV client (Tizen 5.0 Chromium 63, webOS 4 Chromium 53). Tests read it as
// a consumer would: custom properties by name, no CSS engine involved.
function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of read('tokens.css').matchAll(/:root\s*\{([^{}]*)\}/g)) {
    for (const declaration of block[1].matchAll(/(--tt-[\w-]+)\s*:\s*([^;]+);?/g)) map.set(declaration[1], declaration[2].trim());
  }
  return map;
}

function srgb(value: string): number {
  const channel = parseInt(value, 16) / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const digits = hex.replace('#', '');
  return 0.2126 * srgb(digits.slice(0, 2)) + 0.7152 * srgb(digits.slice(2, 4)) + 0.0722 * srgb(digits.slice(4, 6));
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('shared design tokens', () => {
  const t = tokens();
  const color = (name: string) => {
    const value = t.get(name);
    expect(value, `${name} is defined`).toMatch(/^#[0-9a-f]{6}$/);
    return value as string;
  };
  const px = (name: string) => {
    const value = t.get(name);
    expect(value, `${name} is defined in px`).toMatch(/^\d+(?:\.\d+)?px$/);
    return parseFloat(value as string);
  };

  it('defines the color, focus, type, spacing, radius, motion and backdrop families', () => {
    const required = [
      '--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay', '--tt-line', '--tt-line-strong',
      '--tt-text', '--tt-text-muted', '--tt-accent', '--tt-accent-hover', '--tt-on-accent', '--tt-accent-soft',
      '--tt-ok', '--tt-warn', '--tt-danger', '--tt-info',
      '--tt-focus-ring', '--tt-focus-edge', '--tt-focus-width-web', '--tt-focus-width-tv', '--tt-focus-offset', '--tt-focus-scale-tv',
      '--tt-font-sans', '--tt-weight-regular', '--tt-weight-bold',
      '--tt-text-sm', '--tt-text-md', '--tt-text-display',
      '--tt-tv-text-meta', '--tt-tv-text-body', '--tt-tv-text-display',
      '--tt-space-1', '--tt-space-9', '--tt-tv-safe-x', '--tt-tv-safe-y', '--tt-target-web', '--tt-tv-target',
      '--tt-radius-sm', '--tt-radius-md', '--tt-radius-lg', '--tt-radius-pill',
      '--tt-dur-fast', '--tt-dur-base', '--tt-dur-slow', '--tt-ease-out',
      '--tt-scrim-top', '--tt-scrim-text', '--tt-backdrop-blur-web', '--tt-backdrop-blur-tv',
      '--tt-card-surface', '--tt-controls-surface', '--tt-menu-surface', '--tt-tv-timeline-height', '--tt-controls-fade',
    ];
    expect(required.filter(name => !t.has(name))).toEqual([]);
  });

  it('keeps every text color at WCAG AA on every surface it can sit on', () => {
    const surfaces = ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay'].map(color);
    for (const name of ['--tt-text', '--tt-text-muted', '--tt-accent', '--tt-ok', '--tt-warn', '--tt-danger', '--tt-info']) {
      for (const surface of surfaces) expect(contrast(color(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(color('--tt-on-accent'), color('--tt-accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('--tt-on-accent'), color('--tt-accent-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  // Translucent card surfaces let the title's sharp backdrop show on the series page. The backdrop is any picture, so
  // the guarantee is checked against the brightest one there is (white), with the selected-row tint on top.
  it('keeps text at WCAG AA on the translucent card surface over the brightest possible backdrop', () => {
    const rgba = (name: string) => {
      const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(t.get(name) ?? '');
      expect(match, `${name} is an rgba() color`).not.toBeNull();
      return { rgb: [Number(match![1]), Number(match![2]), Number(match![3])], alpha: Number(match![4]) };
    };
    const over = (top: { rgb: number[]; alpha: number }, under: number[]) => top.rgb.map((channel, i) => channel * top.alpha + under[i] * (1 - top.alpha));
    const hex = (channels: number[]) => '#' + channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
    const card = rgba('--tt-card-surface');
    expect(card.alpha, 'translucent enough for the art to show').toBeLessThanOrEqual(0.85);
    expect(card.alpha, 'not so clear that text loses its ground').toBeGreaterThanOrEqual(0.6);
    const panel = over(card, [255, 255, 255]);
    for (const name of ['--tt-text', '--tt-text-muted']) expect(contrast(color(name), hex(panel)), `${name} on the card over white`).toBeGreaterThanOrEqual(4.5);
    const selected = over(rgba('--tt-accent-soft'), panel);
    expect(contrast(color('--tt-text'), hex(selected)), 'text on the selected row over white').toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring and control boundaries at 3:1 against every surface', () => {
    for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay'].map(color)) {
      expect(contrast(color('--tt-focus-ring'), surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised'].map(color)) {
      expect(contrast(color('--tt-line-strong'), surface), `line-strong on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // Focus is a two-signal ring: a white inner edge besides the saffron outline.
    expect(color('--tt-focus-edge')).toBe('#ffffff');
    expect(px('--tt-focus-width-tv')).toBeGreaterThanOrEqual(4);
    expect(px('--tt-focus-width-web')).toBeGreaterThanOrEqual(3);
    expect(parseFloat(t.get('--tt-focus-scale-tv') as string)).toBeGreaterThan(1);
  });

  it('keeps television type readable at 3 metres on the 1920x1080 canvas', () => {
    expect(px('--tt-tv-text-meta')).toBeGreaterThanOrEqual(26);
    expect(px('--tt-tv-text-body')).toBeGreaterThanOrEqual(30);
    expect(px('--tt-tv-text-display')).toBeGreaterThanOrEqual(80);
    expect(px('--tt-tv-target')).toBeGreaterThanOrEqual(64);
    expect(px('--tt-tv-safe-x')).toBeGreaterThanOrEqual(96);
    expect(px('--tt-tv-safe-y')).toBeGreaterThanOrEqual(54);
    expect(px('--tt-target-web')).toBeGreaterThanOrEqual(44);
  });

  it('allows short transitions only, with no looping animation anywhere', () => {
    for (const name of ['--tt-dur-fast', '--tt-dur-base', '--tt-dur-slow', '--tt-controls-fade']) {
      const ms = /^(\d+)ms$/.exec(t.get(name) ?? '');
      expect(ms, `${name} is a ms duration`).not.toBeNull();
      expect(Number(ms?.[1])).toBeLessThanOrEqual(300);
    }
    for (const sheet of sheets) {
      const css = read(sheet);
      expect(css, sheet).not.toMatch(/\binfinite\b/);
      expect(css, sheet).not.toMatch(/@keyframes/);
    }
  });

  it('authors only constructs the Chromium 53 and 63 TV engines support', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['4- or 8-digit hex', /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{4})(?![0-9a-zA-Z_-])/],
      ['gap', /(?:^|[{;\s])(?:grid-|column-|row-)?gap\s*:/],
      ['inset', /(?:^|[{;\s])inset\s*:/],
      ['aspect-ratio', /aspect-ratio\s*:/],
      [':is()', /:is\(/],
      [':where()', /:where\(/],
      [':focus-visible', /:focus-visible/],
      ['min()/max()/clamp()', /(?<![\w-])(?:min|max|clamp)\(/],
      ['var() in a media query', /@media[^{]*var\(/],
    ];
    // Raw text, comments included: the packaging validators scan the built CSS
    // verbatim and Vite keeps comments (cssMinify is off for the TV builds).
    for (const sheet of sheets) {
      const raw = readFileSync(resolve(designDir, sheet), 'utf8');
      for (const [label, pattern] of forbidden) expect(raw, `${sheet}: ${label}`).not.toMatch(pattern);
    }
  });
});

describe('bundled font', () => {
  const fonts = read('fonts.css');
  const files = Array.from(fonts.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g), match => match[1]);

  it('ships one variable family as local woff2 files with the license beside them', () => {
    expect(new Set(Array.from(fonts.matchAll(/font-family\s*:\s*['"]?([^;'"]+)/g), match => match[1].trim())).size).toBe(1);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      expect(file, 'local relative url').toMatch(/^\.\/fonts\/[\w.-]+\.woff2$/);
      const path = resolve(designDir, file);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), `${file} is woff2`).toBe('wOF2');
      expect(statSync(path).size, `${file} stays small`).toBeLessThan(80 * 1024);
    }
    expect(files.every(file => !/^(?:https?:)?\/\//.test(file))).toBe(true);
    expect(fonts).not.toMatch(/local\(/);
    const license = readFileSync(resolve(designDir, 'fonts/OFL.txt'), 'utf8');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(readdirSync(resolve(designDir, 'fonts')).sort()).toEqual(
      expect.arrayContaining(['OFL.txt', 'README.md', ...files.map(file => file.replace('./fonts/', ''))]),
    );
  });

  it('declares the variable face only where variable fonts exist, so Chromium 53 keeps its platform sans', () => {
    // Chromium 53 cannot apply a weight axis: it would render the default
    // instance (ExtraBold for this face) for every weight.
    const face = /@supports\s*\(\s*font-variation-settings\s*:\s*normal\s*\)\s*\{([\s\S]*)\}\s*$/.exec(fonts.trim());
    expect(face, 'every @font-face sits inside @supports (font-variation-settings: normal)').not.toBeNull();
    expect(fonts.match(/@font-face/g)?.length).toBe(face?.[1].match(/@font-face/g)?.length);
    expect(fonts).toMatch(/font-weight\s*:\s*200 800/);
    expect(fonts).toMatch(/font-display\s*:\s*swap/);
    expect(fonts.match(/unicode-range/g)?.length).toBe(files.length);
    // Romanian diacritics (ă ș ț) live in the latin-ext range.
    expect(fonts).toMatch(/U\+0100-02BA/);
  });

  it('names the face first in the font stack with the platform sans behind it', () => {
    const stack = tokens().get('--tt-font-sans') ?? '';
    expect(stack).toMatch(/^"Bricolage Grotesque",/);
    expect(stack).toContain('Arial');
    expect(stack).toMatch(/sans-serif$/);
  });
});
