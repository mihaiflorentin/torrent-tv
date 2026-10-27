#!/usr/bin/env node
/**
 * D-pad navigation audit (ticket #66): runs the built TV bundle in headless Chromium (real layout,
 * Tizen 5 user agent, the perf harness's synthetic household) and checks every screen and overlay
 * against its declared D-pad map in clients/tv/src/dpad/maps.
 *
 *   node tools/tv_perf/dpad.mjs [--only home,rail] [--chrome PATH] [--dist clients/tv/dist] [--out DIR] [--maps FILE] [--record] [--verbose]
 *
 * For each map: reach the screen from Home, check the landing stop, name every visible focus stop
 * (a stop the map does not know fails), press Up/Down/Left/Right (and OK/Back where declared) from
 * the first, second, middle, second-to-last and last stop of every list and from every literal
 * stop, and compare where focus went with the map. Also fails on focus lost to the page body or
 * off screen, a stop left unrevealed after a move, a landing on header chrome, stops that cannot
 * be reached from the landing stop, and traps (stops from which no key ever leaves the screen).
 * Held-key bursts (auto-repeat at 100 ms) run along the lists the maps name and must visit every
 * stop the map says, in order.
 *
 * --record prints what the app does today as a draft map (every stop, every direction) instead of
 * failing: the starting point for a new screen's map.
 *
 * DPAD_TIMING=1 prints how long each phase of every press took (restore, quiet, look, press, settle).
 *
 * Output: a table of failures on stderr, the full report in tools/tv_perf/.out/dpad/report.md
 * and report.json. Exit 0 = every map holds, 1 = a mismatch, 2 = the audit itself failed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildFixture, serve } from './fixture.mjs';
import { CDP, findChrome, launchChrome, waitFor } from './chrome.mjs';
import { pickTitles } from './journey.mjs';
import { makeDriver, prepareTVPage, openTVHome, jsLiteral } from './tv-driver.mjs';
import { DIRECTIONS, classify, sampleStops, movesOf, resolveTarget, resolveOn, checkMaps, formatTable } from '../../clients/tv/src/dpad/model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const VIDEO = path.join(repo, 'tools/smoke_webos_engine/fixture-video.mp4');
const BURST_CADENCE_MS = 100; // a remote's key repeat
const REVEAL_SLACK_PX = 24; // a focused poster scales up a little past its rail

const args = parseArgs(process.argv.slice(2));
const chrome = args.chrome || process.env.CHROME_BIN || findChrome();
const only = args.only ? new Set(String(args.only).split(',')) : null;
const record = Boolean(args.record);
const verbose = Boolean(args.verbose);
// --maps FILE audits another set of maps (a module exporting MAPS), e.g. a deliberately broken copy.
const { MAPS } = await import(args.maps ? path.resolve(String(args.maps)) : '../../clients/tv/src/dpad/maps/index.mjs');

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; }
  }
  return out;
}
const log = message => console.error(`[dpad] ${message}`);

// ---- page probes (inlined into each evaluation) ----------------------------------------------
const PAGE = String.raw`
var SELECTOR = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
function num(value) { var n = Number(value); return value === undefined || value === '' || !isFinite(n) ? null : n; }
function describe(el) {
  var r = el.getBoundingClientRect();
  return { key: el.getAttribute('data-focus-key') || '', region: el.getAttribute('data-focus-region') || '', row: num(el.getAttribute('data-focus-row')), col: num(el.getAttribute('data-focus-col')),
    top: r.top, left: r.left, selected: el.classList.contains('selected') || el.classList.contains('active') || el.getAttribute('aria-current') === 'page', landing: el.getAttribute('data-landing') || '', label: (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40), tag: el.tagName.toLowerCase() };
}
function focusables() {
  var all = document.querySelectorAll(SELECTOR), out = [];
  for (var i = 0; i < all.length; i++) if (all[i].offsetWidth > 0 && all[i].offsetHeight > 0) out.push(all[i]);
  return out;
}
function seen(selector) {
  var list = document.querySelectorAll(selector);
  for (var i = 0; i < list.length; i++) { var el = list[i]; if (!el.getClientRects().length) continue; var s = getComputedStyle(el); if (s.visibility !== 'hidden' && s.display !== 'none') return true; }
  return false;
}
function revealed(el, slack) {
  var r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'not drawn';
  var box = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    var s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    var b = p.getBoundingClientRect();
    if (s.overflowY !== 'visible') { box.top = Math.max(box.top, b.top); box.bottom = Math.min(box.bottom, b.bottom); }
    if (s.overflowX !== 'visible') { box.left = Math.max(box.left, b.left); box.right = Math.min(box.right, b.right); }
  }
  if (r.top < box.top - slack || r.bottom > box.bottom + slack || r.left < box.left - slack || r.right > box.right + slack)
    return 'outside the visible area (' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ')';
  return '';
}
function signature() {
  var app = document.querySelector('.tv-app[data-route]');
  return JSON.stringify({ menu: !!document.querySelector('.tv-app.menu-open'), info: seen('.info-panel'), dialogs: document.querySelectorAll('[role="dialog"]').length,
    detail: !!document.querySelector('.detail-screen'), versions: !!document.querySelector('.versions-view'), player: !!document.querySelector('.player-shell'),
    setup: !!document.querySelector('main.setup'), route: app ? app.getAttribute('data-route') : '', family: !!document.querySelector('[data-focus-key="family-back"]'),
    job: !!document.querySelector('[data-focus-key="job-detail-back"]'), panel: (function () { var dialog = document.querySelector('.player-dialog'); return dialog ? dialog.className + ':' + (dialog.getAttribute('data-player-menu') || '') : ''; })(),
    infoLevel: (function () { var first = document.querySelector('.info-panel .info-scroll [data-focus-key]'); return first ? first.getAttribute('data-focus-key') : ''; })(),
    controls: !!document.querySelector('.player.controls-visible'),
    settings: (function () { var pane = document.querySelector('[data-settings-pane]'); return pane ? pane.getAttribute('data-settings-pane') : ''; })() });
}
function observe(slack) {
  var a = document.activeElement;
  var body = !a || a === document.body || a === document.documentElement;
  var list = focusables();
  return { signature: signature(), elements: list.map(describe), body: body, active: body ? null : describe(a), listed: !body && list.indexOf(a) >= 0, reveal: body ? '' : revealed(a, slack) };
}`;
// A prepare is one request held open while the server works (the fixture holds one open for the preparing dialog's
// map), so it is not counted as in flight: the dialog is the quiet state.
const QUIET_PROBE = `(function () {
  window.__dpadInflight = 0; window.__dpadMutated = Date.now();
  var original = window.fetch;
  if (original) window.fetch = function (input) { if (/\\/prepare(-season)?$/.test(String(input && input.url || input))) return original.apply(this, arguments); window.__dpadInflight++; var done = function () { window.__dpadInflight--; window.__dpadMutated = Date.now(); }; var p = original.apply(this, arguments); p.then(done, done); return p; };
  document.addEventListener('DOMContentLoaded', function () { new MutationObserver(function () { window.__dpadMutated = Date.now(); }).observe(document.body, { childList: true, subtree: true }); });
})();`;
const QUIET = `(window.__dpadInflight === 0 && Date.now() - window.__dpadMutated >= 120)`;
const page = body => `(() => { ${PAGE}\n${body} })()`;

// ---- the audit -------------------------------------------------------------------------------
async function main() {
  const problems = record ? [] : checkMaps(MAPS);
  if (problems.length) throw new Error(`the D-pad maps are inconsistent:\n  ${problems.join('\n  ')}`);
  const maps = MAPS.filter(map => !only || only.has(map.name));
  if (only) { const unknown = [...only].filter(name => !MAPS.some(map => map.name === name)); if (unknown.length) throw new Error(`--only names no map: ${unknown.join(', ')} (maps: ${MAPS.map(map => map.name).join(', ')})`); }
  const dist = path.resolve(args.dist || path.join(repo, 'clients/tv/dist'));
  if (!fs.existsSync(path.join(dist, 'app.js'))) throw new Error(`${dist}/app.js is missing: run \`npm run build:tv\` first (or use \`make dpad-tv\`)`);
  const outDir = path.resolve(args.out || path.join(here, '.out/dpad'));
  fs.mkdirSync(outDir, { recursive: true });

  const fixture = buildFixture({ scenarios: true });
  const picks = pickTitles(fixture);
  const server = await serve({ dist, fixture, video: VIDEO, smallBackdrops: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-dpad-'));
  const { child, wsUrl } = await launchChrome(chrome, userDir, { width: 1920, height: 1080 });
  const cdp = new CDP(wsUrl);
  const results = [];
  const started = Date.now();
  try {
    await cdp.opened;
    await Promise.all(['Page', 'Runtime'].map(domain => cdp.send(`${domain}.enable`)));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await prepareTVPage(cdp, server);
    // In-flight requests and the last DOM change, so a check starts only once the screen is quiet
    // (a page of titles requested by the previous press has landed).
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: QUIET_PROBE });
    const driver = makeDriver(cdp, server, fixture, picks, { gapMs: 150 });
    for (const map of maps) {
      const t0 = Date.now();
      const result = await auditMap(cdp, server, driver, map).catch(error => ({ map: map.name, rows: [], harness: verbose ? error.stack : error.message }));
      result.ms = Date.now() - t0;
      results.push(result);
      const failed = result.rows.filter(row => row.problem).length + (result.harness ? 1 : 0);
      log(`${map.name.padEnd(22)} ${String(result.rows.length).padStart(3)} checks  ${failed ? `${failed} FAILED` : 'ok'}  (${(result.ms / 1000).toFixed(1)} s)${result.harness ? `  harness: ${result.harness}` : ''}`);
    }
  } finally {
    try { cdp.close(); } catch { }
    child.kill('SIGKILL');
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { }
  }
  return report(results, outDir, Date.now() - started);
}

async function reach(cdp, server, driver, map) {
  await openTVHome(cdp, server, { settleMs: 1200 });
  await driver.perform({ name: map.name, actions: map.reach });
  await waitFor(cdp, page(`return ${jsLiteral([].concat(map.detect))}.every(seen);`), 10000, `${[].concat(map.detect).join(' + ')} (map ${map.name})`);
  await sleep(map.settleMs || 600);
}

async function observe(cdp) { return cdp.eval(page(`return observe(${REVEAL_SLACK_PX});`)); }

/** Which map the focused element belongs to now, and as which stop: { screen, stop, layout } or null. */
function locate(observation, preferred) {
  if (!observation.active) return null;
  const order = [...preferred.filter(Boolean), ...MAPS];
  const visible = observation.visibleMaps;
  for (const map of order) {
    if (!visible.includes(map.name)) continue;
    const layout = classify(map, observation.elements);
    const stop = layout.stops.find(candidate => candidate.element.key && candidate.element.key === observation.active.key);
    if (stop) return { screen: map.name, stop: stop.id, layout, map };
  }
  return null;
}

