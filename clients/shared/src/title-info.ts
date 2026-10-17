// Shared, framework-free decisions for release dates and the Info panel, so the TV and the browser
// word dates and order facts identically. Pure, and Intl-free: Tizen 5 / webOS 4 ship limited Intl.
import type { CatalogEpisode, CatalogTitle, InfoEpisode, InfoSeason, InfoSeasonDetail, TitleInfo } from './index';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(value: string | undefined): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

/** 'Mar 14, 2024' from YYYY-MM-DD (a trailing time is ignored); '' when the value is not a date. */
export function formatShortDate(value: string | undefined): string {
  const date = parseDate(value);
  return date ? `${MONTHS[date.month - 1]} ${date.day}, ${date.year}` : '';
}

/** The secondary line of a card or row: a movie's full date (else its year), a series' 'Since 2019'. `compact` shortens a date to 'Mar 2024' for narrow poster cards. */
export function releaseLine(title: Pick<CatalogTitle, 'kind' | 'year' | 'releaseDate'>, options: { compact?: boolean } = {}): string {
  const date = parseDate(title.releaseDate);
  const year = date ? date.year : title.year || 0;
  if (title.kind === 'series') return year ? `Since ${year}` : '';
  if (date) return options.compact ? `${MONTHS[date.month - 1]} ${date.year}` : formatShortDate(title.releaseDate);
  return year ? String(year) : '';
}

/** An episode's air date, with future dates marked 'Upcoming'. Today counts as aired. */
export function episodeAirLabel(airDate: string | undefined, now: Date = new Date()): string {
  const date = parseDate(airDate);
  if (!date) return '';
  const label = formatShortDate(airDate);
  const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return date.year * 10000 + date.month * 100 + date.day > today ? `Upcoming · ${label}` : label;
}

/** 136 -> '2 h 16 min', 120 -> '2 h', 45 -> '45 min', 0 -> ''. */
export function formatRuntime(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Up to two initials, the cast photo fallback. */
export function castInitials(name: string): string {
  const words = name.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0].charAt(0).toUpperCase();
  return words.length === 1 ? first : first + words[words.length - 1].charAt(0).toUpperCase();
}

