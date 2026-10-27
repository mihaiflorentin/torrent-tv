// The six hubs of the TV rail (DESIGN.md "Navigation"). A hub is presentation over the existing
// routes: Library and Discover draw a tab strip whose tabs are those routes, and a hub's selected
// tab is the route on screen, never stored separately. Route identifiers stay what the NavSnapshot,
// landing focus and Back restoration already use.

export type TVRoute = 'home' | 'search' | 'library' | 'continue' | 'favorites' | 'watched' | 'downloads' | 'library-categories' | 'tracker' | 'browse' | 'categories' | 'jobs' | 'settings' | 'projects';
export type HubId = 'home' | 'search' | 'library' | 'discover' | 'downloads' | 'settings';

export interface HubTab { route: TVRoute; label: string }
export interface Hub {
  id: HubId;
  label: string;
  icon: string;
  /** The one-line hint the open rail shows under the focused hub. */
  hint: string;
  /** The routes the hub holds, in tab order; the first is where a hub opens the first time. */
  routes: TVRoute[];
  /** Library and Discover only: the tab strip drawn above the content. */
  tabs?: HubTab[];
}

export const HUBS: Hub[] = [
  { id: 'home', label: 'Home', icon: 'home', hint: 'Pick up where you left off', routes: ['home'] },
  { id: 'search', label: 'Search', icon: 'search', hint: 'Find a film or a series', routes: ['search'] },
  {
    id: 'library', label: 'Library', icon: 'library', hint: 'Continue · My List · Watched · Categories',
    routes: ['library', 'continue', 'favorites', 'watched', 'library-categories'],
    tabs: [
      { route: 'library', label: 'Dashboard' },
      { route: 'continue', label: 'Continue watching' },
      { route: 'favorites', label: 'My List' },
      { route: 'watched', label: 'Watched' },
      { route: 'library-categories', label: 'Categories' },
    ],
  },
  {
    id: 'discover', label: 'Discover', icon: 'discover', hint: 'Highlights · Browse · Categories',
    routes: ['tracker', 'browse', 'categories'],
    tabs: [
      { route: 'tracker', label: 'Highlights' },
      { route: 'browse', label: 'Browse' },
      { route: 'categories', label: 'Categories' },
    ],
  },
  { id: 'downloads', label: 'Downloads', icon: 'download', hint: 'Transfers and files on the server', routes: ['downloads'] },
  // Background jobs and Other projects are reached from Settings, so they belong to its hub.
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Playback, trackers, server and jobs', routes: ['settings', 'jobs', 'projects'] },
];

const ALL_ROUTES = HUBS.reduce<TVRoute[]>((all, hub) => all.concat(hub.routes), []);

/** A route string from a NavSnapshot or the app: an unknown one (a renamed route) falls back to Home. */
export function knownRoute(route: string | undefined): TVRoute {
  return ALL_ROUTES.indexOf(route as TVRoute) >= 0 ? route as TVRoute : 'home';
}

export function hubOf(route: TVRoute): Hub {
  return HUBS.filter(hub => hub.routes.indexOf(route) >= 0)[0] || HUBS[0];
}

/** The screen heading: the hub's name, or the route's own name for screens reached from Settings. Home has none. */
export function screenHeading(route: TVRoute): string {
  if (route === 'home' || route === 'search') return '';
  if (route === 'jobs') return 'Background jobs';
  if (route === 'projects') return 'Other projects';
  return hubOf(route).label;
}

export type HubMemory = Partial<Record<HubId, TVRoute>>;
const MEMORY_KEY = 'tv.hubTabs';

/** Where the rail item of `hub` leads: its last-used tab, else its first route. */
export function hubDestination(hub: Hub, memory: HubMemory): TVRoute {
  const remembered = memory[hub.id];
  return hub.tabs && remembered && hub.tabs.some(tab => tab.route === remembered) ? remembered : hub.routes[0];
}

/** The memory after `route` was shown: a tab route becomes its hub's last-used tab. */
export function rememberTab(memory: HubMemory, route: TVRoute): HubMemory {
  const hub = hubOf(route);
  if (!hub.tabs || !hub.tabs.some(tab => tab.route === route) || memory[hub.id] === route) return memory;
  const next: HubMemory = {};
  for (const key of Object.keys(memory) as HubId[]) next[key] = memory[key];
  next[hub.id] = route;
  return next;
}

// The last-used tabs survive a restart of the app, like the recent searches. Storage can be missing or throw.
export function loadHubMemory(): HubMemory {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}') as Record<string, unknown>;
    const memory: HubMemory = {};
    for (const hub of HUBS) { const route = parsed[hub.id]; if (typeof route === 'string' && hub.routes.indexOf(route as TVRoute) >= 0) memory[hub.id] = route as TVRoute; }
    return memory;
  } catch (error) { return {}; }
}

export function saveHubMemory(memory: HubMemory): void {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch (error) { /* storage unavailable: memory lasts this session */ }
}
