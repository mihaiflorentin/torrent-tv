import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  castInitials, EPISODE_EMPTY, EPISODE_LOADING, episodeView, infoCrumbs, infoView, SEASON_EMPTY, SEASON_LOADING, seasonCardView, seasonDetailView, SEASONS_EMPTY, SEASONS_LOADING,
  type API, type CatalogTitle, type InfoEpisode, type InfoLevel, type InfoSeasonDetail, type InfoSeasons, type TitleInfo,
} from '@torrent-tv/shared';
import { focusElement, remoteAction } from './navigation';
import { Icon } from './icons';
import { inReach, useListArtReach, type ArtReach } from './lazy-art';

// Info panel: the extended description of a title in its own focus region, so the D-pad cannot leave it.
// The top level runs Close, the summary block, the Seasons card (series), one row per cast member, then the fine print.
// The Seasons card opens a stack inside the same sheet: season list, season (episodes and cast), episode (still, credits,
// guest stars). Back pops one level and puts focus back on the row you came from; at the top it closes the panel.
// Long lists load artwork only near focus (lazy-art), because Chromium 53 ignores loading="lazy".

type Phase = 'loading' | 'ready' | 'failed';
interface Entry<T> { phase: Phase; data?: T }
interface Frame { level: InfoLevel; from: string }
/** Provider answers of this panel by level key; notify re-renders the panel when one lands. */
interface Cache { map: Map<string, Entry<unknown>>; notify: () => void }

/** Fetches one provider answer once per panel: the cache outlives a level, so Back shows the list instantly and focus can be restored. */
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

const STOP = 'info-panel';

function Avatar({ api, name, url, near }: { api: API; name: string; url?: string; near: boolean }): JSX.Element {
  return <span class="info-avatar" aria-hidden="true">{castInitials(name)}{url && near && <img src={api.streamURL(url)} alt="" loading="lazy" onError={event => { (event.currentTarget as HTMLElement).style.display = 'none' }} />}</span>;
}

function CastRow({ api, member, row, focusKey, index, reach }: { api: API; member: { name: string; character?: string; imageUrl?: string }; row: number; focusKey: string; index: number; reach: ArtReach }): JSX.Element {
  return <button class="info-stop info-cast" data-focus-region={STOP} data-focus-row={row} data-focus-col="0" data-focus-key={focusKey} data-art-index={index}>
    <Avatar api={api} name={member.name} url={member.imageUrl} near={inReach(reach, index)} />
    <span class="info-cast-copy"><b>{member.name}</b>{member.character && <small>{member.character}</small>}</span>
  </button>;
}

function Calm({ phase, loading, empty }: { phase: Phase; loading: string; empty: string }): JSX.Element {
  return phase === 'loading'
    ? <div role="status" class="info-loading"><p>{loading}</p><span class="info-skeleton" /><span class="info-skeleton short" /></div>
    : <p class="info-empty" role="status">{empty}</p>;
}

function SeasonsLevel({ api, title, cache, reach, push }: { api: API; title: CatalogTitle; cache: { current: Cache }; reach: ArtReach; push: (level: InfoLevel) => void }): JSX.Element {
  const entry = useResource<InfoSeasons>(cache, 'seasons', () => api.titleSeasons(title.id));
  const seasons = entry.data && entry.data.available ? entry.data.seasons : [];
  if (!seasons.length) return <Calm phase={entry.phase} loading={SEASONS_LOADING} empty={SEASONS_EMPTY} />;
  return <>{seasons.map((season, index) => {
    const card = seasonCardView(season);
    return <button class="info-stop info-row" data-focus-region={STOP} data-focus-row={1 + index} data-focus-col="0" data-focus-key={`info-season-${season.number}`} data-art-index={index} aria-haspopup="true" onClick={() => push({ kind: 'season', season: season.number })}>
      <span class="info-poster" aria-hidden="true">{card.initial}{season.posterUrl && inReach(reach, index) && <img src={api.streamURL(season.posterUrl)} alt="" loading="lazy" onError={event => { (event.currentTarget as HTMLElement).style.display = 'none' }} />}</span>
      <span class="info-row-copy"><b>{card.name}</b>{card.meta && <small>{card.meta}</small>}</span>
      <Icon name="chevron-right" class="info-chevron" />
    </button>;
  })}</>;
}

