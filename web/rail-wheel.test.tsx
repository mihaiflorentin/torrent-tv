import { describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Rail } from './src';

// Rail wheel behavior: a vertical wheel over an overflowing rail scrolls the
// rail itself, horizontal gestures keep native passthrough, and a rail at
// either edge declines the event so the page keeps scrolling (happy-dom has
// no layout, so dimensions are stubbed on the rail element).
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { render(<Rail title="Continue watching" landscape>{[<div key="a">card</div>]}</Rail>, host) });
  return host.querySelector<HTMLElement>('.rail')!;
}

function stubDimensions(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
}

function wheel(el: HTMLElement, deltas: { deltaX?: number; deltaY?: number }) {
  const event = new WheelEvent('wheel', { ...deltas, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe('Rail wheel scrolling', () => {
  it('scrolls the rail horizontally for a vertical wheel and prevents the page scroll', () => {
    const rail = mount();
    stubDimensions(rail, 1880, 1055);
    const event = wheel(rail, { deltaY: 300 });
    expect(rail.scrollLeft).toBe(300);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves horizontal wheel gestures to the browser', () => {
    const rail = mount();
    stubDimensions(rail, 1880, 1055);
    const event = wheel(rail, { deltaX: 300, deltaY: 0 });
    expect(rail.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('hands scrolling back to the page once the rail is at its edge', () => {
    const rail = mount();
    stubDimensions(rail, 1880, 1055);
    rail.scrollLeft = 825;
    const event = wheel(rail, { deltaY: 300 });
    expect(event.defaultPrevented).toBe(false);
    expect(rail.scrollLeft).toBe(825);
  });
});
