// The Info dialog: the extended description of a title (story, date, runtime, rating, genres, then
// credits and cast, fine print last). Content decisions come from the shared infoView so the TV and
// the browser order facts identically. A series' Seasons card drills down inside the same dialog:
// season list, a season (episodes and cast), an episode (still, credits, guest stars), with a
// breadcrumb (Title › Season 2 › E05). Back and Escape pop one level and put focus back on the row you
// came from; at the top they close the dialog. Focus trapping, the Tab cycle and the Escape key belong to
// the App's overlay focus machinery, which asks this component to pop first through `backRef`.
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import {
  castInitials, EPISODE_EMPTY, EPISODE_LOADING, episodeView, infoCrumbs, infoView, SEASON_EMPTY, SEASON_LOADING, seasonCardView, seasonDetailView, SEASONS_EMPTY, SEASONS_LOADING,
  type CatalogTitle, type InfoEpisode, type InfoLevel, type InfoSeasonDetail, type InfoSeasons, type TitleInfo,
} from '@torrent-tv/shared';
import { sharedApi } from './shared-api';

type Phase = 'loading' | 'ready' | 'failed';
interface Entry<T> { phase: Phase; data?: T }
interface Frame { level: InfoLevel; from: string }
/** Provider answers of this dialog by level key; notify re-renders the dialog when one lands. */
interface Cache { map: Map<string, Entry<unknown>>; notify: () => void }

/** Fetches one provider answer once per dialog: the cache outlives a level, so Back shows the list at once. */
function useResource<T>(cache: { current: Cache }, key: string, load: () => Promise<T>): Entry<T> {
  const hit = cache.current.map.get(key) as Entry<T> | undefined;
  useEffect(() => {
    const existing = cache.current.map.get(key);
    if (existing && existing.phase !== 'failed') return;
    cache.current.map.set(key, { phase: 'loading' });
    load().then(data => { cache.current.map.set(key, { phase: 'ready', data }); cache.current.notify() }, () => { cache.current.map.set(key, { phase: 'failed' }); cache.current.notify() });
  }, [key]);
  return hit || { phase: 'loading' };
}

const hide = (event: Event) => { (event.currentTarget as HTMLElement).style.display = 'none' };

function Avatar({ name, url }: { name: string; url?: string }) {
  return <span class="info-avatar" aria-hidden="true">{castInitials(name)}{url && <img src={sharedApi().streamURL(url)} alt="" loading="lazy" onError={hide} />}</span>;
}

function People({ label, people }: { label: string; people: { name: string; character?: string; imageUrl?: string }[] }) {
  return <section aria-label={label}><h3>{label}</h3><ul class="info-cast">{people.map(member => <li>
    <Avatar name={member.name} url={member.imageUrl} />
    <span class="info-cast-copy"><strong>{member.name}</strong>{member.character && <small>{member.character}</small>}</span>
  </li>)}</ul></section>;
}

function Calm({ phase, loading, empty }: { phase: Phase; loading: string; empty: string }) {
  return phase === 'loading'
    ? <div role="status" class="info-loading"><p>{loading}</p><span class="info-skeleton" /><span class="info-skeleton short" /></div>
    : <p class="info-empty" role="status">{empty}</p>;
}

type CacheRef = { current: Cache };
type Push = (level: InfoLevel, trigger: HTMLElement) => void;

function SeasonsLevel({ title, cache, push }: { title: CatalogTitle; cache: CacheRef; push: Push }) {
  const entry = useResource<InfoSeasons>(cache, 'seasons', () => sharedApi().titleSeasons(title.id));
  const seasons = entry.data && entry.data.available ? entry.data.seasons : [];
  if (!seasons.length) return <Calm phase={entry.phase} loading={SEASONS_LOADING} empty={SEASONS_EMPTY} />;
  return <ul class="info-levels">{seasons.map(season => {
    const card = seasonCardView(season);
    return <li><button class="info-row" data-info-key={`season-${season.number}`} aria-haspopup="true" onClick={event => push({ kind: 'season', season: season.number }, event.currentTarget as HTMLElement)}>
      <span class="info-poster" aria-hidden="true">{card.initial}{season.posterUrl && <img src={sharedApi().streamURL(season.posterUrl)} alt="" loading="lazy" onError={hide} />}</span>
      <span class="info-row-copy"><strong>{card.name}</strong>{card.meta && <small>{card.meta}</small>}</span>
      <span class="info-chevron" aria-hidden="true">›</span>
    </button></li>;
  })}</ul>;
}

