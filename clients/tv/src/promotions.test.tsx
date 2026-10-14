// @vitest-environment happy-dom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API, PortalPromotion } from '@torrent-tv/shared';

// main.tsx bootstraps against #app during module evaluation, so mount it first.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: () => null,
  } as Storage;
}
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { TVPromotions } = await import('./main');

const creative = { provider: 'p', id: 'a1', title: 'Ad title', text: '', image: '', link: '', screenTime: 10 } as unknown as PortalPromotion;

function fakeAPI(call: (path: string, init?: RequestInit) => Promise<unknown>) {
  return { call, promotionClickURL: () => 'http://x/click' } as unknown as API;
}

describe('TV promotions on an engine without AbortController', () => {
  let host: HTMLElement;
  afterEach(() => { render(null, host); vi.unstubAllGlobals(); });

  it('renders the promotion and requests it without a signal', async () => {
    vi.stubGlobal('AbortController', undefined);
    const call = vi.fn().mockResolvedValue([creative]);
    host = document.createElement('div');
    await act(async () => { render(<TVPromotions api={fakeAPI(call)} />, host); });
    await act(async () => { await Promise.resolve() });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1]).not.toHaveProperty('signal');
    expect(host.textContent).toContain('Ad title');
  });

  it('ignores a late response after unmount', async () => {
    vi.stubGlobal('AbortController', undefined);
    let resolve!: (value: PortalPromotion[]) => void;
    const call = vi.fn().mockReturnValue(new Promise<PortalPromotion[]>(r => { resolve = r }));
    host = document.createElement('div');
    await act(async () => { render(<TVPromotions api={fakeAPI(call)} />, host); });
    await act(async () => { render(null, host); });
    await act(async () => { resolve([creative]) });
    expect(host.textContent).toBe('');
  });
});

describe('TV promotions on an engine with AbortController', () => {
  let host: HTMLElement;
  afterEach(() => { render(null, host); });

  it('passes a signal and aborts it on unmount', async () => {
    const call = vi.fn().mockReturnValue(new Promise(() => {}));
    host = document.createElement('div');
    await act(async () => { render(<TVPromotions api={fakeAPI(call)} />, host); });
    const signal = call.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => { render(null, host); });
    expect(signal.aborted).toBe(true);
  });
});
