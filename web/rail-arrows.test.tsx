import { describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Rail } from './src';

// Rail paginator arrows: < > overlay buttons page a rail by its full width so
// consecutive pages tile the list; each direction renders only while that
// direction can still scroll. happy-dom has no layout, so dimensions are
// stubbed and scroll events drive the arrow re-sync.
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { render(<Rail title="Continue watching">{[<div key="a">card</div>]}</Rail>, host) });
  return { host, rail: host.querySelector<HTMLElement>('.rail')! };
}

function fit(rail: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true });
  rail.scrollLeft = scrollLeft;
  act(() => { rail.dispatchEvent(new Event('scroll')); });
}

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

describe('Rail paginator arrows', () => {
  it('pages an overflowing rail forward and back by full rail width', async () => {
    // happy-dom defers behavior:'smooth' scrolls on the real macrotask queue;
    // a queued 0ms tick lets the deferred scroll land before asserting.
    const { host, rail } = mount();
    fit(rail, 1880, 1055);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.rail-arrow.right')!.click();
      await tick();
    });
    expect(rail.scrollLeft).toBe(1055);
    fit(rail, 1880, 1055, 1055);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.rail-arrow.left')!.click();
      await tick();
    });
    expect(rail.scrollLeft).toBe(0);
  });

  it('shows each arrow only while its direction can still scroll', () => {
    const { host, rail } = mount();
    fit(rail, 1880, 1055, 0);
    expect(host.querySelector('.rail-arrow.right')).toBeTruthy();
    expect(host.querySelector('.rail-arrow.left')).toBeFalsy();
    fit(rail, 1880, 1055, 500);
    expect(host.querySelector('.rail-arrow.left')).toBeTruthy();
    expect(host.querySelector('.rail-arrow.right')).toBeTruthy();
    fit(rail, 1880, 1055, 825);
    expect(host.querySelector('.rail-arrow.right')).toBeFalsy();
    expect(host.querySelector('.rail-arrow.left')).toBeTruthy();
  });

  it('renders no arrows when the rail fits without overflow', () => {
    const { host, rail } = mount();
    fit(rail, 1055, 1055);
    expect(host.querySelector('.rail-arrow')).toBeFalsy();
  });
});

describe('Rail near-end loading', () => {
  it('requests more content once paged within a page width of the end', () => {
    let calls = 0;
    const host = document.createElement('div');
    document.body.append(host);
    act(() => { render(<Rail title="Recently added" onNearEnd={() => { calls++ }}>{[<div key="a">card</div>]}</Rail>, host) });
    const rail = host.querySelector<HTMLElement>('.rail')!;
    fit(rail, 4000, 1000, 500);
    expect(calls).toBe(0);
    fit(rail, 4000, 1000, 2400);
    expect(calls).toBe(1);
  });

  it('does not request more content when the rail fits without overflow', () => {
    let calls = 0;
    const host = document.createElement('div');
    document.body.append(host);
    act(() => { render(<Rail title="Recently added" onNearEnd={() => { calls++ }}>{[<div key="a">card</div>]}</Rail>, host) });
    fit(host.querySelector<HTMLElement>('.rail')!, 1000, 1000);
    expect(calls).toBe(0);
  });
});
