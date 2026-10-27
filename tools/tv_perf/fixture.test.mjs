// The synthetic household answers what the screen capture journey needs: `node --test tools/tv_perf`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFixture, scenarioReleases, serve } from './fixture.mjs';

async function withServer(run, { spa = false, scenarios = false } = {}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-test-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  const fixture = buildFixture({ scenarios });
  const server = await serve({ dist, fixture, spa });
  try { await run(server, fixture); } finally { server.close(); fs.rmSync(dist, { recursive: true, force: true }); }
}
const json = async (server, route, init) => { const r = await fetch(server.url + '/api/v1' + route, init); assert.equal(r.status, 200, `${route} answered ${r.status}`); return r.json(); };

test('a movie title page has several versions to choose from', () => withServer(async (server, fixture) => {
  const movie = fixture.titles.find(title => title.kind === 'movie');
  const detail = await json(server, `/catalog/titles/${movie.id}`);
  assert.equal(detail.title.id, movie.id);
  assert.deepEqual(detail.seasons, []);
  assert.ok(detail.sources.length >= 3, 'at least three versions');
  const ids = detail.sources.map(source => source.release.id);
  assert.equal(new Set(ids).size, ids.length, 'every version is a distinct release');
  assert.ok(new Set(detail.sources.map(source => source.parsed.resolution)).size > 1, 'versions differ in resolution');
}));

test('a series title page has seasons whose episodes each carry versions, and a season pack', () => withServer(async (server, fixture) => {
  const series = fixture.titles.find(title => title.kind === 'series' && title.seasonCount > 1);
  const detail = await json(server, `/catalog/titles/${series.id}`);
  assert.equal(detail.seasons.length, series.seasonCount);
  const first = detail.seasons[0];
  assert.equal(first.number, 1);
  assert.ok(first.episodes.length >= 4);
  assert.equal(first.episodeCount, first.episodes.length);
  for (const episode of first.episodes) {
    assert.equal(episode.season, 1);
    assert.ok(episode.sources.length >= 2, `E${episode.number} has versions`);
    assert.equal(episode.sourceCount, episode.sources.length);
    assert.equal(episode.sources[0].parsed.episodeStart, episode.number);
  }
  assert.ok(first.packSources.length >= 1, 'season 1 offers a complete-season pack');
}));

test('a series being watched has its episodes\' library states: earlier ones watched, the resumed one in progress, the next downloaded', () => withServer(async (server, fixture) => {
  const watching = fixture.state.continueWatching.filter(item => item.catalog.kind === 'series' && item.episodeNumber > 1);
  let checked = 0;
  for (const resume of watching) {
    const detail = await json(server, `/catalog/titles/${resume.titleId}`);
    const episodes = detail.seasons[0].episodes;
    // The household's saved episode can lie past a short fixture season; such a title is not a worked example.
    if (episodes.length < resume.episodeNumber) continue;
    checked += 1;
    const at = number => episodes.find(episode => episode.number === number)?.libraryState;
    assert.equal(at(1).watchState, 'watched');
    assert.equal(at(resume.episodeNumber).watchState, 'partial');
    assert.equal(at(resume.episodeNumber).positionMs, resume.positionMs);
    assert.equal(at(resume.episodeNumber).durationMs, resume.durationMs);
    if (episodes.length > resume.episodeNumber) {
      assert.equal(at(resume.episodeNumber + 1).downloadState, 'downloaded');
      assert.equal(at(resume.episodeNumber + 1).watchState, 'unwatched');
    }
  }
  assert.ok(checked > 0, 'the household is part-way through a series');
  // A series nobody is watching keeps no state on its episodes.
  const idle = fixture.titles.find(title => title.kind === 'series' && !fixture.state.continueWatching.some(item => item.titleId === title.id));
  const quiet = await json(server, `/catalog/titles/${idle.id}`);
  assert.equal(quiet.seasons[0].episodes[0].libraryState, undefined);
}));

test('the Info panel data is available for a title, its seasons and an episode', () => withServer(async (server, fixture) => {
  const series = fixture.titles.find(title => title.kind === 'series');
  const info = await json(server, `/catalog/titles/${series.id}/info`);
  assert.equal(info.titleId, series.id);
  assert.equal(info.available, true);
  assert.ok(info.cast.length > 0);
  const seasons = await json(server, `/catalog/titles/${series.id}/info/seasons`);
  assert.equal(seasons.seasons.length, series.seasonCount);
  const season = await json(server, `/catalog/titles/${series.id}/info/seasons/1`);
  assert.equal(season.number, 1);
  assert.ok(season.episodes.length >= 4);
  const episode = await json(server, `/catalog/titles/${series.id}/info/seasons/1/episodes/2`);
  assert.equal(episode.number, 2);
}));

