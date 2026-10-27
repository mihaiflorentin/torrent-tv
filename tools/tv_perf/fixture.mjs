// Synthetic household for the TV performance harness and the screen capture
// script: ~60 titles with posters and backdrops, facets, families, household
// state, downloads and jobs, title pages with versions (movies) and seasons of
// episodes with versions (series), Info panel data and Settings, served by a
// tiny mock of the Torrent TV API plus a built bundle (TV or browser app).
// Deterministic (seeded), contains no real library data, and needs no network.
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

// `scenarios` (the D-pad audit's household, off for the perf harness and the screen capture so their numbers and
// pictures stay put) adds what only some screens need: a server update that can be installed, a downloaded season
// pack on every series' season 1, and two versions of the first movie whose prepare is held open or refused
// (scenarioReleases), so the update, season-pack delete and preparing dialogs can be reached.
export function buildFixture({ titles: count = 60, seed = 45, scenarios = false } = {}) {
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
  return { titles, state, downloads, jobs, facets, families, libraryFamilies, scenarios };
}

/** With scenarios on: the release ids (of the first movie's first two versions) whose prepare is held open and refused. */
export function scenarioReleases(fixture) {
  const movie = fixture.titles.find(title => title.kind === 'movie');
  const [held, refused] = titleDetail(fixture, movie).sources.map(item => item.release.id);
  return { held, refused };
}
// A prepare the server is still working on (the response never comes; the app's Cancel aborts it) and a refusal.
const HELD = Symbol('held');
const REFUSED = Symbol('refused');
const refusal = (status, detail) => ({ [REFUSED]: status, detail });

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

