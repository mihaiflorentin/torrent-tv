// The screen capture journeys (screens.mjs): one screenshot per step, named by step.
// Pure data plus the small rules the runner applies, so they are unit tested.
//
// Steps name screens by route, never by rail position: { go: 'browse' } opens the rail, walks it
// to the hub that holds the route (Discover, data-menu-hub="discover"), presses OK, then walks the
// hub's tab strip to the Browse tab (data-hub-tab="browse"); { go: 'jobs' } goes through Settings
// to its Background jobs entry. ROUTE_PLACES is the one table that knows where a route lives.
//
// Actions, run in order by screens.mjs:
//   { go: route }                    TV: open the rail, walk to the route's hub, OK, then its tab or Settings entry, OK
//   { openRail: true }               TV: Left until the rail is open
//   { press: key, times }            a real key event (up, down, left, right, enter, back)
//   { pressUntil: key, focused, max } press until document.activeElement matches the selector
//   { focus: selector }              focus the first visible match (to stand on a control before a press)
//   { click: selector }              click the first visible match
//   { input: selector, text }        type text into a field (sets the value, fires input)
//   { openTitle: 'movie'|'series' }  TV: focus the picked title's card on screen and press OK
//   { visit: path }                  web: load an app URL; ':movie' / ':series' / ':download' become fixture ids
//   { pointer: 'move' }              web: move the mouse across the middle of the page (wakes hidden player controls)
//   { wait: ms }
// ready: { selector, focused } -- the screen is reached when the selector matches a visible element
// and, when given, the focused element matches `focused`. A step that never gets there fails loudly.

const ACTIONS = new Set(['go', 'openRail', 'press', 'pressUntil', 'focus', 'click', 'input', 'openTitle', 'visit', 'pointer', 'wait']);
const rail = (name, route, selector) => ({ name, actions: [{ go: route }], ready: { selector } });

// Where each TV route is reached (clients/tv/src/hubs.ts): its rail hub, and the tab or the Settings
// entry inside it. A route missing here is a hub of its own.
export const ROUTE_PLACES = {
  library: { hub: 'library', tab: 'library' }, continue: { hub: 'library', tab: 'continue' }, favorites: { hub: 'library', tab: 'favorites' },
  watched: { hub: 'library', tab: 'watched' }, 'library-categories': { hub: 'library', tab: 'library-categories' },
  tracker: { hub: 'discover', tab: 'tracker' }, browse: { hub: 'discover', tab: 'browse' }, categories: { hub: 'discover', tab: 'categories' },
  jobs: { hub: 'settings', entry: 'settings-jobs' }, projects: { hub: 'settings', entry: 'settings-projects' },
};
export function routePlace(route) { return ROUTE_PLACES[route] || { hub: route }; }

export const TV_JOURNEY = [
  { name: 'home', actions: [], ready: { selector: '.tv-app .poster-card' } },
  { name: 'home-rows', actions: [{ pressUntil: 'down', focused: '.poster-card', max: 6 }, { press: 'down' }], ready: { selector: '.poster-card', focused: '.poster-card' } },
  { name: 'home-rows-lower', actions: [{ press: 'down', times: 3 }], ready: { selector: '.poster-card', focused: '.poster-card' } },
  { name: 'rail-open', actions: [{ openRail: true }], ready: { selector: '.tv-app.menu-open', focused: '[data-menu-hub]' } },
  { name: 'search', actions: [{ go: 'search' }], ready: { selector: '[data-focus-key="search-input"]' } },
  { name: 'search-results', actions: [{ input: '[data-focus-key="search-input"]', text: 'Kingdom' }, { click: '[data-focus-key="search-submit"]' }, { wait: 800 }], ready: { selector: '.tv-search ~ * .poster-card, .poster-card' } },
  rail('library-dashboard', 'library', '.tv-app [data-focus-region="content"]'),
  rail('continue-watching', 'continue', '.poster-card'),
  rail('my-list', 'favorites', '.poster-card'),
  rail('watched', 'watched', '.poster-card'),
  rail('downloads', 'downloads', '[data-focus-key="downloads-sort"]'),
  rail('library-categories', 'library-categories', '[data-focus-key^="family-"]'),
  { name: 'library-family', actions: [{ focus: '[data-focus-key^="family-"]' }, { press: 'enter' }], ready: { selector: '[data-focus-key="family-back"]' } },
  rail('tracker-dashboard', 'tracker', '.poster-card'),
  rail('browse', 'browse', '[data-focus-key="sort-newest"]'),
  rail('tracker-categories', 'categories', '[data-focus-key^="family-"]'),
  rail('jobs', 'jobs', '[data-focus-key="jobs-search"]'),
  { name: 'job-detail', actions: [{ focus: '[data-focus-key^="job-job-"]' }, { press: 'enter' }], ready: { selector: '[data-focus-key="job-detail-back"]' } },
  rail('settings', 'settings', '[data-focus-key="settings-save"]'),
  rail('projects', 'projects', '[data-focus-key^="project-"]'),
  { name: 'movie-title', actions: [{ openTitle: 'movie' }], ready: { selector: '.detail-screen [data-focus-key="detail-back"]', focused: '[data-focus-key="detail-playback"]' } },
  { name: 'movie-versions', actions: [{ pressUntil: 'down', focused: '.source-list .source-button', max: 3 }], ready: { selector: '.source-list .source-button', focused: '.source-button' } },
  { name: 'info-panel', actions: [{ focus: '[data-focus-key="detail-info"]' }, { press: 'enter' }], ready: { selector: '[data-focus-key="info-close"]' } },
  { name: 'series-title', actions: [{ press: 'back', times: 2 }, { openTitle: 'series' }], ready: { selector: '.detail-screen .season-tabs', focused: '[data-focus-key="detail-playback"]' } },
  { name: 'series-episodes', actions: [{ pressUntil: 'down', focused: '[data-focus-region="episodes"]', max: 4 }], ready: { selector: '.episode-pane .episode-tile', focused: '[data-focus-region="episodes"]' } },
  { name: 'series-versions', actions: [{ press: 'enter' }], ready: { selector: '.versions-view .source-button', focused: '[data-focus-region="versions"]' } },
  // OK on the Best match prepares it and opens the player; the first key after the controls hide only wakes them.
  { name: 'player-controls', actions: [{ press: 'enter' }, { wait: 1500 }, { press: 'up' }], ready: { selector: '.player.controls-visible [data-player-control="play"]' } },
];

