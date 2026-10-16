// Synthetic household for the TV performance harness: ~60 titles with posters
// and backdrops, facets, families, household state, downloads and jobs, served
// by a tiny mock of the Torrent TV API plus the built TV bundle. Deterministic
// (seeded), contains no real library data, and needs no network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

const CATEGORIES = ['Movies HD', 'Movies 4K', 'Movies Blu-Ray', 'Movies DVD-RO', 'Animation', 'Documentaries', 'HD TV-Shows', 'TV-Series HD', 'Anime', 'Sports', 'Kids'];
const GENRES = ['Drama', 'Comedy', 'Thriller', 'Sci-Fi', 'Horror', 'Action', 'Adventure', 'Mystery', 'Animation', 'Family'];
const WORDS = ['Lantern', 'Harbor', 'Velvet', 'Orbit', 'Cinder', 'Meridian', 'Atlas', 'Ember', 'Hollow', 'Signal', 'Tidewater', 'Paper', 'Crimson', 'Northern', 'Quiet', 'Glass', 'Borrowed', 'Silent', 'Midnight', 'Copper'];
const NOUNS = ['Kingdom', 'Garden', 'Archive', 'Frontier', 'Letters', 'Station', 'Orchard', 'Witness', 'Voyage', 'Crossing', 'Engine', 'Season', 'Promise', 'Echo', 'Winter', 'Machine'];
const FAMILIES = [['movies', 'Movies'], ['series', 'Series'], ['animation', 'Animation'], ['documentaries', 'Documentaries'], ['anime', 'Anime'], ['sports', 'Sports'], ['kids', 'Kids'], ['music', 'Music'], ['other', 'Other']];

