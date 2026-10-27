import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type HouseholdState } from '@torrent-tv/shared';
import { HUBS as TV_HUBS } from '../clients/tv/src/hubs';
import { App } from './src';
import { HUBS } from './hubs';

// The browser rail holds the TV's six hubs (#64): Library and Discover draw their sections as tabs,
// Background jobs and Other projects are reached from Settings, and every existing URL lands on its
// hub and tab. The API is mocked at the class boundary; the tests read the rendered DOM and the URL.

const household: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
class FakeEventSource { addEventListener() { } close() { } }
const hosts: HTMLElement[] = [];

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) });
}
async function mountAt(url: string) {
  window.history.replaceState(null, '', url);
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(<App />, host) });
  await settle();
}
const railItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'));
const railLabels = () => railItems().map(item => item.querySelector('.nav-label')!.textContent);
const currentHub = () => railItems().filter(item => item.getAttribute('aria-current') === 'page').map(item => item.querySelector('.nav-label')!.textContent);
const railItem = (label: string) => railItems().find(item => item.querySelector('.nav-label')!.textContent === label)!;
const heading = () => document.querySelector('.topbar h1')!.textContent;
const tabs = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.hub-tabs button'));
const tabLabels = () => tabs().map(tab => tab.textContent);
const selectedTab = () => tabs().filter(tab => tab.getAttribute('aria-current') === 'page').map(tab => tab.textContent);
const tab = (label: string) => tabs().find(item => item.textContent === label)!;
const click = async (element: HTMLElement) => { await act(async () => { element.click() }); await settle() };
const path = () => location.pathname + location.search;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  try { localStorage.clear() } catch { }
  vi.spyOn(API.prototype, 'state').mockResolvedValue(household);
  vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
  vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'families').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'libraryFamilies').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  // Settings, its schema and the jobs list: an empty answer is enough for the page chrome.
  vi.spyOn(API.prototype, 'call').mockImplementation((async () => ({ items: [], nextCursor: null, total: 0 })) as never);
});

afterEach(() => {
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  try { localStorage.clear() } catch { }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser rail', () => {
  it('holds the six hubs of the TV rail, in its order, and nothing else', async () => {
    await mountAt('/');
    expect(railLabels()).toEqual(['Home', 'Search', 'Library', 'Discover', 'Downloads', 'Settings']);
    expect(railLabels()).toEqual(TV_HUBS.map(hub => hub.label));
    expect(document.querySelector('.sidebar nav')!.textContent).not.toMatch(/Jobs|Projects|Dashboard|Bug/);
  });

  it('groups the views exactly as the TV hubs group their routes, with the same tab names', () => {
    // TV routes and browser views share their identifiers.
    expect(HUBS.map(hub => ({ id: hub.id, label: hub.label, icon: hub.icon, views: hub.views, tabs: hub.tabs?.map(tab => [tab.view, tab.label]) })))
      .toEqual(TV_HUBS.map(hub => ({ id: hub.id, label: hub.label, icon: hub.icon, views: hub.routes, tabs: hub.tabs?.map(tab => [tab.route, tab.label]) })));
  });

  it('gives every hub its icon, an accessible name and a tooltip for the icon-only widths', async () => {
    await mountAt('/');
    for (const item of railItems()) {
      expect(item.querySelector('svg')).not.toBeNull();
      expect(item.getAttribute('title')).toBe(item.querySelector('.nav-label')!.textContent);
      // Native buttons in the Tab order: Enter and Space open the hub like a click.
      expect(item.tagName).toBe('BUTTON');
      expect(item.tabIndex).toBe(0);
    }
  });
});

