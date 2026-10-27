import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
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

type Rgba = { rgb: number[]; alpha: number };
function rgbaOf(map: Map<string, string>, name: string): Rgba {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(map.get(name) ?? '');
  expect(match, `${name} is an rgba() color`).not.toBeNull();
  return { rgb: [Number(match![1]), Number(match![2]), Number(match![3])], alpha: Number(match![4]) };
}
const rgbOf = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const over = (top: Rgba, under: number[]) => top.rgb.map((channel, i) => channel * top.alpha + under[i] * (1 - top.alpha));
const toHex = (channels: number[]) => '#' + channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');

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
      '--tt-text', '--tt-text-muted', '--tt-text-subtle', '--tt-text-faint',
      '--tt-fill', '--tt-fill-selected', '--tt-fill-focus', '--tt-on-fill-focus',
      '--tt-accent', '--tt-accent-hover', '--tt-on-accent', '--tt-accent-soft',
      '--tt-ok', '--tt-warn', '--tt-danger', '--tt-info',
      '--tt-focus-ring', '--tt-focus-edge', '--tt-focus-width-web', '--tt-focus-width-tv', '--tt-focus-offset', '--tt-focus-scale-tv',
      '--tt-font-sans', '--tt-weight-regular', '--tt-weight-medium', '--tt-weight-semibold', '--tt-weight-bold', '--tt-weight-black',
      '--tt-tracking-display', '--tt-tracking-heading', '--tt-figures',
      '--tt-text-sm', '--tt-text-md', '--tt-text-display',
      '--tt-tv-text-meta', '--tt-tv-text-body', '--tt-tv-text-lead', '--tt-tv-text-heading', '--tt-tv-text-title', '--tt-tv-text-title-compact', '--tt-tv-text-display',
      '--tt-space-1', '--tt-space-9', '--tt-tv-safe-x', '--tt-tv-safe-y', '--tt-target-web', '--tt-tv-target',
      '--tt-radius-sm', '--tt-radius-md', '--tt-radius-lg', '--tt-radius-xl', '--tt-radius-pill',
      '--tt-dur-fast', '--tt-dur-base', '--tt-dur-slow', '--tt-ease-out',
      '--tt-scrim-top', '--tt-scrim-text', '--tt-backdrop-blur-web', '--tt-backdrop-blur-tv',
      '--tt-card-surface', '--tt-text-shade', '--tt-text-shade-core', '--tt-controls-surface', '--tt-menu-surface', '--tt-tv-timeline-height', '--tt-controls-fade',
    ];
    expect(required.filter(name => !t.has(name))).toEqual([]);
  });

  it('keeps every text color at WCAG AA on every surface it can sit on', () => {
    const surfaces = ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay'].map(color);
    for (const name of ['--tt-text', '--tt-text-muted', '--tt-text-subtle', '--tt-accent', '--tt-ok', '--tt-warn', '--tt-danger', '--tt-info']) {
      for (const surface of surfaces) expect(contrast(color(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(color('--tt-on-accent'), color('--tt-accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('--tt-on-accent'), color('--tt-accent-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  // The neutral ground: near-black surfaces that step up in lightness, white text and two muted tones (the brighter one
  // for copy over art, the quieter one for copy on the plain ground), then a faint tone kept for separators.
  it('orders the surfaces and the text tones from dark to light', () => {
    const steps = ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay'].map(name => luminance(color(name)));
    for (let i = 1; i < steps.length; i++) expect(steps[i], 'each surface lighter than the one below').toBeGreaterThan(steps[i - 1]);
    const tones = ['--tt-text', '--tt-text-muted', '--tt-text-subtle', '--tt-text-faint'].map(name => luminance(color(name)));
    for (let i = 1; i < tones.length; i++) expect(tones[i], 'each text tone quieter than the one before').toBeLessThan(tones[i - 1]);
    expect(contrast(color('--tt-text-faint'), color('--tt-ink')), 'the faint separator still shows on the ground').toBeGreaterThanOrEqual(2);
    // The ground is a cool neutral, not a tinted (violet or warm) dark: red never leads green, green never leads blue,
    // and no channel strays far from the others.
    for (const name of ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay', '--tt-text', '--tt-text-muted', '--tt-text-subtle', '--tt-text-faint']) {
      const [r, g, b] = rgbOf(color(name));
      expect(r <= g && g <= b, `${name} is a cool neutral`).toBe(true);
      expect(b - r, `${name} is a neutral`).toBeLessThanOrEqual(24);
    }
  });

  it('reserves the white focused fill for ground-coloured text', () => {
    expect(color('--tt-fill-focus')).toBe('#ffffff');
    expect(color('--tt-on-fill-focus')).toBe(color('--tt-ink'));
    expect(contrast(color('--tt-on-fill-focus'), color('--tt-fill-focus'))).toBeGreaterThanOrEqual(7);
  });

  // Translucent card surfaces let the title's sharp backdrop show on the series page. The backdrop is any picture, so
  // the guarantee is checked against the brightest one there is (white). At 58% the card alone cannot hold 4.5:1 over
  // white, so the text carries a dark halo (--tt-text-shade). A halo around thin strokes never reaches its full alpha,
  // so the check uses only half of --tt-text-shade-core's alpha, with the selected-row tint under it.
  describe('translucent card surface', () => {
    const rgba = (name: string) => rgbaOf(t, name);
    const hex = toHex;
    const WHITE = [255, 255, 255];
    const MID_GREY = [128, 128, 128];
    const HALO_REACH = 0.5;
    const card = rgba('--tt-card-surface');
    const core = rgba('--tt-text-shade-core');
    const shaded = (ground: number[]) => over({ rgb: core.rgb, alpha: core.alpha * HALO_REACH }, ground);

    it('is clearly translucent but not clear', () => {
      expect(card.alpha, 'below 80%, so the art shows').toBeLessThan(0.7);
      expect(card.alpha, 'not so clear that the picture takes over').toBeGreaterThanOrEqual(0.5);
    });

    it('keeps text at WCAG AA on the halo over the card over the brightest possible backdrop', () => {
      const ground = shaded(over(card, WHITE));
      for (const name of ['--tt-text', '--tt-text-muted']) expect(contrast(color(name), hex(ground)), `${name} on the shaded card over white`).toBeGreaterThanOrEqual(4.5);
      const selected = shaded(over(rgba('--tt-accent-soft'), over(card, WHITE)));
      expect(contrast(color('--tt-text'), hex(selected)), 'text on the shaded selected row over white').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps text at WCAG AA on the card alone over a mid-grey picture, so a lost halo still reads', () => {
      const ground = over(card, MID_GREY);
      for (const name of ['--tt-text', '--tt-text-muted']) expect(contrast(color(name), hex(ground)), `${name} on the bare card over grey`).toBeGreaterThanOrEqual(4.5);
    });

    it('draws the halo as at most two small static layers of the shade core', () => {
      const layers = (t.get('--tt-text-shade') ?? '').split(/,(?![^()]*\))/).map(layer => layer.trim());
      expect(layers.length).toBeLessThanOrEqual(2);
      for (const layer of layers) {
        const match = /^(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+(\d+)px\s+var\(--tt-text-shade-core\)$/.exec(layer);
        expect(match, `"${layer}" is x y blur var(--tt-text-shade-core), with no spread`).not.toBeNull();
        expect(Number(match![3]), 'small blur, cheap on a TV').toBeLessThanOrEqual(12);
      }
      expect(core.alpha, 'a dark core').toBeGreaterThanOrEqual(0.85);
      expect(Math.max(...core.rgb), 'darker than the page ink').toBeLessThanOrEqual(14);
    });
  });

  // Controls rest on a translucent white fill and take a slightly stronger one when selected, so they read on the plain
  // ground and over the title's sharp backdrop alike. Over art, the fill sits on the title-page text scrim
  // (--tt-scrim-text); the backdrop is any picture, so the check uses the brightest one there is (white).
  describe('translucent control fills', () => {
    const fill = rgbaOf(t, '--tt-fill');
    const selected = rgbaOf(t, '--tt-fill-selected');
    const scrim = rgbaOf(t, '--tt-scrim-text');
    const WHITE = [255, 255, 255];

    it('are white at about 10% at rest and 14% when selected', () => {
      expect(fill.rgb).toEqual(WHITE);
      expect(selected.rgb).toEqual(WHITE);
      expect(fill.alpha).toBeGreaterThanOrEqual(0.08);
      expect(fill.alpha).toBeLessThanOrEqual(0.12);
      expect(selected.alpha).toBeGreaterThan(fill.alpha);
      expect(selected.alpha).toBeLessThanOrEqual(0.18);
    });

    it('keep text and the muted tone at WCAG AA on either fill over every surface', () => {
      for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay']) {
        for (const top of [fill, selected]) {
          const ground = toHex(over(top, rgbOf(color(surface))));
          for (const name of ['--tt-text', '--tt-text-muted']) expect(contrast(color(name), ground), `${name} on ${top.alpha} fill over ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('keep text and the muted tone at WCAG AA on either fill over the text scrim over a white picture', () => {
      for (const top of [fill, selected]) {
        const ground = toHex(over(top, over(scrim, WHITE)));
        for (const name of ['--tt-text', '--tt-text-muted']) expect(contrast(color(name), ground), `${name} on ${top.alpha} fill over the scrimmed white picture`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keep the focus ring at 3:1 against a selected fill on every surface', () => {
      for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay']) {
        expect(contrast(color('--tt-focus-ring'), toHex(over(selected, rgbOf(color(surface))))), `ring by a selected fill on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  });

  it('keeps the focus ring and control boundaries at 3:1 against every surface', () => {
    for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised', '--tt-overlay'].map(color)) {
      expect(contrast(color('--tt-focus-ring'), surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    for (const surface of ['--tt-ink', '--tt-surface', '--tt-raised'].map(color)) {
      expect(contrast(color('--tt-line-strong'), surface), `line-strong on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // Focus is white in this direction (the accent is not a focus colour): a white outline outside an offset gap and a
    // white inner edge on the control's own border.
    expect(color('--tt-focus-ring')).toBe('#ffffff');
    expect(color('--tt-focus-edge')).toBe('#ffffff');
    expect(px('--tt-focus-width-tv')).toBeGreaterThanOrEqual(4);
    expect(px('--tt-focus-width-web')).toBeGreaterThanOrEqual(3);
    expect(parseFloat(t.get('--tt-focus-scale-tv') as string)).toBeGreaterThan(1);
  });

  it('keeps television type readable at 3 metres on the 1920x1080 canvas', () => {
    expect(px('--tt-tv-text-meta')).toBeGreaterThanOrEqual(26);
    expect(px('--tt-tv-text-body')).toBeGreaterThanOrEqual(30);
    expect(px('--tt-tv-text-display')).toBeGreaterThanOrEqual(80);
    // The scale climbs: meta < body < lead < heading < compact title <= title <= display.
    const scale = ['--tt-tv-text-meta', '--tt-tv-text-body', '--tt-tv-text-lead', '--tt-tv-text-heading', '--tt-tv-text-title-compact'].map(px);
    for (let i = 1; i < scale.length; i++) expect(scale[i]).toBeGreaterThan(scale[i - 1]);
    expect(px('--tt-tv-text-title')).toBeGreaterThanOrEqual(px('--tt-tv-text-title-compact'));
    expect(px('--tt-tv-text-display')).toBeGreaterThanOrEqual(px('--tt-tv-text-title'));
    for (const name of Array.from(t.keys()).filter(key => key.startsWith('--tt-tv-text-'))) expect(px(name), `${name} at or above the 26 px floor`).toBeGreaterThanOrEqual(26);
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

// Reads the character map of a woff2 file, so the tests see which characters the bundled face really draws.
// woff2 keeps every table in one brotli stream in directory order; cmap is never transformed, so its bytes start at the
// sum of the stored lengths of the tables before it.
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Codepoints(path: string): Set<number> {
  const file = readFileSync(path);
  const numTables = file.readUInt16BE(12);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) break;
    }
    return value;
  };
  const tables: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[at++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = file.subarray(at, at + 4).toString('latin1');
      at += 4;
    }
    const origLength = base128();
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : origLength });
  }
  const stream = brotliDecompressSync(file.subarray(at));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 'cmap') break;
    offset += table.length;
  }
  const cmap = stream.subarray(offset);
  const points = new Set<number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.subarray(cmap.readUInt32BE(4 + i * 8 + 4));
    const format = sub.readUInt16BE(0);
    if (format === 4) {
      const segments = sub.readUInt16BE(6) / 2;
      for (let s = 0; s < segments; s++) {
        const end = sub.readUInt16BE(14 + s * 2);
        const start = sub.readUInt16BE(16 + segments * 2 + s * 2);
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) points.add(cp);
      }
    } else if (format === 12) {
      for (let g = 0; g < sub.readUInt32BE(12); g++) {
        for (let cp = sub.readUInt32BE(16 + g * 12); cp <= sub.readUInt32BE(20 + g * 12); cp++) points.add(cp);
      }
    }
  }
  return points;
}

describe('bundled font', () => {
  const fonts = read('fonts.css');
  const files = Array.from(fonts.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g), match => match[1]);

  it('ships one variable family, Inter, as local woff2 files with the license beside them', () => {
    const families = new Set(Array.from(fonts.matchAll(/font-family\s*:\s*['"]?([^;'"]+)/g), match => match[1].trim()));
    expect([...families]).toEqual(['Inter']);
    expect(files.length).toBeGreaterThanOrEqual(2);
    let total = 0;
    for (const file of files) {
      expect(file, 'local relative url').toMatch(/^\.\/fonts\/inter-[\w.-]+\.woff2$/);
      const path = resolve(designDir, file);
      expect(existsSync(path), file).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), `${file} is woff2`).toBe('wOF2');
      expect(statSync(path).size, `${file} stays small`).toBeLessThan(64 * 1024);
      total += statSync(path).size;
    }
    // The TV build inlines the face into its CSS, so the whole family stays under 100 KB.
    expect(total).toBeLessThan(100 * 1024);
    expect(files.every(file => !/^(?:https?:)?\/\//.test(file))).toBe(true);
    expect(fonts).not.toMatch(/local\(/);
    const license = readFileSync(resolve(designDir, 'fonts/OFL.txt'), 'utf8');
    expect(license).toContain('SIL Open Font License, Version 1.1');
    expect(license).toContain('The Inter Project Authors');
    const shipped = readdirSync(resolve(designDir, 'fonts')).sort();
    expect(shipped).toEqual(['OFL.txt', 'README.md', ...files.map(file => file.replace('./fonts/', ''))].sort());
  });

  it('leaves no trace of the previous face in the shared design files', () => {
    for (const name of ['tokens.css', 'fonts.css', 'fonts/README.md', 'fonts/OFL.txt']) {
      expect(readFileSync(resolve(designDir, name), 'utf8'), name).not.toMatch(/bricolage/i);
    }
  });

  it('declares the variable face only where variable fonts exist, so Chromium 53 keeps its platform sans', () => {
    // Chromium 53 cannot apply a weight axis: it would render the default instance for every weight.
    const face = /@supports\s*\(\s*font-variation-settings\s*:\s*normal\s*\)\s*\{([\s\S]*)\}\s*$/.exec(fonts.trim());
    expect(face, 'every @font-face sits inside @supports (font-variation-settings: normal)').not.toBeNull();
    expect(fonts.match(/@font-face/g)?.length).toBe(face?.[1].match(/@font-face/g)?.length);
    expect(fonts).toMatch(/font-weight\s*:\s*400 800/);
    expect(fonts).toMatch(/font-display\s*:\s*swap/);
    expect(fonts.match(/unicode-range/g)?.length).toBe(files.length);
    // Romanian diacritics (ă ș ț) live in the latin-ext range.
    expect(fonts).toMatch(/U\+0100-02BA/);
  });

  it('draws basic Latin and every Romanian letter, each from the file whose range claims it', () => {
    const faces = Array.from(fonts.matchAll(/@font-face\s*\{([^{}]*)\}/g), block => {
      const file = /url\(\s*['"]?\.\/([^'")]+)/.exec(block[1])![1];
      const range = /unicode-range\s*:\s*([^;}]+)/.exec(block[1])![1];
      const ranges = Array.from(range.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi), part => [parseInt(part[1], 16), parseInt(part[2] ?? part[1], 16)]);
      return { ranges, drawn: woff2Codepoints(resolve(designDir, file)) };
    });
    for (const ch of Array.from('AaZz09.,;:!?€–—…“”ăâîșțĂÂÎȘȚşţŞŢ')) {
      const point = ch.codePointAt(0)!;
      const claimed = faces.filter(face => face.ranges.some(([lo, hi]) => point >= lo && point <= hi));
      expect(claimed.length, `${ch} is in a unicode-range`).toBeGreaterThan(0);
      expect(claimed.some(face => face.drawn.has(point)), `${ch} is drawn by the file whose range claims it`).toBe(true);
    }
  });

  it('names the face first in the font stack with the platform sans behind it', () => {
    const stack = tokens().get('--tt-font-sans') ?? '';
    expect(stack).toMatch(/^"Inter",/);
    expect(stack).toContain('Arial');
    expect(stack).toMatch(/sans-serif$/);
  });

  it('sets numbers in tabular figures through the figures token', () => {
    expect(tokens().get('--tt-figures')).toBe('tabular-nums');
  });
});