async function look(cdp) {
  const observation = await observe(cdp);
  observation.visibleMaps = await cdp.eval(page(`var names = ${jsLiteral(MAPS.map(map => [map.name, map.detect]))}; return names.filter(function (pair) { return [].concat(pair[1]).every(seen); }).map(function (pair) { return pair[0]; });`));
  return observation;
}

/** Waits until focus and the screen have been still for a moment (longer when the screen changed). */
/** Waits (up to 3 s) until no request is in flight and the DOM has not changed for a moment. */
async function quiet(cdp) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(await cdp.eval(QUIET).catch(() => true))) await sleep(50);
}

async function settle(cdp, baseline) {
  const t0 = Date.now();
  let last = '';
  let still = 0;
  for (;;) {
    await sleep(60);
    const [now, quiet] = await cdp.eval(page(`var a = document.activeElement; return [signature() + '|' + (a && a.getAttribute && a.getAttribute('data-focus-key')), ${QUIET}];`));
    const changed = !now.startsWith(baseline + '|');
    still = now === last ? still + 1 : 0;
    last = now;
    const elapsed = Date.now() - t0;
    if (elapsed > 3000) return;
    if (still >= 2 && quiet && elapsed >= (changed ? 600 : 150)) return;
  }
}

function name(found, observation) {
  if (observation.body) return 'page body';
  if (!found) return `unmapped ${observation.active.key || `${observation.active.tag} "${observation.active.label}"`}`;
  return found.screen + ':' + found.stop;
}