export interface InfoView {
  /** False when there is nothing to show beyond the title itself, so clients render the calm empty state. */
  hasDetails: boolean;
  tagline: string;
  overview: string;
  /** Primary facts in reading order: date, runtime, rating, certification. */
  meta: string[];
  genres: string[];
  cast: NonNullable<TitleInfo['cast']>;
  /** Secondary: who made it. */
  credits: { label: string; names: string }[];
  /** Fine print, last. */
  fine: { label: string; value: string }[];
  /** The Seasons card of a series whose providers know its seasons or episodes; opens the season level. Null for movies. */
  seasons: { label: string; value: string } | null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Projects an info answer onto the ordered, display-ready sections both Info panels render. */
export function infoView(info: TitleInfo | undefined): InfoView {
  const view: InfoView = { hasDetails: false, tagline: '', overview: '', meta: [], genres: [], cast: [], credits: [], fine: [], seasons: null };
  if (!info || !info.available) return view;
  view.tagline = info.tagline || '';
  view.overview = info.overview || '';
  const kind = info.kind === 'series' ? 'series' : 'movie';
  const date = releaseLine({ kind, releaseDate: info.releaseDate });
  if (date) view.meta.push(date);
  const runtime = formatRuntime(info.runtimeMinutes);
  if (runtime) view.meta.push(runtime);
  if (info.rating && info.rating > 0) view.meta.push(`${info.rating.toFixed(1)} / 10`);
  if (info.certification) view.meta.push(info.certification);
  view.genres = info.genres || [];
  view.cast = info.cast || [];
  if (info.directors && info.directors.length) view.credits.push({ label: 'Directed by', names: info.directors.join(', ') });
  if (info.creators && info.creators.length) view.credits.push({ label: 'Created by', names: info.creators.join(', ') });
  const counts = info.seasons ? { label: 'Seasons', value: info.episodes ? `${plural(info.seasons, 'season')}, ${plural(info.episodes, 'episode')}` : plural(info.seasons, 'season') } : info.episodes ? { label: 'Episodes', value: plural(info.episodes, 'episode') } : null;
  if (counts && kind === 'series') view.seasons = counts;
  else if (counts) view.fine.push(counts);
  if (info.status) view.fine.push({ label: 'Status', value: info.status });
  const last = formatShortDate(info.lastAirDate);
  if (last && kind === 'series') view.fine.push({ label: 'Last aired', value: last });
  if (info.countries && info.countries.length) view.fine.push({ label: 'Country', value: info.countries.join(', ') });
  if (info.originalLanguage) view.fine.push({ label: 'Original language', value: info.originalLanguage });
  view.hasDetails = Boolean(view.tagline || view.overview || view.meta.length || view.genres.length || view.cast.length || view.credits.length || view.fine.length || view.seasons);
  return view;
}

// ---- Season and episode levels of the Info panel ----

/** One level of the Info drill-down stack: the season list, a season, or an episode of a season. */
export type InfoLevel = { kind: 'seasons' } | { kind: 'season'; season: number } | { kind: 'episode'; season: number; episode: number };

export const SEASONS_LOADING = 'Loading seasons…';
export const SEASON_LOADING = 'Loading episodes…';
export const EPISODE_LOADING = 'Loading episode…';
export const SEASONS_EMPTY = 'No season details from the metadata providers yet';
export const SEASON_EMPTY = 'No episode details from the metadata providers yet';
export const EPISODE_EMPTY = 'No episode details from the metadata providers yet';

const two = (value: number) => (value < 10 ? '0' : '') + value;

/** 'Season 2', or 'Specials' for season 0. */
export function seasonLabel(season: number): string {
  return season === 0 ? 'Specials' : `Season ${season}`;
}

/** 'S02E05' */
export function infoEpisodeCode(season: number, episode: number): string {
  return `S${two(season)}E${two(episode)}`;
}

/** 'Title › Season 2 › E05' pieces: the title, then one piece per level (the season list is 'Seasons'; an episode level adds its season, then 'E05'). */
export function infoCrumbs(title: string, stack: InfoLevel[]): string[] {
  const crumbs = [title];
  for (const level of stack) {
    if (level.kind === 'seasons') crumbs.push('Seasons');
    else if (level.kind === 'season') crumbs.push(seasonLabel(level.season));
    else {
      if (crumbs[crumbs.length - 1] !== seasonLabel(level.season)) crumbs.push(seasonLabel(level.season));
      crumbs.push(`E${two(level.episode)}`);
    }
  }
  return crumbs;
}

const plural2 = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export interface SeasonCardView { name: string; meta: string; initial: string }

/** A season row: its name, then 'Year · N episodes'. */
export function seasonCardView(season: InfoSeason): SeasonCardView {
  const date = parseDate(season.airDate);
  const parts: string[] = [];
  if (date) parts.push(String(date.year));
  if (season.episodeCount) parts.push(plural2(season.episodeCount, 'episode'));
  return { name: season.name || seasonLabel(season.number), meta: parts.join(' · '), initial: season.number === 0 ? 'S' : String(season.number) };
}

export interface EpisodeRowView { number: number; code: string; /** 'E05' */ short: string; title: string; meta: string }

/** An episode row of a season: 'E05 · Title' over 'Air date · runtime · rating'. */
export function episodeRowView(season: number, episode: InfoEpisode, now: Date = new Date()): EpisodeRowView {
  const meta: string[] = [];
  const air = episodeAirLabel(episode.airDate, now);
  if (air) meta.push(air);
  const runtime = formatRuntime(episode.runtimeMinutes);
  if (runtime) meta.push(runtime);
  if (episode.rating && episode.rating > 0) meta.push(`${episode.rating.toFixed(1)} / 10`);
  return { number: episode.number, code: infoEpisodeCode(season, episode.number), short: `E${two(episode.number)}`, title: episode.name || `Episode ${episode.number}`, meta: meta.join(' · ') };
}

export interface SeasonDetailView {
  /** False when the providers know nothing about this season: clients show the calm empty state. */
  hasDetails: boolean;
  overview: string;
  meta: string[];
  cast: NonNullable<InfoSeasonDetail['cast']>;
  episodes: EpisodeRowView[];
}

/** Projects a season answer onto the ordered sections both clients render. */
export function seasonDetailView(detail: InfoSeasonDetail | undefined, now: Date = new Date()): SeasonDetailView {
  const view: SeasonDetailView = { hasDetails: false, overview: '', meta: [], cast: [], episodes: [] };
  if (!detail || !detail.available) return view;
  view.overview = detail.overview || '';
  const air = formatShortDate(detail.airDate);
  if (air) view.meta.push(air);
  const episodes = detail.episodes || [];
  if (episodes.length) view.meta.push(plural2(episodes.length, 'episode'));
  view.cast = detail.cast || [];
  view.episodes = episodes.map(episode => episodeRowView(detail.number, episode, now));
  view.hasDetails = Boolean(view.overview || view.cast.length || view.episodes.length);
  return view;
}

export interface EpisodeView {
  hasDetails: boolean;
  code: string;
  title: string;
  meta: string[];
  /** Flags the provider set on the episode: 'Filler', 'Recap'. */
  badges: string[];
  overview: string;
  credits: { label: string; names: string }[];
  guests: NonNullable<InfoEpisode['guestStars']>;
}

/** Projects an episode onto the ordered sections both clients render: code and title, facts, story, who made it, guest stars. */
export function episodeView(season: number, episode: InfoEpisode | undefined, now: Date = new Date()): EpisodeView {
  const view: EpisodeView = { hasDetails: false, code: '', title: '', meta: [], badges: [], overview: '', credits: [], guests: [] };
  if (!episode) return view;
  const row = episodeRowView(season, episode, now);
  view.code = row.code;
  view.title = row.title;
  view.meta = row.meta ? row.meta.split(' · ') : [];
  if (episode.filler) view.badges.push('Filler');
  if (episode.recap) view.badges.push('Recap');
  view.overview = episode.overview || '';
  if (episode.directors && episode.directors.length) view.credits.push({ label: episode.directors.length > 1 ? 'Directors' : 'Director', names: episode.directors.join(', ') });
  if (episode.writers && episode.writers.length) view.credits.push({ label: episode.writers.length > 1 ? 'Writers' : 'Writer', names: episode.writers.join(', ') });
  view.guests = episode.guestStars || [];
  view.hasDetails = Boolean(view.overview || view.credits.length || view.guests.length || episode.stillUrl);
  return view;
}

export interface EpisodePageView {
  /** 'S02E04' */
  code: string;
  title: string;
  /** Air date, runtime, rating: only the facts that are known. */
  meta: string[];
  badges: string[];
  overview: string;
  credits: EpisodeView['credits'];
  /** The provider's still; absent without detailed info, and the client then shows the title's own art. */
  stillUrl?: string;
}

/**
 * What the series page shows for an episode, with or without detailed info. The title detail's own episode (name, air date) always
 * answers; cached Season info adds runtime, rating, synopsis, still and credits; the series overview stands in for a missing synopsis.
 */
export function episodePageView(season: number, listed: Pick<CatalogEpisode, 'number' | 'title' | 'airDate'>, info: InfoEpisode | undefined, fallbackOverview: string = '', now: Date = new Date()): EpisodePageView {
  const merged: InfoEpisode = { ...info, number: listed.number, name: listed.title || info?.name, airDate: info?.airDate || listed.airDate };
  const view = episodeView(season, merged, now);
  const meta = view.meta;
  return { code: view.code, title: view.title, meta, badges: view.badges, overview: view.overview || fallbackOverview, credits: view.credits, stillUrl: info?.stillUrl || undefined };
}

/** The second line of an episode row on both clients: '2 versions', then the page's known facts (air date with 'Upcoming', runtime, rating). */
export function episodeRowLine(episode: { sourceCount: number }, page: Pick<EpisodePageView, 'meta'>): string {
  return [plural2(episode.sourceCount, 'version'), ...page.meta].join(' · ');
}
