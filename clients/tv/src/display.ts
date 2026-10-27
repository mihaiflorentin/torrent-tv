import { canonicalLanguage, episodeRowLine, formatBytes, formatEtaLeft as formatEta, prepareHint, readyLine, readyPercent, releaseLine, languageDisplayName, type CatalogSource, type CatalogTitle, type EpisodePageView, type Download, type HouseholdItem, type Job, type MediaKind, type ParsedRelease, type PlaybackPreferences } from '@torrent-tv/shared';
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

/** Home hero and title page eyebrow: kind, then the full release date (a series: 'Since <year>') when known. */
export function heroFacts(title: CatalogTitle): string[] {
  return [titleKind(title), releaseLine(title)].filter(Boolean);
}

/** Episode tile second line: the shared versions-and-facts line, then watch progress. */
export function episodeMeta(episode: { sourceCount: number }, page: EpisodePageView, progress: number): string {
  return joined([episodeRowLine(episode, page), progress > 0 ? `${progress}% watched` : '']);
}

/**
 * Poster card second line: release (month and year; a series 'Since <year>'), best resolution, a rating that has votes. Tracker names, source
 * counts and seeders stay off the card, except on a row defined by seeders ("Strong swarms").
 */
export function cardMeta(title: CatalogTitle, options: { seeders?: boolean } = {}): string {
  const seeders = options.seeders && title.bestSeeders > 0 ? `${title.bestSeeders} seeders` : '';
  const text = joined([seeders, releaseLine(title, { compact: true }), title.resolutions?.[0]]);
  return text || (cardRating(title) ? '' : title.kind === 'series' ? 'Series' : 'Movie');
}

/** The card's rating, one decimal, only when it has votes; the card draws the star icon in front of it. */
export function cardRating(title: CatalogTitle): string {
  return title.ratingVotes && title.rating ? title.rating.toFixed(1) : '';
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

/** What the primary will play, as the board words it: resolution, HDR and quality as one phrase, the size, and Downloaded once it is local. */
function versionFacts(source: CatalogSource): string[] {
  const phrase = [source.parsed?.resolution, source.parsed?.hdr, source.parsed?.quality].filter(Boolean).join(' ');
  const bytes = source.fileSizeBytes || source.release?.sizeBytes || 0;
  return [phrase, bytes > 0 ? formatBytes(bytes) : '', source.libraryState?.downloadState === 'downloaded' ? 'Downloaded' : ''].filter(Boolean);
}

/**
 * The muted line under the title page's action row: what one press of the primary will play. The Best match and its
 * facts; a resume names the version being resumed (and the episode), or its file when the list no longer has it.
 * Tracker, codec and seeders stay on the version rows, where versions are compared.
 */
export function playsLine(primary: { source?: CatalogSource; resume?: HouseholdItem; kind: MediaKind }): string {
  if (primary.resume) {
    const code = primary.kind === 'series' ? episodeCode(primary.resume.seasonNumber, primary.resume.episodeNumber) : '';
    const facts = primary.source ? versionFacts(primary.source) : [primary.resume.filePath || primary.resume.release.name];
    return `Plays ${joined([code, ...facts])}`;
  }
  return primary.source ? `Plays the Best match: ${joined(versionFacts(primary.source))}` : '';
}

// The getting-ready wording lives in the shared package so the web client says the same thing.
export { formatEta, prepareHint, readyLine, readyPercent };

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

export type DownloadFilter = 'active' | 'done' | 'paused' | 'attention';

/** The one filter chip a download counts under (Active, Downloaded, Paused, Needs attention); every download has one. */
export function downloadFilterOf(download: Download): DownloadFilter {
  const tone = downloadStatus(download).tone;
  return tone === 'done' ? 'done' : tone === 'paused' ? 'paused' : tone === 'error' ? 'attention' : 'active';
}

export interface DownloadRowView { state: string; tone: DownloadTone; percent: number; meter: boolean; facts: string }

/**
 * One compact Downloads row (the Downloads board): the state (the percent while it moves, else a word), whether the
 * slim bar shows (while it is unfinished and not failed), and one line of facts: speed, time left and Playable now
 * while it moves; the reached percent and the picture on a paused row; the version and tracker once it is
 * downloaded; the reason when it needs attention. Release name, path, index and peers are Details.
 */
export function downloadRow(download: Download, files = 1): DownloadRowView {
  const status = downloadStatus(download);
  const parsed = download.parsed;
  const many = files > 1 ? `${files} files` : '';
  const percent = status.percent;
  if (status.tone === 'error') return { state: status.label, tone: status.tone, percent, meter: false, facts: download.error || 'The transfer stopped. Retry it or delete it.' };
  if (status.tone === 'done') return { state: status.label, tone: status.tone, percent, meter: false, facts: joined([parsed?.resolution, parsed?.quality, download.trackerName, many]) };
  if (status.tone === 'paused') return { state: 'Paused', tone: status.tone, percent, meter: true, facts: joined([`${percent}%`, parsed?.resolution, parsed?.videoCodec, many]) };
  const moving = /^Downloading /.test(status.label);
  const state = moving ? `${percent}%` : status.label;
  return { state, tone: status.tone, percent, meter: true, facts: joined([!moving && percent > 0 ? `${percent}%` : '', download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', formatEta(download.etaSeconds), download.playbackMode === 'progressive' && download.progress < 1 ? 'Playable now' : '', many]) };
}

const GIB = 1024 ** 3;
const gigabytes = (value: number) => `${value < 10 ? (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '') : Math.round(value)} GB`;

/**
 * The Downloads heading's storage line: stored torrent content against the Allocation. The Allocation is set in
 * binary gigabytes (Settings shows it as "Allocation (GB)"), so the stored bytes are counted the same way. With no
 * Allocation set (0 or unknown) it only says what is stored, and percent is -1 (no bar).
 */
export function allocationUse(storedBytes: number, allocationGb: number | undefined): { label: string; percent: number } {
  const stored = gigabytes(Math.max(0, storedBytes) / GIB);
  if (!allocationGb || !(allocationGb > 0)) return { label: `${stored} stored`, percent: -1 };
  return { label: `${stored} of ${gigabytes(allocationGb)}`, percent: Math.min(100, Math.round((storedBytes / GIB / allocationGb) * 100)) };
}

/** Player status line: the current Audio and Subtitles choice. Empty until preferences are known. */
// The Player heading: the server names an episode "Show · S01E04 · Episode name"; the show and code become a muted
// kicker over the name. A movie, an episode without a name, or a title without its code (added from the parsed
// release) stays one line.
const EPISODE_CODE = /^S\d+E\d+/;
export function playerHeading(download: Pick<Download, 'displayTitle' | 'filePath' | 'parsed'>): { kicker: string; title: string } {
  const name = download.displayTitle || download.filePath;
  const parts = name.split(' · ');
  const at = parts.findIndex(part => EPISODE_CODE.test(part));
  if (at > 0 && at < parts.length - 1) return { kicker: parts.slice(0, at + 1).join(' · '), title: parts.slice(at + 1).join(' · ') };
  const code = at < 0 ? episodeCode(download.parsed?.seasonStart, download.parsed?.episodeStart) : '';
  return { kicker: '', title: code ? `${name} · ${code}` : name };
}

// Time left in the stream, shown at the right end of the timeline; empty until the duration is known.
export function remainingTime(position: number, total: number): string {
  return total > 0 ? `\u2212${formatTime(Math.max(0, total - position))}` : '';
}

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