test('Settings loads its values and schema, and a version can be prepared for the player', () => withServer(async (server, fixture) => {
  const settings = await json(server, '/settings');
  assert.equal(typeof settings, 'object');
  const schema = await json(server, '/settings/schema');
  assert.ok(schema.items.length > 0);
  const movie = fixture.titles.find(title => title.kind === 'movie');
  const detail = await json(server, `/catalog/titles/${movie.id}`);
  const download = await json(server, `/releases/${detail.sources[0].release.id}/prepare`, { method: 'POST', body: '{"fileIndex":0}' });
  assert.ok(download.streamUrl.startsWith('/api/v1/streams/'));
  assert.equal(download.titleId, movie.id);
}));

test('a job opens with its log', () => withServer(async (server, fixture) => {
  const job = fixture.jobs[1];
  const detail = await json(server, `/jobs/${job.id}`);
  assert.equal(detail.job.id, job.id);
  assert.ok(detail.logs.length > 0);
  const logs = await json(server, `/jobs/${job.id}/logs?pageSize=100`);
  assert.equal(logs.items.length, detail.logs.length);
}));

test('a tracker search answers the titles whose name matches', () => withServer(async server => {
  const result = await json(server, '/catalog/search', { method: 'POST', body: JSON.stringify({ query: 'harbor' }) });
  assert.ok(result.items.length > 0);
  for (const title of result.items) assert.match(title.title, /harbor/i);
  assert.equal(result.job.state, 'succeeded');
}));

test('unknown API routes are recorded so a capture run can report what the fixture lacks', () => withServer(async server => {
  const r = await fetch(server.url + '/api/v1/no/such/route');
  assert.equal(r.status, 404);
  assert.deepEqual(server.misses(), ['GET /api/v1/no/such/route']);
}));

test('with spa set, an app path that is not a file serves index.html (the browser app routes by URL)', () => withServer(async server => {
  const r = await fetch(server.url + '/library/downloads');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>app<\/title>/);
}, { spa: true }));

test('the household the perf harness measures is unchanged by the richer detail data', () => {
  const fixture = buildFixture();
  assert.equal(fixture.titles.length, 60);
  assert.equal(fixture.titles[0].id, 'T000x5flv');
  assert.equal(fixture.titles[59].id, 'T059xjqpc');
  assert.equal(fixture.state.continueWatching.length, 8);
  assert.equal(fixture.downloads.length, 24);
});

// The D-pad audit's scenarios (dpad.mjs): opt-in, so the perf harness and the screen capture see the plain household.
const prepare = (server, id) => fetch(`${server.url}/api/v1/releases/${id}/prepare`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(400) }).then(r => r.status, error => error.name);

test('without scenarios: no update to install, the season pack is not downloaded, every prepare answers', () => withServer(async (server, fixture) => {
  const update = await json(server, '/updates/current');
  assert.equal(update.available, false);
  const series = fixture.titles.find(title => title.kind === 'series' && title.seasonCount > 1);
  const detail = await json(server, `/catalog/titles/${series.id}`);
  assert.equal(detail.seasons[0].packSources[0].libraryState, undefined);
  const { held, refused } = scenarioReleases(fixture);
  assert.equal(await prepare(server, held), 200);
  assert.equal(await prepare(server, refused), 200);
}));

test('with scenarios: an installable update, a downloaded season pack, one prepare held open and one refused', () => withServer(async (server, fixture) => {
  const update = await json(server, '/updates/current');
  assert.equal(update.available, true);
  assert.equal(update.selfUpdate, true);
  assert.ok(update.latest);
  const series = fixture.titles.find(title => title.kind === 'series' && title.seasonCount > 1);
  const pack = (await json(server, `/catalog/titles/${series.id}`)).seasons[0].packSources[0];
  assert.equal(pack.libraryState.downloadState, 'downloaded');
  assert.ok(pack.libraryState.downloadId);
  // The preparing-dialog maps (clients/tv/src/dpad/maps/title.mjs) focus these versions by key.
  assert.deepEqual(scenarioReleases(fixture), { held: '1000000', refused: '1000001' });
  assert.equal(await prepare(server, '1000000'), 'TimeoutError');
  assert.equal(await prepare(server, '1000001'), 409);
  assert.equal(await prepare(server, (await json(server, `/catalog/titles/${fixture.titles[0].id}`)).sources[2].release.id), 200);
}, { scenarios: true }));
