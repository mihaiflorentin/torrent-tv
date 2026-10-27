// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './test-wait';
import { MAPS } from './dpad/maps/index.mjs';
import { checkMaps, classify, resolveOn, resolveTarget, DIRECTIONS, type DpadMap, type ElementInfo } from './dpad/model.mjs';
import { visibleFocusables } from './navigation';

// The declared D-pad maps (src/dpad/maps) are the source of truth for remote navigation. The
// real-Chromium audit (tools/tv_perf/dpad.mjs) walks every screen with real layout; these
// happy-dom tests hold the structured part (data-focus-row/col, no layout) of the screens whose
// D-pad bugs the audit found, through the app, against the same maps.
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
// Importing main.tsx boots an App into #app (the Setup screen, no server yet); its key handlers
// would move focus a second time on every press here, so unmount it.
render(null, appRoot);

const wait = (ms = 60) => sleep(ms);
const respond = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const titleRow = (id: string, seeders: number) => ({ id, title: `Title ${id}`, kind: 'movie', year: 2019, resolutions: ['1080p'], categories: [], sourceCount: 1, bestSeeders: seeders, largestSizeBytes: 4e9, trackers: [{ id: 'filelist', name: 'FileList' }] });
const job = (id: string) => ({ id, kind: 'catalog-sync', state: 'failed', label: `Job ${id}`, dedupeKey: id, progress: 1, attempt: 1, retryable: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
const log = (id: number) => ({ id, jobId: 'j1', attempt: 1, level: 'info', message: `step ${id}`, createdAt: '2026-01-01T00:00:00Z' });
const press = (key: string, keyCode: number) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
const KEY: Record<string, [string, number]> = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39] };
const back = () => { for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key: 'XF86Back', keyCode: 10009, bubbles: true, cancelable: true })); };
const focusKey = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey;
const mapNamed = (name: string) => MAPS.find(map => map.name === name)! as DpadMap;

// The focus stops on screen as the maps see them (no layout here, so rows and columns only).
function screen(map: DpadMap) {
  const elements: ElementInfo[] = visibleFocusables().map(element => ({ key: element.dataset.focusKey || '', region: element.dataset.focusRegion || '', row: element.dataset.focusRow === undefined ? null : Number(element.dataset.focusRow), col: element.dataset.focusCol === undefined ? null : Number(element.dataset.focusCol), selected: element.classList.contains('selected') || element.classList.contains('active') }));
  return classify(map, elements);
}
const focusOn = (key: string) => visibleFocusables().find(element => element.dataset.focusKey === key)!.focus();

/** Presses every arrow from every literal stop of `map` and checks the moves the map keeps on this screen. */
async function holdsLiteralMoves(map: DpadMap) {
  const misses: string[] = [];
  for (const key of Object.keys(map.stops || {})) {
    const layout = screen(map);
    const stop = layout.stops.find(candidate => candidate.id === key);
    if (!stop) continue;
    for (const direction of DIRECTIONS) {
      const target = resolveTarget(map, screen(map), stop, map.stops![key][direction]!, direction);
      if (target.screen !== map.name) continue; // the rail and other screens: the Chromium audit
      focusOn(key);
      press(...KEY[direction]);
      await wait(20);
      const wanted = screen(map).stops.find(candidate => candidate.id === target.stop)?.element.key;
      if (focusKey() !== wanted) misses.push(`${key} ${direction}: expected ${wanted}, got ${focusKey()}`);
    }
  }
  return misses;
}

describe('declared D-pad maps', () => {
  it('are consistent: every target names a stop, every stop says where each arrow goes', () => {
    expect(checkMaps(MAPS as DpadMap[])).toEqual([]);
  });

  it('cover every screen and overlay of the capture journey', () => {
    const names = MAPS.map(map => map.name);
    for (const wanted of ['rail', 'home', 'search', 'search-results', 'library', 'continue', 'favorites', 'watched', 'downloads', 'download-delete', 'library-categories', 'library-family', 'tracker', 'browse', 'categories', 'catalog-family', 'jobs', 'job-detail', 'settings', 'settings-diagnostics', 'rebuild-dialog', 'projects', 'movie-title', 'movie-info', 'movie-more', 'series-title', 'series-more', 'series-versions', 'series-info', 'player'])
      expect(names).toContain(wanted);
  });
});

