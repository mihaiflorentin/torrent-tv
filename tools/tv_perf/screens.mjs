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
import { CDP, findChrome, launchChrome, waitFor } from './chrome.mjs';
import { TV_JOURNEY, WEB_JOURNEY, WEB_VIEWPORTS, checkJourney, shotFile, stepFailure, pickTitles } from './journey.mjs';
import { makeDriver, prepareTVPage, openTVHome } from './tv-driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const VIDEO = path.join(repo, 'tools/smoke_webos_engine/fixture-video.mp4');
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
      await prepareTVPage(cdp, server);
    }
    for (const run of runs) {
      const { width, height, mobile } = run.viewport;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      fs.mkdirSync(run.dir, { recursive: true });
      for (const file of fs.readdirSync(run.dir)) if (file.endsWith('.png')) fs.rmSync(path.join(run.dir, file));
      log(`${run.label}: ${journey.length} steps into ${shown(run.dir)}`);
      if (mode === 'tv') {
        await openTVHome(cdp, server);
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

main().then(code => process.exit(code), error => { console.error(`[screens] FAIL: ${error.message}`); if (!/^(step "|usage:|--only|.*is missing)/.test(error.message)) console.error(error.stack); process.exit(error.message.startsWith('step "') ? 1 : 2); });
