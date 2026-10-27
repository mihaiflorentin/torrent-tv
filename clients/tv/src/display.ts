import { canonicalLanguage, episodeRowLine, formatBytes, formatRuntime, formatEtaLeft as formatEta, prepareHint, readyLine, readyPercent, releaseLine, languageDisplayName, type CatalogSource, type CatalogTitle, type EpisodePageView, type Download, type HouseholdItem, type MediaState, type Job, type MediaKind, type ParsedRelease, type PlaybackPreferences } from '@torrent-tv/shared';
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

/** Home hero kind line: why a resumed title leads Home, else the kind (DESIGN.md "Home"). */
export function heroKind(title: Pick<CatalogTitle, 'kind' | 'seasonCount'>, resuming: boolean): string {
  return resuming ? 'Continue watching' : titleKind(title);
}

/** Home hero title: a "Title: Subtitle" name splits into the title and a subtitle line; anything else stays whole. */
export function heroTitleParts(name: string): [string, string] {
  const at = name.indexOf(': ');
  return at > 0 && at < name.length - 2 ? [name.slice(0, at), name.slice(at + 2)] : [name, ''];
}

/** Home hero facts line: the full release date (a series: 'Since <year>') and up to three genres, each only when known. */
export function heroFacts(title: CatalogTitle): string[] {
  return [releaseLine(title), (title.genres || []).slice(0, 3).join(', ')].filter(Boolean);
}

/** Episode row facts line (the "Series page" board): air date or Upcoming, runtime and rating when known, then the version count. */
export function episodeMeta(episode: { sourceCount: number }, page: Pick<EpisodePageView, 'meta'>): string {
  return joined([...page.meta, `${episode.sourceCount} version${episode.sourceCount === 1 ? '' : 's'}`]);
}

export type EpisodeStateTone = 'progress' | 'ok' | 'quiet' | 'danger';
/**
 * The one library-state word at the right of an episode row, with its tone (never colour alone: the word is the state).
 * A failed download needs action, so it comes first; then how far the viewer is, a finished episode, and the download.
 */
export function episodeState(state: MediaState | undefined, progress: number): { text: string; tone: EpisodeStateTone } | undefined {
  if (!state) return undefined;
  const download = state.downloadState;
  if (download === 'error') return { text: 'Needs attention', tone: 'danger' };
  if (state.watchState !== 'watched' && progress > 0) return { text: `${progress}% watched`, tone: 'progress' };
  if (state.watchState === 'watched') return { text: 'Watched', tone: 'ok' };
  if (download === 'downloading') return { text: `Downloading ${Math.round((state.progress || 0) * 100)}%`, tone: 'progress' };
  if (download === 'downloaded') return { text: 'Downloaded', tone: 'quiet' };
  if (download === 'partial') return { text: 'Some downloaded', tone: 'quiet' };
  if (download === 'queued') return { text: 'Queued', tone: 'quiet' };
  return undefined;
}

/**
 * Poster card fact line: one short fact that fits the ~210 px card whole: the release (month and year; a series
 * 'Since <year>'), else the kind. Resolution, rating, tracker names and source counts stay off the card; a row
 * defined by seeders ("Strong swarms") shows the seeders instead.
 */
export function cardMeta(title: CatalogTitle, options: { seeders?: boolean } = {}): string {
  if (options.seeders && title.bestSeeders > 0) return `${title.bestSeeders} seeders`;
  return releaseLine(title, { compact: true }) || (title.kind === 'series' ? 'Series' : 'Movie');
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

/** Library poster card fact line (My List, Watched, Library grids): where the viewer is, in one short fact. */
export function libraryCardLine(item: HouseholdItem): string {
  if (item.watched) return 'Watched';
  if (item.positionMs > 0) {
    const code = episodeCode(item.seasonNumber, item.episodeNumber);
    return code ? `${code} · ${watchProgress(item)}%` : `${watchProgress(item)}% watched`;
  }
  return (item.catalog && releaseLine(item.catalog, { compact: true })) || 'Ready to play';
}

/** What is left of a title in progress ("1 h 30 min left"), rounded up to the minute; empty when its length is unknown. */
export function timeLeft(item: Pick<HouseholdItem, 'positionMs' | 'durationMs'>): string {
  if (item.durationMs <= 0) return '';
  return `${formatRuntime(Math.max(1, Math.ceil((item.durationMs - item.positionMs) / 60_000)))} left`;
}

/** Continue watching landscape card line: the episode code, then the time left (or the state). */
export function continueCardLine(item: HouseholdItem): string {
  if (item.watched) return 'Watched';
  const state = item.positionMs > 0 ? timeLeft(item) || 'In progress' : 'Ready to play';
  return joined([episodeCode(item.seasonNumber, item.episodeNumber), state]);
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

/** The status line of a download row: state, then speed and ETA while it moves, or the error. */
export function downloadProgressLine(download: Download): string {
  const status = downloadStatus(download);
  if (status.tone === 'error') return joined([status.label, download.error]);
  if (status.tone !== 'active') return status.label;
  return joined([status.label, download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', formatEta(download.etaSeconds)]);
}

/** Secondary facts of a download row. Release name, path, index, peers and the engine route are details. */
export function downloadFacts(download: Download, group: { sizeBytes?: number; files?: number } = {}): string {
  const parsed = download.parsed;
  return joined([parsed?.resolution, parsed?.quality, parsed?.videoCodec, group.files && group.files > 1 ? `${group.files} files` : '', formatBytes(group.sizeBytes ?? download.sizeBytes), download.trackerName, download.playbackMode === 'progressive' && download.progress < 1 ? 'Playable while downloading' : '']);
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
