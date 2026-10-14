import { canonicalLanguage, formatBytes, languageDisplayName, type CatalogTitle, type Download, type HouseholdItem, type Job, type MediaKind, type ParsedRelease, type PlaybackPreferences } from '@torrent-tv/shared';
import { formatTime } from './player';

// Display decisions for the TV screens (DESIGN.md "Information priorities"), kept as pure text
// so the markup only places it. An unknown fact is omitted, never printed as a placeholder.

const pad = (value: number) => String(value).padStart(2, '0');
const joined = (parts: Array<string | number | false | null | undefined>) => parts.filter(part => part !== '' && part !== false && part !== null && part !== undefined).join(' · ');

export function episodeCode(season?: number, episode?: number): string {
  return season && episode ? `S${pad(season)}E${pad(episode)}` : '';
}

export function titleKind(title: Pick<CatalogTitle, 'kind' | 'seasonCount'>): string {
  if (title.kind !== 'series') return 'Movie';
  const seasons = title.seasonCount || 0;
  return seasons > 0 ? `${seasons} season${seasons === 1 ? '' : 's'}` : 'Series';
}

/** Home hero eyebrow: kind, then year when known. */
export function heroFacts(title: CatalogTitle): string[] {
  return [titleKind(title), title.year ? String(title.year) : ''].filter(Boolean);
}

/**
 * Poster card second line: year, best resolution, a rating that has votes. Tracker names, source
 * counts and seeders stay off the card, except on a row defined by seeders ("Strong swarms").
 */
export function cardMeta(title: CatalogTitle, options: { seeders?: boolean } = {}): string {
  const rating = title.ratingVotes && title.rating ? `★ ${title.rating.toFixed(1)}` : '';
  const seeders = options.seeders && title.bestSeeders > 0 ? `${title.bestSeeders} seeders` : '';
  const text = joined([seeders, title.year, title.resolutions?.[0], rating]);
  return text || (title.kind === 'series' ? 'Series' : 'Movie');
}

/** Version row headline: resolution with HDR. */
export function sourceHeadline(parsed: ParsedRelease): string {
  return joined([parsed.resolution, parsed.hdr]) || 'Version';
}

/** Version row chips: quality (or the tracker category when the release name has none) and codec. */
export function sourceChips(parsed: ParsedRelease, fallbackQuality = ''): string[] {
  return [parsed.quality || fallbackQuality, parsed.videoCodec].filter((chip): chip is string => Boolean(chip));
}

export function watchProgress(item: Pick<HouseholdItem, 'positionMs' | 'durationMs'>): number {
  return item.durationMs > 0 ? Math.max(0, Math.min(100, Math.round(item.positionMs / item.durationMs * 100))) : 0;
}

/** Continue-watching and Library card line: episode code (or year), then where the viewer is. */
export function libraryCardLine(item: HouseholdItem): string {
  const code = episodeCode(item.seasonNumber, item.episodeNumber);
  const status = item.watched ? 'Watched' : item.positionMs > 0 ? `${watchProgress(item)}% watched` : 'Ready to play';
  if (item.watched || item.positionMs <= 0) return status;
  return joined([code || item.catalog?.year, status]);
}

