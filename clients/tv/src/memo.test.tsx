// @vitest-environment happy-dom
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memo, shallowEqual, useStableCallback } from './memo';
import { createStatusStore, useStatus } from './status-store';

describe('memo', () => {
  let host: HTMLDivElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { render(null, host); host.remove(); });

  it('compares props shallowly by identity', () => {
    const item = {};
    expect(shallowEqual({ a: 1, item }, { a: 1, item })).toBe(true);
    expect(shallowEqual({ a: 1, item }, { a: 1, item: {} })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('skips a re-render while props are unchanged and renders again when one changes', async () => {
    let renders = 0;
    const Card = memo(function Card({ label }: { label: string }) { renders++; return <b>{label}</b>; });
    let bump = () => { };
    let relabel = () => { };
    function Parent() { const [, setTick] = useState(0); const [label, setLabel] = useState('a'); bump = () => setTick(value => value + 1); relabel = () => setLabel('b'); return <Card label={label} />; }
    render(<Parent />, host);
    expect(renders).toBe(1);
    bump(); await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(renders).toBe(1);
    relabel(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(renders).toBe(2);
    expect(host.textContent).toBe('b');
  });

  it('keeps a stable callback identity that runs the latest closure', async () => {
    const seen: Array<() => string> = [];
    let next = () => { };
    function Probe() { const [value, setValue] = useState('one'); next = () => setValue('two'); seen.push(useStableCallback(() => value)); return null; }
    render(<Probe />, host);
    next(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]()).toBe('two');
  });
});

describe('status store', () => {
  it('ignores a repeated message and notifies subscribers of a change', () => {
    const store = createStatusStore('x');
    let calls = 0;
    const off = store.subscribe(() => { calls++; });
    store.set('x'); expect(calls).toBe(0);
    store.set('y'); expect(calls).toBe(1); expect(store.get()).toBe('y');
    off(); store.set('z'); expect(calls).toBe(1);
  });

  it('re-renders only the component that reads it', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const store = createStatusStore('Online');
    let parentRenders = 0;
    function Line() { return <span>{useStatus(store)}</span>; }
    function Parent() { parentRenders++; return <Line />; }
    render(<Parent />, host);
    await new Promise(resolve => setTimeout(resolve, 150));
    store.set('A background job was updated.');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(host.textContent).toBe('A background job was updated.');
    expect(parentRenders).toBe(1);
    render(null, host); host.remove();
  });
});