function SeasonLevel({ title, season, cache, push }: { title: CatalogTitle; season: number; cache: CacheRef; push: Push }) {
  const entry = useResource<InfoSeasonDetail>(cache, `season-${season}`, () => sharedApi().seasonInfo(title.id, season));
  const view = seasonDetailView(entry.data);
  if (!view.hasDetails) return <Calm phase={entry.phase} loading={SEASON_LOADING} empty={SEASON_EMPTY} />;
  const detail = entry.data!;
  return <>
    {view.meta.length > 0 && <p class="info-meta">{view.meta.join(' · ')}</p>}
    {view.overview && <p class="info-overview">{view.overview}</p>}
    {view.episodes.length > 0 && <section aria-label="Episodes"><h3>Episodes</h3><ul class="info-levels">{view.episodes.map((episode, index) => <li>
      <button class="info-row" data-info-key={`episode-${episode.number}`} aria-haspopup="true" onClick={event => push({ kind: 'episode', season, episode: episode.number }, event.currentTarget as HTMLElement)}>
        <span class="info-still-small" aria-hidden="true">{detail.episodes[index].stillUrl && <img src={sharedApi().streamURL(detail.episodes[index].stillUrl!)} alt="" loading="lazy" onError={hide} />}</span>
        <span class="info-row-copy"><strong>{`${episode.short} · ${episode.title}`}</strong>{episode.meta && <small>{episode.meta}</small>}</span>
        <span class="info-chevron" aria-hidden="true">›</span>
      </button>
    </li>)}</ul></section>}
    {view.cast.length > 0 && <People label="Cast" people={view.cast} />}
  </>;
}

function EpisodeLevel({ title, season, episode, cache }: { title: CatalogTitle; season: number; episode: number; cache: CacheRef }) {
  const parent = cache.current.map.get(`season-${season}`) as Entry<InfoSeasonDetail> | undefined;
  const listed = parent && parent.data ? parent.data.episodes.find(item => item.number === episode) : undefined;
  // Providers that leave the synopsis to a per-episode call (MyAnimeList) are asked once, on first open.
  const lazy = useResource<InfoEpisode | undefined>(cache, `episode-${season}-${episode}`, () => listed && listed.lazyDetail ? sharedApi().episodeInfo(title.id, season, episode) : Promise.resolve(undefined));
  const detail: InfoEpisode | undefined = lazy.data ? { ...listed, ...lazy.data } : listed;
  if (!detail) return <Calm phase={lazy.phase} loading={EPISODE_LOADING} empty={EPISODE_EMPTY} />;
  const view = episodeView(season, detail);
  return <>
    {detail.stillUrl && <span class="info-still" aria-hidden="true"><img src={sharedApi().streamURL(detail.stillUrl)} alt="" loading="lazy" onError={hide} /></span>}
    <p class="info-meta">{[view.code].concat(view.meta).join(' · ')}</p>
    <h3 class="info-episode-title">{view.title}</h3>
    {view.badges.length > 0 && <p class="info-genres">{view.badges.join(' · ')}</p>}
    {view.overview && <p class="info-overview">{view.overview}</p>}
    {view.credits.length > 0 && <dl class="info-credits">{view.credits.map(credit => <div><dt>{credit.label}</dt><dd>{credit.names}</dd></div>)}</dl>}
    {lazy.phase === 'loading' && listed && listed.lazyDetail && <div role="status" class="info-loading"><p>{EPISODE_LOADING}</p></div>}
    {!view.hasDetails && lazy.phase !== 'loading' && <p class="info-empty" role="status">{EPISODE_EMPTY}</p>}
    {view.guests.length > 0 && <People label="Guest stars" people={view.guests} />}
  </>;
}

