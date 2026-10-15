// What each screen chooses to show. DESIGN.md "Information priorities" ranks
// every fact as primary, secondary or hidden by default; these helpers apply
// that ranking so the components only lay the result out. Nothing here fetches
// data. An unknown fact is left out of the result instead of becoming a
// placeholder such as "codec unknown" or "—".
import { episodeAirLabel, formatBytes, releaseLine, type CatalogSource, type CatalogTitle, type Download, type HouseholdItem, type Job, type MediaKind } from '@torrent-tv/shared';

const pad2 = (value: number) => String(value).padStart(2, '0');
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

export const episodeCode = (season?: number, episode?: number): string => season && episode ? `S${pad2(season)}E${pad2(episode)}` : '';

// m:ss under an hour, h:mm:ss above it; the shared clock for the player and resume lines.
export function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

export function kindLabel(title: Pick<CatalogTitle, 'kind' | 'seasonCount'>): string {
  if (title.kind !== 'series') return 'Movie';
  return title.seasonCount && title.seasonCount > 0 ? plural(title.seasonCount, 'season') : 'Series';
}

// Hero and detail header line: the full release date (a series: 'Since <year>') and kind. Seeders and trackers stay out.
export const titleFacts = (title: CatalogTitle): string[] => [releaseLine(title), kindLabel(title)].filter(Boolean);

// Episode row second line: versions, then the air date ('Upcoming' when it is ahead).
export function episodeFacts(episode: { sourceCount: number; airDate?: string }, now?: Date): string {
  return [plural(episode.sourceCount, 'version'), episodeAirLabel(episode.airDate, now)].filter(Boolean).join(' · ');
}

// Poster card caption: release (month and year; a series 'Since <year>'), best resolution, the rating once when it has votes.
// Seeders appear only on a row defined by seeders ("Strong swarms").
export function cardFacts(title: CatalogTitle, options: { showSeeders?: boolean } = {}): string[] {
  const rated = title.ratingVotes && title.rating !== undefined ? `★ ${title.rating.toFixed(1)}` : '';
  return [releaseLine(title, { compact: true }), title.resolutions[0] || '', rated, options.showSeeders ? plural(title.bestSeeders, 'seeder') : ''].filter(Boolean);
}

export function libraryProgress(item: Pick<HouseholdItem, 'watched' | 'positionMs' | 'durationMs'>): { percent: number; label: string } {
  if (item.watched) return { percent: 100, label: 'Watched' };
  if (item.positionMs > 0 && item.durationMs > 0) {
    const percent = Math.max(0, Math.min(100, Math.round(item.positionMs / item.durationMs * 100)));
    return { percent, label: `${percent}% watched` };
  }
  return { percent: 0, label: '' };
}

// One-line resume summary for the detail header: episode and position, never a file path.
export function resumeLine(item: HouseholdItem, kind: MediaKind): string {
  return [kind === 'series' ? episodeCode(item.seasonNumber, item.episodeNumber) : '', `Continue at ${formatClock(item.positionMs)}`].filter(Boolean).join(' · ');
}

export type SourceSpec = { headline: string; chips: string[]; size: string; seeders: string; audio: string; release: string; details: Array<[string, string]> };

// Version row, the decision point: resolution with HDR, quality and codec,
// size and seeders lead; the release and file name sit behind a details control.
export function sourceSpec(source: CatalogSource): SourceSpec {
  const { parsed, release } = source;
  const headline = [parsed.resolution, parsed.hdr].filter(Boolean).join(' ') || parsed.quality || 'Version';
  const chips = [headline === parsed.quality ? '' : parsed.quality, parsed.videoCodec].filter((chip): chip is string => Boolean(chip));
  const details: Array<[string, string]> = [['Release', release.name]];
  if (source.filePath) details.push(['File', source.filePath]);
  if (release.category) details.push(['Category', release.category]);
  details.push(['Release ID', release.id]);
  if (source.fileIndex !== undefined && source.fileIndex >= 0) details.push(['File index', String(source.fileIndex)]);
  return {
    headline,
    chips,
    size: formatBytes(source.fileSizeBytes || release.sizeBytes),
    seeders: plural(release.seeders, 'seeder'),
    audio: parsed.audio || '',
    release: source.filePath || release.name,
    details,
  };
}