// Every existing path, the hub it belongs to, the page heading and the selected tab.
const ROUTES: Array<[path: string, hub: string, heading: string, tab: string | null]> = [
  ['/', 'Home', 'Home', null],
  ['/search', 'Search', 'Search', null],
  ['/search?q=lanterns', 'Search', 'Search', null],
  ['/library/dashboard', 'Library', 'Library', 'Dashboard'],
  ['/library/continue', 'Library', 'Library', 'Continue watching'],
  ['/library/favorites', 'Library', 'Library', 'My List'],
  ['/library/watched', 'Library', 'Library', 'Watched'],
  ['/library/categories', 'Library', 'Library', 'Categories'],
  ['/library/downloads', 'Downloads', 'Downloads', null],
  ['/tracker/dashboard', 'Discover', 'Discover', 'Highlights'],
  ['/tracker/browse', 'Discover', 'Discover', 'Browse'],
  ['/tracker/categories', 'Discover', 'Discover', 'Categories'],
  ['/settings', 'Settings', 'Settings', null],
  ['/jobs', 'Settings', 'Background jobs', null],
  ['/projects', 'Settings', 'Other projects', null],
];

describe('existing URLs', () => {
  it.each(ROUTES)('%s opens on the %s hub', async (url, hub, title, selected) => {
    vi.spyOn(API.prototype, 'searchTitles').mockResolvedValue({ items: [], nextCursor: null, total: 0, trackers: [] } as never);
    await mountAt(url);
    expect(currentHub()).toEqual([hub]);
    expect(heading()).toBe(title);
    expect(selectedTab()).toEqual(selected ? [selected] : []);
    expect(path()).toBe(url);
  });

  it('keeps the URL of every tab, so a refresh lands on the same tab', async () => {
    await mountAt('/library/dashboard');
    await click(tab('Watched'));
    expect(path()).toBe('/library/watched');
    render(null, hosts.pop()!);
    await mountAt(path());
    expect(currentHub()).toEqual(['Library']);
    expect(selectedTab()).toEqual(['Watched']);
  });
});

describe('Library and Discover tabs', () => {
  it('draw the hub sections as tabs under the heading', async () => {
    await mountAt('/library/dashboard');
    expect(tabLabels()).toEqual(['Dashboard', 'Continue watching', 'My List', 'Watched', 'Categories']);
    await click(railItem('Discover'));
    expect(heading()).toBe('Discover');
    expect(tabLabels()).toEqual(['Highlights', 'Browse', 'Categories']);
    expect(path()).toBe('/tracker/dashboard');
  });

  it('switch the section and push a history entry, so Back returns to the previous tab', async () => {
    await mountAt('/tracker/dashboard');
    await click(tab('Browse'));
    expect(path()).toBe('/tracker/browse');
    expect(selectedTab()).toEqual(['Browse']);
    expect(document.querySelector('.poster-grid')).not.toBeNull();
    await act(async () => { window.history.back() });
    await new Promise(resolve => setTimeout(resolve, 20));
    await settle();
    expect(path()).toBe('/tracker/dashboard');
    expect(selectedTab()).toEqual(['Highlights']);
  });

  it('are not drawn on hubs without sections', async () => {
    await mountAt('/library/downloads');
    expect(tabs()).toHaveLength(0);
  });

  it('reopen on the last-used tab from the rail', async () => {
    await mountAt('/library/dashboard');
    await click(tab('My List'));
    await click(railItem('Home'));
    await click(railItem('Library'));
    expect(path()).toBe('/library/favorites');
    expect(selectedTab()).toEqual(['My List']);
  });
});

describe('Settings', () => {
  it('leads to Background jobs and Other projects, with the Settings hub still current', async () => {
    await mountAt('/settings');
    const links = document.querySelector('.settings-links')!;
    const jobs = Array.from(links.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Background jobs')!;
    await click(jobs);
    expect(path()).toBe('/jobs');
    expect(heading()).toBe('Background jobs');
    expect(currentHub()).toEqual(['Settings']);
  });

  it('offers the way back to Settings from the screens it leads to, also on a shared link', async () => {
    await mountAt('/projects');
    const back = Array.from(document.querySelectorAll<HTMLButtonElement>('.topbar button')).find(button => button.textContent === 'Settings')!;
    await click(back);
    expect(path()).toBe('/settings');
    expect(heading()).toBe('Settings');
  });

  it('keeps the bug report link beside them, opening the issue tracker', async () => {
    await mountAt('/settings');
    const link = document.querySelector<HTMLAnchorElement>('.settings-links a')!;
    expect(link.textContent).toContain('Report a bug');
    expect(link.getAttribute('href')).toBe('https://github.com/mihaiflorentin/torrent-tv/issues');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
