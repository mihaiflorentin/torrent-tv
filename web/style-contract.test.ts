import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The browser app and the desktop shell read every design value from the shared
// --tt- tokens (clients/shared/design/tokens.css). These checks read the two
// stylesheets as text, the way design-tokens.test.ts reads the token sheet:
// no legacy teal variables, no copied hex values, visible focus, reduced motion
// honored, no looping animation, and no text smaller than the token floor.
// vitest runs from web/.
const read = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets: Array<[string, string]> = [
  ['web/style.css', strip(read('style.css'))],
  ['desktop/src/shell.css', strip(read('..', 'desktop', 'src', 'shell.css'))],
];

// Flat rule list, including rules inside one level of @media.
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: match[1].trim().replace(/^@media[^{]*\{\s*/, ''), body: match[2] });
  return out;
}
const declarations = (css: string, property: string): string[] =>
  Array.from(css.matchAll(new RegExp(`(?:^|[{;\\s])${property}\\s*:\\s*([^;}]+)`, 'g')), match => match[1].trim());

describe.each(sheets)('%s', (_name, css) => {
  it('uses only --tt- tokens (plus its own --w- locals), never the legacy teal variables', () => {
    expect(css).not.toMatch(/(?<![\w-])--(?:teal|teal-soft|panel|panel-2|panel-deep|ink|muted|amber|accent|line|text|danger|radius)\b(?!-)/);
    const locals = new Set(Array.from(css.matchAll(/(--w-[\w-]+)\s*:/g), match => match[1]));
    for (const use of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
      expect(use[1].startsWith('--tt-') || locals.has(use[1]), `${use[1]} is a token or a local`).toBe(true);
    }
  });

  it('copies no color values: no hex, and rgba only for black shadows', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/);
    for (const color of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) expect(color.slice(1, 4).join(','), 'only rgba(0,0,0,a) shadows').toBe('0,0,0');
  });

  it('never loops an animation or blurs the backdrop with a filter on the whole page', () => {
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/\binfinite\b/);
    expect(css).not.toMatch(/backdrop-filter/);
    for (const value of declarations(css, 'animation')) expect(value).toBe('none');
  });

  it('transitions only opacity, color, transform and shadow properties', () => {
    for (const value of [...declarations(css, 'transition'), ...declarations(css, 'transition-property')]) {
      for (const property of value.split(',').map(part => part.trim().split(/\s+/)[0])) {
        expect(['opacity', 'color', 'background-color', 'border-color', 'transform', 'box-shadow', 'visibility', 'outline-color', 'none'], `${property} in "${value}"`).toContain(property);
      }
    }
  });

  it('keeps text at or above the 13px token floor and the font on the token', () => {
    for (const value of declarations(css, 'font-size')) {
      const px = /^(\d*\.?\d+)px$/.exec(value);
      const rem = /^(\d*\.?\d+)rem$/.exec(value);
      if (px) expect(Number(px[1]), `font-size ${value}`).toBeGreaterThanOrEqual(13);
      if (rem) expect(Number(rem[1]) * 16, `font-size ${value}`).toBeGreaterThanOrEqual(13);
    }
    for (const value of declarations(css, 'font-family')) expect(value, 'font-family').toMatch(/^var\(--tt-font-sans|monospace/);
  });

  it('never removes an outline without a replacement on the same control', () => {
    for (const rule of rules(css)) {
      if (!/outline\s*:\s*(?:none|0)\b/.test(rule.body)) continue;
      expect(rule.selector, 'only the search field may drop its own outline; its wrapper shows focus').toMatch(/\.search input/);
    }
  });
});