// Title pages. Derived from the title's position, not the seeded generator, so the household above stays exactly what the perf harness measures.
const VERSION_SHAPES = [['2160p', 'WEB-DL', 'H.265', 'DDP5.1', 'HDR10'], ['1080p', 'BLU-RAY', 'H.264', 'DTS'], ['1080p', 'WEB-DL', 'H.264', 'AAC'], ['720p', 'WEBRip', 'H.264', 'AAC']];
const EPISODE_NAMES = ['Pilot', 'The Long Way Round', 'Signals', 'Low Tide', 'Paper Walls', 'The Copper Door', 'Midnight Ferry', 'Homecoming'];
function source(title, releaseId, shapeIndex, { season, episode, pack = false, sizeBytes } = {}) {
  const [resolution, quality, videoCodec, audio, hdr] = VERSION_SHAPES[shapeIndex % VERSION_SHAPES.length];
  const code = season ? `S${String(season).padStart(2, '0')}${pack ? '' : `E${String(episode).padStart(2, '0')}`}` : String(title.year);
  const name = `${title.title.replace(/[^A-Za-z0-9]+/g, '.')}.${code}.${resolution}.${quality.replace('BLU-RAY', 'BluRay')}.${videoCodec}${hdr ? '.' + hdr : ''}-FIXTURE`;
  const seeders = Math.max(1, Math.round(title.bestSeeders / (1 + shapeIndex)) + 3);
  const bytes = Math.round(sizeBytes || title.largestSizeBytes / (1 + shapeIndex * 0.6));
  return {
    release: { id: String(releaseId), trackerId: 'filelist', trackerName: 'FileList', providerId: String(releaseId), categoryId: '6', browseClass: 'video', name, category: title.categories[0], sizeBytes: bytes, seeders, leechers: shapeIndex, freeleech: shapeIndex === 1, imdbId: title.imdbId },
    parsed: { title: title.title, sortTitle: title.title.toLowerCase(), kind: title.kind, year: title.year, resolution, quality, videoCodec, audio, ...(hdr ? { hdr } : {}), releaseGroup: 'FIXTURE', ...(season ? { seasonStart: season, seasonEnd: season, ...(pack ? {} : { episodeStart: episode, episodeEnd: episode }) } : {}) },
    fileIndex: 0, filePath: `${name}.mkv`, fileSizeBytes: bytes,
  };
}
function episodesIn(title, season) { return Math.min(8, Math.max(4, Math.round(title.episodeCount / title.seasonCount) + season)); }
/** The title page of one fixture title: four versions for a movie; for a series, its seasons of episodes with two or three versions each, and a pack for season 1. */
export function titleDetail(fixture, title) {
  const n = fixture.titles.indexOf(title);
  const base = 1_000_000 + n * 1000;
  if (title.kind !== 'series') return { title, seasons: [], sources: [0, 1, 2, 3].map(k => source(title, base + k, k)) };
  // A series the household is part-way through: the earlier episodes of that season are watched (and on disk), the
  // resumed one is in progress at the saved position, the next one is downloaded and waiting.
  const resume = fixture.state.continueWatching.find(item => item.titleId === title.id && item.seasonNumber);
  const episodeState = (season, episode) => {
    if (!resume || season !== resume.seasonNumber) return undefined;
    if (episode < resume.episodeNumber) return { downloadState: 'downloaded', transferState: 'idle', watchState: 'watched', positionMs: resume.durationMs, durationMs: resume.durationMs };
    if (episode === resume.episodeNumber) return { downloadState: 'downloaded', transferState: 'idle', watchState: 'partial', positionMs: resume.positionMs, durationMs: resume.durationMs };
    if (episode === resume.episodeNumber + 1) return { downloadState: 'downloaded', transferState: 'idle', watchState: 'unwatched' };
    return undefined;
  };
  const seasons = Array.from({ length: title.seasonCount }, (_, s) => {
    const number = s + 1;
    const episodes = Array.from({ length: episodesIn(title, number) }, (_, e) => {
      const sources = Array.from({ length: 2 + ((e + n) % 2) }, (_, k) => source(title, base + number * 100 + (e + 1) * 5 + k, k + (e % 2), { season: number, episode: e + 1, sizeBytes: 1.2e9 + k * 4e8 }));
      const libraryState = episodeState(number, e + 1);
      return { number: e + 1, title: EPISODE_NAMES[e % EPISODE_NAMES.length], season: number, airDate: `${title.year + s}-0${1 + (e % 9)}-1${e % 9}`, sourceCount: sources.length, sources, ...(libraryState ? { libraryState } : {}) };
    });
    const pack = () => ({ ...source(title, base + 99, 1, { season: 1, pack: true, sizeBytes: 9.6e9 }), ...(fixture.scenarios ? { libraryState: { downloadId: `PACK${n}`, downloadState: 'downloaded', transferState: 'idle', watchState: 'unwatched' } } : {}) });
    const packSources = number === 1 ? [pack()] : [];
    return { number, title: `Season ${number}`, episodeCount: episodes.length, episodes, packSources };
  });
  return { title, seasons, sources: [] };
}
const CAST = ['Ada Lindqvist', 'Tomas Ferreira', 'Mira Okafor', 'Jonah Weller', 'Ilinca Marin', 'Ravi Castell'];
function titleInfo(title) {
  return { titleId: title.id, available: true, provider: 'tmdb', kind: title.kind, language: 'en', tagline: `Every ${title.title.split(' ').pop().toLowerCase()} has a story.`, overview: title.overview, releaseDate: title.releaseDate, status: title.kind === 'series' ? 'Returning Series' : 'Released', runtimeMinutes: title.kind === 'series' ? 48 : 112, rating: title.rating, ratingVotes: title.ratingVotes, ratingProvider: 'tmdb', genres: title.genres, cast: CAST.map((name, i) => ({ name, character: `${WORDS[i]} ${NOUNS[i]}` })), directors: ['Lena Hartmann'], ...(title.kind === 'series' ? { creators: ['Paul Ionescu'], seasons: title.seasonCount, episodes: title.episodeCount } : {}), countries: ['RO', 'GB'], originalLanguage: 'en', certification: '12' };
}
function infoEpisode(title, episode) { return { number: episode.number, name: episode.title, airDate: episode.airDate, runtimeMinutes: 44 + (episode.number % 6), rating: Math.round((6.5 + (episode.number % 4) * 0.6) * 10) / 10, voteCount: 120 + episode.number * 7, overview: `In "${episode.title}", the ${title.title} crew follows a lead that changes everything.`, directors: ['Lena Hartmann'], writers: ['Paul Ionescu'] }; }
// rest: "<id>", "<id>/info", "<id>/info/seasons", "<id>/info/seasons/<n>" or "<id>/info/seasons/<n>/episodes/<e>"
function titleRoute(fixture, rest) {
  const [id, ...parts] = rest.split('/').map(decodeURIComponent);
  const title = fixture.titles.find(item => item.id === id);
  if (!title) return null;
  if (parts.length === 0) return titleDetail(fixture, title);
  if (parts[0] !== 'info') return null;
  if (parts.length === 1) return titleInfo(title);
  if (parts[1] !== 'seasons') return null;
  const seasons = titleDetail(fixture, title).seasons;
  if (parts.length === 2) return { titleId: title.id, available: true, provider: 'tmdb', seasons: seasons.map(season => ({ number: season.number, name: season.title, airDate: season.episodes[0].airDate, episodeCount: season.episodeCount, overview: `Season ${season.number} of ${title.title}.` })) };
  const season = seasons.find(item => item.number === Number(parts[2]));
  if (!season) return null;
  if (parts.length === 3) return { titleId: title.id, available: true, provider: 'tmdb', number: season.number, name: season.title, overview: `Season ${season.number} of ${title.title}.`, airDate: season.episodes[0].airDate, cast: titleInfo(title).cast, episodes: season.episodes.map(episode => infoEpisode(title, episode)) };
  const episode = parts[3] === 'episodes' && season.episodes.find(item => item.number === Number(parts[4]));
  return episode ? infoEpisode(title, episode) : null;
}
// Preparing any version answers a finished Managed download of it, so the player opens on it.
function prepared(fixture, releaseId) {
  for (const title of fixture.titles) {
    const detail = titleDetail(fixture, title);
    const all = [...detail.sources, ...detail.seasons.flatMap(season => [...season.packSources, ...season.episodes.flatMap(episode => episode.sources)])];
    const found = all.find(item => item.release.id === releaseId);
    if (found) return { ...fixture.downloads[0], id: `P${releaseId}`, releaseId, titleId: title.id, displayTitle: title.title, releaseName: found.release.name, parsed: found.parsed, state: 'seeding', progress: 1, streamUrl: `/api/v1/streams/P${releaseId}`, browserStreamUrl: `/api/v1/streams/P${releaseId}/browser` };
  }
  return null;
}
// GET /settings and /settings/schema in the server's shape (internal/platform/config, internal/adapters/httpapi/schema.go): secrets blank with a Configured flag.
const SETTINGS = {
  instanceName: 'Living room server', listenAddress: ':8097', trustedCidrs: ['192.168.0.0/16'], databasePath: '/var/lib/torrent-tv/catalog.db', downloadRoot: '/srv/torrent-tv/downloads',
  fileListEnabled: true, fileListUrl: 'https://filelist.example.invalid', fileListUsername: 'household', fileListPasskey: '', pirateBayEnabled: false, pirateBayWebsiteUrl: 'https://tpb.example.invalid', pirateBayApiUrl: 'https://tpb-api.example.invalid',
  qbittorrentUrl: '', qbittorrentUsername: '', qbittorrentPassword: '', downloadEngine: 'native', torrentPeerPort: 42069, torrentPublicPeerPort: 0, torrentSessionDir: '/var/lib/torrent-tv/session',
  initialBufferBytes: 16777216, readAheadBytes: 67108864, pieceWaitTimeoutSeconds: 30, streamStartBytes: 4194304, catalogMaxAgeHours: 24, allocationGb: 500, reserveGb: 20, evictionRules: ['watched', 'oldest'],
  protectIncomplete: true, protectLeased: true, protectFavorites: true, protectNeverWatched: false, preferredSubtitleLanguage: 'ro', fallbackSubtitleLanguage: 'en', preferredAudioLanguage: 'en',
  tmdbApiKey: '', metadataProviders: ['tmdb'], metadataLanguage: 'en-US', metadataFallbackLanguage: 'ro-RO', artworkCachePath: '/var/cache/torrent-tv/artwork', artworkCacheMaxBytes: 1073741824,
  subDLUrl: 'https://subdl.example.invalid', subDLApiKey: '', subtitleCachePath: '/var/cache/torrent-tv/subtitles', subtitleCacheMaxBytes: 268435456, ffprobePath: '/usr/bin/ffprobe', ffmpegPath: '/usr/bin/ffmpeg',
  watchedThresholdPercent: 90, maxConcurrentJobs: 2, titleRefreshTimeoutMinutes: 10, portalAPIKey: '',
  fileListPasskeyConfigured: true, qbittorrentPasswordConfigured: false, tmdbApiKeyConfigured: true, subDLApiKeyConfigured: true, portalAPIKeyConfigured: false, settingsPath: '/etc/torrent-tv/settings.json', engineRunning: 'native',
};
const TV_VISIBLE = new Set(['fileListEnabled', 'pirateBayEnabled', 'preferredSubtitleLanguage', 'fallbackSubtitleLanguage', 'preferredAudioLanguage', 'initialBufferBytes', 'streamStartBytes', 'readAheadBytes', 'pieceWaitTimeoutSeconds', 'watchedThresholdPercent', 'maxConcurrentJobs', 'titleRefreshTimeoutMinutes']);
const SENSITIVE = new Set(['fileListUsername', 'fileListPasskey', 'tmdbApiKey', 'qbittorrentUsername', 'qbittorrentPassword', 'subDLApiKey', 'portalAPIKey']);
const RESTART = new Set(['downloadEngine', 'torrentPeerPort', 'torrentPublicPeerPort', 'torrentSessionDir', 'maxConcurrentJobs', 'titleRefreshTimeoutMinutes', 'listenAddress', 'databasePath']);
const SETTINGS_SCHEMA = Object.keys(SETTINGS).filter(key => !key.endsWith('Configured') && key !== 'settingsPath' && key !== 'engineRunning' && key !== 'catalogMaxAgeHours' && !key.startsWith('artworkCache'))
  .map(key => ({ key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), help: `Sets ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} for this server.`, tvVisible: TV_VISIBLE.has(key), sensitive: SENSITIVE.has(key), restartRequired: RESTART.has(key), readOnly: key === 'databasePath' }));

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