async function auditMap(cdp, server, driver, map) {
  const rows = [];
  const fail = (stop, key, expected, actual, problem) => rows.push({ stop, key, expected, actual, problem });
  const pass = (stop, key, expected, actual) => rows.push({ stop, key, expected, actual, problem: '' });
  await reach(cdp, server, driver, map);
  let first = await look(cdp);
  // Landing: where the screen put focus by itself.
  {
    let layout = classify(map, first.elements);
    const wanted = resolveOn(map, layout, map.landing);
    const found = locate(first, [map]);
    const actual = name(found, first);
    const problem = first.body ? 'focus is on the page body' : first.active.landing === 'chrome' ? 'landed on header chrome' : actual !== `${map.name}:${wanted}` ? 'landed elsewhere' : '';
    (problem ? fail : pass)('(landing)', 'open', `${map.name}:${wanted}`, actual, problem);
  }
  const baseline = first.signature;
  // Back to the screen as reached: Back (twice at most, each given up to 1 s to take), else reload and reach again.
  const restore = async () => {
    const current = () => cdp.eval(page('return signature();'));
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await current()) === baseline) return;
      await driver.press('back', 1, 0);
      for (let i = 0; i < 20 && (await current()) !== baseline; i++) await sleep(50);
    }
    if ((await current()) !== baseline) await reach(cdp, server, driver, map);
  };

  let layout = classify(map, first.elements);
  for (const element of layout.unmapped) fail(element.key || `${element.tag} "${element.label}"`, '-', '(a stop of this map)', `region ${element.region || '-'} row ${element.row} col ${element.col}`, element.key ? 'stop not in the map' : 'stop has no data-focus-key');
  for (const [key, moves] of Object.entries(map.stops || {})) if (!moves.optional && !layout.stops.some(stop => stop.id === key)) fail(key, '-', 'on screen', 'missing', 'declared stop not on screen');
  for (const name of Object.keys(map.groups || {})) if (!layout.groups[name] && !map.groups[name].optional) fail(`${name}[*]`, '-', 'on screen', 'missing', 'declared group not on screen');

  const edges = [];
  const samples = record ? [...sampleStops(map, layout), ...recordSamples(layout.unmapped)] : sampleStops(map, layout);
  const tested = new Set();
  for (let round = 0; round < 3 && samples.length; round++) {
    for (const sample of samples.splice(0)) {
      if (tested.has(sample.element.key)) continue;
      tested.add(sample.element.key);
      if (!record) { await restore(); await quiet(cdp); }
      const fresh = record ? null : classify(map, (await look(cdp)).elements);
      const placed = fresh && fresh.stops.find(stop => stop.element.key === sample.element.key);
      const moves = placed ? movesOf(map, fresh, placed) : {};
      const keys = record ? DIRECTIONS : [...DIRECTIONS, ...['ok', 'back'].filter(key => moves[key])];
      for (const key of keys) {
        const T = [Date.now()];
        await restore(); T.push(Date.now());
        await quiet(cdp); T.push(Date.now());
        const before = await look(cdp); T.push(Date.now());
        layout = classify(map, before.elements);
        const stop = layout.stops.find(candidate => candidate.element.key === sample.element.key) || (record ? sample : null);
        if (!stop) { fail(sample.id, key, '-', 'stop vanished', 'stop not on screen after restoring the screen'); continue; }
        const focused = await cdp.eval(page(`var el = focusables().filter(function (e) { return e.getAttribute('data-focus-key') === ${jsLiteral(stop.element.key)}; })[0]; if (!el) return false; el.focus(); return document.activeElement === el;`));
        if (!focused) { fail(stop.id, key, '-', 'cannot focus', 'stop does not take focus'); continue; }
        await sleep(40);
        const signatureBefore = await cdp.eval(page('return signature();'));
        T.push(Date.now());
        await driver.press(key === 'ok' ? 'enter' : key, 1, 0); T.push(Date.now());
        await settle(cdp, signatureBefore); T.push(Date.now());
        const after = await look(cdp); T.push(Date.now());
        if (process.env.DPAD_TIMING) log(`timing ${T.slice(1).map((t, i) => t - T[i]).join(' ')}`);
        // Judge against the screen as it is after the press (a lazy rail may have arrived meanwhile),
        // from the stop's place on it.
        const afterLayout = classify(map, after.elements);
        const stopAfter = afterLayout.stops.find(candidate => candidate.element.key === stop.element.key);
        const movedToken = stopAfter && movesOf(map, afterLayout, stopAfter)[key];
        const declared = movedToken || moves[key];
        if (!record && !declared) { fail(stop.id, key, '-', '-', 'the map has no move for this key here'); continue; }
        const expected = record ? null : movedToken ? resolveTarget(map, afterLayout, stopAfter, movedToken, key) : resolveTarget(map, layout, stop, moves[key], key);
        const found = locate(after, [expected && MAPS.find(other => other.name === expected.screen), map]);
        const actual = name(found, after);
        let wanted = '';
        if (expected) {
          const target = expected.stop !== undefined ? expected.stop : found && found.screen === expected.screen ? resolveOn(found.map, found.layout, expected.token, stop, key) : expected.token;
          wanted = `${expected.screen}:${target}`;
        }
        const label = stop.element.key && stop.id !== stop.element.key ? `${stop.id} (${stop.element.key})` : stop.id;
        let problem = '';
        if (after.body) problem = 'focus lost to the page body';
        else if (!after.listed) problem = 'focus on an element that is not drawn';
        else if (after.reveal) problem = `focused stop not revealed: ${after.reveal}`;
        else if (!record && actual !== wanted) problem = 'went elsewhere';
        if (found) edges.push({ from: stop.group || stop.id, key, to: found.screen === map.name ? (found.layout.stops.find(s => s.id === found.stop)?.group || found.stop) : `${found.screen}:`, leaves: found.screen !== map.name });
        (problem ? fail : pass)(label, key, record ? '' : wanted, actual, problem);
        if (verbose) log(`  ${map.name} ${label} ${key} -> ${actual}${problem ? `  FAIL ${problem} (expected ${wanted})` : ''}`);
      }
    }

    // Lists that arrived while the keys were pressed (lazy rails, a page of titles): their ends too.
    if (!record) { await quiet(cdp); samples.push(...sampleStops(map, classify(map, (await look(cdp)).elements)).filter(stop => !tested.has(stop.element.key))); }
  }

  // Held-key bursts: every stop on the way, in order, and the declared end.
  for (const burst of record ? [] : map.bursts || []) {
    await restore();
    await quiet(cdp);
    const before = await look(cdp);
    layout = classify(map, before.elements);
    const fromId = resolveOn(map, layout, burst.from);
    const from = layout.stops.find(stop => stop.id === fromId);
    const label = `burst ${burst.key} x${burst.presses || 'n'}`;
    if (!from) { fail(burst.from, label, '-', 'missing', 'burst start not on screen'); continue; }
    // Enough presses to cross the longest list on the screen and push once past its end.
    const presses = burst.presses || Math.max(4, ...Object.values(layout.groups).map(group => group.members.length + 2));
    await cdp.eval(page(`window.__dpadTrail = []; if (!window.__dpadTrailHook) { window.__dpadTrailHook = true; document.addEventListener('focusin', function (e) { var k = e.target && e.target.getAttribute && e.target.getAttribute('data-focus-key'); if (window.__dpadTrail) window.__dpadTrail.push(k || '?'); }); }
      var el = focusables().filter(function (e) { return e.getAttribute('data-focus-key') === ${jsLiteral(from.element.key)}; })[0]; el.focus(); window.__dpadTrail = []; return true;`));
    await sleep(40);
    await driver.hold(burst.key, presses, BURST_CADENCE_MS);
    await settle(cdp, before.signature);
    const after = await look(cdp);
    const trail = await cdp.eval('window.__dpadTrail');
    const finalLayout = classify(map, after.elements);
    // The declared path: apply the map's move for this key from the start, once per press.
    const path = [];
    let at = finalLayout.stops.find(stop => stop.element.key === from.element.key) || from;
    for (let i = 0; i < presses; i++) {
      const next = resolveTarget(map, finalLayout, at, movesOf(map, finalLayout, at)[burst.key], burst.key);
      if (next.screen !== map.name || next.stop === at.id) break;
      at = finalLayout.stops.find(stop => stop.id === next.stop);
      if (!at) break;
      path.push(at.element.key);
    }
    // The declared end: `expect` when the map names it, else wherever the declared path ends.
    const pathEnd = path.length ? finalLayout.stops.find(stop => stop.element.key === path[path.length - 1]).id : (finalLayout.stops.find(stop => stop.element.key === from.element.key) || from).id;
    const expectedEnd = burst.expect ? resolveOn(map, finalLayout, burst.expect) : pathEnd;
    const found = locate(after, [map]);
    const actual = name(found, after);
    const trailText = trail.join(' > ');
    let problem = '';
    if (after.body) problem = 'focus lost to the page body';
    else if (actual !== `${map.name}:${expectedEnd}`) problem = `ended elsewhere (trail: ${shorten(trailText)})`;
    else if (trailText !== path.join(' > ')) problem = `skipped or extra stops: trail ${shorten(trailText)} | declared ${shorten(path.join(' > '))}`;
    else if (expectedEnd !== pathEnd) problem = `the map's own moves end on ${pathEnd}, not on the burst's expect ${expectedEnd}`;
    (problem ? fail : pass)(`${burst.from} (${from.element.key})`, label, `${map.name}:${expectedEnd}`, actual, problem);
  }

  // Reachability and traps over what the keys actually did (lists count as one node).
  if (!record) {
    const nodes = new Set(sampleStops(map, layout).map(stop => stop.group || stop.id));
    const landingStop = layout.stops.find(stop => stop.id === resolveOn(map, layout, map.landing));
    const start = landingStop ? landingStop.group || landingStop.id : null;
    const next = node => edges.filter(edge => edge.from === node && !edge.leaves).map(edge => edge.to);
    const reached = new Set(start ? [start] : []);
    for (const queue = [...reached]; queue.length;) for (const to of next(queue.shift())) if (!reached.has(to)) { reached.add(to); queue.push(to); }
    for (const node of nodes) if (!reached.has(node)) fail(node, '-', `reachable from ${start}`, 'unreachable', 'stop cannot be reached from the landing stop');
    const exits = new Set(edges.filter(edge => edge.leaves).map(edge => edge.from));
    for (const node of nodes) {
      const seen = new Set([node]);
      let free = exits.has(node);
      for (const queue = [node]; queue.length && !free;) for (const to of next(queue.shift())) { if (exits.has(to)) { free = true; break; } if (!seen.has(to)) { seen.add(to); queue.push(to); } }
      if (!free && edges.length && !map.noExit) fail(node, '-', 'a way off the screen', 'none', 'trap: no key leads off this screen from here');
    }
  }
  return { map: map.name, rows, layout: record ? layout : null };
}

