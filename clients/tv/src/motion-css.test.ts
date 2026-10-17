import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Motion on the TV (spec #45: the Velvet Booth look stays on capable engines, a cheaper equivalent on old ones).
// Read as text like chromium53-css.test.ts: the sidebar slides and its labels fade, and a focused poster eases its
// scale, all on compositor properties only; the lean-graphics root class (capability.ts) snaps every one of them.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsOf(selector: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map(part => part.trim()).includes(selector)) bodies.push(match[2]);
  }
  return bodies.join(';');
}
const transitions = [...css.matchAll(/transition\s*:\s*([^;}]+)/g)].map(match => match[1]);

describe('TV motion on capable engines', () => {
  it('never animates a main-thread property: only transform and opacity transition on the shell', () => {
    for (const selector of ['.tv-sidebar::before', '.tv-sidebar button span', '.poster-card']) {
      const value = /transition\s*:\s*([^;]+)/.exec(declarationsOf(selector))?.[1] ?? '';
      expect(value.split(',').every(part => /^\s*(transform|opacity)\b/.test(part)), `${selector}: ${value}`).toBe(true);
    }
    expect(transitions.join(' ')).not.toMatch(/\bclip\b/);
  });

  it('slides the sidebar panel with a transform, not by animating clip', () => {
    expect(declarationsOf('.tv-sidebar::before')).toMatch(/transform:\s*translateX\(-280px\)/);
    expect(declarationsOf('.tv-sidebar::before')).toMatch(/transition:\s*transform/);
    expect(declarationsOf('.tv-app.menu-open .tv-sidebar::before')).toMatch(/transform:\s*none/);
    expect(declarationsOf('.tv-sidebar')).not.toMatch(/\bclip\s*:/);
  });

  it('fades the sidebar labels with opacity', () => {
    expect(declarationsOf('.tv-sidebar button span')).toMatch(/transition:\s*opacity/);
  });

  it('eases the poster focus scale on transform only, in a short time', () => {
    expect(declarationsOf('.poster-card')).toMatch(/transition:\s*transform var\(--tt-dur-fast\)/);
  });

  it('snaps all of it on lean engines', () => {
    const lean = declarationsOf('.lean-graphics .tv-sidebar::before') + declarationsOf('.lean-graphics .tv-sidebar button span') + declarationsOf('.lean-graphics .poster-card');
    expect(lean.match(/transition:\s*none/g)).toHaveLength(3);
  });
});
