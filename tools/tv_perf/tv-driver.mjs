// Driving the TV bundle in headless Chromium: the journey actions (journey.mjs), real key events,
// a stand-in AVPlay. Shared by the screen capture script (screens.mjs) and the D-pad audit (dpad.mjs).
import { setTimeout as sleep } from 'node:timers/promises';
import { waitFor, LEAN_USER_AGENT } from './chrome.mjs';
import { railMove, stepFailure, resolvePath } from './journey.mjs';

export const STORAGE_KEY = 'filelist.serverUrl'; // clients/tv/src/main.tsx
// Escape is Back: remoteAction() maps keyCode 27 to back, like the remote's Return key.
const READY_MS = 10000;
export const KEYS = { right: ['ArrowRight', 39], left: ['ArrowLeft', 37], up: ['ArrowUp', 38], down: ['ArrowDown', 40], enter: ['Enter', 13], back: ['Escape', 27] };

// A stand-in for Samsung's AVPlay: the TV player draws its controls over a "playing" stream 25 minutes into 100.
export const AVPLAY_STUB = `(() => {
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


/** Lean TV user agent, the saved server address and the AVPlay stand-in on every page load. */
export async function prepareTVPage(cdp, server) {
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: LEAN_USER_AGENT });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(server.url)}) } catch (e) {}\n${AVPLAY_STUB}` });
}

/** Loads the TV app and waits for Home with its landing focus. */
export async function openTVHome(cdp, server, { settleMs = 2000 } = {}) {
  await cdp.send('Page.navigate', { url: server.url + '/index.html' });
  await waitFor(cdp, `document.querySelectorAll('.poster-card').length > 3`, 30000, 'the TV Home screen to render');
  await sleep(settleMs); // boot-time fetches and the landing focus
}

// Visible = laid out and not hidden; the page helpers are inlined into each evaluation.
export const VISIBLE = `function visible(el) { if (!el || !el.getClientRects().length) return false; var s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; }
function first(selector) { var list = document.querySelectorAll(selector); for (var i = 0; i < list.length; i++) if (visible(list[i])) return list[i]; return null; }`;
export const inPage = body => `(() => { ${VISIBLE}\n${body} })()`;

export function makeDriver(cdp, server, fixture, picks, { gapMs = 250 } = {}) {
  const press = async (name, times = 1, gap = gapMs) => {
    const key = KEYS[name];
    if (!key) throw new Error(`unknown key ${name}`);
    for (let i = 0; i < times; i++) {
      const base = { key: key[0], code: key[0], windowsVirtualKeyCode: key[1], nativeVirtualKeyCode: key[1] };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      if (gap) await sleep(gap);
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
  // A held key: one press, then auto-repeat keydowns at the remote's cadence, then the release.
  const hold = async (name, count, cadenceMs = 100) => {
    const key = KEYS[name];
    if (!key) throw new Error(`unknown key ${name}`);
    const base = { key: key[0], code: key[0], windowsVirtualKeyCode: key[1], nativeVirtualKeyCode: key[1] };
    for (let i = 0; i < count; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', autoRepeat: i > 0, ...base });
      await sleep(cadenceMs);
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  return {
    press,
    hold,
    async perform(step) {
      for (const action of step.actions) {
        const name = Object.keys(action).find(key => actions[key]);
        if (!name) throw stepFailure(step, `unknown action ${Object.keys(action).join(', ')}`);
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