describe('screens the D-pad audit found bugs on', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog/titles')) return respond({ items: [titleRow('a', 5), titleRow('b', 90), titleRow('c', 40)], nextCursor: null, total: 3 });
      if (url.includes('/catalog/families')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/catalog/facets')) return respond({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
      if (url.includes('/settings')) return respond({});
      if (url.includes('/trackers')) return respond([]);
      if (/\/jobs\/[^/?]+\/logs/.test(url)) return respond({ items: [log(1), log(2), log(3)], nextCursor: null, total: 3 });
      if (/\/jobs\/[^/?]+(\?|$)/.test(url)) return respond({ job: job('j1') });
      if (url.includes('/jobs')) return respond({ items: [job('j1'), job('j2')], nextCursor: null, total: 2 });
      if (url.includes('/downloads')) return respond({ items: [], nextCursor: null, total: 0 });
      if (url.includes('/portal/state')) return respond({ accountsEnabled: false, adsEnabled: false, donor: false, links: [] });
      if (url.includes('/updates/current')) return respond({ currentVersion: '1.0.0', available: false, releasesUrl: '', selfUpdate: false, applying: false });
      if (url.includes('/state')) return respond({ favorites: [], continueWatching: [], recent: [], watched: [] });
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
    vi.restoreAllMocks();
  });
  const start = async () => { render(h(App, null), container); await wait(150); };
  const open = async (route: string) => { container.querySelector<HTMLElement>(`[data-menu-route="${route}"]`)!.click(); await wait(80); };

  it('gives the Tracker rails their own focus keys, so Down reaches Strong swarms and Up comes back', async () => {
    await start();
    await open('tracker');
    const keys = visibleFocusables().map(element => element.dataset.focusKey);
    expect(new Set(keys).size).toBe(keys.length);
    const map = mapNamed('tracker');
    const layout = screen(map);
    expect(layout.groups.swarms.members).toHaveLength(3);
    focusOn(layout.groups.recent.members[0].element.key);
    press(...KEY.down);
    await wait(20);
    expect(focusKey()).toBe(layout.groups.swarms.members[0].element.key);
    press(...KEY.up);
    await wait(20);
    expect(focusKey()).toBe(layout.groups.recent.members[0].element.key);
  });

  it('opens a job on the back-to-Jobs button, walks its map, and Back returns to the job row', async () => {
    await start();
    await open('jobs');
    await wait(500);
    focusOn('job-j2');
    press('Enter', 13);
    await wait(100);
    const map = mapNamed('job-detail');
    expect(focusKey()).toBe(resolveOn(map, screen(map), map.landing));
    expect(await holdsLiteralMoves(map)).toEqual([]);
    // Up from the log filters reaches the back-to-Jobs button (it used to share row 0 with Refresh and was skipped).
    focusOn('log-attempt');
    press(...KEY.up);
    await wait(20);
    expect(focusKey()).toBe('job-detail-back');
    back();
    await wait(100);
    expect(container.querySelector('[data-focus-key="job-detail-back"]')).toBeNull();
    expect(container.querySelector('.tv-app.menu-open')).toBeNull();
    expect(focusKey()).toBe('job-j2');
  });

  it('closes the rail before the job detail when Back is pressed with the rail open over it', async () => {
    await start();
    await open('jobs');
    await wait(500);
    focusOn('job-j1');
    press('Enter', 13);
    await wait(100);
    press(...KEY.left);
    await wait(50);
    expect(container.querySelector('.tv-app.menu-open')).not.toBeNull();
    back();
    await wait(100);
    expect(container.querySelector('.tv-app.menu-open')).toBeNull();
    expect(container.querySelector('[data-focus-key="job-detail-back"]')).not.toBeNull();
    expect(focusKey()).toBe('job-detail-back');
  });

  it('returns to the job row when the back-to-Jobs button is pressed', async () => {
    await start();
    await open('jobs');
    await wait(500);
    focusOn('job-j1');
    press('Enter', 13);
    await wait(100);
    press('Enter', 13);
    await wait(100);
    expect(focusKey()).toBe('job-j1');
  });
});
