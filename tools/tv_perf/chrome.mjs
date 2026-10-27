// Headless Chromium over the DevTools protocol, shared by the perf harness (run.mjs) and the
// screen capture script (screens.mjs). No npm dependencies: Node >= 22 native fetch + WebSocket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** The Chromium Playwright caches (Linux or macOS layout), else a system Chrome; '' when none is found. */
export function findChrome() {
  const caches = [path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), 'Library/Caches/ms-playwright')];
  const builds = ['chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell'];
  const candidates = [];
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const dir of fs.readdirSync(cache).sort().reverse()) for (const build of builds) candidates.push(path.join(cache, dir, build));
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

export class CDP {
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

/** Starts headless Chromium with a throwaway profile; resolves to { child, wsUrl } for its first page. */
export async function launchChrome(chrome, userDir, { width = 1920, height = 1080 } = {}) {
  if (!chrome) throw new Error('no Chromium found: pass --chrome PATH or set CHROME_BIN');
  const child = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1', `--window-size=${width},${height}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
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

/** Polls a page expression until it is truthy; throws `timed out waiting for <what>`. */
export async function waitFor(cdp, expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await cdp.eval(expression).catch(() => false)) return; await sleep(200); }
  throw new Error(`timed out waiting for ${what}`);
}

/** The user agent of a 2019 Tizen 5 TV (Chromium 69): the TV app takes its lean-graphics path (clients/tv/src/capability.ts). */
export const LEAN_USER_AGENT = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.106 TV Safari/537.36';
