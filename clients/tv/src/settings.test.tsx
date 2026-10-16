// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API } from '@torrent-tv/shared';
// Static import cannot work here: main.tsx bootstraps and asserts the presence
// of document.getElementById('app') during module evaluation. The #app container
// must be mounted to the DOM before main.tsx evaluates.
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

const { TVSettings } = await import('./main');

const settingsValue = (engineRunning: string): Record<string, unknown> => ({
  downloadEngine: 'native',
  engineRunning,
  preferredAudioLanguage: 'en',
  preferredSubtitleLanguage: 'en',
  fallbackSubtitleLanguage: 'ro',
  watchedThresholdPercent: 90,
  maxConcurrentJobs: 10,
  titleRefreshTimeoutMinutes: 30,
  fileListEnabled: true,
  pirateBayEnabled: false,
  pirateBayWebsiteUrl: 'https://piratebay.example',
  pirateBayApiUrl: 'https://piratebay.example/api',
});

function fakeApi(value: Record<string, unknown>) {
  return {
    call: async (path: string, init?: RequestInit): Promise<unknown> => {
      const method = init?.method || 'GET';
      if (path === '/settings' && method === 'GET') return value;
      if (path === '/settings/schema') return { items: [] };
      if (path === '/trackers') return [];
      if (path === '/catalog/status') return { observedReleases: 1200, discoverableReleases: 800, hiddenDiscovery: 400, fileListLatestWindowLimit: 1000 };
      // Belt-and-braces against the strip bug: the strict server decoder
      // rejects unknown fields, so a save that ever fires here must fail loudly.
      throw new Error(`unexpected API call ${method} ${path}`);
    },
  } as unknown as API;
}

describe('TV engine ownership feedback', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('names the running engine when it differs from the saved selection', async () => {
    render(
      <TVSettings
        api={fakeApi(settingsValue('qbittorrent'))}
        onChangeServer={() => { }}
        onForgetServer={() => { }}
        updateStatus={null}
        onUpdateStatus={() => { }}
        confirmOpen={false}
        onConfirmOpen={() => { }}
        onConfirmClose={() => { }}
        rebuildConfirmOpen={false}
        onRebuildConfirmOpen={() => { }}
        onRebuildConfirmClose={() => { }}
      />,
      container
    );
    await sleep(20);
    expect(container.textContent).toContain('Running now: qBittorrent');
    expect(container.textContent).toContain('new downloads after restart');
  });

  it('keeps the ownership copy without a running notice when the engine agrees', async () => {
    render(
      <TVSettings
        api={fakeApi(settingsValue('native'))}
        onChangeServer={() => { }}
        onForgetServer={() => { }}
        updateStatus={null}
        onUpdateStatus={() => { }}
        confirmOpen={false}
        onConfirmOpen={() => { }}
        onConfirmClose={() => { }}
        rebuildConfirmOpen={false}
        onRebuildConfirmOpen={() => { }}
        onRebuildConfirmClose={() => { }}
      />,
      container
    );
    await sleep(20);
    expect(container.textContent).toContain('Existing downloads keep the engine that owns them');
    expect(container.textContent).not.toContain('Running now');
  });
});

function catalogApi(sync: (mode: string) => Promise<{ label: string }>) {
  return { ...(fakeApi(settingsValue('native')) as unknown as Record<string, unknown>), syncCatalog: sync } as unknown as API;
}

describe('TV catalog maintenance in Settings', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const mount = (api: API, extra: { rebuildConfirmOpen?: boolean; onRebuildConfirmOpen?: () => void; onRebuildConfirmClose?: () => void } = {}) => {
    render(
      <TVSettings
        api={api}
        onChangeServer={() => { }}
        onForgetServer={() => { }}
        updateStatus={null}
        onUpdateStatus={() => { }}
        confirmOpen={false}
        onConfirmOpen={() => { }}
        onConfirmClose={() => { }}
        rebuildConfirmOpen={extra.rebuildConfirmOpen ?? false}
        onRebuildConfirmOpen={extra.onRebuildConfirmOpen ?? (() => { })}
        onRebuildConfirmClose={extra.onRebuildConfirmClose ?? (() => { })}
      />,
      container
    );
    return sleep(20);
  };
  const byKey = (key: string) => container.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`);

  it('shows read-only coverage and a Fetch latest button that queues a latest sync and says so', async () => {
    const sync = vi.fn(async () => ({ label: 'Fetch latest releases' }));
    await mount(catalogApi(sync));
    const section = container.querySelector('.tv-catalog')!;
    expect(section.textContent).toContain('1,200');
    expect(section.textContent).toContain('800');
    const fetch = byKey('catalog-fetch-latest')!;
    expect(section.contains(fetch)).toBe(true);
    fetch.click();
    await sleep(20);
    expect(sync).toHaveBeenCalledWith('latest');
    expect(section.querySelector('[role="status"]')!.textContent).toContain('queued');
  });

  it('still renders Fetch latest when the coverage request fails or is malformed', async () => {
    const api = { call: async (path: string) => { if (path === '/catalog/status') throw new Error('nope'); return (await (fakeApi(settingsValue('native')) as unknown as { call: (p: string) => Promise<unknown> }).call(path)) }, syncCatalog: async () => ({ label: 'x' }) } as unknown as API;
    await mount(api);
    expect(byKey('catalog-fetch-latest')).not.toBeNull();
    expect(container.querySelector('.tv-catalog')!.textContent).not.toContain('NaN');
  });

  it('keeps Rebuild catalog in a separate danger zone below every other control and only asks for confirmation', async () => {
    const sync = vi.fn(async () => ({ label: 'Rebuild catalog' }));
    const opened = vi.fn();
    await mount(catalogApi(sync), { onRebuildConfirmOpen: opened });
    const zone = container.querySelector('.tv-danger-zone')!;
    expect(zone.querySelector('h2')!.textContent).toBe('Danger zone');
    expect(zone.textContent).toContain('only when something is broken');
    const rebuild = byKey('catalog-rebuild')!;
    expect(zone.contains(rebuild)).toBe(true);
    expect(container.querySelector('.tv-catalog')!.contains(rebuild)).toBe(false);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-region="content"]')).map(element => Number(element.dataset.focusRow));
    expect(Number(rebuild.dataset.focusRow)).toBe(Math.max(...rows));
    const controls = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-region="content"]'));
    expect(controls[controls.length - 1]).toBe(rebuild);
    rebuild.click();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('renders the rebuild confirmation as a trapped dialog with Cancel first and runs the rebuild only on confirm', async () => {
    const sync = vi.fn(async () => ({ label: 'Rebuild catalog' }));
    const closed = vi.fn();
    await mount(catalogApi(sync), { rebuildConfirmOpen: true, onRebuildConfirmClose: closed });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"].tv-rebuild-confirm')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('every enabled category');
    expect(dialog.textContent).toContain('slow');
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map(button => button.dataset.focusKey)).toEqual(['rebuild-confirm-cancel', 'rebuild-confirm-apply']);
    expect(buttons.every(button => button.dataset.focusRegion === 'rebuild-dialog')).toBe(true);
    buttons[0].click();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
    buttons[1].click();
    await sleep(20);
    expect(sync).toHaveBeenCalledWith('rebuild');
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
