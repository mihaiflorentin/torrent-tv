// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backdrop, BACKDROP_FOLLOW_MS, cssURL, nextBackdrop } from './backdrop';

// DESIGN.md "Backdrop art": one blurred layer behind the rows that follows the focused title,
// changed by crossfading opacity, with a designed fallback when there is no artwork.

describe('cssURL', () => {
  it('quotes the address and escapes what could end the url token', () => {
    expect(cssURL('http://s/a.jpg')).toBe('url("http://s/a.jpg")');
    expect(cssURL('http://s/a"b).jpg')).toBe('url("http://s/a%22b%29.jpg")');
  });
  it('is none without art', () => expect(cssURL('')).toBe('none'));
});

describe('nextBackdrop', () => {
  const start = { layers: ['a', ''] as [string, string], front: 0 as 0 | 1 };
  it('loads the new art into the hidden layer and brings it to the front', () => {
    expect(nextBackdrop(start, 'b')).toEqual({ layers: ['a', 'b'], front: 1 });
    expect(nextBackdrop({ layers: ['a', 'b'], front: 1 }, 'c')).toEqual({ layers: ['c', 'b'], front: 0 });
  });
  it('keeps the same state for the art already shown', () => {
    expect(nextBackdrop(start, 'a')).toBe(start);
  });
  it('falls back to the designed backdrop for no art', () => {
    expect(nextBackdrop(start, '')).toEqual({ layers: ['a', ''], front: 1 });
  });
});

describe('Backdrop', () => {
  let host: HTMLElement;
  const art = () => Array.from(host.querySelectorAll<HTMLElement>('.tv-backdrop-art'));
  const front = () => host.querySelector<HTMLElement>('.tv-backdrop-art.on');
  const focusOn = (element: HTMLElement) => element.dispatchEvent(new Event('focusin', { bubbles: true }));

  beforeEach(() => {
    vi.useFakeTimers();
    // Preloading resolves at once: the swap waits for the image, not for the network.
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    render(null, host);
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = async (initial?: string) => {
    await act(async () => { render(<Backdrop initial={initial} />, host); });
    const card = (art: string | undefined) => {
      const element = document.createElement('button');
      if (art !== undefined) element.dataset.art = art;
      host.appendChild(element);
      return element;
    };
    return { card };
  };
  const settle = async (ms = BACKDROP_FOLLOW_MS + 5) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); }); };

  it('is a hidden decoration that paints the static fallback without art', async () => {
    await mount();
    const root = host.querySelector('.tv-backdrop')!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(front()?.style.backgroundImage ?? '').toBe('');
  });

  it('shows the initial art on the front layer', async () => {
    await mount('http://s/a.jpg');
    expect(front()?.style.backgroundImage).toContain('http://s/a.jpg');
  });

  it('follows focus onto a card with art after the short settle delay', async () => {
    const { card } = await mount('http://s/a.jpg');
    focusOn(card('http://s/b.jpg'));
    expect(front()?.style.backgroundImage).toContain('a.jpg');
    await settle();
    expect(front()?.style.backgroundImage).toContain('b.jpg');
    expect(art().filter(layer => layer.classList.contains('on'))).toHaveLength(1);
  });

  it('skips art for a held key: only the last focused card loads', async () => {
    const loaded: string[] = [];
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; set src(value: string) { loaded.push(value); queueMicrotask(() => this.onload?.()); } });
    const { card } = await mount('http://s/a.jpg');
    focusOn(card('http://s/b.jpg'));
    await settle(BACKDROP_FOLLOW_MS - 50);
    focusOn(card('http://s/c.jpg'));
    await settle();
    expect(loaded).toEqual(['http://s/c.jpg']);
    expect(front()?.style.backgroundImage).toContain('c.jpg');
  });

  it('falls back to the designed backdrop on a title without art', async () => {
    const { card } = await mount('http://s/a.jpg');
    focusOn(card(''));
    await settle();
    expect(front()?.style.backgroundImage ?? '').toBe('');
  });

  it('keeps the current art while focus sits on a control that carries none', async () => {
    const { card } = await mount('http://s/a.jpg');
    focusOn(card(undefined));
    await settle();
    expect(front()?.style.backgroundImage).toContain('a.jpg');
  });

  it('stays still when it is told not to follow focus', async () => {
    await act(async () => { render(<Backdrop initial="http://s/a.jpg" follow={false} />, host); });
    const card = document.createElement('button');
    card.dataset.art = 'http://s/b.jpg';
    host.appendChild(card);
    focusOn(card);
    await settle();
    expect(front()?.style.backgroundImage).toContain('a.jpg');
  });

  it('keeps the previous art when the next artwork fails to load', async () => {
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { queueMicrotask(() => (value.includes('dead') ? this.onerror : this.onload)?.()); } });
    const { card } = await mount('http://s/a.jpg');
    focusOn(card('http://s/dead.jpg'));
    await settle();
    expect(front()?.style.backgroundImage).toContain('a.jpg');
    expect(art().some(layer => (layer.style.backgroundImage ?? '').includes('dead.jpg'))).toBe(false);
    await settle(2000);
    expect(front()?.style.backgroundImage).toContain('a.jpg');
  });

  it('does not flicker blank when a held key crosses a missing poster', async () => {
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { queueMicrotask(() => (value.includes('dead') ? this.onerror : this.onload)?.()); } });
    const { card } = await mount('http://s/a.jpg');
    const seen: string[] = [];
    const watch = new MutationObserver(() => seen.push(front()?.style.backgroundImage ?? ''));
    watch.observe(host, { attributes: true, subtree: true });
    focusOn(card('http://s/dead.jpg'));
    await settle();
    focusOn(card('http://s/b.jpg'));
    await settle();
    watch.disconnect();
    expect(seen.every(value => value !== '')).toBe(true);
    expect(front()?.style.backgroundImage).toContain('b.jpg');
  });
});