// Web: the browser app owns a URL per screen, so most steps load it directly.
export const WEB_VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }];
const page = (name, path, selector) => ({ name, actions: [{ visit: path }], ready: { selector } });
export const WEB_JOURNEY = [
  page('home', '/', '.rail .media-card'),
  page('search', '/search', '.catalog-tools .search'),
  page('search-results', '/search?q=Kingdom', '.poster-grid .media-card'),
  page('library-dashboard', '/library/dashboard', '.rail-section .media-card'),
  page('continue-watching', '/library/continue', '.media-card'),
  page('my-list', '/library/favorites', '.media-card'),
  page('watched', '/library/watched', '.media-card'),
  page('downloads', '/library/downloads', '.download-list .download-actions'),
  page('library-categories', '/library/categories', '.family-grid .family-tile'),
  page('tracker-dashboard', '/tracker/dashboard', '.media-card'),
  page('browse', '/tracker/browse', '.media-card'),
  page('tracker-categories', '/tracker/categories', '.family-grid .family-tile'),
  page('jobs', '/jobs', '.jobs .job-card'),
  page('job-detail', '/jobs/job-1', '[role="dialog"]'),
  page('settings', '/settings', 'form.settings .settings-tabs'),
  page('projects', '/projects', '.project-grid .project-card'),
  page('movie-title', '/title/:movie', '.overlay .detail'),
  { name: 'info-panel', actions: [{ click: '.detail .actions button[aria-haspopup], .detail .hero-info, .detail .actions button:last-child' }, { wait: 600 }], ready: { selector: '[role="dialog"]' } },
  page('series-title', '/title/:series', '.detail .episode-select'),
  { name: 'series-versions', actions: [{ click: '.episode-select' }, { wait: 500 }], ready: { selector: '.versions-view' } },
  { name: 'player-controls', actions: [{ visit: '/watch/:download' }, { pointer: 'move' }], ready: { selector: '.video.controls-visible .player-chrome' } },
];

export function checkJourney(steps) {
  const seen = new Set();
  for (const step of steps) {
    if (seen.has(step.name)) throw new Error(`step "${step.name}" appears twice`);
    seen.add(step.name);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(step.name)) throw new Error(`step "${step.name}": names are lower-case words joined by hyphens`);
    for (const action of step.actions) {
      const unknown = Object.keys(action).find(key => !ACTIONS.has(key) && !['times', 'focused', 'max', 'text'].includes(key));
      if (unknown) throw new Error(`step "${step.name}": unknown action ${unknown}`);
    }
    if (!step.ready || !step.ready.selector) throw new Error(`step "${step.name}": no ready check`);
  }
  return steps;
}

/** The PNG for the step at `index` (0-based) of a journey. */
export function shotFile(index, name) { return `${String(index + 1).padStart(2, '0')}-${name}.png`; }

/** Which way to move along the rail (routes in on-screen order) from `at` to `target`; null when there. */
export function railMove(order, at, target, stepName = target) {
  const to = order.indexOf(target);
  if (to < 0) throw new Error(`step "${stepName}": destination "${target}" is not on the rail (${order.join(', ')})`);
  if (at === target) return null;
  const from = order.indexOf(at);
  return from < to ? 'down' : 'up';
}

export function stepFailure(step, reason) { return new Error(`step "${step.name}" did not reach its screen: ${reason}`); }

/** The fixture titles and download the journeys open: the first movie, the first series with several seasons, the first download. */
export function pickTitles(fixture) {
  return {
    movie: fixture.titles.find(title => title.kind === 'movie').id,
    series: fixture.titles.find(title => title.kind === 'series' && title.seasonCount > 1).id,
    download: fixture.downloads[1].id,
  };
}

/** An app path with :movie, :series and :download replaced by the picked ids. */
export function resolvePath(path, picks) { return path.replace(/:(movie|series|download)\b/g, (_, key) => encodeURIComponent(picks[key])); }
