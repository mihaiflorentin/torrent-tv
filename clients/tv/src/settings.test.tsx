// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import type { API, Job, UpdateStatus } from '@torrent-tv/shared';
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
  preferredSubtitleLanguage: 'ro',
  fallbackSubtitleLanguage: 'en',
  watchedThresholdPercent: 90,
  maxConcurrentJobs: 10,
  titleRefreshTimeoutMinutes: 30,
  fileListEnabled: true,
  pirateBayEnabled: false,
  pirateBayWebsiteUrl: 'https://piratebay.example',
  pirateBayApiUrl: 'https://piratebay.example/api',
  fileListPasskeyConfigured: true,
});

const trackers = [{ id: 'filelist', name: 'FileList', enabled: true, configured: true }, { id: 'piratebay', name: 'The Pirate Bay', enabled: false, configured: true }];

function fakeApi(value: Record<string, unknown>, extra: { put?: (body: Record<string, unknown>) => void; failSettings?: () => boolean; test?: (name: string) => Promise<unknown> } = {}) {
  return {
    base: 'http://pi.local:8080',
    call: async (path: string, init?: RequestInit): Promise<unknown> => {
      const method = init?.method || 'GET';
      if (path === '/settings' && method === 'GET') { if (extra.failSettings?.()) throw new Error('decode settings: unexpected EOF at offset 412'); return value; }
      if (path === '/settings' && method === 'PUT' && extra.put) { extra.put(JSON.parse(String(init?.body))); return {}; }
      if (path === '/settings/schema') return { items: [] };
      if (path === '/trackers') return trackers;
      if (path === '/catalog/status') return { observedReleases: 48210, discoverableReleases: 12000, hiddenDiscovery: 400, fileListLatestWindowLimit: 1000 };
      const dependency = /^\/dependencies\/(\w+)\/test$/.exec(path);
      if (dependency && extra.test) return extra.test(dependency[1]);
      // Belt-and-braces against the strip bug: the strict server decoder
      // rejects unknown fields, so a save that ever fires here must fail loudly.
      throw new Error(`unexpected API call ${method} ${path}`);
    },
  } as unknown as API;
}

const running = (id: string): Job => ({ id, kind: 'catalog-sync', state: 'running', label: 'x', dedupeKey: id, progress: 0.5, attempt: 1, retryable: false, createdAt: '', updatedAt: '' });
const update: UpdateStatus = { currentVersion: '0.10.10', available: true, latest: '0.11.0', releasesUrl: 'https://example.org/releases', selfUpdate: true, applying: false };