/** One-line resume summary on the title detail header. */
export function resumeLine(item: HouseholdItem, kind: MediaKind): string {
  return joined([kind === 'series' ? episodeCode(item.seasonNumber, item.episodeNumber) : '', `Continue at ${formatTime(item.positionMs)}`]);
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s left`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(total / 3600);
  const rest = Math.round(total % 3600 / 60);
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

export type DownloadTone = 'active' | 'paused' | 'queued' | 'done' | 'error' | 'idle';

const PAUSED = /^(paused|stopped)/;
const QUEUED = /^queued?dl$/;
const CHECKING = /^(checking|moving|allocating|metadl|forcedmetadl)/;

/** The word that carries a download's state; tone only styles it. */
export function downloadStatus(download: Download): { label: string; tone: DownloadTone; percent: number } {
  const state = (download.state || '').trim().toLowerCase();
  const percent = Math.round(Math.max(0, Math.min(1, download.progress || 0)) * 100);
  if (download.error || state === 'error' || state === 'missingfiles') return { label: 'Needs attention', tone: 'error', percent };
  if (download.progress >= 1 || state === 'completed') return { label: 'Downloaded', tone: 'done', percent: 100 };
  if (PAUSED.test(state)) return { label: `Paused at ${percent}%`, tone: 'paused', percent };
  if (QUEUED.test(state)) return { label: 'Queued', tone: 'queued', percent };
  if (CHECKING.test(state)) return { label: 'Preparing', tone: 'active', percent };
  if (state === 'downloading' || /dl$/.test(state)) return { label: `Downloading ${percent}%`, tone: 'active', percent };
  if (/up$/.test(state)) return { label: 'Downloaded', tone: 'done', percent: 100 };
  return { label: percent > 0 ? `Downloading ${percent}%` : 'Waiting', tone: 'idle', percent };
}

/** The status line of a download row: state, then speed and ETA while it moves, or the error. */
export function downloadProgressLine(download: Download): string {
  const status = downloadStatus(download);
  if (status.tone === 'error') return joined([status.label, download.error]);
  if (status.tone !== 'active') return status.label;
  return joined([status.label, download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', formatEta(download.etaSeconds)]);
}

/** "Getting ready" panel: percent of the download, 0 to 100. */
export function readyPercent(download: Download | undefined): number {
  return download ? Math.round(Math.max(0, Math.min(1, download.progress || 0)) * 100) : 0;
}

/** "Getting ready" panel facts: peers, speed, time left. A part that is not known yet is left out. */
export function readyLine(download: Download): string {
  const peers = download.peers > 0 ? `${download.peers} peer${download.peers === 1 ? '' : 's'}` : '';
  return joined([peers, download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', formatEta(download.etaSeconds)]);
}

/** One calm sentence once Prepare has taken 15 seconds; nothing before that. */
export function prepareHint(elapsedSeconds: number, seeders?: number): string {
  if (elapsedSeconds < 15) return '';
  return seeders && seeders > 0 ? `Still looking for peers. This release has ${seeders} seeder${seeders === 1 ? '' : 's'}, so it can take a little longer.` : 'Still looking for peers. It can take a little longer.';
}

/** Secondary facts of a download row. Release name, path, index, peers and the engine route are details. */
export function downloadFacts(download: Download, group: { sizeBytes?: number; files?: number } = {}): string {
  const parsed = download.parsed;
  return joined([parsed?.resolution, parsed?.quality, parsed?.videoCodec, group.files && group.files > 1 ? `${group.files} files` : '', formatBytes(group.sizeBytes ?? download.sizeBytes), download.trackerName, download.playbackMode === 'progressive' && download.progress < 1 ? 'Playable while downloading' : '']);
}

/** Player status line: the current Audio and Subtitles choice. Empty until preferences are known. */
export function playerChoiceLine(preferences: PlaybackPreferences | undefined): string {
  if (!preferences) return '';
  const language = (code: string) => languageDisplayName(canonicalLanguage(code)) || '';
  const audio = language(preferences.audioLanguage);
  const subtitles = preferences.subtitleMode === 'off' ? 'Off' : preferences.subtitleMode === 'auto' ? 'Auto' : language(preferences.subtitleLanguage) || 'On';
  return joined([audio ? `Audio ${audio}` : '', `Subtitles ${subtitles}`]);
}

const JOB_KINDS: Record<string, string> = { '': 'All', 'catalog-sync': 'Catalog sync', 'catalog-title-refresh': 'Title refresh', metadata: 'Metadata' };
export function jobKindLabel(kind: string): string {
  return JOB_KINDS[kind] ?? kind;
}

const JOB_STATES: Record<string, string> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', retry_wait: 'Retrying later' };
const defaultStamp = (value: string) => new Date(value).toLocaleString();

/** Job row status line: state first, then the last message or time. The job id is never shown here. */
export function jobStatusLine(job: Job, stamp: (value: string) => string = defaultStamp): string {
  const state = JOB_STATES[job.state] || job.state;
  if (job.error) return joined([state, job.error]);
  if (job.state === 'running') return joined([state, `${Math.round((job.progress || 0) * 100)}%`]);
  if (job.state === 'retry_wait' && job.nextAttemptAt) return joined([state, stamp(job.nextAttemptAt)]);
  if (job.state === 'queued') return state;
  return joined([state, job.updatedAt ? stamp(job.updatedAt) : '']);
}
