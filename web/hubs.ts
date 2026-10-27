import type { View } from '@torrent-tv/shared';

// The six hubs of the browser rail (DESIGN.md "Web layout"), the same as the TV's (clients/tv/src/hubs.ts;
// hubs.test.tsx fails if the two drift). A hub is presentation over the existing views and URLs: Library
// and Discover draw a tab strip whose tabs are those views, and a hub's selected tab is the view on
// screen, never stored separately. Background jobs and Other projects are reached from Settings.

export type SectionView = Exclude<View, 'title' | 'watch'>;
export type HubId = 'home' | 'search' | 'library' | 'discover' | 'downloads' | 'settings';
export interface HubTab { view: SectionView; label: string }
export interface Hub { id: HubId; label: string; icon: string; views: SectionView[]; tabs?: HubTab[] }

export const HUBS: Hub[] = [
  { id: 'home', label: 'Home', icon: 'home', views: ['home'] },
  { id: 'search', label: 'Search', icon: 'search', views: ['search'] },
  {
    id: 'library', label: 'Library', icon: 'library', views: ['library', 'continue', 'favorites', 'watched', 'library-categories'],
    tabs: [
      { view: 'library', label: 'Dashboard' },
      { view: 'continue', label: 'Continue watching' },
      { view: 'favorites', label: 'My List' },
      { view: 'watched', label: 'Watched' },
      { view: 'library-categories', label: 'Categories' },
    ],
  },
  {
    id: 'discover', label: 'Discover', icon: 'discover', views: ['tracker', 'browse', 'categories'],
    tabs: [
      { view: 'tracker', label: 'Highlights' },
      { view: 'browse', label: 'Browse' },
      { view: 'categories', label: 'Categories' },
    ],
  },
  { id: 'downloads', label: 'Downloads', icon: 'download', views: ['downloads'] },
  { id: 'settings', label: 'Settings', icon: 'settings', views: ['settings', 'jobs', 'projects'] },
];

export function hubOf(view: View): Hub {
  return HUBS.find(hub => hub.views.includes(view as SectionView)) || HUBS[0];
}

/** The page heading: the hub's name, or the screen's own name for the screens reached from Settings. */
export function pageHeading(view: View): string {
  if (view === 'jobs') return 'Background jobs';
  if (view === 'projects') return 'Other projects';
  return hubOf(view).label;
}

/** The name of a tab view (a single-shelf Library tab titles its shelf with it). */
export function tabLabel(view: View): string {
  return hubOf(view).tabs?.find(tab => tab.view === view)?.label || pageHeading(view);
}

export type HubMemory = Partial<Record<HubId, SectionView>>;
const MEMORY_KEY = 'web.hubTabs';

/** Where the rail item of `hub` leads: its last-used tab, else its first view. */
export function hubDestination(hub: Hub, memory: HubMemory): SectionView {
  const remembered = memory[hub.id];
  return hub.tabs && remembered && hub.tabs.some(tab => tab.view === remembered) ? remembered : hub.views[0];
}

/** The memory after `view` was shown: a tab view becomes its hub's last-used tab. */
export function rememberTab(memory: HubMemory, view: View): HubMemory {
  const hub = hubOf(view);
  if (!hub.tabs || !hub.tabs.some(tab => tab.view === view) || memory[hub.id] === view) return memory;
  return { ...memory, [hub.id]: view };
}

// The last-used tabs survive a reload, like the recent searches. Storage can be missing or throw.
export function loadHubMemory(): HubMemory {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}') as Record<string, unknown>;
    const memory: HubMemory = {};
    for (const hub of HUBS) { const view = parsed[hub.id]; if (typeof view === 'string' && hub.tabs?.some(tab => tab.view === view)) memory[hub.id] = view as SectionView }
    return memory;
  } catch { return {} }
}

export function saveHubMemory(memory: HubMemory): void {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)) } catch { /* storage unavailable: memory lasts this page load */ }
}