export function TitleInfoDialog({ title, onClose, backRef }: { title: CatalogTitle; onClose: () => void; backRef?: MutableRef<(() => boolean) | null> }) {
  const headingId = useId();
  const [info, setInfo] = useState<TitleInfo | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [stack, setStack] = useState<Frame[]>([]);
  const stackRef = useRef<Frame[]>([]);
  const restoreKey = useRef<string | null>(null);
  const [, setTick] = useState(0);
  const cache = useRef<Cache>({ map: new Map(), notify: () => setTick(count => count + 1) });
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    sharedApi().titleInfo(title.id).then(value => { if (live) { setInfo(value); setPhase('ready') } }, () => { if (live) setPhase('failed') });
    return () => { live = false };
  }, [title.id]);

  const jump = (depth: number) => {
    const frames = stackRef.current;
    if (depth >= frames.length) return;
    restoreKey.current = frames[depth].from;
    stackRef.current = frames.slice(0, depth);
    setStack(stackRef.current);
  };
  const push: Push = (level, trigger) => {
    stackRef.current = stackRef.current.concat([{ level, from: trigger.dataset.infoKey || '' }]);
    setStack(stackRef.current);
  };
  // Escape reaches the App's overlay trap first; it asks here whether a level was popped (true) or the dialog should close.
  if (backRef) backRef.current = () => { if (!stackRef.current.length) return false; jump(stackRef.current.length - 1); return true };
  useEffect(() => () => { if (backRef) backRef.current = null }, []);

  // Each level change lands focus: back on the row the level was opened from, or on the new level's first control
  // (the Back button while its data is still loading). Data that lands later moves focus in only from the header.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const root = dialog.current;
      if (!root) return;
      const wanted = restoreKey.current;
      restoreKey.current = null;
      const target = wanted ? root.querySelector<HTMLElement>(`[data-info-key="${wanted}"]`) : null;
      if (target) { target.focus(); return }
      if (stackRef.current.length) (root.querySelector<HTMLElement>('.info-body [data-info-key]') || root.querySelector<HTMLElement>('.info-back'))?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stack.length]);
  useEffect(() => {
    const root = dialog.current;
    if (!root || !stack.length || !(document.activeElement as HTMLElement | null)?.classList.contains('info-back')) return;
    const first = root.querySelector<HTMLElement>('.info-body [data-info-key]');
    if (first) first.focus();
  });

  const view = infoView(info);
  const top = stack.length ? stack[stack.length - 1].level : null;
  const crumbs = infoCrumbs(title.title, stack.map(frame => frame.level));
  // The catalog card already knows a description; keep showing it when the provider has nothing more.
  const overview = view.overview || (!view.hasDetails ? title.overview || '' : '');
  const empty = phase !== 'loading' && !view.hasDetails;
  return <div class="overlay info-overlay" role="dialog" aria-modal="true" aria-labelledby={headingId}>
    <section class="info-dialog" ref={dialog}>
      <button class="close" onClick={onClose}>Close</button>
      <h2 id={headingId}>{title.title}</h2>
      {top && <nav class="info-crumbs" aria-label="Breadcrumb"><ol>{crumbs.map((crumb, index) => <li>
        {index < crumbs.length - 1
          ? <button class="info-crumb" onClick={() => jump(index)}>{crumb}</button>
          : <span aria-current="page">{crumb}</span>}
      </li>)}</ol></nav>}
      {top && <button class="info-back" onClick={() => jump(stack.length - 1)}>Back</button>}
      <div class="info-body">
        {!top && <>
          {phase === 'loading' && <div role="status" class="info-loading"><p>Loading details…</p><span class="info-skeleton" /><span class="info-skeleton short" /><span class="info-skeleton" /></div>}
          {empty && <p class="info-empty" role="status">No extra details available</p>}
          {view.meta.length > 0 && <p class="info-meta">{view.meta.join(' · ')}</p>}
          {view.tagline && <p class="info-tagline">{view.tagline}</p>}
          {overview && <p class="info-overview">{overview}</p>}
          {view.genres.length > 0 && <p class="info-genres">{view.genres.join(' · ')}</p>}
          {view.credits.length > 0 && <dl class="info-credits">{view.credits.map(credit => <div><dt>{credit.label}</dt><dd>{credit.names}</dd></div>)}</dl>}
          {view.seasons && <button class="info-row info-seasons" data-info-key="seasons" aria-haspopup="true" onClick={event => push({ kind: 'seasons' }, event.currentTarget as HTMLElement)}>
            <span class="info-row-copy"><strong>{view.seasons.label}</strong><small>{view.seasons.value}</small></span>
            <span class="info-chevron" aria-hidden="true">›</span>
          </button>}
          {view.cast.length > 0 && <People label="Cast" people={view.cast} />}
          {view.fine.length > 0 && <dl class="info-fine">{view.fine.map(entry => <div><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}
        </>}
        {top && top.kind === 'seasons' && <SeasonsLevel title={title} cache={cache} push={push} />}
        {top && top.kind === 'season' && <SeasonLevel title={title} season={top.season} cache={cache} push={push} />}
        {top && top.kind === 'episode' && <EpisodeLevel title={title} season={top.season} episode={top.episode} cache={cache} />}
      </div>
    </section>
  </div>;
}
