#!/usr/bin/env node
/**
 * Throttled-Chromium performance harness for the TV client (spec #45, ticket #48).
 * Development only: never packaged, no npm dependencies (Node >= 22: native
 * fetch + WebSocket speak the DevTools protocol).
 *
 *   node tools/tv_perf/run.mjs [--server URL] [--throttle 6] [--dist DIR] [--out FILE]
 *
 * It serves the built TV bundle (clients/tv/dist, from `npm run build:tv`) on
 * localhost together with a synthetic household API (fixture.mjs), or points the
 * app at a real server with --server. Headless Chromium then runs the journeys
 * under Emulation.setCPUThrottlingRate and a Chrome trace; analysis.mjs turns
 * the trace into per-step main-thread time and checks the budgets.
 *
 * Exit codes: 0 budgets held, 1 a budget was exceeded, 2 harness failure.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildFixture, serve } from './fixture.mjs';
import { analyzeSteps, countSlowFrames, evaluateBudgets, BUDGETS } from './analysis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const STORAGE_KEY = 'filelist.serverUrl'; // clients/tv/src/main.tsx

const args = parseArgs(process.argv.slice(2));
const options = {
  server: args.server || '',
  throttle: Number(args.throttle ?? 6),
  dist: path.resolve(args.dist || path.join(repo, 'clients/tv/dist')),
  out: path.resolve(args.out || path.join(here, '.out/report.json')),
  chrome: args.chrome || process.env.CHROME_BIN || findChrome(),
  cadenceMs: Number(args['repeat-ms'] ?? 100), // remote key-repeat interval
  railPresses: Number(args['rail-presses'] ?? 20),
  downPresses: Number(args['down-presses'] ?? 8),
  verbose: Boolean(args.verbose),
};

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

function findChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache).sort().reverse()) {
      candidates.push(path.join(cache, dir, 'chrome-linux64/chrome'), path.join(cache, dir, 'chrome-headless-shell-linux64/chrome-headless-shell'));
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.opened = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('DevTools socket failed')); });
    this.ws.onmessage = message => {
      const data = JSON.parse(message.data);
      if (data.id) { const p = this.pending.get(data.id); this.pending.delete(data.id); if (data.error) p.reject(new Error(`${p.method}: ${data.error.message}`)); else p.resolve(data.result); }
      else for (const handler of this.listeners.get(data.method) || []) handler(data.params);
    };
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = this.nextId++; this.pending.set(id, { resolve, reject, method }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, handler) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(handler); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed'); return r.result.value; }
  close() { this.ws.close(); }
}

async function launchChrome(userDir) {
  if (!options.chrome) throw new Error('no Chromium found: pass --chrome PATH or set CHROME_BIN');
  const child = spawn(options.chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1', '--window-size=1920,1080', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', chunk => { log += chunk; });
  const portFile = path.join(userDir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { child.kill(); throw new Error(`Chromium did not start:\n${log.slice(-800)}`); }
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => []);
    target = list.find(item => item.type === 'page');
    if (!target) await sleep(100);
  }
  if (!target) { child.kill(); throw new Error('no page target'); }
  return { child, wsUrl: target.webSocketDebuggerUrl };
}

// The page side: a trusted-keydown hook that stamps a trace mark and its own clock, and a rAF clock for frame gaps.
const PAGE_HOOK = (serverUrl, storageKey) => `
(() => {
  try { if (!localStorage.getItem(${JSON.stringify(storageKey)})) localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(serverUrl)}); } catch (e) {}
  const perf = window.__tvperf = { n: 0, keys: [], frames: [], errors: [] };
  addEventListener('keydown', event => { if (!event.isTrusted) return; const n = perf.n++; perf.keys[n] = performance.now(); performance.mark('tvperf:key:' + n); }, true);
  addEventListener('error', event => perf.errors.push(String(event.message)));
  const tick = t => { perf.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();`;

const MENU_GROUP = 'Left toward the menu, Up/Down in the menu';
const KEYS = {
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  noop: { key: 'Shift', code: 'ShiftLeft', vk: 16 }, // not a remote key: only stamps a trace mark
};

async function main() {
  if (!fs.existsSync(path.join(options.dist, 'app.js'))) throw new Error(`${options.dist}/app.js is missing: run \`npm run build:tv\` first (or use \`make perf-tv\`)`);
  const fixture = buildFixture();
  const web = await serve({ dist: options.dist, fixture });
  const apiBase = options.server ? options.server.replace(/\/$/, '') : web.url;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-perf-'));
  const { child, wsUrl } = await launchChrome(userDir);
  const cdp = new CDP(wsUrl);
  const cleanup = () => { try { cdp.close(); } catch { } child.kill('SIGKILL'); web.close(); fs.rmSync(userDir, { recursive: true, force: true }); };
  try {
    await cdp.opened;
    await Promise.all(['Page', 'Runtime', 'Performance', 'Log'].map(domain => cdp.send(`${domain}.enable`)));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HOOK(apiBase, STORAGE_KEY) });
    const consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', event => consoleErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));

    const load = os.loadavg()[0];
    if (load > os.cpus().length / 2) log(`WARN: load average ${load.toFixed(1)} on ${os.cpus().length} CPUs; other work on this machine inflates every number, rerun when it is quiet`);
    log(`serving${options.dist} at ${web.url}; API ${options.server || 'synthetic fixture (' + fixture.titles.length + ' titles)'}`);
    await cdp.send('Page.navigate', { url: web.url + '/index.html' });
    await waitFor(cdp, `!!document.querySelector('[data-focus-region="content"]') && document.querySelectorAll('.poster-card').length > 3`, 30000, 'the Home screen to render');
    await sleep(2500); // let boot-time fetches and the landing intent finish unthrottled

    // Warm the unthrottled boot; everything below is measured under CPU throttling and a trace.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.throttle });
    const events = [];
    cdp.on('Tracing.dataCollected', params => events.push(...params.value));
    const traceDone = new Promise(resolve => cdp.on('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', { categories: '-*,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });

    const steps = [];
    let pressed = 0;
    const press = async (name, repeat = false) => {
      const k = KEYS[name];
      const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, autoRepeat: repeat };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      return pressed++;
    };
    const quiet = () => sleep(450);
    const active = () => cdp.eval(`(() => { const a = document.activeElement; return a && a.dataset ? { key: a.dataset.focusKey || '', region: a.dataset.focusRegion || '', row: a.dataset.focusRow || '', col: a.dataset.focusCol || '', route: a.dataset.menuRoute || '' } : null })()`);
    const menuOpen = () => cdp.eval(`document.querySelector('.tv-app').classList.contains('menu-open')`);
    const discrete = async (id, kind, name, label) => { const key = press(name); const index = await key; steps.push({ id, label: label || id, kind, key: index }); await quiet(); };
    const held = async (prefix, kind, name, count, label) => {
      const first = pressed;
      for (let i = 0; i < count; i++) {
        const index = await press(name, i > 0);
        steps.push({ id: `${prefix} ${String(i + 1).padStart(2, '0')}`, label, group: label, kind, key: index, until: index + 1 });
        await sleep(options.cadenceMs);
      }
      delete steps[steps.length - 1].until; // the last press ends at its own idle gap
      await quiet();
      return first;
    };

    // Idle floor: one second with nothing pressed, so the table shows what the page costs at rest.
    const idleStart = await press('noop');
    await sleep(1000);
    const idleEnd = await press('noop');
    steps.push({ id: 'idle (1 s, no input)', label: 'Idle floor', group: 'idle (1 s, no input)', kind: 'idle', key: idleStart, until: idleEnd });
    await quiet();

    // Journeys 1-4: Down from the hero to the Recently added rail, hold Right along it, hold Down through the rails, hold Right along the rail reached (My List).
    for (let attempt = 0; attempt < 6 && !(await active())?.key.startsWith('title-'); attempt++) {
      const index = await press('down');
      steps.push({ id: `down to rail ${attempt + 1}`, label: 'Down toward the first rail', group: 'Down from hero to first rail', kind: 'move', key: index });
      await quiet();
    }
    log(`on rail: focus ${JSON.stringify(await active())}`);
    await held('rail-1 right', 'move', 'right', options.railPresses, 'Home: hold Right along Recently added');
    await held('rails down', 'move', 'down', options.downPresses, 'Home: hold Down through rails');
    log(`after Down: focus ${JSON.stringify(await active())}`);
    await held('rail-2 right', 'move', 'right', options.railPresses, 'Home: hold Right along the last rail');
    log(`after Right: focus ${JSON.stringify(await active())}`);

    // Journey 3: open the menu and walk every destination. Each switch is Down/Up inside the menu (D-pad moves) then OK (the route change).
    const routes = await cdp.eval(`Array.from(document.querySelectorAll('[data-menu-route]')).map(b => ({ route: b.dataset.menuRoute, label: b.textContent.trim() }))`);
    let current = 'home';
    for (const target of routes) {
      if (target.route === current && target.route === 'home') continue;
      // Left until the menu is open (a content screen may need several presses to reach column 0).
      for (let attempt = 0; attempt < 12 && !(await menuOpen()); attempt++) {
        const index = await press('left');
        steps.push({ id: `left to menu from ${current} ${attempt + 1}`, label: `Left toward the menu (${current})`, group: MENU_GROUP, kind: 'move', key: index });
        await quiet();
      }
      if (!(await menuOpen())) { log(`WARN: menu did not open on ${current}`); continue; }
      const order = routes.map(r => r.route);
      for (let guard = 0; guard < 20; guard++) {
        const at = (await active())?.route;
        if (at === target.route) break;
        const dir = order.indexOf(at) < order.indexOf(target.route) ? 'down' : 'up';
        const index = await press(dir);
        steps.push({ id: `menu ${dir} to ${target.route} (${guard + 1})`, label: `Menu ${dir}`, group: MENU_GROUP, kind: 'move', key: index });
        await quiet();
      }
      const index = await press('enter');
      steps.push({ id: `route ${target.route}`, label: `OK on ${target.label}`, kind: 'route', key: index });
      await sleep(1200);
      current = target.route;
    }

    await cdp.send('Tracing.end');
    await traceDone;
    if (args.trace) fs.writeFileSync(path.resolve(args.trace), JSON.stringify(events));
    const page = await cdp.eval(`({ keys: window.__tvperf.keys, frames: window.__tvperf.frames, errors: window.__tvperf.errors })`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    const results = analyzeSteps(events, steps).map((result, index) => {
      const step = steps[index];
      const start = page.keys[step.key];
      const end = step.until !== undefined ? page.keys[step.until] : start + result.settleMs;
      return { ...result, slowFrames: countSlowFrames(page.frames, start, end) };
    });
    const violations = evaluateBudgets(results, BUDGETS);
    const report = { generatedAt: new Date().toISOString(), chrome: options.chrome, throttle: options.throttle, api: options.server || 'synthetic fixture', cadenceMs: options.cadenceMs, budgets: BUDGETS, steps: results, totals: totals(results), violations, pageErrors: [...page.errors, ...consoleErrors] };
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
    printReport(report);
    log(`report: ${options.out}`);
    return violations.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

function totals(steps) {
  const sum = (list, field) => Math.round(list.reduce((total, step) => total + step[field], 0) * 10) / 10;
  const group = kind => { const list = steps.filter(step => step.kind === kind); return { steps: list.length, busyMs: sum(list, 'busyMs'), worstBusyMs: Math.max(0, ...list.map(step => step.busyMs)), worstSettleMs: Math.max(0, ...list.map(step => step.settleMs)), scriptMs: sum(list, 'scriptMs'), styleMs: sum(list, 'styleMs'), layoutMs: sum(list, 'layoutMs'), paintMs: sum(list, 'paintMs'), longTasks: sum(list, 'longTasks'), slowFrames: sum(list, 'slowFrames') }; };
  return { route: group('route'), move: group('move'), all: { steps: steps.length, busyMs: sum(steps, 'busyMs'), longTasks: sum(steps, 'longTasks'), slowFrames: sum(steps, 'slowFrames') } };
}

function printReport(report) {
  const bad = new Set(report.violations.map(violation => violation.id));
  const mean = (list, field) => Math.round(list.reduce((sum, step) => sum + step[field], 0) / list.length * 10) / 10;
  const total = (list, field) => list.reduce((sum, step) => sum + step[field], 0);
  const groups = [];
  for (const step of report.steps) {
    const last = groups[groups.length - 1];
    if (last && last.name === step.group && step.kind !== 'route') last.steps.push(step); else groups.push({ name: step.group, kind: step.kind, steps: [step] });
  }
  const cols = ['step', 'kind', 'n', 'busy avg', 'busy max', 'settle max', 'script', 'style', 'layout', 'paint', 'other', 'long', 'slowFr', 'over'];
  const rows = groups.map(group => {
    const list = group.steps;
    const over = list.filter(step => bad.has(step.id)).length;
    return [group.name, group.kind, list.length, mean(list, 'busyMs'), Math.max(...list.map(step => step.busyMs)), Math.max(...list.map(step => step.settleMs)), mean(list, 'scriptMs'), mean(list, 'styleMs'), mean(list, 'layoutMs'), mean(list, 'paintMs'), mean(list, 'otherMs'), total(list, 'longTasks'), total(list, 'slowFrames'), over || ''];
  });
  const widths = cols.map((col, i) => Math.max(col.length, ...rows.map(row => String(row[i]).length)));
  const line = row => row.map((cell, i) => i < 2 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i])).join('  ');
  console.log(`\nTV performance at ${report.throttle}x CPU throttle. ms of main-thread time per step: group rows average script/style/layout/paint/other over their n presses; busy max and settle max are the worst press (settle = keypress to end of work); over = steps beyond budget.`);
  console.log(line(cols));
  for (const row of rows) console.log(line(row));
  const t = report.totals;
  console.log(`\nroute changes: ${t.route.steps}, worst settle ${t.route.worstSettleMs} ms (budget ${BUDGETS.routeSettleMs}), long tasks ${t.route.longTasks}, slow frames ${t.route.slowFrames}`);
  console.log(`D-pad moves:   ${t.move.steps}, worst busy ${t.move.worstBusyMs} ms (budget < ${BUDGETS.moveBusyMs}), long tasks ${t.move.longTasks}, slow frames ${t.move.slowFrames}`);
  console.log(`all steps: busy ${t.all.busyMs} ms, long tasks ${t.all.longTasks}, slow frames ${t.all.slowFrames}`);
  if (report.pageErrors.length) console.log(`page errors: ${report.pageErrors.slice(0, 3).join(' | ')}`);
  if (report.violations.length) {
    console.log(`\nFAIL: ${report.violations.length} budget violation(s)${options.verbose ? '' : ' (route changes listed; every step and violation is in the JSON report, --verbose prints them all)'}`);
    for (const violation of report.violations.filter(violation => options.verbose || violation.id.startsWith('route '))) console.log(`  ${violation.id}: ${violation.reason}`);
  } else console.log('\nPASS: all budgets held');
  if (options.verbose) { console.log('\nevery step:'); for (const step of report.steps) console.log(`  ${bad.has(step.id) ? '!' : ' '} ${step.id.padEnd(42)} busy ${step.busyMs}  settle ${step.settleMs}  script ${step.scriptMs}  style ${step.styleMs}  layout ${step.layoutMs}  paint ${step.paintMs}  long ${step.longTasks}  slowFr ${step.slowFrames}`); }
}

async function waitFor(cdp, expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await cdp.eval(expression).catch(() => false)) return; await sleep(200); }
  throw new Error(`timed out waiting for ${what}`);
}

function log(message) { console.error(`[tv-perf] ${message}`); }

main().then(code => process.exit(code), error => { console.error(`[tv-perf] harness failure: ${error.stack || error.message}`); process.exit(2); });
