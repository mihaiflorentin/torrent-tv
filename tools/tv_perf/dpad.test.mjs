// The D-pad audit fails, naming the stop and the key, when a map and the app disagree:
// `node --test tools/tv_perf`. Needs the built TV bundle and a Chromium; skipped without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from './chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const built = fs.existsSync(path.join(repo, 'clients/tv/dist/app.js'));
const chrome = process.env.CHROME_BIN || findChrome();
const skip = !built ? 'needs clients/tv/dist (npm run build:tv)' : !chrome ? 'needs a Chromium (CHROME_BIN)' : false;

function audit(mutation, only) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpad-broken-'));
  const file = path.join(dir, 'maps.mjs');
  const maps = pathToFileURL(path.join(repo, 'clients/tv/src/dpad/maps/index.mjs')).href;
  fs.writeFileSync(file, `import { MAPS as REAL } from ${JSON.stringify(maps)};\nexport const MAPS = structuredClone(REAL);\n${mutation}\n`);
  const run = spawnSync(process.execPath, [path.join(here, 'dpad.mjs'), '--maps', file, '--only', only, '--out', path.join(dir, 'out')], { encoding: 'utf8', env: { ...process.env, CHROME_BIN: chrome }, timeout: 240000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

test('a map that says Right on Refresh reaches the first link fails, naming that stop and key', { skip, timeout: 300000 }, () => {
  const run = audit(`MAPS.find(map => map.name === 'projects').stops['header-retry'].right = 'links[first]';`, 'projects');
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /projects\s+header-retry\s+right\s+projects:links\[0\]\s+projects:header-retry\s+went elsewhere/);
});

test('a stop the map does not know fails as unmapped', { skip, timeout: 300000 }, () => {
  const run = audit(`MAPS.find(map => map.name === 'projects').groups.links.keys = '^nothing-';`, 'projects');
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /project-1\s+-\s+\(a stop of this map\).*stop not in the map/);
});
