#!/usr/bin/env node
/**
 * Screen capture for the TV client and the browser app (ticket #65): one PNG per journey step,
 * named by step, from the perf harness's synthetic household (fixture.mjs). No pixel assertions:
 * the sets are for comparing a change with the mockups and with the "before" set.
 * Development only, no npm dependencies, no network.
 *
 *   node tools/tv_perf/screens.mjs tv  [--dist clients/tv/dist] [--out DIR] [--only a,b] [--chrome PATH]
 *   node tools/tv_perf/screens.mjs web [--dist internal/adapters/httpapi/static] [--out DIR] [--only a,b] [--chrome PATH]
 *
 * tv:  headless Chromium at 1920x1080 with the Tizen 5 user agent (lean graphics), real key events
 *      (Escape is Back), a stand-in AVPlay so the player opens with its controls. Build with `npm run build:tv`.
 * web: the built browser app (`npm run build:web`) served against the same fixture, at 1440x900 and 390x844.
 *
 * Output: tools/tv_perf/.out/screens/tv/NN-step.png and .../web/<viewport>/NN-step.png (git-ignored).
 * A step that cannot reach its screen fails with the step name (exit 1) and leaves FAILED-step.png beside the set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildFixture, serve } from './fixture.mjs';
import { CDP, findChrome, launchChrome, waitFor, LEAN_USER_AGENT } from './chrome.mjs';
import { TV_JOURNEY, WEB_JOURNEY, WEB_VIEWPORTS, checkJourney, shotFile, railMove, stepFailure, pickTitles, resolvePath } from './journey.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const STORAGE_KEY = 'filelist.serverUrl'; // clients/tv/src/main.tsx
const VIDEO = path.join(repo, 'tools/smoke_webos_engine/fixture-video.mp4');
const KEYS = { right: ['ArrowRight', 39], left: ['ArrowLeft', 37], up: ['ArrowUp', 38], down: ['ArrowDown', 40], enter: ['Enter', 13], back: ['Escape', 27] };
const READY_MS = 10000;
const SETTLE_MS = 900; // art and focus transitions land before the shot

const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const chrome = args.chrome || process.env.CHROME_BIN || findChrome();
const only = args.only ? new Set(String(args.only).split(',')) : null;

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
function log(message) { console.error(`[screens] ${message}`); }
const shown = file => (file.startsWith(repo + path.sep) ? path.relative(repo, file) : file);

// A stand-in for Samsung's AVPlay: the TV player draws its controls over a "playing" stream 25 minutes into 100.
const AVPLAY_STUB = `(() => {
  var listener = {}, state = 'NONE';
  var avplay = {
    open: function () { state = 'IDLE'; }, close: function () { state = 'NONE'; }, stop: function () { state = 'IDLE'; },
    setListener: function (value) { listener = value || {}; }, setDisplayRect: function () {}, setDisplayMethod: function () {},
    prepareAsync: function (done) { state = 'READY'; setTimeout(function () { done && done(); }, 50); },
    play: function () { state = 'PLAYING'; setTimeout(function () { listener.oncurrentplaytime && listener.oncurrentplaytime(1500000); }, 100); },
    pause: function () { state = 'PAUSED'; }, seekTo: function (ms, ok) { ok && setTimeout(ok, 0); }, jumpForward: function () {}, jumpBackward: function () {},
    getDuration: function () { return 6000000; }, getCurrentTime: function () { return 1500000; }, getState: function () { return state; },
    getTotalTrackInfo: function () { return [{ index: 1, type: 'AUDIO', extra_info: '{"language":"eng","channels":"6"}' }]; },
    setSelectTrack: function () {}, setSilentSubtitle: function () {}, setExternalSubtitlePath: function () {}, setSubtitlePosition: function () {},
    getCurrentStreamInfo: function () { return []; }, setStreamingProperty: function () {}, suspend: function () {}, restore: function () {}
  };
  window.webapis = window.webapis || {};
  window.webapis.avplay = avplay;
  // On a TV the AVPlay <object> is the video surface; Chromium has no such plugin and draws "Couldn't load plugin".
  document.addEventListener('DOMContentLoaded', function () { var s = document.createElement('style'); s.textContent = '#av-player { visibility: hidden; }'; document.head.appendChild(s); });
})();`;

async function main() {
  if (mode !== 'tv' && mode !== 'web') throw new Error('usage: node tools/tv_perf/screens.mjs tv|web [--out DIR] [--dist DIR] [--only step,step] [--chrome PATH]');
  const journey = checkJourney(mode === 'tv' ? TV_JOURNEY : WEB_JOURNEY);
  const unknown = only ? [...only].filter(name => !journey.some(step => step.name === name)) : [];
  if (unknown.length) throw new Error(`--only names no ${mode} step: ${unknown.join(', ')} (steps: ${journey.map(step => step.name).join(', ')})`);
  const dist = path.resolve(args.dist || path.join(repo, mode === 'tv' ? 'clients/tv/dist' : 'internal/adapters/httpapi/static'));
  const entry = mode === 'tv' ? 'app.js' : 'index.html';
  if (!fs.existsSync(path.join(dist, entry))) throw new Error(`${dist}/${entry} is missing: run \`npm run build:${mode}\` first (or use \`make screens-${mode}\`)`);
  const outRoot = path.resolve(args.out || path.join(here, '.out/screens', mode));
  const fixture = buildFixture();
  const picks = pickTitles(fixture);
  const server = await serve({ dist, fixture, spa: mode === 'web', video: VIDEO, smallBackdrops: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-screens-'));
  const first = mode === 'tv' ? { width: 1920, height: 1080 } : WEB_VIEWPORTS[0];
  const { child, wsUrl } = await launchChrome(chrome, userDir, first);
  const cdp = new CDP(wsUrl);
  const pageErrors = [];
  const written = [];
  try {
    await cdp.opened;
    await Promise.all(['Page', 'Runtime'].map(domain => cdp.send(`${domain}.enable`)));
    cdp.on('Runtime.exceptionThrown', event => pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    const runs = mode === 'tv'
      ? [{ label: 'tv 1920x1080', dir: outRoot, viewport: { width: 1920, height: 1080, mobile: false } }]
      : WEB_VIEWPORTS.map(viewport => ({ label: `web ${viewport.name} ${viewport.width}x${viewport.height}`, dir: path.join(outRoot, `${viewport.name}-${viewport.width}x${viewport.height}`), viewport }));
    if (mode === 'tv') {
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: LEAN_USER_AGENT });
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(server.url)}) } catch (e) {}\n${AVPLAY_STUB}` });
    }
    for (const run of runs) {
      const { width, height, mobile } = run.viewport;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      fs.mkdirSync(run.dir, { recursive: true });
      for (const file of fs.readdirSync(run.dir)) if (file.endsWith('.png')) fs.rmSync(path.join(run.dir, file));
      log(`${run.label}: ${journey.length} steps into ${shown(run.dir)}`);
      if (mode === 'tv') {
        await cdp.send('Page.navigate', { url: server.url + '/index.html' });
        await waitFor(cdp, `document.querySelectorAll('.poster-card').length > 3`, 30000, 'the TV Home screen to render');
        await sleep(2000); // boot-time fetches and the landing focus
        if (!(await cdp.eval(`document.documentElement.classList.contains('lean-graphics')`))) log('WARN: the TV page did not take its lean-graphics path');
      }
      const driver = makeDriver(cdp, server, fixture, picks);
      for (const [index, step] of journey.entries()) {
        if (only && !only.has(step.name)) { await driver.perform(step); continue; } // still walk it: later steps start where it ends
        const missed = server.misses().length;
        try {
          await driver.perform(step);
          await driver.ready(step);
          await sleep(SETTLE_MS);
          // A screen drawn over a 404 shows an error, not the screen: the fixture must answer everything the step asks.
          const gaps = [...new Set(server.misses().slice(missed))];
          if (gaps.length) throw stepFailure(step, `the fixture had no answer for ${gaps.join(', ')} (extend tools/tv_perf/fixture.mjs)`);
        } catch (error) {
          await shoot(cdp, path.join(run.dir, `FAILED-${step.name}.png`)).catch(() => {});
          throw error.message.startsWith('step "') ? error : stepFailure(step, error.message);
        }
        const file = path.join(run.dir, shotFile(index, step.name));
        await shoot(cdp, file);
        written.push(file);
        log(`  ${shotFile(index, step.name)}`);
      }
    }
    const misses = [...new Set(server.misses())];
    if (misses.length) log(`fixture had no answer for: ${misses.join(', ')}`);
    if (pageErrors.length) log(`page errors: ${[...new Set(pageErrors)].slice(0, 5).join(' | ')}`);
    log(`${written.length} screenshots written under ${shown(outRoot)}`);
    return 0;
  } finally {
    try { cdp.close(); } catch { }
    child.kill('SIGKILL');
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { } // Chromium may still be flushing its profile
  }
}

async function shoot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

// Visible = laid out and not hidden; the page helpers are inlined into each evaluation.
const VISIBLE = `function visible(el) { if (!el || !el.getClientRects().length) return false; var s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; }
function first(selector) { var list = document.querySelectorAll(selector); for (var i = 0; i < list.length; i++) if (visible(list[i])) return list[i]; return null; }`;
const inPage = body => `(() => { ${VISIBLE}\n${body} })()`;

function makeDriver(cdp, server, fixture, picks) {
  const press = async (name, times = 1) => {
    const key = KEYS[name];
    if (!key) throw new Error(`unknown key ${name}`);
    for (let i = 0; i < times; i++) {
      const base = { key: key[0], code: key[0], windowsVirtualKeyCode: key[1], nativeVirtualKeyCode: key[1] };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(250);
    }
  };
  const focusedMatches = selector => cdp.eval(inPage(`var a = document.activeElement; return !!(a && a.matches && a.matches(${JSON.stringify(selector)}));`));
  const menuOpen = () => cdp.eval(`!!document.querySelector('.tv-app.menu-open')`);
  const element = async (step, selector, act) => {
    const done = await cdp.eval(inPage(`var el = first(${JSON.stringify(selector)}); if (!el) return false; ${act}; return true;`));
    if (!done) throw stepFailure(step, `no visible element matches ${selector}`);
  };
  const openRail = async step => {
    for (let i = 0; i < 12 && !(await menuOpen()); i++) await press('left');
    if (!(await menuOpen())) throw stepFailure(step, 'Left never opened the rail');
  };
  const go = async (step, route) => {
    await openRail(step);
    const order = await cdp.eval(`Array.from(document.querySelectorAll('[data-menu-route]')).map(function (b) { return b.dataset.menuRoute; })`);
    for (let guard = 0; guard < 30; guard++) {
      const at = await cdp.eval(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.menuRoute : undefined`);
      const direction = railMove(order, at, route, step.name);
      if (!direction) { await press('enter'); await sleep(1200); return; }
      await press(direction);
    }
    throw stepFailure(step, `the rail cursor never reached ${route}`);
  };
  const actions = {
    go: (step, action) => go(step, action.go),
    openRail: step => openRail(step),
    press: (step, action) => press(action.press, action.times || 1),
    pressUntil: async (step, action) => {
      for (let i = 0; i < (action.max || 6); i++) { if (await focusedMatches(action.focused)) return; await press(action.pressUntil); }
      if (!(await focusedMatches(action.focused))) throw stepFailure(step, `${action.pressUntil} never put focus on ${action.focused}`);
    },
    focus: (step, action) => element(step, action.focus, 'el.focus()'),
    click: (step, action) => element(step, action.click, 'el.click()'),
    input: (step, action) => element(step, action.input, `el.value = ${JSON.stringify(action.text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))`),
    openTitle: async (step, action) => {
      const id = picks[action.openTitle];
      const card = `.poster-card[data-focus-key*=${JSON.stringify(id)}]`;
      if (!(await cdp.eval(inPage(`return !!first(${JSON.stringify(card)});`)))) await go(step, 'home');
      await element(step, card, 'el.focus()');
      await press('enter');
      await sleep(1200);
    },
    visit: async (step, action) => {
      await cdp.send('Page.navigate', { url: server.url + resolvePath(action.visit, picks) });
      await waitFor(cdp, `document.readyState === 'complete'`, 15000, `${action.visit} to load`).catch(() => { throw stepFailure(step, `${action.visit} did not load`); });
      await sleep(1500);
    },
    pointer: async () => {
      const { width, height } = await cdp.eval(`({ width: innerWidth, height: innerHeight })`);
      for (const x of [0.4, 0.5, 0.6]) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(width * x), y: Math.round(height / 2) });
      await sleep(300);
    },
    wait: (step, action) => sleep(action.wait),
  };
  return {
    async perform(step) {
      for (const action of step.actions) {
        const name = Object.keys(action).find(key => actions[key]);
        await actions[name](step, action);
      }
    },
    async ready(step) {
      const { selector, focused } = step.ready;
      const check = inPage(`if (!first(${JSON.stringify(selector)})) return false; ${focused ? `var a = document.activeElement; return !!(a && a.matches && a.matches(${JSON.stringify(focused)}));` : 'return true;'}`);
      try { await waitFor(cdp, check, READY_MS, 'ready'); }
      catch {
        const seen = await cdp.eval(inPage(`var a = document.activeElement; return { matched: !!first(${JSON.stringify(selector)}), focus: a ? (a.dataset && a.dataset.focusKey) || a.tagName.toLowerCase() + '.' + a.className : '' };`));
        throw stepFailure(step, !seen.matched ? `no visible element matches ${selector}` : `focus is on ${seen.focus}, not ${focused}`);
      }
    },
  };
}

main().then(code => process.exit(code), error => { console.error(`[screens] FAIL: ${error.message}`); if (!/^(step "|usage:|--only|.*is missing)/.test(error.message)) console.error(error.stack); process.exit(error.message.startsWith('step "') ? 1 : 2); });
