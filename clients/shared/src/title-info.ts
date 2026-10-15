// Shared, framework-free decisions for release dates and the Info panel, so the TV and the browser
// word dates and order facts identically. Pure, and Intl-free: Tizen 5 / webOS 4 ship limited Intl.
import type { CatalogTitle, TitleInfo } from './index';

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
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Projects an info answer onto the ordered, display-ready sections both Info panels render. */
export function infoView(info: TitleInfo | undefined): InfoView {
  const view: InfoView = { hasDetails: false, tagline: '', overview: '', meta: [], genres: [], cast: [], credits: [], fine: [] };
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
  if (info.seasons) view.fine.push({ label: 'Seasons', value: info.episodes ? `${plural(info.seasons, 'season')}, ${plural(info.episodes, 'episode')}` : plural(info.seasons, 'season') });
  else if (info.episodes) view.fine.push({ label: 'Episodes', value: plural(info.episodes, 'episode') });
  if (info.status) view.fine.push({ label: 'Status', value: info.status });
  const last = formatShortDate(info.lastAirDate);
  if (last && kind === 'series') view.fine.push({ label: 'Last aired', value: last });
  if (info.countries && info.countries.length) view.fine.push({ label: 'Country', value: info.countries.join(', ') });
  if (info.originalLanguage) view.fine.push({ label: 'Original language', value: info.originalLanguage });
  view.hasDetails = Boolean(view.tagline || view.overview || view.meta.length || view.genres.length || view.cast.length || view.credits.length || view.fine.length);
  return view;
}