export function buildFixture({ titles: count = 60, seed = 45 } = {}) {
  const rand = rng(seed);
  const pick = list => list[Math.floor(rand() * list.length)];
  const titles = [];
  for (let index = 0; index < count; index++) {
    const kind = index % 5 < 3 ? 'movie' : 'series';
    const id = `T${String(index).padStart(3, '0')}x${Math.floor(rand() * 1e6).toString(36)}`;
    const year = 1998 + Math.floor(rand() * 28);
    const rating = Math.round((4 + rand() * 5.5) * 10) / 10;
    const seeders = Math.floor(rand() * rand() * 2000);
    const category = kind === 'movie' ? pick(CATEGORIES.slice(0, 6)) : pick(CATEGORIES.slice(6, 9));
    titles.push({
      id, title: `${pick(WORDS)} ${pick(NOUNS)}${index % 7 === 0 ? `: The ${pick(WORDS)} ${pick(NOUNS)}` : ''}`, kind, year,
      releaseDate: `${year}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`, imdbId: `tt${1000000 + index * 977}`,
      overview: `A ${pick(GENRES).toLowerCase()} story about ${pick(WORDS).toLowerCase()} people and a ${pick(NOUNS).toLowerCase()} that changes everything. `.repeat(2 + (index % 3)).trim(),
      posterUrl: `/api/v1/artwork/${id}/poster`, backdropUrl: `/api/v1/artwork/${id}/backdrop`,
      trackers: [{ id: 'filelist', name: 'FileList' }], categories: [category], resolutions: ['1080p', ...(index % 4 === 0 ? ['2160p'] : [])],
      sourceCount: 1 + Math.floor(rand() * 12), bestSeeders: seeders, largestSizeBytes: Math.floor((2 + rand() * 30) * 1e9),
      newestUpload: new Date(Date.UTC(2026, 9, 17) - index * 3_600_000 * 7).toISOString(), rating, ratingVotes: 20 + Math.floor(rand() * 9000), ratingProvider: 'tmdb',
      genres: [pick(GENRES), pick(GENRES)].filter((genre, i, all) => all.indexOf(genre) === i),
      ...(kind === 'series' ? { seasonCount: 1 + (index % 5), episodeCount: 8 + (index % 14) } : {}),
      libraryState: { downloadState: 'none', transferState: 'idle', watchState: 'unwatched' },
    });
  }
  const release = (title, index) => ({ id: String(900000 + index), trackerId: 'filelist', trackerName: 'FileList', providerId: String(900000 + index), categoryId: '6', browseClass: 'video', name: `${title.title.replace(/[^A-Za-z0-9]+/g, '.')}.${title.year}.1080p.WEB-DL.H.264`, category: title.categories[0], sizeBytes: title.largestSizeBytes, seeders: title.bestSeeders, leechers: 1, freeleech: index % 3 === 0, imdbId: title.imdbId });
  const playback = (title, index, positionMs, watched) => ({ release: release(title, index), catalog: title, profileId: 'household', sourceId: `S${index}`, releaseId: String(900000 + index), fileIndex: 0, filePath: `${title.title}.mkv`, positionMs, durationMs: 6_000_000, watched, updatedAt: '2026-10-16T20:00:00Z', favorite: false, titleId: title.id, ...(title.kind === 'series' ? { seasonNumber: 1, episodeNumber: 1 + (index % 8) } : {}) });
  const slice = (from, to, mapper) => titles.slice(from, to).map(mapper);
  const state = {
    continueWatching: slice(0, 8, (title, i) => playback(title, i, 1_200_000 + i * 300_000, false)),
    favorites: slice(8, 20, (title, i) => ({ ...playback(title, 8 + i, 0, false), favorite: true })),
    recent: slice(20, 32, (title, i) => playback(title, 20 + i, 600_000, false)),
    watched: slice(32, 44, (title, i) => playback(title, 32 + i, 6_000_000, true)),
  };
  const downloads = slice(0, 24, (title, i) => ({
    id: `D${i}`, releaseId: String(900000 + i), trackerId: 'filelist', trackerName: 'FileList', titleId: title.id, displayTitle: title.kind === 'series' ? `${title.title} · S01E0${1 + (i % 8)} · Pilot` : title.title,
    releaseName: release(title, i).name, category: title.categories[0], releaseSizeBytes: title.largestSizeBytes, trackerSeeders: title.bestSeeders,
    parsed: { title: title.title, sortTitle: title.title.toLowerCase(), kind: title.kind, resolution: '1080p', quality: 'WEB-DL', videoCodec: 'H.264' },
    engineId: `native:${i}`, fileIndex: 0, filePath: `${title.title}.mkv`, mimeType: 'video/x-matroska', sizeBytes: title.largestSizeBytes,
    state: i % 6 === 0 ? 'downloading' : 'seeding', progress: i % 6 === 0 ? 0.4 : 1, playbackMode: 'local', downloadedBytes: title.largestSizeBytes, speedBytesPerSecond: 0, etaSeconds: 0, peers: 3, seeds: 5, leased: false,
    createdAt: '2026-10-16T22:34:46Z', updatedAt: '2026-10-16T22:35:23Z', streamUrl: `/api/v1/streams/D${i}`, browserStreamUrl: `/api/v1/streams/D${i}/browser`,
  }));
  const jobs = Array.from({ length: 30 }, (_, i) => ({ id: `job-${i}`, trackerId: 'filelist', kind: 'catalog-title-refresh', state: i % 5 === 0 ? 'running' : 'succeeded', label: `Refresh FileList for ${titles[i % titles.length].title}`, dedupeKey: `refresh:${i}`, progress: i % 5 === 0 ? 0.5 : 1, attempt: 1, retryable: false, createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' }));
  const facets = { categories: [...CATEGORIES, ...Array.from({ length: 25 }, (_, i) => `Category ${i + 1}`)], kinds: ['movie', 'series'], resolutions: ['480p', '720p', '1080i', '1080p', '2160p'], hdr: ['DOVI', 'HDR10', 'HDR10+', 'SDR'], qualities: ['BLU-RAY', 'WEB-DL', 'WEBRip', 'HDTV', 'DVDRip', 'REMUX', 'CAM'], codecs: ['AV1', 'H.264', 'H.265', 'VC-1', 'XviD', 'MPEG-2', 'VP9', 'ProRes', 'DivX'] };
  const familyArt = index => ({ url: `/api/v1/artwork/${titles[index].id}/backdrop`, source: 'catalog', titleId: titles[index].id });
  const families = FAMILIES.map(([key, name], i) => ({ key, name, count: 50 + i * 313, newestTitle: titles[i].title, newestTitleId: titles[i].id, categories: CATEGORIES.slice(0, 2 + (i % 4)), art: familyArt(i) }));
  const libraryFamilies = families.slice(0, 4).map((family, i) => ({ ...family, count: 3 + i * 4 }));
  return { titles, state, downloads, jobs, facets, families, libraryFamilies };
}

// Posters and backdrops are generated PNGs (gradient with a diagonal pattern) so the page decodes real raster images of TV-realistic sizes.
const artCache = new Map();
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
export function png(width, height, variant) {
  const key = `${width}x${height}:${variant}`;
  if (artCache.has(key)) return artCache.get(key);
  const hue = variant * 47;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const o = base + 1 + x * 3;
      const t = (x / width + y / height) / 2;
      const stripe = ((x + y + variant * 7) % 64) < 3 ? 22 : 0;
      rows[o] = Math.min(255, 20 + ((hue + t * 140) % 200) + stripe);
      rows[o + 1] = Math.min(255, 24 + ((hue * 2 + t * 90) % 150) + stripe);
      rows[o + 2] = Math.min(255, 40 + (255 - t * 170) / 1.6 + stripe);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const data = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
  artCache.set(key, data);
  return data;
}

function page(items, cursor, total) { return { items, nextCursor: cursor, total }; }

function queryTitles(fixture, query) {
  let list = fixture.titles;
  const kind = query.get('kind'); if (kind) list = list.filter(title => title.kind === kind);
  const category = query.get('category'); if (category) list = list.filter(title => title.categories.includes(category));
  const search = (query.get('search') || '').toLowerCase(); if (search) list = list.filter(title => title.title.toLowerCase().includes(search));
  const sort = query.get('sort');
  if (sort === 'seeders') list = [...list].sort((a, b) => b.bestSeeders - a.bestSeeders);
  else if (sort === 'rating') list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  const size = Number(query.get('pageSize')) || 12;
  const offset = Number(query.get('cursor')) || 0;
  const items = list.slice(offset, offset + size);
  const next = offset + size < list.length ? String(offset + size) : null;
  return page(items, next, list.length);
}

function api(fixture, req, url) {
  const route = url.pathname.replace(/^\/api\/v1/, '');
  const q = url.searchParams;
  if (route === '/system/info') return { apiVersion: 'v1', capabilities: ['catalog', 'metadata', 'artworkProxy', 'householdState', 'titleInfo'], configured: true, instanceName: 'Perf Fixture', name: 'Torrent TV', version: '0.0.0-fixture' };
  if (route === '/catalog/titles') return queryTitles(fixture, q);
  if (route.startsWith('/catalog/titles/')) { const title = fixture.titles.find(item => route.includes(item.id)); return title ? { title, seasons: [], sources: [] } : null; }
  if (route === '/catalog/facets') return fixture.facets;
  if (route === '/catalog/families') return page(fixture.families, null, fixture.families.length);
  if (route === '/library/families') {
    if (q.get('family')) return page(fixture.state.recent, null, fixture.state.recent.length);
    return page(fixture.libraryFamilies, null, fixture.libraryFamilies.length);
  }
  if (route === '/library/categories') return page(fixture.facets.categories.slice(0, 8).map((name, i) => ({ name, count: 2 + i })), null, 8);
  if (route === '/state') return fixture.state;
  if (route === '/downloads') return page(fixture.downloads, null, fixture.downloads.length);
  if (route === '/jobs') { const size = Number(q.get('pageSize')) || 24; return page(fixture.jobs.slice(0, size), null, fixture.jobs.length); }
  if (route === '/trackers') return [{ id: 'filelist', name: 'FileList', enabled: true, configured: true, capabilities: { imdbSearch: true, seasonFilter: true, episodeFilter: true, categories: true } }];
  if (route === '/portal/state') return { accountsEnabled: false, adsEnabled: false, donor: false, links: [{ id: 1, title: 'Project site', url: 'https://example.invalid/', description: 'A published project.' }] };
  if (route === '/portal/promotions') return [];
  if (route === '/updates/current') return { currentVersion: '0.0.0-fixture', available: false, releasesUrl: 'https://example.invalid/releases', selfUpdate: false, applying: false };
  if (route === '/settings') return {};
  if (route === '/metadata/ensure') return { queued: 0 };
  if (route === '/diagnostics/client') return undefined;
  return null;
}

/** Serves `dist` and the fixture API on 127.0.0.1; resolves to { url, close }. */
export function serve({ dist, fixture, port = 0 }) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (url.pathname === '/api/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': ready\n\n'); return; }
    const art = url.pathname.match(/^\/api\/v1\/artwork\/([^/]+)\/(poster|backdrop)$/);
    if (art) {
      const variant = fixture.titles.findIndex(title => title.id === art[1]) % 8;
      const body = art[2] === 'poster' ? png(300, 450, variant) : png(1280, 720, variant);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }).end(body);
      return;
    }
    if (url.pathname.startsWith('/api/v1/')) {
      const body = api(fixture, req, url);
      if (body === undefined) res.writeHead(204).end();
      else if (body === null) res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ detail: 'not found in fixture' }));
      else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    // Static bundle. index.html references the Tizen-only $WEBAPIS script; answer it with an empty script so the page boots as on a browser.
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes('webapis')) { res.writeHead(200, { 'Content-Type': MIME['.js'] }).end(''); return; }
    if (rel === '/') rel = '/index.html';
    const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(fs.readFileSync(file));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  })));
}
