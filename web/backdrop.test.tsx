import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { BackdropLayer, backdropArtFor, setBackdropArt } from './backdrop';

// The backdrop follows focus: one blurred layer behind the rows that crossfades
// to the artwork of the focused or hovered title and rests on the featured
// title when nothing is focused. Without artwork it is the designed tinted
// state, never an empty hole.

const hosts: HTMLElement[] = [];
function mount(ui: Parameters<typeof render>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  act(() => { render(ui, host) });
  return host;
}
afterEach(() => {
  act(() => { setBackdropArt(undefined) });
  for (const host of hosts) { render(null, host); host.remove() }
  hosts.length = 0;
});

const imgs = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLImageElement>('.backdrop-art'));
const shown = (host: HTMLElement) => imgs(host).filter(img => img.dataset.active === 'true').map(img => img.getAttribute('src'));

describe('backdrop art selection', () => {
  const title = { posterUrl: '/poster.jpg', backdropUrl: '/backdrop.jpg' };
  it('prefers the backdrop and falls back to the poster', () => {
    expect(backdropArtFor(title)).toBe('/backdrop.jpg');
    expect(backdropArtFor({ posterUrl: '/poster.jpg' })).toBe('/poster.jpg');
    expect(backdropArtFor({})).toBe('');
    expect(backdropArtFor(null)).toBe('');
  });
});

describe('BackdropLayer', () => {
  it('rests on the fallback art and is hidden from assistive technology', () => {
    const host = mount(<BackdropLayer fallback="/featured.jpg" />);
    const layer = host.querySelector('.backdrop')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(shown(host)).toEqual(['/featured.jpg']);
  });

  it('shows the designed tinted state when there is no artwork', () => {
    const host = mount(<BackdropLayer />);
    expect(host.querySelector('.backdrop')!.getAttribute('data-art')).toBe('false');
    expect(imgs(host)).toHaveLength(0);
  });

  it('crossfades to the focused title once its image has loaded', () => {
    const host = mount(<BackdropLayer fallback="/featured.jpg" />);
    act(() => { setBackdropArt('/focused.jpg') });
    // The new image waits in the hidden layer; the old one stays until it can be shown.
    expect(shown(host)).toEqual(['/featured.jpg']);
    const incoming = imgs(host).find(img => img.getAttribute('src') === '/focused.jpg')!;
    expect(incoming.dataset.active).toBe('false');
    act(() => { incoming.dispatchEvent(new Event('load')) });
    expect(shown(host)).toEqual(['/focused.jpg']);
  });

  it('returns to the fallback when focus is cleared', () => {
    const host = mount(<BackdropLayer fallback="/featured.jpg" />);
    act(() => { setBackdropArt('/focused.jpg') });
    act(() => { imgs(host).find(img => img.getAttribute('src') === '/focused.jpg')!.dispatchEvent(new Event('load')) });
    act(() => { setBackdropArt(undefined) });
    act(() => { imgs(host).find(img => img.getAttribute('src') === '/featured.jpg')?.dispatchEvent(new Event('load')) });
    expect(shown(host)).toEqual(['/featured.jpg']);
  });

  it('fades out when focus clears and there is no featured title', () => {
    const host = mount(<BackdropLayer />);
    act(() => { setBackdropArt('/focused.jpg') });
    act(() => { imgs(host).find(img => img.getAttribute('src') === '/focused.jpg')!.dispatchEvent(new Event('load')) });
    expect(host.querySelector('.backdrop')!.getAttribute('data-art')).toBe('true');
    act(() => { setBackdropArt(undefined) });
    expect(host.querySelector('.backdrop')!.getAttribute('data-art')).toBe('false');
    expect(shown(host)).toEqual([]);
  });

  it('keeps the previous artwork when the incoming image fails to load', () => {
    const host = mount(<BackdropLayer fallback="/featured.jpg" />);
    act(() => { setBackdropArt('/dead.jpg') });
    act(() => { imgs(host).find(img => img.getAttribute('src') === '/dead.jpg')!.dispatchEvent(new Event('error')) });
    expect(shown(host)).toEqual(['/featured.jpg']);
    expect(imgs(host).map(img => img.getAttribute('src'))).not.toContain('/dead.jpg');
  });

  it('falls back to the designed state when the only artwork is dead', () => {
    const host = mount(<BackdropLayer fallback="/dead.jpg" />);
    act(() => { imgs(host)[0].dispatchEvent(new Event('error')) });
    expect(host.querySelector('.backdrop')!.getAttribute('data-art')).toBe('false');
    expect(imgs(host)).toHaveLength(0);
  });
});