function api(fixture, req, url, sent) {
  const route = url.pathname.replace(/^\/api\/v1/, '');
  const q = url.searchParams;
  if (route === '/system/info') return { apiVersion: 'v1', capabilities: ['catalog', 'metadata', 'artworkProxy', 'householdState', 'titleInfo'], configured: true, instanceName: 'Perf Fixture', name: 'Torrent TV', version: '0.0.0-fixture' };
  if (route === '/catalog/titles') return queryTitles(fixture, q);
  if (route === '/catalog/search' && req.method === 'POST') {
    const found = queryTitles(fixture, new URLSearchParams({ search: String(sent.query || ''), pageSize: '24' }));
    return { ...found, job: { id: 'job-search', kind: 'catalog-search', state: 'succeeded', label: `Search trackers for ${sent.query}`, dedupeKey: 'search', progress: 1, attempt: 1, retryable: false, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z' }, trackers: [{ id: 'filelist', name: 'FileList', enabled: true, configured: true }] };
  }
  if (route.startsWith('/catalog/titles/')) return titleRoute(fixture, route.slice('/catalog/titles/'.length));
  if (route === '/catalog/facets') return fixture.facets;
  if (route === '/catalog/families') return page(fixture.families, null, fixture.families.length);
  if (route === '/library/families') {
    if (q.get('family')) return page(fixture.state.recent, null, fixture.state.recent.length);
    return page(fixture.libraryFamilies, null, fixture.libraryFamilies.length);
  }
  if (route === '/library/categories') return page(fixture.facets.categories.slice(0, 8).map((name, i) => ({ name, count: 2 + i })), null, 8);
  if (route === '/state') return fixture.state;
  if (route === '/downloads') return page(fixture.downloads, null, fixture.downloads.length);
  const jobRoute = route.match(/^\/jobs\/([^/]+)(\/logs)?$/);
  if (jobRoute) {
    const job = fixture.jobs.find(item => item.id === decodeURIComponent(jobRoute[1]));
    if (!job) return null;
    const logs = ['queued', 'searching FileList', 'matched 4 releases', 'catalog updated'].map((message, i) => ({ id: i + 1, jobId: job.id, attempt: 1, level: i === 2 ? 'debug' : 'info', phase: i ? 'run' : 'queue', message, createdAt: `2026-10-16T10:00:0${i}Z`, at: `2026-10-16T10:00:0${i}Z` }));
    return jobRoute[2] ? page(logs, null, logs.length) : { job, logs };
  }
  if (route === '/jobs') { const size = Number(q.get('pageSize')) || 24; return page(fixture.jobs.slice(0, size), null, fixture.jobs.length); }
  if (route === '/trackers') return [{ id: 'filelist', name: 'FileList', enabled: true, configured: true, capabilities: { imdbSearch: true, seasonFilter: true, episodeFilter: true, categories: true } }];
  if (route === '/portal/state') return { accountsEnabled: false, adsEnabled: false, donor: false, links: [{ id: 1, title: 'Project site', url: 'https://example.invalid/', description: 'A published project.' }] };
  if (route === '/portal/promotions') return [];
  if (route === '/updates/current') return fixture.scenarios
    ? { currentVersion: '0.0.0-fixture', latest: '0.0.1-fixture', available: true, releasesUrl: 'https://example.invalid/releases', selfUpdate: true, applying: false }
    : { currentVersion: '0.0.0-fixture', available: false, releasesUrl: 'https://example.invalid/releases', selfUpdate: false, applying: false };
  if (route === '/settings') return SETTINGS;
  if (route === '/settings/schema') return { items: SETTINGS_SCHEMA };
  if (route === '/catalog/status') return { observedReleases: 41250, discoverableReleases: 52800 };
  const prepare = route.match(/^\/releases\/([^/]+)\/prepare$/);
  if (prepare && req.method === 'POST') {
    const id = decodeURIComponent(prepare[1]);
    if (fixture.scenarios) {
      const { held, refused } = scenarioReleases(fixture);
      if (id === held) return HELD;
      if (id === refused) return refusal(409, 'the tracker refused this release (fixture)');
    }
    return prepared(fixture, id);
  }
  const playback = route.match(/^\/playback\/([^/]+)(\/preferences)?$/);
  if (playback) return playback[2] ? { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' } : { profileId: 'household', sourceId: playback[1], releaseId: '', fileIndex: 0, filePath: '', positionMs: 0, durationMs: 0, watched: false, updatedAt: '2026-10-16T20:00:00Z' };
  if (/^\/downloads\/[^/]+\/media-info$/.test(route)) return { durationMs: 6_000_000, audioTracks: [{ streamIndex: 1, language: 'en', codec: 'aac', channels: 6, default: true }] };
  if (/^\/downloads\/[^/]+\/subtitles$/.test(route)) return { items: [], nextCursor: null, total: 0, warnings: [] };
  if (route === '/metadata/ensure') return { queued: 0 };
  if (route === '/diagnostics/client') return undefined;
  return null;
}

/**
 * Serves `dist` and the fixture API on 127.0.0.1; resolves to { url, close, misses }.
 * `spa` answers index.html for any extensionless path that is not a file (the browser app routes by URL); `video` is a file served for every stream.
 * `smallBackdrops` also answers the w780 focus-follow backdrops (/backdrop-small). Off by default so the perf harness keeps
 * measuring what its earlier runs did (those requests 404 there and cost no decode); the screen capture turns it on.
 * misses() lists the API requests the fixture had no answer for, so a capture run can say what is missing.
 */
export function serve({ dist, fixture, port = 0, spa = false, video = '', smallBackdrops = false }) {
  const sockets = new Set();
  const misses = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (url.pathname === '/api/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': ready\n\n'); return; }
    const art = url.pathname.match(/^\/api\/v1\/artwork\/([^/]+)\/(poster|backdrop|backdrop-small)$/);
    if (art && (art[2] !== 'backdrop-small' || smallBackdrops)) {
      const variant = fixture.titles.findIndex(title => title.id === art[1]) % 8;
      const body = art[2] === 'poster' ? png(300, 450, variant) : art[2] === 'backdrop-small' ? png(780, 439, variant) : png(1280, 720, variant);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }).end(body);
      return;
    }
    if (video && url.pathname.startsWith('/api/v1/streams/')) { streamFile(req, res, video); return; }
    if (url.pathname.startsWith('/api/v1/')) {
      let raw = '';
      req.on('data', part => { raw += part; });
      req.on('end', () => {
        let sent = {};
        try { sent = raw ? JSON.parse(raw) : {}; } catch { }
        const body = api(fixture, req, url, sent);
        if (body === HELD) return;
        if (body && body[REFUSED]) { res.writeHead(body[REFUSED], { 'Content-Type': 'application/json' }).end(JSON.stringify({ detail: body.detail })); return; }
        if (body === null) misses.push(`${req.method} ${url.pathname}`);
        if (body === undefined) res.writeHead(204).end();
        else if (body === null) res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ detail: 'not found in fixture' }));
        else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      });
      return;
    }
    // Static bundle. index.html references the Tizen-only $WEBAPIS script; answer it with an empty script so the page boots as on a browser.
    let rel = decodeURIComponent(url.pathname);
    if (rel.includes('webapis')) { res.writeHead(200, { 'Content-Type': MIME['.js'] }).end(''); return; }
    if (rel === '/') rel = '/index.html';
    const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    let found = file.startsWith(dist) && fs.existsSync(file) && !fs.statSync(file).isDirectory() ? file : '';
    if (!found && spa && !path.extname(rel)) found = path.join(dist, 'index.html');
    if (!found) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(found)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(fs.readFileSync(found));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
    misses: () => [...misses],
  })));
}

// Byte-range answers, as a media element asks for them.
function streamFile(req, res, file) {
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const type = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (!range) { res.writeHead(200, { ...type, 'Content-Length': size }); fs.createReadStream(file).pipe(res); return; }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, { ...type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}
