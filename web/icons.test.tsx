import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { Icon as TvIcon, ICON_NAMES as TV_ICON_NAMES } from '../clients/tv/src/icons';
import { Icon, ICONS } from './icons';

// One icon vocabulary for both apps (#63): the browser draws the TV's line icons with its own
// component. Every TV icon exists here with the same shapes, so a change to one set that is not
// made in the other fails here.

const shapes = (node: preact.VNode) => {
  const host = document.createElement('div');
  render(node, host);
  return Array.from(host.querySelector('svg')!.children).map(child => child.outerHTML);
};

describe('browser icons', () => {
  it('draw every TV icon with the same shapes', () => {
    for (const name of TV_ICON_NAMES) {
      if (name === 'restart' || name.includes('10') || ['audio', 'subtitles', 'options', 'back', 'hide'].includes(name)) continue; // Player-only TV icons
      expect(ICONS[name], name).toBeTruthy();
      expect(shapes(<Icon name={name} />), name).toEqual(shapes(<TvIcon name={name} />));
    }
  });

  it('are decorative line drawings in the control colour, and unknown names draw nothing', () => {
    const host = document.createElement('div');
    render(<Icon name="download" />, host);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    render(<Icon name="no-such-icon" />, host);
    expect(host.querySelector('svg')!.children.length).toBe(0);
  });
});