// --record on a screen without a map: the first two and last two stops of every row.
function recordSamples(elements) {
  const rows = new Map();
  for (const element of elements.filter(item => item.key)) { const row = `${element.region}|${element.row}`; if (!rows.has(row)) rows.set(row, []); rows.get(row).push(element); }
  return [...rows.values()].flatMap(list => [...new Set([0, 1, list.length - 2, list.length - 1].filter(i => i >= 0 && i < list.length))].map(i => ({ id: list[i].key, element: list[i] })));
}

const shorten = text => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

function report(results, outDir, ms) {
  const failures = results.flatMap(result => [...(result.harness ? [{ screen: result.map, stop: '-', key: '-', expected: '-', actual: '-', problem: `audit could not run: ${result.harness}` }] : []), ...result.rows.filter(row => row.problem).map(row => ({ screen: result.map, ...row }))]);
  const header = ['screen', 'stop', 'key', 'expected', 'actual', 'problem'];
  const table = rows => formatTable([header, ...rows.map(row => [row.screen, row.stop, row.key, row.expected, row.actual, row.problem])]);
  const lines = [`# D-pad audit`, '', `${results.length} maps, ${results.reduce((n, r) => n + r.rows.length, 0)} checks, ${failures.length} failures, ${(ms / 1000).toFixed(0)} s.`, ''];
  if (record) {
    for (const result of results) {
      lines.push(`## ${result.map} (observed)`, '', '```', formatTable([['stop', 'key', 'actual', 'problem'], ...result.rows.map(row => [row.stop, row.key, row.actual, row.problem])]), '```', '');
    }
  } else {
    if (failures.length) lines.push('## Failures', '', '```', table(failures), '```', '');
    for (const result of results) lines.push(`## ${result.map}`, '', '```', table(result.rows.map(row => ({ screen: result.map, ...row, problem: row.problem || 'ok' }))), '```', '');
  }
  fs.writeFileSync(path.join(outDir, record ? 'observed.md' : 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, record ? 'observed.json' : 'report.json'), JSON.stringify(results.map(result => { const rest = { ...result }; delete rest.layout; return rest; }), null, 2));
  const shown = file => path.relative(repo, file);
  if (record) { log(`observed moves written to ${shown(path.join(outDir, 'observed.md'))}`); return 0; }
  if (failures.length) {
    console.error('\n' + table(failures) + '\n');
    log(`FAIL: ${failures.length} D-pad checks failed; full report in ${shown(path.join(outDir, 'report.md'))}`);
    return 1;
  }
  log(`ok: every declared D-pad map holds (${results.length} maps); report in ${shown(path.join(outDir, 'report.md'))}`);
  return 0;
}

main().then(code => process.exit(code), error => { console.error(`[dpad] FAIL: ${error.message}`); if (verbose) console.error(error.stack); process.exit(2); });