export function formatEta(seconds: number): string {
  if (!(seconds > 0)) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

export type DownloadTone = 'active' | 'paused' | 'error' | 'done' | 'idle';
const COMPLETE_STATES = new Set(['seeding', 'uploading', 'stalledup', 'forcedup', 'checkingup', 'queuedup', 'pausedup', 'stoppedup']);
const PAUSED_STATES = new Set(['pauseddl', 'stoppeddl']);
const ACTIVE_LABELS: Record<string, string> = { downloading: 'Downloading', forceddl: 'Downloading', metadl: 'Getting metadata', forcedmetadl: 'Getting metadata', queueddl: 'Queued', stalleddl: 'Waiting for peers', allocating: 'Preparing disk', checkingdl: 'Checking files', checkingresumedata: 'Checking files' };

// Downloads row headline: state with percent, plus speed and ETA only while it moves.
export function downloadStatus(download: Download): { label: string; tone: DownloadTone; line: string } {
  const state = (download.state || '').trim().toLowerCase();
  const percent = `${Math.round(Math.max(0, Math.min(1, download.progress)) * 100)}%`;
  if (download.error || state === 'error' || state === 'missingfiles') return { label: 'Error', tone: 'error', line: `Error · ${percent}` };
  if (download.progress >= 1 || COMPLETE_STATES.has(state)) return { label: 'Downloaded', tone: 'done', line: 'Downloaded' };
  if (PAUSED_STATES.has(state)) return { label: 'Paused', tone: 'paused', line: `Paused · ${percent}` };
  const label = ACTIVE_LABELS[state] || 'Downloading';
  const moving = label === 'Downloading' || label === 'Waiting for peers';
  const parts = [label, download.progress > 0 || moving ? percent : '', moving && download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', moving && formatEta(download.etaSeconds) ? `ETA ${formatEta(download.etaSeconds)}` : ''];
  return { label, tone: 'active', line: parts.filter(Boolean).join(' · ') };
}

// Secondary facts on a Downloads row; release name, path and swarm counts live in downloadDetails.
export function downloadFacts(download: Download): string[] {
  const quality = [download.parsed?.resolution, download.parsed?.videoCodec].filter(Boolean).join(' · ');
  return [formatBytes(download.sizeBytes), quality, download.playbackMode === 'progressive' && download.progress < 1 ? 'Playable while downloading' : ''].filter(Boolean);
}

export const engineLabel = (engineId: string) => engineId.startsWith('native:') ? 'native engine' : 'qBittorrent';

export function downloadDetails(download: Download): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (download.releaseName) rows.push(['Release', download.releaseName]);
  rows.push(['File', download.filePath], ['File index', String(download.fileIndex)], ['Release ID', download.releaseId]);
  if (download.category) rows.push(['Category', download.category]);
  if (download.trackerSeeders !== undefined) rows.push(['Tracker seeders', String(download.trackerSeeders)]);
  rows.push(['Peers', `${plural(download.seeds, 'connected seed')} · ${plural(download.peers, 'peer')} · ${download.seeds + download.peers} known in swarm`]);
  rows.push(['Upload', download.uploadSpeedBytesPerSecond ? `${formatBytes(download.uploadSpeedBytesPerSecond)}/s` : 'idle']);
  rows.push(['Engine', engineLabel(download.engineId)], ['Engine route', download.engineId]);
  return rows;
}

// Player heading: the title with its episode code, never the release name.
export function playerTitle(download: Download): string {
  const title = download.displayTitle || download.filePath;
  const code = episodeCode(download.parsed?.seasonStart, download.parsed?.episodeStart);
  return !code || /S\d+E\d+/i.test(title) ? title : `${title} · ${code}`;
}

export type StatusTone = 'ok' | 'busy' | 'warn' | 'danger' | 'idle';
const JOB_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Running', tone: 'busy' },
  queued: { label: 'Queued', tone: 'idle' },
  retry_wait: { label: 'Waiting to retry', tone: 'warn' },
};
export function jobStatus(job: Pick<Job, 'state'>): { label: string; tone: StatusTone } {
  return JOB_STATUS[job.state] || { label: job.state ? job.state[0].toUpperCase() + job.state.slice(1).replace(/_/g, ' ') : 'Unknown', tone: 'idle' };
}

// Time the job took, only once it has finished: updatedAt is then its end.
export function jobDuration(job: Pick<Job, 'state' | 'createdAt' | 'updatedAt'>): string {
  if (job.state !== 'completed' && job.state !== 'failed') return '';
  const seconds = Math.round((Date.parse(job.updatedAt) - Date.parse(job.createdAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : formatEta(seconds);
}

// Settings group status from this session's connection tests; an untested group says nothing.
export function connectionStatus(state: string | undefined): { label: string; tone: StatusTone } | null {
  if (state === 'pass') return { label: 'Connected', tone: 'ok' };
  if (state === 'fail') return { label: 'Needs attention', tone: 'warn' };
  if (state === 'testing') return { label: 'Checking', tone: 'busy' };
  return null;
}
