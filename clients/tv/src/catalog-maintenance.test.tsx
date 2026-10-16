// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';

// App-seam tests for the Catalog maintenance controls in TV Settings: the
// Events page is gone from the menu, and the Rebuild catalog confirmation
// follows the update-confirm dialog contract (opens on Cancel, Back cancels,
// focus returns to the Rebuild button). main.tsx asserts #app at module
// evaluation, so the mount point exists before the dynamic import.
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
class FakeEventSource { onopen = null; onerror = null; close() { } addEventListener() { } removeEventListener() { } }
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
const appRoot = document.createElement('div');
appRoot.id = 'app';
document.body.appendChild(appRoot);
const { App } = await import('./main');

const wait = (ms = 60) => sleep(ms);
const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
// Back arrives as keydown then keyup: a five-second hold exits the app, a short press runs onBack on release.
const back = () => { const init = { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true }; document.dispatchEvent(new KeyboardEvent('keydown', init)); document.dispatchEvent(new KeyboardEvent('keyup', init)) };

describe('TV Settings catalog maintenance through the app', () => {
  let container: HTMLDivElement;
  let syncModes: string[];
  beforeEach(() => {
    syncModes = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/catalog/sync')) { syncModes.push(JSON.parse(String(init?.body)).mode); return respond({ id: 'j', label: 'Rebuild catalog', state: 'queued' }); }
      if (url.includes('/catalog/status')) return respond({ observedReleases: 10, discoverableReleases: 5 });
      if (url.includes('/settings/schema')) return respond({ items: [] });
      if (url.includes('/settings')) return respond({});
      if (url.includes('/trackers')) return respond([]);
      if (url.includes('/catalog/titles')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/catalog/facets')) return respond({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/downloads') || url.includes('/jobs')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: [] });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [], continueWatching: [], recent: [], watched: [] });
      if (url.includes('/info')) return respond({ name: 'torrent-tv', version: '1', instanceName: 'test' });
      return respond({});
    });
    localStorage.setItem('filelist.serverUrl', 'http://server.lan:8097');
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
    localStorage.clear();
  });

  it('has no Events entry in the menu', async () => {
    render(h(App, null), container);
    await wait(120);
    const labels = Array.from(container.querySelectorAll('[data-menu-route]')).map(item => item.getAttribute('data-menu-route'));
    expect(labels).toContain('settings');
    expect(labels).not.toContain('events');
    expect(container.textContent).not.toContain('Events');
  });

  it('opens the rebuild dialog on Cancel, cancels on Back without syncing, and returns focus to the Rebuild button', async () => {
    render(h(App, null), container);
    await wait(120);
    container.querySelector<HTMLElement>('[data-menu-route="settings"]')!.click();
    await wait(120);
    const rebuild = container.querySelector<HTMLButtonElement>('[data-focus-key="catalog-rebuild"]')!;
    rebuild.focus();
    rebuild.click();
    await wait(30);
    const cancel = container.querySelector<HTMLButtonElement>('[data-focus-key="rebuild-confirm-cancel"]')!;
    expect(cancel).not.toBeNull();
    expect(document.activeElement).toBe(cancel);
    back();
    await wait(30);
    expect(container.querySelector('.tv-rebuild-confirm')).toBeNull();
    expect(syncModes).toEqual([]);
    expect(document.activeElement).toBe(container.querySelector('[data-focus-key="catalog-rebuild"]'));
  });

  it('queues the rebuild only from the confirm button', async () => {
    render(h(App, null), container);
    await wait(120);
    container.querySelector<HTMLElement>('[data-menu-route="settings"]')!.click();
    await wait(120);
    container.querySelector<HTMLButtonElement>('[data-focus-key="catalog-rebuild"]')!.click();
    await wait(30);
    container.querySelector<HTMLButtonElement>('[data-focus-key="rebuild-confirm-apply"]')!.click();
    await wait(60);
    expect(syncModes).toEqual(['rebuild']);
    expect(container.querySelector('.tv-rebuild-confirm')).toBeNull();
    expect(container.querySelector('.tv-danger-zone')!.textContent).toContain('queued');
  });
});
