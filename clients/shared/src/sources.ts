import { formatBytes, type CatalogDetail, type CatalogSource } from './index';

// Best version ranking (pure). The primary Play on a title page prepares the
// first entry of rankSources(); the full list stays one press away. Policy,
// in priority order (documented in DESIGN.md "Best version"):
//  1. Junk captures (CAM, TS, HDCAM, screeners) go last; they lead only when
//     nothing else exists.
//  2. A downloaded version beats a managed one (queued, downloading, partial),
//     which beats anything that needs a new Prepare.
//  3. A healthy swarm (SEEDERS_HEALTHY or more) beats a thin one. When no
//     candidate is healthy, seeders alone decide, so a dead torrent never leads
//     unless it is the only one.
//  4. Resolution tier: 1080p, then 4K with HDR or a big swarm, 720p, plain 4K,
//     480p and below, unknown. A small box progressing a 60 GB remux is a
//     worse default than 1080p.
//  5. Quality: BluRay/REMUX/WEB-DL, WEBRip, HDTV, unknown.
//  6. More seeders, then the smaller file.
// Ties keep the input order.
export const SEEDERS_HEALTHY = 3;
export const SEEDERS_BIG_SWARM = 20;
const JUNK = /(^|[^a-z0-9])(cam|camrip|hdcam|hd-cam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr|hdscr)([^a-z0-9]|$)/i;

export interface RankOptions { season?: number; episode?: number }

function isJunk(source: CatalogSource): boolean {
 return JUNK.test(source.parsed?.quality || '') || JUNK.test(source.release?.name || '');
}
function managedTier(source: CatalogSource): number {
 const state = source.libraryState?.downloadState;
 if (state === 'downloaded') return 0;
 if (state === 'queued' || state === 'downloading' || state === 'partial') return 1;
 return 2;
}
function seeders(source: CatalogSource): number {
 const value = source.release?.seeders;
 return typeof value === 'number' && value > 0 ? value : 0;
}
function resolutionTier(source: CatalogSource): number {
 const value = (source.parsed?.resolution || '').toLowerCase();
 if (/1080/.test(value)) return 0;
 if (/2160|4k|uhd/.test(value)) return source.parsed?.hdr || seeders(source) >= SEEDERS_BIG_SWARM ? 1 : 3;
 if (/720/.test(value)) return 2;
 if (/\d/.test(value) || value === 'sd') return 4;
 return 5;
}
function qualityTier(source: CatalogSource): number {
 const value = (source.parsed?.quality || '').toLowerCase();
 if (/remux|blu-?ray|bdrip|web-?dl/.test(value)) return 0;
 if (/web/.test(value)) return 1;
 if (/hdtv|pdtv|dvdrip/.test(value)) return 2;
 return 3;
}
function sizeBytes(source: CatalogSource): number {
 const value = source.fileSizeBytes || source.release?.sizeBytes || 0;
 return value > 0 ? value : Number.MAX_VALUE;
}
function matchesEpisode(source: CatalogSource, options: RankOptions): boolean {
 const parsed = source.parsed;
 if (!parsed) return false;
 if (options.season !== undefined && parsed.seasonStart !== undefined && parsed.seasonStart !== options.season) return false;
 if (options.episode !== undefined) {
  if (parsed.episodeStart === undefined) return false;
  const end = parsed.episodeEnd === undefined ? parsed.episodeStart : parsed.episodeEnd;
  if (options.episode < parsed.episodeStart || options.episode > end) return false;
 }
 return true;
}

export function rankSources(sources: CatalogSource[], options: RankOptions = {}): CatalogSource[] {
 const hasTarget = options.season !== undefined || options.episode !== undefined;
 const exact = new Set<CatalogSource>();
 if (hasTarget) for (const item of sources) if (matchesEpisode(item, options)) exact.add(item);
 const healthyExists = sources.some(item => !isJunk(item) && managedTier(item) === 2 && seeders(item) >= SEEDERS_HEALTHY);
 const keyed = sources.map((item, index) => ({ item, index, keys: [
  exact.size > 0 && !exact.has(item) ? 1 : 0,
  isJunk(item) ? 1 : 0,
  managedTier(item),
  healthyExists ? (seeders(item) >= SEEDERS_HEALTHY ? 0 : 1) : -seeders(item),
  resolutionTier(item),
  qualityTier(item),
  -seeders(item),
  sizeBytes(item)
 ] }));
 keyed.sort((a, b) => {
  for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] < b.keys[i] ? -1 : 1;
  return a.index - b.index;
 });
 return keyed.map(entry => entry.item);
}

// The source the primary Play prepares. Movies rank the title's versions. For
// series the target is the given episode, else the first episode, of the given
// season (else the first season); a season with no episodes yields undefined.
export function bestSourceForDetail(detail: CatalogDetail, target: { season?: number; episode?: number }): CatalogSource | undefined {
 if (detail.title.kind !== 'series' || detail.seasons.length === 0) return rankSources(detail.sources)[0];
 const season = target.season ? detail.seasons.find(item => item.number === target.season) : detail.seasons[0];
 if (!season) return undefined;
 const episode = target.episode ? season.episodes.find(item => item.number === target.episode) : season.episodes[0];
 return episode ? rankSources(episode.sources, { season: season.number, episode: episode.number })[0] : undefined;
}

// Primary Play button text: the action (Play when the version is already
// managed, Play and download when it still needs a Prepare), then the chosen
// version so the viewer sees what one press will do. Unknown facts are omitted.
export function playActionLabel(source: CatalogSource): string {
 const state = source.libraryState?.downloadState;
 const action = state && state !== 'none' ? 'Play' : 'Play and download';
 const version = [source.parsed?.resolution, source.parsed?.quality].filter(Boolean).join(' ');
 const bytes = source.fileSizeBytes || source.release?.sizeBytes || 0;
 return [action, version, bytes > 0 ? formatBytes(bytes) : ''].filter(Boolean).join(' · ');
}