describe('web/style.css', () => {
  const css = sheets[0][1];

  it('shows keyboard focus with the shared two-signal ring', () => {
    const focus = rules(css).filter(rule => /:focus-visible/.test(rule.selector));
    expect(focus.length).toBeGreaterThan(0);
    const joined = focus.map(rule => rule.body).join(';');
    expect(joined).toMatch(/outline\s*:\s*var\(--tt-focus-width-web\)\s+solid\s+var\(--tt-focus-ring\)/);
    expect(joined).toMatch(/var\(--tt-focus-offset\)/);
    expect(joined).toMatch(/var\(--tt-focus-edge\)/);
  });

  it('honors reduced motion by dropping transitions', () => {
    const block = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
    expect(block, 'a prefers-reduced-motion block exists').not.toBeNull();
    expect(block?.[1]).toMatch(/transition(?:-duration)?\s*:\s*(?:none|0s|0ms)\s*!important/);
  });

  it('keeps selection, progress and focus visible in forced-colors mode', () => {
    const block = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{([\s\S]*)\n\}\s*(?:\/\*|@media|$)/.exec(css)?.[1] ?? '';
    expect(block, 'a forced-colors block exists').not.toBe('');
    expect(block).toMatch(/\.nav-items button\.selected::before/);
    expect(block).toMatch(/progress[^{]*\{[^}]*forced-color-adjust\s*:\s*none/);
    expect(block).toMatch(/\.switch-field input:checked ~ \.switch-track/);
    expect(block).toMatch(/Highlight/);
  });

  it('sets the page on the ink token and the dark color scheme', () => {
    expect(css).toMatch(/color-scheme\s*:\s*dark/);
    expect(css).toMatch(/background\s*:\s*var\(--tt-ink\)/);
  });

  it('collapses to a phone layout and never forces horizontal scroll on the page', () => {
    expect(css).toMatch(/@media\s*\(\s*max-width\s*:\s*(?:640|600|599|560)px\s*\)/);
    expect(css).toMatch(/\.content\s*\{[^}]*min-width\s*:\s*0/);
  });
});

// The backdrop is artwork at --tt-backdrop-art-opacity under a --tt-scrim-top to
// --tt-scrim-bottom gradient. Worst case for text contrast is an all-white poster
// under the top of the gradient; secondary text there must still clear AA.
describe('backdrop scrim contrast', () => {
  const tokens = new Map<string, string>();
  for (const declaration of strip(read('..', 'clients', 'shared', 'design', 'tokens.css')).matchAll(/(--tt-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(declaration[1], declaration[2].trim());
  const hex = (name: string): [number, number, number] => {
    const value = tokens.get(name) ?? '';
    return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
  };
  const rgba = (name: string): { rgb: [number, number, number]; alpha: number } => {
    const parts = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(tokens.get(name) ?? '');
    expect(parts, `${name} is rgba()`).not.toBeNull();
    return { rgb: [Number(parts?.[1]), Number(parts?.[2]), Number(parts?.[3])], alpha: Number(parts?.[4]) };
  };
  const over = (top: [number, number, number], alpha: number, bottom: [number, number, number]) => top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha)) as [number, number, number];
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, b] = rgb.map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: [number, number, number], b: [number, number, number]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) };

  it('keeps muted text at 4.5:1 over an all-white poster under the top scrim', () => {
    const artOpacity = Number(tokens.get('--tt-backdrop-art-opacity'));
    const withArt = over([255, 255, 255], artOpacity, hex('--tt-ink'));
    const top = rgba('--tt-scrim-top');
    expect(contrast(hex('--tt-text-muted'), over(top.rgb, top.alpha, withArt))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps muted text at 4.5:1 under the text scrim even over the brightest art', () => {
    const withArt = over([255, 255, 255], 1, hex('--tt-ink'));
    const text = rgba('--tt-scrim-text');
    expect(contrast(hex('--tt-text-muted'), over(text.rgb, text.alpha, withArt))).toBeGreaterThanOrEqual(4.5);
  });
});

// The title overlay shows the title's backdrop as the picture it is: sharp, at full
// opacity, with a scrim that darkens the text side and fades out over the rest.
describe('title overlay art', () => {
  const css = sheets[0][1];
  const rule = (selector: string) => rules(css).filter(item => item.selector === selector).map(item => item.body).join('\n');

  it('draws the backdrop sharp and undimmed', () => {
    const art = rule('.detail-art') + rule('.detail-art img');
    expect(art).not.toMatch(/blur\(|filter\s*:/);
    expect(art).not.toMatch(/opacity\s*:/);
  });

  it('fades the scrim out toward the right instead of veiling the whole picture', () => {
    expect(rule('.detail-scrim')).toMatch(/linear-gradient\(90deg,\s*var\(--tt-scrim-text\)[^;]*transparent\s+100%\)/);
  });
});

// The series page: translucent token cards over the title's sharp backdrop, and one centred column sized to its rows.
// Contrast of the card token over the brightest possible picture is checked in clients/shared/src/design-tokens.test.ts.
describe('series page surfaces', () => {
  const css = sheets[0][1];
  const rule = (selector: string) => rules(css).filter(item => item.selector === selector).map(item => item.body).join('\n');
  const prop = (selector: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(rule(selector))?.[1].trim();

  it('puts the cards on the translucent card token', () => {
    for (const selector of ['.season-tabs', '.episode-column', '.versions-view']) expect(prop(selector, 'background'), selector).toBe('var(--tt-card-surface)');
  });

  // The text on those cards carries the --tt-text-shade halo (a button does not inherit text-shadow, so the transparent
  // episode rows take it directly); text on a saffron fill stays crisp.
  const shadeOf = (selector: string) => rules(css).filter(item => item.selector.split(',').map(part => part.trim()).includes(selector)).map(item => new RegExp('(?:^|[;\\s])text-shadow\\s*:\\s*([^;]+)').exec(item.body)?.[1].trim()).filter(Boolean).pop();

  it('puts a dark halo behind the text on the cards, and none on text over a saffron fill', () => {
    for (const selector of ['.season-tabs', '.episode-column', '.versions-view', '.episode-column .episode-select']) expect(shadeOf(selector), selector).toBe('var(--tt-text-shade)');
    for (const selector of ['.versions-view button.primary', '.versions-view .best-match', '.versions-view .source-action > b']) expect(shadeOf(selector), selector).toBe('none');
  });

  it('draws the halo statically: no transition or animation on text-shadow', () => {
    expect(css).not.toMatch(/transition[^;]*text-shadow/);
    expect(css).not.toMatch(/animation[^;]*text-shadow/);
  });

  it('leaves episode rows transparent inside their card, never a second solid layer', () => {
    expect(prop('.episode-list article', 'background')).toBe('transparent');
  });

  it('keeps the selected row\'s facts at full text colour on its saffron tint', () => {
    expect(prop('.episode-list article.selected .info-row-copy small', 'color')).toBe('var(--tt-text)');
  });

  it('centres one column that is sized to its content, and draws the carried art sharp', () => {
    expect(prop('.season-panes', 'justify-content')).toBe('center');
    expect(prop('.episode-column', 'flex')).toBe('0 1 auto');
    expect(prop('.episode-column', 'max-width')).toMatch(/^\d+px$/);
    expect(rule('.series-art img')).not.toMatch(/blur\(|filter\s*:|opacity\s*:/);
  });
});
