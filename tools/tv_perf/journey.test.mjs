// The capture journeys and their naming: `node --test tools/tv_perf`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_JOURNEY, WEB_JOURNEY, WEB_VIEWPORTS, checkJourney, shotFile, railMove, routePlace, stepFailure, pickTitles, resolvePath } from './journey.mjs';
import { buildFixture } from './fixture.mjs';

test('web paths name the picked fixture titles, so the journey survives a fixture reseed', () => {
  const picks = pickTitles(buildFixture());
  assert.deepEqual(picks, { movie: 'T000x5flv', series: 'T003xi8xr', download: 'D1' });
  assert.equal(resolvePath('/title/:series', picks), '/title/T003xi8xr');
  assert.equal(resolvePath('/watch/:download', picks), '/watch/D1');
  assert.equal(resolvePath('/library/downloads', picks), '/library/downloads');
});

test('every screen the ticket names has a TV step', () => {
  const names = TV_JOURNEY.map(step => step.name);
  for (const wanted of ['home', 'home-rows', 'rail-open', 'search', 'search-results', 'movie-title', 'movie-versions', 'info-panel', 'series-title', 'series-episodes', 'series-versions', 'downloads', 'settings', 'jobs', 'player-controls'])
    assert.ok(names.includes(wanted), `TV journey has ${wanted}`);
});

test('every rail destination is reached by name, so a rail change only edits the table', () => {
  const destinations = TV_JOURNEY.filter(step => step.actions.some(action => action.go)).map(step => step.actions.find(action => action.go).go);
  assert.deepEqual(destinations, ['search', 'library', 'continue', 'favorites', 'watched', 'downloads', 'library-categories', 'tracker', 'browse', 'categories', 'jobs', 'settings', 'projects']);
});

test('the web journey covers the same screens by URL, at a desktop and a phone size', () => {
  const names = WEB_JOURNEY.map(step => step.name);
  for (const wanted of ['home', 'search-results', 'movie-title', 'series-title', 'series-versions', 'info-panel', 'downloads', 'settings', 'jobs', 'player-controls']) assert.ok(names.includes(wanted), `web journey has ${wanted}`);
  assert.deepEqual(WEB_VIEWPORTS.map(viewport => `${viewport.width}x${viewport.height}`), ['1440x900', '390x844']);
});

test('both journeys pass their own check', () => {
  assert.doesNotThrow(() => checkJourney(TV_JOURNEY));
  assert.doesNotThrow(() => checkJourney(WEB_JOURNEY));
});

test('a journey with a repeated or malformed step name, an unknown action or no ready check is rejected', () => {
  const ok = { name: 'home', actions: [], ready: { selector: 'main' } };
  assert.throws(() => checkJourney([ok, { ...ok }]), /step "home" appears twice/);
  assert.throws(() => checkJourney([{ ...ok, name: 'Home Screen' }]), /step "Home Screen": names are lower-case words joined by hyphens/);
  assert.throws(() => checkJourney([{ ...ok, actions: [{ teleport: 'jobs' }] }]), /step "home": unknown action teleport/);
  assert.throws(() => checkJourney([{ name: 'home', actions: [] }]), /step "home": no ready check/);
});

test('shots are numbered in journey order and named by step', () => {
  assert.equal(shotFile(0, 'home'), '01-home.png');
  assert.equal(shotFile(11, 'series-versions'), '12-series-versions.png');
});

test('a route is reached through its hub: a Library or Discover tab, a Settings group and its entry, or the hub itself', () => {
  assert.deepEqual(routePlace('favorites'), { hub: 'library', tab: 'favorites' });
  assert.deepEqual(routePlace('tracker'), { hub: 'discover', tab: 'tracker' });
  assert.deepEqual(routePlace('categories'), { hub: 'discover', tab: 'categories' });
  assert.deepEqual(routePlace('jobs'), { hub: 'settings', group: 'settings-group-jobs', entry: 'settings-jobs' });
  assert.deepEqual(routePlace('downloads'), { hub: 'downloads' });
  // Every route the journey visits lands on one of the six hubs.
  const hubs = ['home', 'search', 'library', 'discover', 'downloads', 'settings'];
  for (const step of TV_JOURNEY) for (const action of step.actions) if (action.go) assert.ok(hubs.includes(routePlace(action.go).hub), action.go);
});

test('the rail is walked toward the destination from wherever the cursor is', () => {
  const rail = ['home', 'search', 'library', 'downloads', 'jobs', 'settings'];
  assert.equal(railMove(rail, 'home', 'jobs'), 'down');
  assert.equal(railMove(rail, 'settings', 'search'), 'up');
  assert.equal(railMove(rail, 'jobs', 'jobs'), null);
  assert.equal(railMove(rail, undefined, 'library'), 'down');
});

test('a destination missing from the rail fails with the step name', () => {
  assert.throws(() => railMove(['home', 'search'], 'home', 'jobs', 'jobs'), /step "jobs": destination "jobs" is not on the rail \(home, search\)/);
});

test('a step that cannot reach its screen fails loudly with the step name', () => {
  const error = stepFailure({ name: 'movie-versions' }, 'no element matches .source-list .source-button');
  assert.match(error.message, /^step "movie-versions" did not reach its screen: no element matches \.source-list \.source-button$/);
});