function SeasonLevel({ api, title, season, cache, reach, push }: { api: API; title: CatalogTitle; season: number; cache: { current: Cache }; reach: ArtReach; push: (level: InfoLevel) => void }): JSX.Element {
  const entry = useResource<InfoSeasonDetail>(cache, `season-${season}`, () => api.seasonInfo(title.id, season));
  const view = seasonDetailView(entry.data);
  if (!view.hasDetails) return <Calm phase={entry.phase} loading={SEASON_LOADING} empty={SEASON_EMPTY} />;
  const detail = entry.data!;
  let row = 1;
  let art = 0;
  return <>
    {(view.overview || view.meta.length > 0) && <button class="info-stop info-summary" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key="info-season-summary">
      {view.meta.length > 0 && <span class="info-meta">{view.meta.join(' · ')}</span>}
      {view.overview && <span class="info-overview">{view.overview}</span>}
    </button>}
    {view.episodes.length > 0 && <h3 class="info-subheading">Episodes</h3>}
    {view.episodes.map((episode, index) => {
      const source = detail.episodes[index];
      const at = art++;
      return <button class="info-stop info-row" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key={`info-episode-${episode.number}`} data-art-index={at} aria-haspopup="true" onClick={() => push({ kind: 'episode', season, episode: episode.number })}>
        <span class="info-still-small" aria-hidden="true">{source.stillUrl && inReach(reach, at) && <img src={api.streamURL(source.stillUrl)} alt="" loading="lazy" onError={event => { (event.currentTarget as HTMLElement).style.display = 'none' }} />}</span>
        <span class="info-row-copy"><b>{`${episode.short} · ${episode.title}`}</b>{episode.meta && <small>{episode.meta}</small>}</span>
        <Icon name="chevron-right" class="info-chevron" />
      </button>;
    })}
    {view.cast.length > 0 && <h3 class="info-subheading">Cast</h3>}
    {view.cast.map((member, index) => <CastRow api={api} member={member} row={row++} focusKey={`info-season-cast-${index}`} index={art++} reach={reach} />)}
  </>;
}

function EpisodeLevel({ api, title, season, episode, cache, reach }: { api: API; title: CatalogTitle; season: number; episode: number; cache: { current: Cache }; reach: ArtReach }): JSX.Element {
  const parent = cache.current.map.get(`season-${season}`) as Entry<InfoSeasonDetail> | undefined;
  const listed = parent && parent.data ? parent.data.episodes.find(item => item.number === episode) : undefined;
  // Providers that leave the synopsis to a per-episode call (MyAnimeList) are asked once, on first open.
  const lazy = useResource<InfoEpisode | undefined>(cache, `episode-${season}-${episode}`, () => listed && listed.lazyDetail ? api.episodeInfo(title.id, season, episode) : Promise.resolve(undefined));
  const detail: InfoEpisode | undefined = lazy.data ? { ...listed, ...lazy.data } : listed;
  const view = episodeView(season, detail);
  if (!detail) return <Calm phase={lazy.phase} loading={EPISODE_LOADING} empty={EPISODE_EMPTY} />;
  let row = 1;
  return <>
    <button class="info-stop info-summary info-episode" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key="info-episode-summary">
      {detail.stillUrl && <span class="info-still" aria-hidden="true"><img src={api.streamURL(detail.stillUrl)} alt="" onError={event => { (event.currentTarget as HTMLElement).style.display = 'none' }} /></span>}
      <span class="info-meta">{[view.code].concat(view.meta).join(' · ')}</span>
      <span class="info-episode-title">{view.title}</span>
      {view.badges.length > 0 && <span class="info-genres">{view.badges.join(' · ')}</span>}
      {view.overview && <span class="info-overview">{view.overview}</span>}
      {view.credits.map(credit => <span class="info-credit-line"><b>{credit.label}</b> {credit.names}</span>)}
    </button>
    {lazy.phase === 'loading' && listed && listed.lazyDetail && <div role="status" class="info-loading"><p>{EPISODE_LOADING}</p></div>}
    {!view.hasDetails && lazy.phase !== 'loading' && <p class="info-empty" role="status">{EPISODE_EMPTY}</p>}
    {view.guests.length > 0 && <h3 class="info-subheading">Guest stars</h3>}
    {view.guests.map((member, index) => <CastRow api={api} member={member} row={row++} focusKey={`info-guest-${index}`} index={index} reach={reach} />)}
  </>;
}