describe('TV Settings in two panes', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container);
    // happy-dom has no layout: give every element a size so the visible-focusables filter sees them.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  });
  afterEach(() => { render(null, container); container.remove(); vi.restoreAllMocks(); });

  type Extra = Partial<Parameters<typeof TVSettings>[0]>;
  const mount = (api: API, extra: Extra = {}) => {
    render(
      <TVSettings
        api={api}
        hasProjects
        projectCount={3}
        jobs={[running('a'), running('b')]}
        onChangeServer={() => { }}
        onForgetServer={() => { }}
        updateStatus={update}
        onUpdateStatus={() => { }}
        confirmOpen={false}
        onConfirmOpen={() => { }}
        onConfirmClose={() => { }}
        rebuildConfirmOpen={false}
        onRebuildConfirmOpen={() => { }}
        onRebuildConfirmClose={() => { }}
        {...extra}
      />,
      container
    );
    return sleep(20);
  };
  const byKey = (key: string) => container.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
  const pane = () => container.querySelector<HTMLElement>('[data-settings-pane]')!;
  const open = async (group: string) => { byKey(`settings-group-${group}`)!.click(); await sleep(20); };
  const rowText = (key: string) => (byKey(key)!.closest('.tv-setting-row') || byKey(key)!).textContent!.replace(/\s+/g, ' ').trim();

  it('lists the groups with a short status beside each name and opens on Playback', async () => {
    await mount(fakeApi(settingsValue('native')));
    const groups = Array.from(container.querySelectorAll<HTMLElement>('.tv-settings-groups button')).map(button => button.textContent);
    expect(groups).toEqual(['Playback', 'Trackers1 on', 'Catalog48,210 releases', 'Serverpi.local:8080', 'Background jobs2 running', 'Updates0.11.0 available', 'Other projects', 'Danger zone']);
    expect(pane().dataset.settingsPane).toBe('playback');
    expect(byKey('settings-group-playback')!.getAttribute('aria-current')).toBe('true');
  });

  it('opens a group on OK and moves the cursor to its first row', async () => {
    await mount(fakeApi(settingsValue('native')));
    byKey('settings-group-server')!.focus();
    await open('server');
    expect(pane().dataset.settingsPane).toBe('server');
    expect(byKey('settings-group-server')!.classList.contains('selected')).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('settings-reload');
  });

  it('shows the playback preferences with their values, marks an edit unsaved, and saves without read-only fields', async () => {
    const put = vi.fn();
    await mount(fakeApi(settingsValue('native'), { put }));
    const field = (key: string) => byKey(key) as HTMLInputElement;
    expect(field('setting-audio-primary').value).toBe('en');
    expect(field('setting-subtitle-primary').value).toBe('ro');
    expect(field('setting-subtitle-fallback').value).toBe('en');
    expect(field('setting-watched').value).toBe('90');
    expect(rowText('setting-audio-primary')).toContain('Audio language');
    expect(rowText('setting-audio-primary')).toContain('Used first when a version has several audio tracks');
    expect(rowText('settings-save')).toContain('Saved');
    field('setting-audio-primary').value = 'ro';
    field('setting-audio-primary').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(10);
    expect(rowText('settings-save')).toContain('Unsaved changes');
    byKey('settings-save')!.click();
    await sleep(20);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0].preferredAudioLanguage).toBe('ro');
    expect(put.mock.calls[0][0]).not.toHaveProperty('fileListPasskeyConfigured');
    expect(put.mock.calls[0][0]).not.toHaveProperty('engineRunning');
    expect(rowText('settings-save')).toContain('Saved');
    expect(pane().querySelector('[role="status"]')!.textContent).toContain('Settings saved');
  });

  it('shows tracker switches with On/Off, their readiness, the Pirate Bay addresses and the engine note', async () => {
    await mount(fakeApi(settingsValue('native')));
    await open('trackers');
    const filelist = byKey('setting-filelist-enabled')!;
    expect(filelist.getAttribute('role')).toBe('switch');
    expect(filelist.getAttribute('aria-checked')).toBe('true');
    expect(rowText('setting-filelist-enabled')).toContain('On');
    expect(rowText('setting-piratebay-enabled')).toContain('Off');
    filelist.click();
    await sleep(10);
    expect(byKey('setting-filelist-enabled')!.getAttribute('aria-checked')).toBe('false');
    expect(rowText('settings-save')).toContain('Unsaved changes');
    expect(pane().querySelector('.tv-tracker-readiness')!.textContent).toBe('FileList · readyThe Pirate Bay · off');
    expect((byKey('setting-piratebay-website') as HTMLInputElement).value).toBe('https://piratebay.example');
    expect((byKey('setting-piratebay-api') as HTMLInputElement).value).toBe('https://piratebay.example/api');
    expect(pane().textContent).toContain('Existing downloads keep the engine that owns them');
    expect(pane().textContent).not.toContain('Running now');
  });

  it('names the running engine when it differs from the saved selection', async () => {
    await mount(fakeApi(settingsValue('qbittorrent')), { group: 'trackers' });
    expect(pane().textContent).toContain('Running now: qBittorrent');
    expect(pane().textContent).toContain('new downloads after restart');
  });

  it('shows the catalog counts and a Fetch latest that queues a latest sync and says so', async () => {
    const sync = vi.fn(async () => ({ label: 'Fetch latest releases' }));
    await mount({ ...(fakeApi(settingsValue('native')) as unknown as object), syncCatalog: sync } as unknown as API, { group: 'catalog' });
    expect(pane().textContent).toContain('48,210');
    expect(pane().textContent).toContain('12,000');
    byKey('catalog-fetch-latest')!.click();
    await sleep(20);
    expect(sync).toHaveBeenCalledWith('latest');
    expect(pane().querySelector('[role="status"]')!.textContent).toBe('Fetch latest releases queued. Follow it in Background jobs.');
  });

  it('still offers Fetch latest when the coverage request fails, and a failed sync is one sentence', async () => {
    const base = fakeApi(settingsValue('native')) as unknown as { call: (path: string) => Promise<unknown> };
    const api = { base: 'http://pi.local', call: async (path: string) => { if (path === '/catalog/status') throw new Error('nope'); return base.call(path); }, syncCatalog: async () => { throw new Error('POST /catalog/sync: 503 upstream timeout'); } } as unknown as API;
    await mount(api, { group: 'catalog' });
    expect(pane().textContent).not.toContain('NaN');
    byKey('catalog-fetch-latest')!.click();
    await sleep(20);
    expect(pane().querySelector('[role="status"]')!.textContent).toBe('Fetch latest could not start. Try again in a minute.');
  });

  it('shows the connected server with Reload library, Change server and Forget, and the connection tests behind a disclosure', async () => {
    const reload = vi.fn(); const change = vi.fn(); const forget = vi.fn();
    const test = vi.fn(async (name: string) => ({ message: `${name} reachable` }));
    await mount(fakeApi(settingsValue('native'), { test }), { group: 'server', onReload: reload, onChangeServer: change, onForgetServer: forget });
    expect(pane().textContent).toContain('Connected server');
    expect(pane().textContent).toContain('pi.local:8080');
    byKey('settings-reload')!.click(); byKey('change-server')!.click(); byKey('forget-server')!.click();
    expect([reload, change, forget].map(spy => spy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(container.querySelector('[data-focus-key^="test-"]')).toBeNull();
    expect(byKey('settings-diagnostics')!.getAttribute('aria-expanded')).toBe('false');
    byKey('settings-diagnostics')!.click();
    await sleep(10);
    const tests = Array.from(container.querySelectorAll<HTMLElement>('[data-focus-key^="test-"]'));
    expect(tests.map(button => button.textContent)).toEqual(['Test FileList', 'Test qBittorrent', 'Test storage', 'Test FFmpeg', 'Test FFprobe', 'Test TMDB', 'Test SubDL', 'Test Pirate Bay']);
    expect(tests.map(button => button.dataset.focusCol)).toEqual(['0', '1', '2', '3', '0', '1', '2', '3']);
    byKey('test-tmdb')!.click();
    await sleep(20);
    expect(test).toHaveBeenCalledWith('tmdb');
    expect(pane().querySelector('[role="status"]')!.textContent).toBe('tmdb reachable');
  });

  it('says a failed connection test in one sentence instead of the raw error', async () => {
    await mount(fakeApi(settingsValue('native'), { test: async () => { throw new Error('dial tcp 10.0.0.2:8080: connect: connection refused'); } }), { group: 'server' });
    byKey('settings-diagnostics')!.click();
    await sleep(10);
    byKey('test-qbittorrent')!.click();
    await sleep(20);
    expect(pane().querySelector('[role="status"]')!.textContent).toBe('The qBittorrent test failed. Check its settings in the browser Settings.');
  });

  it('opens Background jobs from its group, which also holds the background-work limits', async () => {
    const opened = vi.fn();
    await mount(fakeApi(settingsValue('native')), { group: 'jobs', onOpen: opened });
    expect(rowText('settings-jobs')).toMatch(/^Background jobs2 running/);
    expect((byKey('setting-workers') as HTMLInputElement).value).toBe('10');
    expect((byKey('setting-title-timeout') as HTMLInputElement).value).toBe('30');
    expect(byKey('settings-save')).not.toBeNull();
    byKey('settings-jobs')!.click();
    expect(opened).toHaveBeenCalledWith('jobs');
  });

  it('shows the version, the update state and the release link as rows, and Install asks first', async () => {
    const confirm = vi.fn();
    await mount(fakeApi(settingsValue('native')), { group: 'updates', onConfirmOpen: confirm });
    expect(pane().textContent).toContain('Version 0.10.10');
    expect(pane().textContent).toContain('Update available');
    expect(rowText('update-release-link')).toContain('Version 0.11.0 is available');
    expect(rowText('update-release-link')).toContain('https://example.org/releases');
    expect(byKey('update-check')).not.toBeNull();
    byKey('update-apply')!.click();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('opens Other projects from its group, and leaves the group out without project links', async () => {
    const opened = vi.fn();
    await mount(fakeApi(settingsValue('native')), { group: 'projects', onOpen: opened });
    expect(rowText('settings-projects')).toMatch(/^Other projects3 sites/);
    byKey('settings-projects')!.click();
    expect(opened).toHaveBeenCalledWith('projects');
    render(null, container);
    await mount(fakeApi(settingsValue('native')), { hasProjects: false, group: 'projects' });
    expect(byKey('settings-group-projects')).toBeNull();
    expect(pane().dataset.settingsPane).toBe('playback');
  });

  it('turns a failed settings load into one sentence with Try again, never the raw error', async () => {
    let fail = true;
    await mount(fakeApi(settingsValue('native'), { failSettings: () => fail }));
    expect(pane().textContent).toContain('Settings could not be loaded from the server.');
    expect(pane().textContent).not.toContain('unexpected EOF');
    fail = false;
    byKey('settings-retry')!.click();
    await sleep(20);
    expect((byKey('setting-audio-primary') as HTMLInputElement).value).toBe('en');
  });

  it('keeps Rebuild catalog alone in the Danger zone and only asks for confirmation', async () => {
    const sync = vi.fn(async () => ({ label: 'Rebuild catalog' }));
    const opened = vi.fn();
    await mount({ ...(fakeApi(settingsValue('native')) as unknown as object), syncCatalog: sync } as unknown as API, { group: 'danger', onRebuildConfirmOpen: opened });
    expect(pane().querySelector('h2')!.textContent).toBe('Danger zone');
    expect(pane().textContent).toContain('only when something is broken');
    const controls = Array.from(pane().querySelectorAll<HTMLElement>('[data-focus-region="content"]'));
    expect(controls.map(control => control.dataset.focusKey)).toEqual(['catalog-rebuild']);
    byKey('catalog-rebuild')!.click();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('renders the rebuild confirmation as a trapped dialog with Cancel first and runs the rebuild only on confirm', async () => {
    const sync = vi.fn(async () => ({ label: 'Rebuild catalog' }));
    const closed = vi.fn();
    await mount({ ...(fakeApi(settingsValue('native')) as unknown as object), syncCatalog: sync } as unknown as API, { group: 'danger', rebuildConfirmOpen: true, onRebuildConfirmClose: closed });
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
    expect(pane().querySelector('[role="status"]')!.textContent).toBe('Rebuild catalog queued. Follow it in Background jobs.');
  });
});