export function TitleInfoPanel({ api, title, onClose }: { api: API; title: CatalogTitle; onClose: () => void }): JSX.Element {
  const [info, setInfo] = useState<TitleInfo | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [stack, setStack] = useState<Frame[]>([]);
  const stackRef = useRef<Frame[]>([]);
  const restoreKey = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [, setTick] = useState(0);
  const cache = useRef<Cache>({ map: new Map(), notify: () => setTick(count => count + 1) });
  const art = useListArtReach();
  const artRef = useRef(art);
  artRef.current = art;
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    api.titleInfo(title.id).then(value => { if (live) { setInfo(value); setPhase('ready') } }, () => { if (live) setPhase('failed') });
    return () => { live = false };
  }, [title.id]);

  const push = (level: InfoLevel) => {
    const active = document.activeElement as HTMLElement | null;
    const from = active && active.dataset ? active.dataset.focusKey || '' : '';
    stackRef.current = stackRef.current.concat([{ level, from }]);
    setStack(stackRef.current);
  };
  const pop = () => {
    const frames = stackRef.current;
    if (!frames.length) { closeRef.current(); return }
    restoreKey.current = frames[frames.length - 1].from;
    stackRef.current = frames.slice(0, -1);
    setStack(stackRef.current);
  };
  const popRef = useRef(pop);
  popRef.current = pop;

  useEffect(() => {
    const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="info-close"]')), 0);
    const key = (event: KeyboardEvent) => { if (remoteAction(event.key, event.keyCode) !== 'back') return; event.preventDefault(); event.stopImmediatePropagation(); popRef.current() };
    // Artwork follows focus: the list window grows to the focused row.
    const focused = (event: FocusEvent) => {
      const row = (event.target as HTMLElement | null)?.closest?.('[data-art-index]') as HTMLElement | null;
      if (row) artRef.current.focus(Number(row.dataset.artIndex));
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focused);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focused) };
  }, []);

  // Each level change restarts the artwork window and lands focus: back on the row the level was opened from, or
  // on the new level's first stop (the Close/Back buttons while its data is still loading).
  useEffect(() => {
    artRef.current.reset();
    const timer = window.setTimeout(() => {
      const wanted = restoreKey.current;
      restoreKey.current = null;
      const target = wanted ? document.querySelector<HTMLElement>(`.info-panel [data-focus-key="${wanted}"]`) : null;
      if (target) { focusElement(target); return }
      if (scroll.current) scroll.current.scrollTop = 0;
      const first = document.querySelector<HTMLElement>('.info-scroll [data-focus-key]');
      if (stackRef.current.length && first) focusElement(first);
      else focusElement(document.querySelector<HTMLElement>(stackRef.current.length ? '[data-focus-key="info-back"]' : '[data-focus-key="info-close"]'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stack.length]);

  // A level's data arrives after focus landed on Close: move into the list, but never steal focus from a row already focused.
  useEffect(() => {
    if (!stack.length) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active.closest && active.closest('.info-scroll')) return;
    const first = document.querySelector<HTMLElement>('.info-scroll [data-focus-key]');
    if (first) focusElement(first);
  });

  const view = infoView(info);
  const top = stack.length ? stack[stack.length - 1].level : null;
  const crumbs = infoCrumbs(title.title, stack.map(frame => frame.level));
  // The catalog card already knows a description; keep showing it when the provider has nothing more.
  const overview = view.overview || (!view.hasDetails ? title.overview || '' : '');
  const empty = phase !== 'loading' && !view.hasDetails;
  const summary = Boolean(view.tagline || overview || view.meta.length || view.genres.length);
  let row = 1;
  return <section role="dialog" aria-modal="true" aria-labelledby="tv-info-heading" class="info-panel">
    <div class="info-sheet">
      <header class="info-head">
        <h2 id="tv-info-heading">{title.title}</h2>
        {top && <button data-focus-region={STOP} data-focus-row="0" data-focus-col="0" data-focus-key="info-back" onClick={pop}><Icon name="chevron-left" />Back</button>}
        <button data-focus-region={STOP} data-focus-row="0" data-focus-col={top ? 1 : 0} data-focus-key="info-close" onClick={onClose}>Close</button>
      </header>
      {top && <p class="info-crumbs" aria-label="You are here">{crumbs.join(' › ')}</p>}
      <div class="info-scroll" ref={scroll}>
        {!top && <>
          {phase === 'loading' && <div role="status" class="info-loading"><p>Loading details…</p><span class="info-skeleton" /><span class="info-skeleton short" /><span class="info-skeleton" /></div>}
          {empty && <p class="info-empty" role="status">No extra details available</p>}
          {summary && <button class="info-stop info-summary" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key="info-summary">
            {view.meta.length > 0 && <span class="info-meta">{view.meta.join(' · ')}</span>}
            {view.tagline && <span class="info-tagline">{view.tagline}</span>}
            {overview && <span class="info-overview">{overview}</span>}
            {view.genres.length > 0 && <span class="info-genres">{view.genres.join(' · ')}</span>}
          </button>}
          {view.credits.map(credit => <p class="info-credit"><b>{credit.label}</b> {credit.names}</p>)}
          {view.seasons && <button class="info-stop info-seasons" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key="info-seasons" aria-haspopup="true" onClick={() => push({ kind: 'seasons' })}>
            <span class="info-row-copy"><b>{view.seasons.label}</b><small>{view.seasons.value}</small></span>
            <Icon name="chevron-right" class="info-chevron" />
          </button>}
          {view.cast.length > 0 && <h3 class="info-subheading">Cast</h3>}
          {view.cast.map((member, index) => <CastRow api={api} member={member} row={row++} focusKey={`info-cast-${index}`} index={index} reach={art.reach} />)}
          {view.fine.length > 0 && <button class="info-stop info-fine" data-focus-region={STOP} data-focus-row={row++} data-focus-col="0" data-focus-key="info-fine">{view.fine.map(entry => <span><b>{entry.label}</b> {entry.value}</span>)}</button>}
        </>}
        {top && top.kind === 'seasons' && <SeasonsLevel api={api} title={title} cache={cache} reach={art.reach} push={push} />}
        {top && top.kind === 'season' && <SeasonLevel api={api} title={title} season={top.season} cache={cache} reach={art.reach} push={push} />}
        {top && top.kind === 'episode' && <EpisodeLevel api={api} title={title} season={top.season} episode={top.episode} cache={cache} reach={art.reach} />}
      </div>
    </div>
  </section>;
}
