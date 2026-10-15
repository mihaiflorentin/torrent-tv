import { render, type ComponentChild, type ComponentChildren } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { homeHero, homeRowItems, homeRowSpecs, clearRecentSearches, deviceStorage, loadRecentSearches, recordRecentSearch, audioPlaybackRoute, bestSourceForDetail, playActionLabel, rankSources, buildPath, canonicalHouseholdItems, CatalogDetail, CatalogEpisode, CatalogSource, CatalogTitle, clampVolume, ControlsVisibility, clearPortalSession, Download, DownloadTransferAction, eventPayload, formatBytes, HouseholdItem, HouseholdState, languageDisplayName, LibraryCategory, loadPlayerSettings, loadPortalSession, logicalPlaybackPosition, MediaAudioTrack, MediaInfo, MediaState, canonicalLanguage, PortalSessionStorage, PortalState, PortalSync, PortalUser, autoSubtitleOrder, subtitleItemDetail, subtitlePreferenceLanguage, parsePath, PlaybackPreferences, preferredAudioTrack, reconcileDownloads, Route, resumeActionLabel, resumeForTitle, resumeSummary, savePlayerSettings, seasonPackActionLabel, SettingsField, SubtitleCandidate, subtitleItemLabel, subtitleMenuGroups, SubtitleWarning, TrackerStatus, UpdateStatus, View } from '@torrent-tv/shared';
import { applyVolumeStep, fractionTarget, resolveEscape, resolveShortcut, ScrubCoalescer, seekTarget, type PlayerCommand } from './shortcuts';
import { attachCompatStream, compatStreamSupported, type CompatStream } from './compat-stream';
import { OsdLayer, type OsdFeedback } from './osd';
import { CacheCoverage, Events, Settings } from './settings';
import { TrackerBadge, trackerSourceKey } from './tracker-badge';
import { Icon } from './icons';
import { BackdropLayer, backdropArtFor, setBackdropArt } from './backdrop';
import { PlayerReady, PrepareElapsed } from './getting-ready';
import { cardFacts, episodeCode, formatClock as formatPlaybackTime, libraryProgress, playerTitle, resumeLine, sourceSpec, titleFacts, episodeFacts } from './presentation';
import { captureDownloadAnchor, Downloads, restoreDownloadAnchor } from './downloads';
import { Jobs } from './jobs';
import { ProjectsPage } from './projects';
import { PortalAccountDialog, PortalSidebarDock, UpdateApplyConfirm, UpdateNotice, UpdateSection, useUpdateController } from './portal';
import { sharedApi } from './shared-api';
import { TitleInfoDialog } from './info';
import '@torrent-tv/shared/design/fonts.css';
import '@torrent-tv/shared/design/tokens.css';
import './style.css';

const api = sharedApi();
type ActivePlayer = { download: Download; resumeMs: number; preferences?: PlaybackPreferences };
type DetailTarget = { season?: number; episode?: number };
// The address bar mirrors the view: sidebar navigation pushes an entry,
// search submissions replace in place, and popstate restores from the URL.
// App-pushed entries carry a marker, so closing an overlay can go back in
// history when the current entry is one of ours; a cold-loaded overlay URL
// is instead replaced with the section route.
function pushRoute(route: Route): boolean { const url = buildPath(route); if (location.pathname + location.search === url) return false; window.history.pushState({ filelist: true }, '', url); return true }
function replaceRoute(route: Route) { const url = buildPath(route); if (location.pathname + location.search !== url) window.history.replaceState({ filelist: true }, '', url) }
const emptyState: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const needsEpisodeExpansion = (detail: CatalogDetail) => detail.title.kind === 'series' && detail.seasons.some(season => (season.packSources?.length || 0) > 0 && season.episodes.length === 0);
function audioTrackLabel(track: MediaAudioTrack) { const language = languageDisplayName(track.language || '') || track.language?.toUpperCase() || 'Language unavailable'; const channels = track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : track.channels && track.channels > 2 ? `${track.channels} channels` : ''; return [track.title, language, track.codec?.toUpperCase(), channels].filter(Boolean).join(' · ') }
// The compatibility stream is a live ffmpeg transcode (video copied, audio
// converted to AAC) served as fragmented MP4. It exists for codecs the
// browser cannot decode (E-AC-3 in most releases). A live transcode is not
// range-addressable, so seeking re-issues the request at the new position.
export function browserPlaybackURL(download: Download, audioTrack = -1, startMs = 0, snapped = false) {
  if (!download.browserStreamUrl) return download.streamUrl;
  const value = new URL(download.browserStreamUrl, location.origin);
  if (audioTrack >= 0) value.searchParams.set('audioTrack', String(audioTrack));
  if (startMs > 0) value.searchParams.set('startMs', String(Math.round(startMs)));
  // startMs is already a keyframe: the server skips its own probe.
  if (snapped) value.searchParams.set('snapped', '1');
  return `${value.pathname}${value.search}`;
}
// Deep links: the player entry records the Managed download, the Source file
// index it plays, and the resume position (only when actually resuming) so a
// refresh or a shared link lands back in the same playback.
export function watchRoute(download: Download, resumeMs: number): Route {
  return { view: 'watch', id: download.id, source: download.fileIndex >= 0 ? download.fileIndex : undefined, t: resumeMs > 0 ? resumeMs : undefined };
}
// Storage access itself can throw or be missing (blocked cookies, odd embeds,
// non-browser runs); the player then runs with defaults and no persistence
// instead of crashing.
function persistedStore(): PortalSessionStorage { try { const store = localStorage; if (store) return store } catch { } return { getItem: () => null, setItem: () => { }, removeItem: () => { } } }
function permanentPersistenceFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return error.status === 404 || error.status === 409;
}
const MAX_RECOVER_ATTEMPTS = 3;
type NavItem = { id?: View; label: string; icon: string; href?: string };
const navGroups: { label?: string; items: NavItem[] }[] = [
  { items: [{ id: 'home', label: 'Home', icon: 'home' }, { id: 'search', label: 'Search', icon: 'search' }] },
  { label: 'My Library', items: [{ id: 'library', label: 'Dashboard', icon: 'library' }, { id: 'continue', label: 'Continue watching', icon: 'play' }, { id: 'favorites', label: 'My List', icon: 'heart' }, { id: 'watched', label: 'Watched', icon: 'check' }, { id: 'downloads', label: 'Downloads', icon: 'download' }, { id: 'library-categories', label: 'Categories', icon: 'folder' }] },
  { label: 'Tracker', items: [{ id: 'tracker', label: 'Dashboard', icon: 'tracker' }, { id: 'browse', label: 'Browse', icon: 'grid' }, { id: 'categories', label: 'Categories', icon: 'folder' }] },
  { items: [{ id: 'jobs', label: 'Jobs', icon: 'activity' }, { id: 'events', label: 'Events', icon: 'tracker' }, { id: 'projects', label: 'Projects', icon: 'link' }, { label: 'Bug Report', icon: 'bug', href: 'https://github.com/mihaiflorentin/torrent-tv/issues' }, { id: 'settings', label: 'Settings', icon: 'settings' }] },
];


function Sidebar({ view, onView, dock }: { view: View; onView: (view: View) => void; dock?: ComponentChild }) {
  return <aside class="sidebar"><div class="brand"><span class="brand-mark" aria-hidden="true">TT</span><strong>Torrent <span>TV</span></strong></div><nav aria-label="Main navigation">{navGroups.map((group, index) => <div class="nav-group" key={index}>{group.label && <p>{group.label}</p>}{group.items.map(item => <button type="button" title={item.label} class={view === item.id ? 'selected' : ''} onClick={() => { if (item.href) { window.open(item.href, '_blank', 'noopener,noreferrer') } else if (item.id) { onView(item.id) } }} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} /><span class="nav-label">{item.label}</span></button>)}</div>)}</nav>{dock}</aside>;
}

function Artwork({ title, kind = 'poster' }: { title: CatalogTitle; kind?: 'poster' | 'backdrop' }) {
  const url = kind === 'poster' ? title.posterUrl : title.backdropUrl;
  return url ? <img src={url} alt="" loading="lazy" /> : <div class="art-fallback"><span>{title.title.slice(0, 1).toUpperCase()}</span></div>;
}

// Poster card: what is this and where am I with it. Poster, title, year and
// library state lead; best resolution and the rating (once) follow. Seeders,
// trackers and source counts stay off the card, except on a row defined by
// seeders. Focus or hover hands the title's artwork to the backdrop layer.
function MediaCard({ title, onOpen, wide = false, progress, showSeeders = false }: { title: CatalogTitle; onOpen: (title: CatalogTitle) => void; wide?: boolean; progress?: number; showSeeders?: boolean }) {
  const art = backdropArtFor(title);
  const follow = () => setBackdropArt(art);
  return <button class={`media-card ${wide ? 'wide' : ''}`} onClick={() => onOpen(title)} onPointerEnter={follow} onFocus={follow} aria-label={`Open ${title.title}`}><div class="card-art"><Artwork title={title} kind={wide ? 'backdrop' : 'poster'} /><MediaBadges state={title.libraryState} />{progress !== undefined && <span class="card-progress"><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></span>}</div><span class="card-copy"><strong>{title.title}</strong><small>{cardFacts(title, { showSeeders }).join(' · ')}</small></span></button>;
}

// Continue watching and Library cards: artwork, title, episode code and a
// progress bar with "41% watched" or "Watched"; the year is secondary. Release
// names, file paths and trackers stay out, except for a raw release with no
// catalog match, where the release name is the only title there is.
function LegacyCard({ item, onOpen }: { item: HouseholdItem; onOpen: (item: HouseholdItem) => void }) {
  if (item.catalog) {
    const { percent, label } = libraryProgress(item);
    const state = [episodeCode(item.seasonNumber, item.episodeNumber), label].filter(Boolean).join(' · ');
    const art = backdropArtFor(item.catalog);
    const follow = () => setBackdropArt(art);
    return <button class="media-card wide library-card" onClick={() => onOpen(item)} onPointerEnter={follow} onFocus={follow} aria-label={`Open ${item.catalog.title}`}><div class="card-art"><Artwork title={item.catalog} kind="backdrop" />{percent > 0 && <span class="card-progress"><i style={{ width: `${percent}%` }} /></span>}</div><span class="card-copy"><strong>{item.catalog.title}</strong>{state && <small class="library-card-state">{state}</small>}{item.catalog.year ? <small>{item.catalog.year}</small> : null}</span></button>;
  }
  return <button class="media-card wide raw" onClick={() => onOpen(item)}><div class="art-fallback"><span>{item.release.name.slice(0, 1)}</span></div><span class="card-copy"><strong>{item.release.name}</strong><small>{formatBytes(item.release.sizeBytes)}</small></span></button>;
}

function MediaBadges({ state }: { state?: MediaState }) { if (!state?.downloadState || !state.watchState) return null; const download = state.downloadState; const watch = state.watchState; return <span class="media-badges">{download !== 'none' && <span class={`media-badge download ${download}`} title={download === 'downloaded' ? 'Downloaded' : download === 'partial' ? 'Some episodes downloaded' : download === 'error' ? 'Download needs attention' : `Downloading ${Math.round((state.progress || 0) * 100)}%`}><Icon name={download === 'downloaded' ? 'check' : 'download'} /><span>{download === 'downloaded' ? 'Downloaded' : download === 'partial' ? 'Partial' : download === 'error' ? 'Error' : `${Math.round((state.progress || 0) * 100)}%`}</span></span>}{watch !== 'unwatched' && <span class={`media-badge watch ${watch}`} title={watch === 'watched' ? 'Watched' : watch === 'partial' ? 'Some episodes watched' : 'In progress'}><Icon name={watch === 'watched' ? 'check' : 'clock'} /><span>{watch === 'watched' ? 'Watched' : watch === 'partial' ? 'Part watched' : 'In progress'}</span></span>}</span> }


export function Rail({ title, children, empty, landscape = false, onNearEnd }: { title: string; children: ComponentChildren; empty?: string; landscape?: boolean; onNearEnd?: () => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  // A single child arrives unwrapped; normalizing here keeps the empty check
  // and the render identical to the array case.
  const list = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const hasRail = list.length > 0;
  const [arrows, setArrows] = useState({ left: false, right: false });
  // Latest callback without re-wiring the listeners below on every render.
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;
  // A vertical wheel over an overflowing rail scrolls the rail: the dominant
  // gesture for row scrolling, which the browser otherwise spends on the page.
  // Horizontal deltas keep native behavior; a rail at either edge declines the
  // event so the page keeps scrolling (no scroll trap). The < > arrows page by
  // a full rail width; each direction renders only while it can still move.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth;
      setArrows({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY));
      if (next === el.scrollLeft) return;
      el.scrollLeft = next;
      event.preventDefault();
    };
    const onScroll = () => {
      sync();
      const load = nearEnd.current;
      if (!load) return;
      const max = el.scrollWidth - el.clientWidth;
      // Within a page width of the end, ask for more content so the rail
      // keeps paging instead of running out.
      if (max > 0 && el.scrollLeft >= max - el.clientWidth) load();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    observer?.observe(el);
    sync();
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [hasRail]);
  // Paginator step: one full rail width so consecutive pages tile the list
  // without skipped cards.
  const page = (direction: -1 | 1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth, behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <section class="rail-section"><div class="section-heading"><h2>{title}</h2></div>{!hasRail ? <p class="empty">{empty || 'Nothing here yet.'}</p> : <div class="rail-wrap"><div ref={railRef} class={`rail ${landscape ? 'landscape' : ''}`}>{list}</div>{arrows.left && <button type="button" class="rail-arrow left" aria-label={`Scroll ${title} back`} onClick={() => page(-1)}><Icon name="chevron-left" /></button>}{arrows.right && <button type="button" class="rail-arrow right" aria-label={`Scroll ${title} forward`} onClick={() => page(1)}><Icon name="chevron-right" /></button>}</div>}</section>;
}

// Shared modal focus machinery: inert the page background, move focus into
// the surface, Tab-cycle inside it, and restore focus on teardown. Escape is
// an explicit per-caller policy: surfaces that own Escape pass onEscape
// (preventDefault, then invoke); surfaces whose Escape belongs to another
// chain omit it and get a Tab-only trap.
function trapFocus(surface: () => HTMLElement | null, focusableSelector: string, background: (surface: HTMLElement | null) => HTMLElement[], onEscape?: () => void): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const root = surface();
  const inertElements = background(root);
  inertElements.forEach(element => element.setAttribute('inert', ''));
  const focusable = () => Array.from(surface()?.querySelectorAll<HTMLElement>(focusableSelector) || []);
  const timer = window.setTimeout(() => focusable()[0]?.focus(), 0);
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { if (!onEscape) return; event.preventDefault(); onEscape(); return }
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
  };
  document.addEventListener('keydown', key);
  return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key); inertElements.forEach(element => element.removeAttribute('inert')); previous?.focus() };
}

// Tab-trap only: the player's resolveEscape chain owns Escape (fullscreen →
// panel → hide-chrome → close), so no onEscape is declared here. The surface
// is a controls-bearing <video>, a legitimate Tab stop plain overlays lack.
function useModalFocus(root: { current: HTMLElement | null }) {
  useEffect(() => trapFocus(() => root.current, 'button:not([disabled]),input:not([disabled]),select:not([disabled]),video[controls],[tabindex]:not([tabindex="-1"])', () => Array.from(document.querySelectorAll<HTMLElement>('.sidebar,.content'))), []);
}

function useOverlayFocus(active: boolean, onClose: () => void) {
  // Escape runs the latest onClose: consumers capture state (the Downloads
  // removal confirm stays open while a removal is in flight), so the listener
  // registered when the overlay opened must not go stale.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    // The trap follows the topmost overlay: nested overlays (detail → source
    // picker) cycle within the one actually on top.
    const surface = () => { const overlays = document.querySelectorAll<HTMLElement>('.overlay'); return overlays[overlays.length - 1] || null };
    return trapFocus(surface, 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', overlay => Array.from(document.querySelectorAll<HTMLElement>('.sidebar,.content')).filter(element => !overlay || !element.contains(overlay)), () => closeRef.current());
  }, [active]);
}

// Seek commands before the media's duration is known cannot compute a target.
const seekUnavailableHint = 'Seek unavailable — still reading the media.';

export function BrowserPlayer({ active, onClose, onStateChanged, onAdvance, onSkip }: { active: ActivePlayer; onClose: () => void; onStateChanged: () => void; onAdvance: (preferences: PlaybackPreferences) => Promise<void>; onSkip?: (direction: 'next' | 'previous', preferences: PlaybackPreferences) => Promise<boolean> }) {
  const defaults: PlaybackPreferences = { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' };
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(0);
  const lastRendered = useRef(0);
  const retryTimer = useRef(0);
  const mediaRetryTimer = useRef(0);
  const recovering = useRef(false);
  const recoverAttempts = useRef(0);
  const saveFailed = useRef(false);
  const shouldPlay = useRef(true);
  const preferenceRef = useRef<PlaybackPreferences>(active.preferences || defaults);
  const attemptedSubtitles = useRef<Set<string>>(new Set());
  const durationRef = useRef(0);
  const [message, setMessage] = useState('Reading media details…');
  const [osd, setOsd] = useState<OsdFeedback | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedAudio, setSelectedAudio] = useState(-1);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The element reported it is waiting for data: with the opening phase, this is when the getting-ready panel shows.
  const [stalled, setStalled] = useState(false);
  // Volume and mute persist per browser (localStorage): loaded once per mount,
  // saved on every change, applied to whichever audio route is active.
  const [volume, setVolume] = useState(() => loadPlayerSettings(persistedStore()).volume);
  const [muted, setMuted] = useState(() => loadPlayerSettings(persistedStore()).muted);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const [warnings, setWarnings] = useState<SubtitleWarning[]>([]);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  // Content position at the head of the current compatibility stream. The
  // element's clock starts at zero for that request, so the logical position
  // is offset + element.currentTime (see logicalPlaybackPosition).
  const offsetRef = useRef(0);
  // Whether offsetRef holds a probed keyframe; forwards snapped=1 so the
  // stream route skips its own probe.
  const snappedRef = useRef(false);
  const [streamOffset, setStreamOffset] = useState(0);
  // True while a compatibility re-request is in flight; suppresses buffering
  // chatter and recovery for the reload window.
  const reloading = useRef(false);
  // Original VTT cue times so offset re-syncs shift from truth, not drift.
  const cueTimes = useRef(new Map<TextTrackCue, { start: number; end: number }>());
  // Pending element seek applied on the next loadedmetadata (track switches
  // that move between native and compatibility routes).
  const pendingSeekRef = useRef(-1);
  // Shortcut transport: the pending scrub commit target (non-null while a
  // coalesced seek is in flight) and the latest restartAt for the coalescer's
  // stable commit callback.
  const scrub = useRef<ScrubCoalescer | null>(null);
  const restartAtRef = useRef<(targetMs: number) => void>(() => { });
  restartAtRef.current = restartAt;
  const compatRef = useRef<CompatStream | null>(null);
  const [compatGeneration, setCompatGeneration] = useState(0);
  const [compatFallback, setCompatFallback] = useState(false);
  const [selectedSubtitle, setSelectedSubtitle] = useState('off');
  const [controlsVisible, setControlsVisible] = useState(true);
  const controls = useMemo(() => new ControlsVisibility({ policy: { armWhilePaused: true, statusHolds: true, manualHideSuppressionMs: 500 }, onChange: setControlsVisible }), []);
  controls.setStatus(message !== '');
  controls.setPanelOpen(subtitleOpen || audioOpen);
  useModalFocus(root);
  const currentTrack = mediaInfo?.audioTracks.find(track => track.streamIndex === selectedAudio);
  const audioChoice = currentTrack ? ` · ${languageDisplayName(currentTrack.language || '') || currentTrack.title || 'Track'}` : '';
  const chosenSubtitle = candidates.find(candidate => `${candidate.provider}:${candidate.id}` === selectedSubtitle);
  const subtitleChoice = selectedSubtitle === 'off' ? ' · Off' : chosenSubtitle ? ` · ${languageDisplayName(chosenSubtitle.language) || chosenSubtitle.language || 'On'}` : '';
  const browserMode = !!currentTrack && !!mediaInfo && (audioPlaybackRoute(currentTrack.codec) === 'decode' || (mediaInfo.audioTracks.length > 1 && !currentTrack.default));
  // The compatibility transcode is appended through MediaSource (see
  // compat-stream.ts): <video src> cannot carry an unbounded fragmented MP4 —
  // Chromium derives a bogus few-seconds duration, stops fetching at fragment
  // boundaries, and playback stalls every few seconds.
  const mseMode = browserMode && !compatFallback && compatStreamSupported();
  const playbackURL = useMemo(() => {
    if (!mediaInfo) return '';
    if (browserMode) return browserPlaybackURL(active.download, selectedAudio, streamOffset, snappedRef.current);
    return active.download.streamUrl;
  }, [active.download.id, mediaInfo, browserMode, selectedAudio, streamOffset]);
  const subtitlePositions = useMemo(() => new Map(candidates.map((candidate, index) => [candidate, index + 1])), [candidates]);
  const subtitleGroups = useMemo(() => subtitleMenuGroups(candidates), [candidates]);
  const save = async () => {
    if (durationRef.current <= 0 || saveFailed.current) return;
    try {
      await api.updatePlayback(active.download.id, logicalPlaybackPosition(offsetRef.current, video.current?.currentTime || 0, durationRef.current), durationRef.current);
      onStateChanged()
    } catch (error) {
      // Position persistence is best-effort: a missing source (404) or a permanent
      // update conflict (409) ends it for this playback instead of hammering the
      // endpoint every ten seconds; transient failures keep the 10s cadence.
      if (permanentPersistenceFailure(error)) saveFailed.current = true;
    }
  };
  const savePreferences = async (value: PlaybackPreferences) => { preferenceRef.current = value; try { preferenceRef.current = await api.updatePlaybackPreferences(active.download.id, value) } catch { } };
  // Attach the MediaSource pipeline for the compatibility transcode. Seeking
  // re-issues the stream URL (playbackURL changes), and a recovery retry bumps
  // compatGeneration — both re-run this effect, which is the reload model.
  useEffect(() => {
    if (!mseMode || !playbackURL || !mediaInfo || !video.current) return;
    const element = video.current;
    const stream = attachCompatStream(element, api.streamURL(playbackURL), mediaInfo.durationMs, reason => {
      // A broken pipeline falls back to the plain source for the rest of this
      // playback instead of looping on the same failure.
      setCompatFallback(true);
      setMessage(reason);
    });
    compatRef.current = stream;
    if (!stream) return;
    if (shouldPlay.current) void element.play().catch(() => setMessage('Press Play to start playback.'));
    return () => {
      stream.stop();
      compatRef.current = null;
    };
  }, [mseMode, playbackURL, mediaInfo, compatGeneration]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [saved, info] = await Promise.all([active.preferences ? Promise.resolve(active.preferences) : api.playbackPreferences(active.download.id).catch(() => defaults), api.mediaInfo(active.download.id)]);
        if (cancelled) return;
        preferenceRef.current = saved;
        recoverAttempts.current = 0;
        saveFailed.current = false;
        durationRef.current = info.durationMs;
        const track = preferredAudioTrack(info.audioTracks, saved);
        const initial = Math.min(Math.max(0, active.resumeMs), Math.max(0, info.durationMs - 1000));
        setMediaInfo(info);
        setPosition(initial);
        const chosen = track;
        const useBrowser = !!chosen && (audioPlaybackRoute(chosen.codec) === 'decode' || (info.audioTracks.length > 1 && !chosen.default));
        offsetRef.current = 0;
        snappedRef.current = false;
        if (useBrowser && initial > 0) {
          // The route snaps seeks onto a video keyframe; clock and subtitle
          // offsets must use that effective start, not the requested one.
          try { const snap = await api.snapStreamStart(active.download.id, initial); offsetRef.current = snap.startMs; snappedRef.current = snap.snapped } catch { offsetRef.current = initial }
        }
        setStreamOffset(offsetRef.current);
        setSelectedAudio(track?.streamIndex ?? -1);
        setMessage('Opening stream…');
      } catch (error) {
        if (cancelled) return;
        setMessage(`Preparing media details… ${(error as Error).message}`);
        mediaRetryTimer.current = window.setTimeout(() => void load(), 2000);
      }
    }
    void load();
    return () => { cancelled = true; window.clearTimeout(mediaRetryTimer.current) };
  }, [active.download.id]);

  useEffect(() => () => { window.clearTimeout(retryTimer.current); if (clickTimer.current) window.clearTimeout(clickTimer.current); scrub.current?.cancel(); void save() }, [active.download.id]);
  // Subtitle cues carry content-time timestamps; the compatibility stream's
  // element clock starts at the requested offset, so shift cues to match.
  function syncSubtitleOffset(offset: number) {
    video.current?.querySelectorAll<HTMLTrackElement>('track[data-filelist]').forEach(element => {
      for (const cue of Array.from(element.track?.cues || [])) {
        let original = cueTimes.current.get(cue);
        if (!original) { original = { start: cue.startTime, end: cue.endTime }; cueTimes.current.set(cue, original) }
        cue.startTime = Math.max(0, original.start - offset / 1000);
        cue.endTime = Math.max(cue.startTime + .01, original.end - offset / 1000);
      }
    });
  }

  // Loudness truth lives in persisted React state; this effect pushes it to
  // whichever output owns audio — the decoder gain during a decode session,
  // the element otherwise. The element's muted flag while decoding is the
  // controller's implementation detail and is never mirrored back into the
  // UI (that mirror used to show 0 while the decoder played at full gain).
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.volume = volume; element.muted = muted;
  }, [volume, muted]);
  useEffect(() => {
    let cancelled = false;
    // Every candidate is prepared at most once per playback: the ranked
    // fallback must not re-prepare the remembered pick that just failed, and
    // a failed prepare must not re-trigger while the same download plays.
    attemptedSubtitles.current = new Set();
    const attempt = async (candidate: SubtitleCandidate, persist: boolean) => {
      const key = `${candidate.provider}:${candidate.id}`;
      if (attemptedSubtitles.current.has(key)) return false;
      attemptedSubtitles.current.add(key);
      return chooseSubtitle(candidate, true, persist);
    };
    void (async () => {
      try {
        const saved = active.preferences || await api.playbackPreferences(active.download.id);
        if (cancelled) return;
        preferenceRef.current = saved;
        const page = await api.subtitles(active.download.id, saved.subtitleLanguage || 'ro', 'all');
        if (cancelled) return;
        setCandidates(page.items); setWarnings(page.warnings || []);
        if (saved.subtitleMode === 'off') { disableSubtitles(false); return }
        if (saved.subtitleMode === 'selected' && saved.subtitleProvider && saved.subtitleCandidateId) {
          const remembered = page.items.find(candidate => candidate.provider === saved.subtitleProvider && candidate.id === saved.subtitleCandidateId);
          if (remembered && await attempt(remembered, false)) return;
        }
        const preferred = autoSubtitleOrder(page.items, { language: preferenceRef.current.subtitleLanguage || 'ro' });
        for (const candidate of preferred) if (await attempt(candidate, true)) return;
        setMessage((page.warnings || []).map(w => `${w.provider}: ${w.message}`).join(' · ') || 'No Romanian or English subtitle was found.');
      } catch (error) { if (!cancelled) setMessage(`Subtitles unavailable: ${(error as Error).message}`) }
    })();
    return () => { cancelled = true };
  }, [active.download.id]);
  // Player chrome auto-hide: the shared controller holds controls while a panel
  // or a status message is shown; otherwise 2 idle seconds hide them until the
  // next mouse move or key press, windowed and fullscreen alike.
  useEffect(() => {
    if (controlsVisible) controls.refresh();
    return () => controls.dispose();
  }, [controlsVisible, subtitleOpen, audioOpen, message, controls]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.addEventListener('mousemove', revealControls);
    // Shortcuts dispatch at document level: the player is a modal surface
    // (background inert) and focus may legitimately rest on body — e.g. right
    // after clicking the video — where a root-level listener never fires.
    document.addEventListener('keydown', onKey);
    return () => { element.removeEventListener('mousemove', revealControls); document.removeEventListener('keydown', onKey) };
  }, [onKey]);
  // Fullscreen truth: the browser can exit fullscreen without delivering the
  // key to the page, so the Escape chain follows the fullscreenchange event.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  async function chooseSubtitle(candidate: SubtitleCandidate, automatic = false, persist = true) {
    try {
      setMessage(automatic ? 'Selecting subtitles…' : 'Preparing subtitle…');
      const asset = await api.prepareSubtitle(active.download.id, candidate.provider, candidate.id, 'vtt');
      const element = document.createElement('track');
      element.kind = 'subtitles'; element.label = subtitleItemLabel(candidate, 1); element.srclang = candidate.language || 'und'; element.src = api.streamURL(asset.url); element.default = true; element.dataset.filelist = 'true';
      video.current?.querySelectorAll('track[data-filelist]').forEach(track => track.remove()); video.current?.appendChild(element);
      element.addEventListener('load', () => { if (element.track) { syncSubtitleOffset(offsetRef.current); element.track.mode = 'showing' } setSelectedSubtitle(`${candidate.provider}:${candidate.id}`); setMessage('') }, { once: true });
      element.addEventListener('error', () => setMessage('The subtitle is cached, but this browser could not load it.'), { once: true });
      setSubtitleOpen(false); root.current?.focus();
      if (persist) await savePreferences({ ...preferenceRef.current, subtitleLanguage: subtitlePreferenceLanguage(candidate.language, preferenceRef.current.subtitleLanguage), subtitleProvider: candidate.provider, subtitleCandidateId: candidate.id, subtitleMode: 'selected' });
      return true;
    } catch (error) { if (!automatic) setMessage(`Subtitle failed: ${(error as Error).message}`); return false }
  }
  function disableSubtitles(persist = true) { if (video.current) Array.from(video.current.textTracks).forEach(track => track.mode = 'disabled'); setSelectedSubtitle('off'); setSubtitleOpen(false); root.current?.focus(); if (persist) void savePreferences({ ...preferenceRef.current, subtitleMode: 'off', subtitleProvider: '', subtitleCandidateId: '' }) }
  // Playback recovery retries are bounded: after MAX_RECOVER_ATTEMPTS consecutive
  // failures the loop stops and the viewer sees a terminal message instead of the
  // player reloading the stream every two seconds forever.
  async function recover() {
    if (recovering.current || reloading.current) return;
    recovering.current = true;
    setMessage('Waiting for the next downloaded segment…');
    retryTimer.current = window.setTimeout(async () => {
      try {
        const latest = (await api.downloads()).items.find(item => item.id === active.download.id);
        if (!latest) throw new Error('The download is no longer managed.');
        setMessage(latest.playbackMode === 'progressive' ? `Streaming while downloading · ${Math.round(latest.progress * 100)}%` : 'Downloaded file ready · retrying playback…');
        if (mseMode) {
          // A MediaSource pipeline cannot survive load(): the transport is
          // re-attached instead, which restarts the stream at the same
          // stream offset.
          shouldPlay.current = true;
          setCompatGeneration(value => value + 1);
          recovering.current = false
        } else {
          video.current?.load();
          await video.current?.play();
          recovering.current = false
        }
      } catch (error) {
        recovering.current = false;
        recoverAttempts.current++;
        const detail = `Playback retry failed: ${(error as Error).message}`;
        if (recoverAttempts.current >= MAX_RECOVER_ATTEMPTS) { setMessage(`${detail} This stream is no longer available.`); return }
        setMessage(detail);
        void recover()
      }
    }, 2000)
  }
  async function restartAt(value: number) {
    if (!mediaInfo || !video.current) return;
    const target = seekTarget(value, mediaInfo.durationMs, 0);
    if (!browserMode) { video.current.currentTime = target / 1000; setPosition(target); return }
    reloading.current = true;
    let start = target;
    let snapped = false;
    try { const snap = await api.snapStreamStart(active.download.id, target); start = snap.startMs; snapped = snap.snapped } catch { }
    offsetRef.current = start;
    snappedRef.current = snapped;
    syncSubtitleOffset(start);
    setPosition(start);
    setStreamOffset(start);
  }
  async function chooseAudio(track: MediaAudioTrack) {
    if (!mediaInfo) return;
    const nextBrowser = audioPlaybackRoute(track.codec) === 'decode' || (mediaInfo.audioTracks.length > 1 && !track.default);
    if (nextBrowser || browserMode) {
      const target = logicalPlaybackPosition(offsetRef.current, video.current?.currentTime || 0, durationRef.current);
      if (nextBrowser) {
        let start = target;
        let snapped = false;
        try { const snap = await api.snapStreamStart(active.download.id, target); start = snap.startMs; snapped = snap.snapped } catch { }
        offsetRef.current = start;
        snappedRef.current = snapped;
      } else {
        offsetRef.current = 0;
        snappedRef.current = false;
      }
      pendingSeekRef.current = nextBrowser ? -1 : target;
      setStreamOffset(offsetRef.current);
    }
    setSelectedAudio(track.streamIndex);
    setAudioOpen(false);
    await savePreferences({ ...preferenceRef.current, audioTrackIndex: track.streamIndex, audioLanguage: track.language || 'en' });
  }
  function togglePlayback() { const element = video.current; if (!element) return; if (element.paused) { shouldPlay.current = true; void element.play().catch(error => setMessage(`Playback could not start: ${error.message}`)) } else { shouldPlay.current = false; element.pause() } }
  function revealControls() { controls.reveal() }
  function hideControls() { controls.hide() }
  // Mouse conventions on the video surface: single click toggles playback,
  // double click toggles fullscreen; the deferral window tells them apart.
  // Clicks on the chrome or panels never reach these handlers — they are not
  // descendants of the video element.
  const clickTimer = useRef(0);
  function onVideoClick() {
    if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = 0; return }
    clickTimer.current = window.setTimeout(() => { clickTimer.current = 0; runCommand({ kind: 'toggle-playback' }) }, 250);
  }
  function onVideoDoubleClick() {
    if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = 0 }
    void runCommand({ kind: 'toggle-fullscreen' });
  }
  // Player shortcut dispatch: resolve the keydown at the command layer and
  // execute. Bound keys are consumed with preventDefault so a focused chrome
  // button cannot double-fire; stopPropagation cannot order listeners here —
  // this handler and the focus hooks all sit on the same document node.
  // Unbound keys keep today's reveal behavior.
  function onKey(event: KeyboardEvent) {
    // Native slider/stepper keys win while a form control is focused (ARIA
    // contract); the shortcut layer stays out of the way.
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) { revealControls(); return }
    if (event.metaKey || event.ctrlKey || event.altKey) { revealControls(); return }
    const resolved = resolveShortcut(event.key, event.repeat, subtitleOpen || audioOpen);
    if (!resolved) { revealControls(); return }
    event.preventDefault();
    event.stopPropagation();
    runCommand(resolved.command);
  }
  const isSeries = active.download.parsed?.kind === 'series';
  const skipBusy = useRef(false);
  // Previous / next episode: save progress, then let the app swap the player. The app resolves false when there is none.
  async function skipEpisode(direction: 'next' | 'previous') {
    if (!isSeries || !onSkip) { setOsd({ kind: 'hint', text: `No ${direction} episode` }); return }
    if (skipBusy.current) return;
    skipBusy.current = true;
    try {
      await save();
      if (!await onSkip(direction, preferenceRef.current)) setOsd({ kind: 'hint', text: `No ${direction} episode` });
    } finally { skipBusy.current = false }
  }
  function runCommand(command: PlayerCommand) {
    if (command.kind === 'next-episode' || command.kind === 'previous-episode') { void skipEpisode(command.kind === 'next-episode' ? 'next' : 'previous'); return }
    if (command.kind === 'toggle-playback') { togglePlayback(); return }
    if (command.kind === 'toggle-mute') { toggleMuted(); setOsd({ kind: 'mute', muted: !muted }); return }
    if (command.kind === 'play') { shouldPlay.current = true; void video.current?.play().catch(() => { }); return }
    if (command.kind === 'pause' || command.kind === 'stop') { shouldPlay.current = false; if (video.current && !video.current.paused) video.current.pause(); return }
    if (command.kind === 'open-subtitles') { setSubtitleOpen(true); revealControls(); return }
    if (command.kind === 'seek-fraction') {
      if (!mediaInfo) { setOsd({ kind: 'hint', text: seekUnavailableHint }); return }
      restartAt(fractionTarget(command.fraction, mediaInfo.durationMs));
      setOsd({ kind: 'seek', fraction: command.fraction, hint: `${Math.round(command.fraction * 100)}%` });
      return;
    }
    if (command.kind === 'volume') {
      // Loudness truth lives in persisted state; ↑/↓ while muted unmutes and
      // then applies the step (sliding to zero mutes), matching the slider.
      const stepped = applyVolumeStep(volume, command.delta);
      setVolume(stepped.volume);
      setMuted(stepped.muted);
      savePlayerSettings(persistedStore(), stepped);
      setOsd({ kind: 'volume', percent: Math.round(stepped.volume * 100) }); return;
    }
    if (command.kind === 'toggle-fullscreen') { void toggleFullscreen(); return }
    if (command.kind === 'escape') {
      // Graceful exit: peel one layer per press instead of closing outright.
      const step = resolveEscape({ fullscreen, panelOpen: subtitleOpen || audioOpen, controlsVisible });
      if (step === 'exit-fullscreen') { if (document.fullscreenElement) void document.exitFullscreen().catch(() => { }); return }
      if (step === 'close-panel') { setSubtitleOpen(false); setAudioOpen(false); root.current?.focus(); return }
      if (step === 'hide-chrome') { hideControls(); return }
      onClose();
      return;
    }
    if (command.kind === 'seek') {
      if (!mediaInfo) { setOsd({ kind: 'hint', text: seekUnavailableHint }); return }
      const base = scrub.current?.target ?? position;
      const target = seekTarget(base, mediaInfo?.durationMs ?? 0, command.deltaMs);
      const hint = `${command.deltaMs > 0 ? '+' : '−'}${Math.abs(command.deltaMs) / 1000}s`;
      if (!scrub.current) scrub.current = new ScrubCoalescer(targetMs => restartAtRef.current(targetMs));
      scrub.current.nudge(target);
      setPosition(target);
      setOsd(seekOsd(target, hint));
    }
  }
  // Loudness changes update persisted React state; the sync effect pushes them
  // to the decoder or the element, and the browser store keeps them for the
  // next mount. Sliding to zero mutes, sliding up from zero unmutes.
  function setPlayerVolume(value: number) { const next = clampVolume(value); setVolume(next); setMuted(next === 0); savePlayerSettings(persistedStore(), { volume: next, muted: next === 0 }) }
  function toggleMuted() { setMuted(!muted); savePlayerSettings(persistedStore(), { volume, muted: !muted }) }
  async function toggleFullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen() } catch (error) { setMessage(`Fullscreen unavailable: ${(error as Error).message}`) } }
  function seekOsd(targetMs: number, hint: string): OsdFeedback {
    return { kind: 'seek', fraction: durationRef.current > 0 ? targetMs / durationRef.current : 0, hint };
  }
  return <div ref={root} tabindex={-1} class={`video ${controlsVisible ? 'controls-visible' : ''}`} role="dialog" aria-modal="true" aria-label={`Playing ${active.download.displayTitle || active.download.filePath}`}>
    <video ref={video} src={!mseMode && playbackURL ? api.streamURL(playbackURL) : undefined} autoplay playsInline onLoadedMetadata={event => { reloading.current = false; const pending = pendingSeekRef.current >= 0 ? pendingSeekRef.current : (!browserMode && active.resumeMs > 0 ? active.resumeMs : -1); pendingSeekRef.current = -1; if (pending > 0) event.currentTarget.currentTime = pending / 1000; if (shouldPlay.current) void event.currentTarget.play().catch(() => setMessage('Press Play to start playback.')) }} onWaiting={() => { if (!reloading.current) setStalled(true); if (!reloading.current) setMessage(active.download.playbackMode === 'progressive' ? 'Buffering the next downloaded segment…' : 'Buffering…') }} onCanPlay={() => { recovering.current = false; recoverAttempts.current = 0; setStalled(false); if (!reloading.current) setMessage('') }} onPlaying={() => { recovering.current = false; recoverAttempts.current = 0; setStalled(false); setPlaying(true); if (!reloading.current) setMessage('') }} onTimeUpdate={event => { if (scrub.current?.target != null) return; const next = logicalPlaybackPosition(offsetRef.current, event.currentTarget.currentTime, durationRef.current); const now = Date.now(); if (now - lastRendered.current >= 250) { lastRendered.current = now; setPosition(next) } if (now - lastSaved.current > 10000) { lastSaved.current = now; void save() } }} onPause={() => { setPlaying(false); void save() }} onEnded={() => void save().then(() => onAdvance(preferenceRef.current))} onError={() => void recover()} onClick={onVideoClick} onDblClick={onVideoDoubleClick} />    <div class="player-chrome">
      <div class="player-heading"><strong>{playerTitle(active.download)}</strong>{active.download.playbackMode === 'progressive' && <span class="player-note" role="status">Streaming while downloading</span>}</div>
      <div class="player-scrubber"><input aria-label="Playback position" type="range" min="0" max={mediaInfo?.durationMs || 1} step="1000" value={Math.min(position, mediaInfo?.durationMs || 1)} disabled={!mediaInfo} onInput={event => setPosition(Number(event.currentTarget.value))} onChange={event => restartAt(Number(event.currentTarget.value))} /><div><time>{formatPlaybackTime(position)}</time><time>{mediaInfo ? formatPlaybackTime(mediaInfo.durationMs) : 'Preparing…'}</time></div></div>
      <div class="player-control-row"><div class="control-group">{isSeries && onSkip && <button aria-label="Previous episode" onClick={() => void skipEpisode('previous')}>Previous episode</button>}<button class="player-play" onClick={togglePlayback}><Icon name={playing ? 'pause' : 'play'} />{playing ? 'Pause' : 'Play'}</button>{isSeries && onSkip && <button aria-label="Next episode" onClick={() => void skipEpisode('next')}>Next episode</button>}<button onClick={() => restartAt(position - 10000)} disabled={!mediaInfo}>−10 seconds</button><button onClick={() => restartAt(position + 10000)} disabled={!mediaInfo}>+10 seconds</button></div><div class="control-group"><label class="player-volume"><span>Volume</span><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onInput={event => setPlayerVolume(Number(event.currentTarget.value))} /></label><button onClick={toggleMuted}>{muted ? 'Unmute' : 'Mute'}</button></div><div class="control-group"><button onClick={() => { setSubtitleOpen(false); setAudioOpen(value => !value); revealControls() }} disabled={!mediaInfo} aria-expanded={audioOpen}>Audio{audioChoice}</button><button onClick={() => { setAudioOpen(false); setSubtitleOpen(value => !value); revealControls() }} aria-expanded={subtitleOpen}>Subtitles{subtitleChoice}</button></div><div class="control-group control-group-end"><button onClick={() => void toggleFullscreen()}>Fullscreen</button><button onClick={hideControls} aria-label="Hide controls">Hide</button><button onClick={() => { void save(); onClose() }} aria-label="Close player">Close</button></div></div>
    </div>
    {audioOpen && <section class="subtitle-panel audio-panel"><h2>Audio track</h2>{mediaInfo?.audioTracks.map(track => <button class={track.streamIndex === selectedAudio ? 'selected' : ''} onClick={() => void chooseAudio(track)}><strong>{audioTrackLabel(track)}</strong>{track.default && <span>Default track</span>}</button>)}</section>}
    {subtitleOpen && <section class="subtitle-panel"><h2>Subtitles</h2><button class={selectedSubtitle === 'off' ? 'selected' : ''} onClick={() => disableSubtitles()}>Off</button>{subtitleGroups.map(group => <div class="subtitle-group" key={group.key}><p class="subtitle-group-label">{group.label}</p>{group.items.map(candidate => { const position = subtitlePositions.get(candidate) ?? 0; return <button key={`${candidate.provider}:${candidate.id}`} class={selectedSubtitle === `${candidate.provider}:${candidate.id}` ? 'selected' : ''} onClick={() => void chooseSubtitle(candidate)}><strong>{subtitleItemLabel(candidate, position)}</strong><span>{subtitleItemDetail(candidate)}</span>{candidate.releaseName && <small>{candidate.releaseName}</small>}</button> })}</div>)}{candidates.length === 0 && <p>No matching downloadable subtitles were found.</p>}{warnings.map(w => <p class="danger"><strong>{w.provider}</strong>: {w.message}</p>)}</section>}
    {(!mediaInfo || stalled) && <PlayerReady api={api} download={active.download} title={playerTitle(active.download)} />}
    {message && <p class="player-status" role="status">{message}</p>}
    <OsdLayer feedback={osd} onHidden={() => setOsd(null)} />
  </div>;
}

export function App() {
  const initialRoute = parsePath(location.pathname, location.search);
  const [view, setView] = useState<View>(initialRoute.view === 'title' || initialRoute.view === 'watch' ? 'home' : initialRoute.view); const [titles, setTitles] = useState<CatalogTitle[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [household, setHousehold] = useState<HouseholdState>(emptyState); const [downloads, setDownloads] = useState<Download[]>([]); const [hero, setHero] = useState<CatalogTitle | null>(null); const [detail, setDetail] = useState<CatalogDetail | null>(null); const [detailTarget, setDetailTarget] = useState<DetailTarget>({}); const [picker, setPicker] = useState<CatalogSource[] | null>(null); const [info, setInfo] = useState<CatalogTitle | null>(null); const infoTrigger = useRef<HTMLElement | null>(null); const [player, setPlayer] = useState<ActivePlayer | null>(null); const [draftQuery, setDraftQuery] = useState(initialRoute.query || ''); const [query, setQuery] = useState(initialRoute.query || ''); const [searching, setSearching] = useState(false); const [updatesAvailable, setUpdatesAvailable] = useState(false); const [category, setCategory] = useState(''); const [kind, setKind] = useState(''); const [resolution, setResolution] = useState(''); const [sort, setSort] = useState('newest'); const [facets, setFacets] = useState<{ categories: string[]; resolutions: string[] }>({ categories: [], resolutions: [] }); const [libraryCategories, setLibraryCategories] = useState<LibraryCategory[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [settings, setSettings] = useState<Record<string, unknown> | null>(null); const [settingsFields, setSettingsFields] = useState<SettingsField[]>([]); const loadMore = useRef<HTMLDivElement>(null); const requestGeneration = useRef(0); const inFlightCursor = useRef(''); const viewportInput = useRef(0); const catalogParams = useRef({ query, category, kind, resolution, sort }); catalogParams.current = { query, category, kind, resolution, sort };
  const [jobDeepId, setJobDeepId] = useState<string | undefined>(initialRoute.view === 'jobs' ? initialRoute.id : undefined);
  const [portal, setPortal] = useState<PortalState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [portalConnected, setPortalConnected] = useState(true);
  const [identity, setIdentity] = useState<PortalUser | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [portalFailure, setPortalFailure] = useState('');
  const syncRef = useRef<PortalSync | null>(null);
  const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') };
  const updates = useUpdateController({ client: api, status: updateStatus, onStatus: setUpdateStatus });
  const detailRef = useRef<CatalogDetail | null>(null); const loadDownloadsRef = useRef<() => Promise<void>>(async () => { }); detailRef.current = detail;
  const playerRef = useRef<ActivePlayer | null>(null); playerRef.current = player;
  const loadState = async () => { try { setHousehold(await api.state()); } catch (e) { setError((e as Error).message) } };
  // Acquisition UX: a source click names its tracker, shows a preparing or
  // metadata state, and stays cancellable until the server returns a
  // Download. The UI never switches to playback early; cancellation is
  // distinct from failure, and 409/504 details render verbatim because the
  // server wording is already actionable.
  const [preparing, setPreparing] = useState<{ trackerId?: string; trackerName: string; label: string; seeders?: number; canceled?: boolean; error?: string; settingsHint?: boolean } | null>(null);
  const [searchTrackers, setSearchTrackers] = useState<TrackerStatus[]>([]);
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches(deviceStorage()));
  // The last term the trackers were asked for. Typing fills the cache view without asking them, so Search must not mistake that for a finished tracker search.
  const trackerSearched = useRef('');
  const prepareAbort = useRef<AbortController | null>(null);
  useEffect(() => () => prepareAbort.current?.abort(), []);
  const beginPrepare = (trackerName: string, label: string, trackerId?: string, seeders?: number) => { prepareAbort.current?.abort(); const controller = new AbortController(); prepareAbort.current = controller; setPreparing({ trackerId, trackerName, label, seeders }); return controller };
  const cancelPrepare = () => prepareAbort.current?.abort();
  const notePrepareFailure = (origin: { trackerName: string; label: string }, controller: AbortController) => (error: unknown) => {
    if (prepareAbort.current !== controller) return;
    if (controller.signal.aborted || (error as DOMException)?.name === 'AbortError') { setPreparing({ ...origin, canceled: true }); return }
    const err = error as Error & { status?: number };
    setPreparing({ ...origin, error: err.message || 'Preparation failed.', settingsHint: err.status === 409 });
  };
  const navigate = (next: View) => { prepareAbort.current?.abort(); setDetail(null); setView(next); setJobDeepId(undefined); pushRoute({ view: next, query: next === 'search' ? query : '' }) };
  // Sidebar navigation away from a dirty Settings page asks first; Settings
  // reports dirtiness through the ref so the check stays synchronous.
  const settingsDirty = useRef(false); const viewRef = useRef(view); viewRef.current = view;
  const [pendingLeave, setPendingLeave] = useState<Route | null>(null);
  const guardedNavigate = (next: View) => {
    if (view === 'settings' && next !== 'settings' && settingsDirty.current) { setPendingLeave({ view: next, query: next === 'search' ? query : '' }); return }
    navigate(next);
  };
  // Every history entry — popped, or replayed after a canceled pop — lands
  // through this one applier.
  const applyRoute = (route: Route) => {
    prepareAbort.current?.abort();
    if (route.view === 'watch') { if (route.id && playerRef.current?.download.id !== route.id) void startWatch(route.id, route.source, route.t); return }
    setPlayer(null);
    if (route.view === 'title') { if (route.id && detailRef.current?.title.id !== route.id) void loadDetail(route.id); return }
    setDetail(null);
    setJobDeepId(route.view === 'jobs' ? route.id : undefined);
    setView(route.view);
    if (route.view === 'search') { setDraftQuery(route.query || ''); setQuery(route.query || '') }
  };
  const confirmLeave = () => {
    settingsDirty.current = false;
    const target = pendingLeave;
    setPendingLeave(null);
    if (!target) return;
    if (target.view === 'watch' || target.view === 'title') { applyRoute(target); return }
    applyRoute(target); pushRoute(target);
  };
  // Closing an overlay goes back in history when the current entry is one the
  // app pushed, so Back never escapes the app; a cold-loaded overlay URL is
  // replaced with the section route instead.
  const closeOverlay = (clear: () => void) => { if ((window.history.state as { filelist?: boolean } | null)?.filelist === true) { window.history.back(); return } clear(); replaceRoute({ view, query: view === 'search' ? query : '' }) };
  const closeDetail = () => closeOverlay(() => { prepareAbort.current?.abort(); setDetail(null) });
  const closePlayer = () => closeOverlay(() => setPlayer(null));
  const closeJobDetail = () => closeOverlay(() => { });
  const openJobDetail = (id: string) => { setJobDeepId(id); pushRoute({ view: 'jobs', id }) };
  useOverlayFocus(Boolean(detail) && !picker && !info, closeDetail); useOverlayFocus(Boolean(picker), () => setPicker(null)); useOverlayFocus(Boolean(info), () => setInfo(null));
  // Closing Info returns focus to the button that opened it. The overlay beneath re-arms its own trap in the same commit and
  // focuses its first control on a zero timer, so this timer is registered after it to run last.
  useEffect(() => { if (info) return; const trigger = infoTrigger.current; infoTrigger.current = null; if (!trigger) return; const timer = window.setTimeout(() => { if (trigger.isConnected) trigger.focus() }, 0); return () => window.clearTimeout(timer) }, [info]);
  const openInfo = (title: CatalogTitle, trigger: HTMLElement) => { infoTrigger.current = trigger; setInfo(title) };
  const loadDownloads = async () => { const anchor = captureDownloadAnchor(); const inputVersion = viewportInput.current; try { const incoming = (await api.downloads()).items; setDownloads(current => reconcileDownloads(current, incoming)); window.requestAnimationFrame(() => { if (inputVersion === viewportInput.current) restoreDownloadAnchor(anchor) }) } catch (e) { setError((e as Error).message) } }; loadDownloadsRef.current = loadDownloads;
  const loadTitles = async (append = false, cursor = '') => { if (append && inFlightCursor.current === cursor) return; const generation = append ? requestGeneration.current : ++requestGeneration.current; if (append) inFlightCursor.current = cursor; setLoading(true); const p = catalogParams.current; try { const page = await api.titles({ search: p.query, category: p.category, kind: p.kind, resolution: p.resolution, sort: p.sort, pageSize: 24, cursor }); if (generation !== requestGeneration.current) return; setTitles(current => { if (!append) return page.items; const seen = new Set(current.map(item => item.id)); return [...current, ...page.items.filter(item => !seen.has(item.id))] }); setNextCursor(page.nextCursor); setHero(h => h || page.items[0] || null); void api.ensureMetadata(page.items.slice(0, 12).map(item => item.id)).catch(() => { }); setError(''); } catch (e) { if (generation === requestGeneration.current) setError((e as Error).message) } finally { if (inFlightCursor.current === cursor) inFlightCursor.current = ''; if (generation === requestGeneration.current) setLoading(false) } };
  useEffect(() => { void Promise.all([loadState(), loadTitles(), api.facets().then(f => setFacets(f)).catch(() => { })]); }, []);
  // Portal snapshot and self-update status: the sync controller owns the
  // initial refetch, SSE events, and reconnect recovery, so a replayed
  // event can never override the fresher HTTP snapshot. A failed optional
  // integration simply leaves the state unknown — the UI renders nothing.
  useEffect(() => {
    const sync = new PortalSync({ loadState: () => api.portalState(), loadStatus: () => api.updatesCurrent() });
    syncRef.current = sync;
    const render = () => { setPortal(sync.state); setUpdateStatus(sync.status); setPortalConnected(sync.connected); setPortalFailure(sync.failure) };
    render();
    const unsubscribe = sync.subscribe(render);
    void sync.recover();
    return () => unsubscribe();
  }, []);
  // Stored supporter identity: a stored token must prove itself against
  // /session/me on boot; only a session-invalid answer (401) clears it — a
  // plain network failure (server restarting, outage) keeps the token for
  // the next boot. This is identity state only — the household donor flag
  // lives in the snapshot.
  useEffect(() => {
    const storage = persistedStore();
    const origin = location.origin;
    const stored = loadPortalSession(storage, origin);
    if (!stored) return;
    const controller = new AbortController();
    api.portalMe(stored.token, controller.signal).then(user => setIdentity(user)).catch(error => { const status = (error as { status?: number }).status; if (status === 401) clearPortalSession(storage, origin) });
    return () => controller.abort();
  }, []);
  // A capability loss must also drop the open-flag: a later re-enable then
  // does not spontaneously re-open the dialog the user lost.
  useEffect(() => { if (accountOpen && portal && !portal.accountsEnabled) setAccountOpen(false) }, [accountOpen, portal]);
  // Detail through the same catalog call a tile uses; a /watch URL runs the
  // playDownload path honoring the URL's Source index and resume position.
  useEffect(() => {
    if (initialRoute.view === 'title' && initialRoute.id) void loadDetail(initialRoute.id);
    if (initialRoute.view === 'watch' && initialRoute.id) void startWatch(initialRoute.id, initialRoute.source, initialRoute.t);
  }, []);
  useEffect(() => { void loadTitles(false, ''); }, [query, category, kind, resolution, sort]);
  useEffect(() => { if (!loadMore.current) return; const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting && nextCursor && !loading) void loadTitles(true, nextCursor) }, { rootMargin: '500px' }); observer.observe(loadMore.current); return () => observer.disconnect() }, [view, nextCursor, loading, query, category, kind, resolution, sort]);
  useEffect(() => { const stream = new EventSource('/api/v1/events'); const catalog = (event: MessageEvent) => { setUpdatesAvailable(true); try { const envelope = JSON.parse(event.data); const payload = typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload; const titleId = String(payload.titleId || ''); if (titleId && detailRef.current?.title.id === titleId) void api.title(titleId).then(setDetail).catch(e => setError((e as Error).message)) } catch { } }; const metadata = (event: MessageEvent) => { try { const envelope = JSON.parse(event.data); const payload = typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload; const title = payload.title as CatalogTitle | undefined; if (!title?.id) return; setTitles(current => current.map(item => item.id === title.id ? title : item)); setHero(current => current?.id === title.id ? title : current); setDetail(current => current?.title.id === title.id ? { ...current, title } : current) } catch { } }; const searchComplete = (event: MessageEvent) => { try { const envelope = JSON.parse(event.data); const payload = typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload; if (String(payload.query || '').toLowerCase() === catalogParams.current.query.toLowerCase()) void loadTitles(false, '') } catch { } }; let lastStreamEventId = 0; const portalEvent = (event: MessageEvent) => { const parsed = eventPayload(event.data); if (!parsed) return; lastStreamEventId = Number(event.lastEventId) > 0 ? Number(event.lastEventId) : lastStreamEventId; syncRef.current?.absorb({ id: parsed.id, kind: parsed.kind, payload: parsed.payload }) }; stream.addEventListener('catalog.updated', catalog as EventListener); stream.addEventListener('catalog.search.completed', searchComplete as EventListener); stream.addEventListener('metadata.updated', metadata as EventListener); stream.addEventListener('portal.state', portalEvent as EventListener); stream.addEventListener('updates.status', portalEvent as EventListener); stream.addEventListener('updates.failed', portalEvent as EventListener); stream.addEventListener('open', () => { void syncRef.current?.recover(lastStreamEventId > 0 ? lastStreamEventId : undefined) }); stream.addEventListener('error', () => syncRef.current?.disconnect()); return () => stream.close() }, []);
  useEffect(() => { if (view === 'library-categories') void api.libraryCategories().then(page => setLibraryCategories(page.items as LibraryCategory[])).catch(e => setError(e.message)); if (view === 'settings') void Promise.all([api.call<Record<string, unknown>>('/settings').then(setSettings), api.call<{ items: SettingsField[] }>('/settings/schema').then(value => setSettingsFields(value.items))]).catch(e => setError(e.message)); }, [view]);
  useEffect(() => { if (view !== 'downloads') return; let stopped = false; let running = false; const refresh = async () => { if (stopped || running) return; running = true; try { await loadDownloadsRef.current() } finally { running = false } }; void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) } }, [view]);
  useEffect(() => { const titleId = detail?.title.kind === 'series' ? detail.title.id : ''; if (!titleId) return; let stopped = false; let running = false; const refresh = async () => { if (stopped || running) return; running = true; try { const next = await api.title(titleId); if (!stopped && detailRef.current?.title.id === titleId) setDetail(next) } catch (e) { if (!stopped) setError((e as Error).message) } finally { running = false } }; const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) } }, [detail?.title.id]);
  useEffect(() => { const moved = () => { viewportInput.current++ }; window.addEventListener('wheel', moved, { passive: true }); window.addEventListener('touchmove', moved, { passive: true }); window.addEventListener('keydown', moved); return () => { window.removeEventListener('wheel', moved); window.removeEventListener('touchmove', moved); window.removeEventListener('keydown', moved) } }, []);
  useEffect(() => {
    const restore = () => {
      const route = parsePath(location.pathname, location.search);
      // Popping away from dirty Settings cancels the pop: the settings entry
      // goes back on top (keeping the app's history marker) and the popped
      // route is held for the leave confirm to replay.
      if (viewRef.current === 'settings' && settingsDirty.current && route.view !== 'settings') { pushRoute({ view: 'settings', query: '' }); setPendingLeave(route); return }
      applyRoute(route);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  async function loadDetail(id: string, target: DetailTarget = {}, stub?: CatalogTitle) {
    setDetailTarget(target);
    if (stub) setHero(stub);
    try {
      const next = await api.title(id);
      setDetail(next);
      pushRoute({ view: 'title', id });
      if (needsEpisodeExpansion(next)) void api.refreshTitle(id, (stub || next.title).title).catch(e => setError((e as Error).message))
    } catch (e) { setError((e as Error).message) }
  }
  async function openTitle(title: CatalogTitle, target: DetailTarget = {}) { await loadDetail(title.id, target, title) }
  async function openLibraryItem(item: HouseholdItem) { const id = item.titleId || item.catalog?.id; if (!id) { setError('This library item is not linked to a catalog title yet. Refresh the catalog and try again.'); return } const title = item.catalog || { id, title: item.release.name, kind: 'movie', categories: [], resolutions: [], sourceCount: 1, bestSeeders: item.release.seeders, largestSizeBytes: item.release.sizeBytes, trackers: item.release.trackerId ? [{ id: item.release.trackerId, name: item.release.trackerName }] : [], libraryState: { downloadState: 'none', watchState: 'unwatched' } } as CatalogTitle; await openTitle(title, { season: item.seasonNumber, episode: item.episodeNumber }) }
  async function prepare(source: CatalogSource, resumeMs = 0) { const origin = { trackerId: source.release.trackerId, trackerName: source.release.trackerName || 'Unknown tracker', label: source.release.name, seeders: source.release.seeders }; const controller = beginPrepare(origin.trackerName, origin.label, origin.trackerId, origin.seeders); try { setPicker(null); const d = await api.prepare(source.release.id, source.fileIndex ?? -1, controller.signal); if (prepareAbort.current !== controller) return; if (!resumeMs) resumeMs = await api.playback(d.id).then(p => p.watched ? 0 : p.positionMs).catch(() => 0); setPreparing(null); setPlayer({ download: d, resumeMs }); pushRoute(watchRoute(d, resumeMs)); } catch (e) { notePrepareFailure(origin, controller)(e) } }
  async function playLegacy(item: HouseholdItem) { const origin = { trackerId: item.release.trackerId, trackerName: item.release.trackerName || 'Unknown tracker', label: item.release.name, seeders: item.release.seeders }; const controller = beginPrepare(origin.trackerName, origin.label, origin.trackerId, origin.seeders); try { const d = await api.prepare(item.release.id, item.fileIndex, controller.signal); if (prepareAbort.current !== controller) return; const resumeMs = item.watched ? 0 : item.positionMs; setPreparing(null); setPlayer({ download: d, resumeMs }); pushRoute(watchRoute(d, resumeMs)) } catch (e) { notePrepareFailure(origin, controller)(e) } }
  async function playDownload(download: Download) { const resumeMs = await api.playback(download.id).then(value => value.watched ? 0 : value.positionMs).catch(() => 0); setPlayer({ download, resumeMs }); pushRoute(watchRoute(download, resumeMs)) }
  // Cold watch deep link: resolve the Managed download by id, honor an
  // explicit Source index in the URL by re-preparing only when it differs
  // from the download's own, then the playDownload path — Household resume
  // unless the URL carries t.
  async function startWatch(id: string, source?: number, t?: number) {
    try {
      const found = (await api.downloads()).items.find(item => item.id === id);
      if (!found) throw new Error('This playback link points to a download that is no longer managed.');
      let download = found;
      if (source !== undefined && source !== found.fileIndex) { try { download = await api.prepare(found.releaseId, source) } catch { download = found } }
      const resumeMs = t === undefined ? await api.playback(download.id).then(value => value.watched ? 0 : value.positionMs).catch(() => 0) : Math.max(0, t);
      setPlayer({ download, resumeMs });
    } catch (e) { setError((e as Error).message) }
  }
  async function advanceEpisode(preferences: PlaybackPreferences) { if (!player) return; try { const next = await api.nextEpisode(player.download.id); await Promise.all([loadState(), loadDownloads()]); if (next) { setPlayer({ download: next, resumeMs: 0, preferences: { ...preferences, sourceId: next.id, subtitleMode: preferences.subtitleMode === 'off' ? 'off' : 'auto', subtitleProvider: '', subtitleCandidateId: '' } }); replaceRoute(watchRoute(next, 0)) } else closePlayer() } catch (e) { setError(`Could not start the next episode: ${(e as Error).message}`); closePlayer() } }
  async function skipEpisode(direction: 'next' | 'previous', preferences: PlaybackPreferences): Promise<boolean> {
    const from = playerRef.current?.download.id; if (!from) return false;
    try {
      const target = await (direction === 'next' ? api.nextEpisode(from) : api.previousEpisode(from));
      if (playerRef.current?.download.id !== from) return true; // closed or replaced meanwhile: drop the stale result
      if (!target) return false;
      void Promise.all([loadState(), loadDownloads()]);
      setPlayer({ download: target, resumeMs: 0, preferences: { ...preferences, sourceId: target.id, subtitleMode: preferences.subtitleMode === 'off' ? 'off' : 'auto', subtitleProvider: '', subtitleCandidateId: '' } });
      replaceRoute(watchRoute(target, 0));
      return true;
    } catch (e) { setError(`Could not start the ${direction} episode: ${(e as Error).message}`); return true }
  }
  async function downloadSeason(source: CatalogSource, season: number) { const origin = { trackerId: source.release.trackerId, trackerName: source.release.trackerName || 'Unknown tracker', label: source.release.name, seeders: source.release.seeders }; const controller = beginPrepare(origin.trackerName, origin.label, origin.trackerId, origin.seeders); try { await api.prepareSeason(source.release.id, season, controller.signal); if (prepareAbort.current !== controller) return; setPreparing(null); await loadDownloads(); if (detailRef.current) { const next = await api.title(detailRef.current.title.id); setDetail(next); setDetailTarget({ season }) } } catch (e) { notePrepareFailure(origin, controller)(e) } }
  async function manageSeasonPack(source: CatalogSource, season: number, action: 'download' | 'pause' | 'resume' | 'retry' | 'delete') { try { if (action === 'download' || (action === 'retry' && !source.libraryState?.downloadId)) { await downloadSeason(source, season); return } const id = source.libraryState?.downloadId; if (!id) throw new Error('This season download is not registered yet. Refresh the title and try again.'); if (action === 'delete') await api.deleteDownload(id); else await api.call(`/downloads/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); await loadDownloads(); if (detailRef.current) setDetail(await api.title(detailRef.current.title.id)) } catch (e) { setError((e as Error).message); throw e } }
  async function remove(d: Download) { try { await api.deleteDownload(d.id); await loadDownloads() } catch (e) { setError((e as Error).message); throw e } }
  async function removeDownloadFile(d: Download) { try { await api.call(`/downloads/${encodeURIComponent(d.id)}/remove-file`, { method: 'POST' }); await loadDownloads() } catch (e) { setError((e as Error).message); throw e } }
  async function manageDownload(d: Download, action: DownloadTransferAction) { try { await api.call(`/downloads/${encodeURIComponent(d.id)}/${action}`, { method: 'POST' }); await loadDownloads() } catch (e) { setError((e as Error).message); throw e } }
  // Typing refreshes the results from the cache after a short pause (three characters or more, Browse and Search only).
  // It never contacts the trackers: only Search does that.
  useEffect(() => {
    const term = draftQuery.trim();
    if ((view !== 'search' && view !== 'browse') || term.length < 3 || term === query) return;
    const timer = window.setTimeout(() => { setQuery(term); if (view === 'search') replaceRoute({ view: 'search', query: term }) }, 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery, view]);
  const runRecentSearch = (term: string) => { setDraftQuery(term); setQuery(term); setRecentSearches(recordRecentSearch(deviceStorage(), term)); replaceRoute({ view: 'search', query: term }) };
  const forgetRecentSearches = () => { clearRecentSearches(deviceStorage()); setRecentSearches([]) };
  async function submitSearch(event?: Event, valueOverride?: string) { event?.preventDefault(); const value = (valueOverride ?? draftQuery).trim(); if (value === query && (!value || trackerSearched.current === value)) { void loadTitles(false, ''); return } setSearching(true); setError(''); try { if (value) { const page = await api.searchTitles(value); trackerSearched.current = value; setRecentSearches(recordRecentSearch(deviceStorage(), value)); setTitles(page.items); setNextCursor(page.nextCursor); setHero(page.items[0] || null); setSearchTrackers(page.trackers || []); void api.ensureMetadata(page.items.slice(0, 12).map(item => item.id)).catch(() => { }); } setQuery(value); setUpdatesAvailable(false); if (view === 'search') { replaceRoute({ view: 'search', query: value }) } else { setView('search'); pushRoute({ view: 'search', query: value }) } } catch (e) { setError((e as Error).message) } finally { setSearching(false) } }
  async function applyUpdates() { setUpdatesAvailable(false); await loadTitles(false, '') }
  // The backdrop rests on the featured title (Home, catalog views) or the first library title, and follows focus from there.
  useEffect(() => { setBackdropArt(undefined) }, [view]);
  const pageTitle = navGroups.flatMap(g => g.items).find(i => i.id === view)?.label || 'Home';
  const continueWatching = canonicalHouseholdItems(household.continueWatching); const favorites = canonicalHouseholdItems(household.favorites); const recent = canonicalHouseholdItems(household.recent); const watched = canonicalHouseholdItems(household.watched);
  const libraryItems = view === 'continue' ? continueWatching : view === 'favorites' ? favorites : view === 'watched' ? watched : [];
  const loadMoreTitles = () => { if (nextCursor && !loading) void loadTitles(true, nextCursor) };
  // Home leads with what the household is mid-way through; otherwise with the newest title.
  const homeTop = homeHero(continueWatching, hero ?? undefined);
  const showCatalog = ['tracker', 'browse', 'categories', 'search'].includes(view);
  const restingArt = view === 'home' ? backdropArtFor(homeTop.title ?? null) : showCatalog ? backdropArtFor(hero) : view === 'library' || view === 'continue' ? backdropArtFor(continueWatching.find(item => item.catalog)?.catalog) : view === 'favorites' ? backdropArtFor(favorites.find(item => item.catalog)?.catalog) : view === 'watched' ? backdropArtFor(watched.find(item => item.catalog)?.catalog) : '';
  const libraryEmpty: Record<string, string> = { continue: 'Nothing in progress. Start a movie or episode and it will appear here.', favorites: 'Your list is empty. Open a title and choose Add to My List to keep it close.', watched: 'Nothing watched yet. Titles you finish appear here.' };
  const catalogEmpty = !loading && !searching && titles.length === 0;
  return <div class="app-shell"><a class="skip-link" href="#content">Skip to content</a><BackdropLayer fallback={restingArt} /><Sidebar view={view} onView={guardedNavigate} dock={<PortalSidebarDock snapshot={portal} client={api} identity={identity} onOpenAccount={() => setAccountOpen(true)} openExternal={openExternal} />} /><main class="content" id="content"><header class="topbar"><h1>{pageTitle}</h1></header>{updateStatus?.available && <UpdateNotice status={updateStatus} controller={updates} openExternal={openExternal} />}
    {view === 'home' && <><Hero title={homeTop.title ?? null} resume={homeTop.resume} loading={loading} onOpen={openTitle} onResume={item => void playLegacy(item)} onSettings={() => navigate('settings')} onInfo={openInfo} /><Rail title="Continue watching" empty={libraryEmpty.continue} landscape>{continueWatching.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail><Rail title="Recently added" empty={loading ? 'Loading titles…' : 'The catalog has no titles yet. Enable a tracker in Settings, then run Fetch latest from Maintenance.'} onNearEnd={loadMoreTitles}>{titles.map(t => <MediaCard title={t} onOpen={openTitle} />)}</Rail><HomeDiscovery onOpen={openTitle} /><Rail title="My List" empty={libraryEmpty.favorites} landscape>{favorites.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail></>}
    {view === 'library' && <><Rail title="Continue watching" empty={libraryEmpty.continue} landscape>{continueWatching.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail><Rail title="Recently viewed" empty="Titles you open appear here." landscape>{recent.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail><Rail title="Watched" empty={libraryEmpty.watched} landscape>{watched.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail></>}
    {['continue', 'favorites', 'watched'].includes(view) && <Rail title={pageTitle} empty={libraryEmpty[view]} landscape>{libraryItems.map(i => <LegacyCard item={i} onOpen={openLibraryItem} />)}</Rail>}
    {showCatalog && <><CatalogTools draftQuery={draftQuery} setDraftQuery={setDraftQuery} query={query} searching={searching} onSubmit={submitSearch} category={category} setCategory={setCategory} kind={kind} setKind={setKind} resolution={resolution} setResolution={setResolution} sort={sort} setSort={setSort} facets={facets} trackers={searchTrackers} recent={view === 'search' && !draftQuery ? recentSearches : []} onRecent={runRecentSearch} onClearRecent={forgetRecentSearches} />{updatesAvailable && <button class="catalog-update" onClick={() => void applyUpdates()}>Catalog updates available · Refresh</button>}{view === 'categories' ? <CategoryGrid categories={facets.categories} onSelect={c => { setCategory(c); navigate('browse') }} /> : view === 'tracker' ? <><Rail title="Recently added" empty={loading ? 'Loading titles…' : 'No titles yet. Enable a tracker in Settings, then run Fetch latest from Maintenance.'} onNearEnd={loadMoreTitles}>{titles.map(t => <MediaCard title={t} onOpen={openTitle} />)}</Rail><Rail title="Strong swarms" empty="Titles with the most seeders appear here." onNearEnd={loadMoreTitles}>{[...titles].sort((a, b) => b.bestSeeders - a.bestSeeders).map(t => <MediaCard title={t} onOpen={openTitle} showSeeders />)}</Rail></> : <><section class="poster-grid" aria-busy={loading}>{titles.map(t => <MediaCard title={t} onOpen={openTitle} />)}</section>{loading && <section class="poster-grid">{Array.from({ length: 12 }, (_, i) => <div class="skeleton" key={i} />)}</section>}{catalogEmpty && <CatalogEmpty query={query} filtered={Boolean(category || kind || resolution)} onSettings={() => navigate('settings')} onClear={() => { setDraftQuery(''); void submitSearch(undefined, '') }} />}<div ref={loadMore} class="load-more" aria-hidden="true" /></>}</>}
    {view === 'downloads' &&
      <Downloads items={downloads} onRefresh={loadDownloads} onPlay={d => void playDownload(d)} onRemove={remove} onRemoveFile={removeDownloadFile} onAction={manageDownload} />
    }
    {view === 'library-categories' &&
      <LibraryCategories items={libraryCategories} onOpen={openLibraryItem} />
    }
    {view === 'jobs' && <Jobs onError={setError} deepJobId={jobDeepId} onOpenDetail={openJobDetail} onCloseDetail={closeJobDetail} />
    }
    {view === 'projects' &&
      <ProjectsPage links={portal?.links || []} openExternal={openExternal} />
    }
    {view === 'events' && <><CacheCoverage /><Events onError={setError} /></>
    }
    {view === 'settings' && settings && <Settings value={settings} fields={settingsFields} onSaved={setSettings} onError={setError} onDirtyChange={value => { settingsDirty.current = value }} accountsEnabled={portal?.accountsEnabled === true} updateSection={updateStatus ? <UpdateSection client={api} status={updateStatus} connected={portalConnected} failure={portalFailure} controller={updates} openExternal={openExternal} /> : null} />
    }
  </main>{detail && <Detail key={`${detail.title.id}:${detailTarget.season || 0}:${detailTarget.episode || 0}`} detail={detail} target={detailTarget} resume={resumeForTitle(household.continueWatching, detail.title.id)} favorite={household.favorites.some(item => item.titleId === detail.title.id || item.catalog?.id === detail.title.id)} onClose={closeDetail} onChoose={setPicker} onResume={playLegacy} onSource={s => void prepare(s)} onPackAction={manageSeasonPack} onError={setError} onInfo={openInfo} onFavorite={async value => { await api.titleFavorite(detail.title.id, value); await loadState(); }} />}{picker && <SourcePicker sources={picker} onClose={() => setPicker(null)} onChoose={s => void prepare(s)} />}{info && <TitleInfoDialog title={info} onClose={() => setInfo(null)} />} {player && <BrowserPlayer key={player.download.id} active={player} onClose={closePlayer} onStateChanged={loadState} onAdvance={advanceEpisode} onSkip={skipEpisode} />}{pendingLeave !== null && <div class="overlay" role="dialog" aria-modal="true" aria-label="Unsaved changes"><section class="help-modal"><h2>Leave with unsaved changes?</h2><p>Changes on the Settings page have not been saved yet.</p><div class="confirm-actions"><button type="button" onClick={() => setPendingLeave(null)}>Keep editing</button><button type="button" class="primary" onClick={confirmLeave}>Discard and leave</button></div></section></div>}{error && <div class="overlay error-overlay" role="alertdialog" aria-modal="true" aria-label="Something needs attention"><section class="error-modal"><h2>Something needs attention</h2><p>{error}</p><p class="next-step">Dismiss this message and try again. If it keeps happening, run the connection checks in Settings.</p><div class="confirm-actions"><button type="button" onClick={() => setError('')}>Dismiss</button></div></section></div>}{accountOpen && portal?.accountsEnabled && <PortalAccountDialog client={api} storage={persistedStore()} origin={location.origin} identity={identity} onIdentity={setIdentity} onClose={() => setAccountOpen(false)} />}{updates.phase === 'confirming' && <UpdateApplyConfirm controller={updates} />}{preparing && <div class="overlay" role="dialog" aria-modal="true" aria-label="Preparing download"><section class="help-modal prepare-status"><h2>{preparing.canceled ? 'Preparation canceled' : preparing.error ? 'Could not start this download' : <>Preparing from <TrackerBadge id={preparing.trackerId} name={preparing.trackerName} /></>}</h2><p class="supporting">{preparing.canceled ? `${preparing.trackerName} was not asked for a new download — nothing was added.` : preparing.error ? `${preparing.trackerName}: ${preparing.error}` : `Reading ${preparing.trackerName} metadata. Playback opens as soon as the download is ready; Cancel stops it.`}</p>{!preparing.canceled && !preparing.error && <PrepareElapsed seeders={preparing.seeders} />}<div class="confirm-actions">{preparing.settingsHint && <button type="button" class="primary" onClick={() => { setPreparing(null); navigate('settings') }}>Open Settings</button>}{!preparing.canceled && !preparing.error && <button type="button" onClick={cancelPrepare}>Cancel</button>}{(preparing.canceled || preparing.error) && <button type="button" onClick={() => setPreparing(null)}>Close</button>}</div></section></div>}</div>;
}

// Home hero: title, year, kind, a three-line overview and one primary action;
// the genre is secondary. Seeders, best resolution and source counts stay off
// it. With no title yet it is either a loading placeholder or the setup prompt.
// Discovery rows under Recently added. Each loads when the page nears it (one at a time, at most four, ten titles each),
// from the cache only; a row that fails to load is left out without a message.
function HomeDiscovery({ onOpen }: { onOpen: (title: CatalogTitle) => void }) {
  const specs = useMemo(() => homeRowSpecs(), []);
  const [rows, setRows] = useState<Array<{ key: string; title: string; items: CatalogTitle[] }>>([]);
  const [next, setNext] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (next >= specs.length) return;
    let cancelled = false;
    const load = async () => {
      const spec = specs[next];
      try {
        const items = homeRowItems(spec, (await api.titles(spec.query)).items);
        if (cancelled) return;
        if (items.length > 0) setRows(current => [...current, { key: spec.key, title: spec.title, items }]);
        void api.ensureMetadata(items.map(item => item.id)).catch(() => { });
      } catch { }
      if (!cancelled) setNext(value => value + 1);
    };
    if (typeof IntersectionObserver === 'undefined' || !sentinel.current) { void load(); return () => { cancelled = true }; }
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) { observer.disconnect(); void load() } }, { rootMargin: '400px' });
    observer.observe(sentinel.current);
    return () => { cancelled = true; observer.disconnect() };
  }, [next]);
  return <>{rows.map(row => <Rail key={row.key} title={row.title}>{row.items.map(t => <MediaCard title={t} onOpen={onOpen} />)}</Rail>)}{next < specs.length && <div ref={sentinel} class="home-sentinel" aria-hidden="true" />}</>;
}

function Hero({ title, resume, loading, onOpen, onResume, onSettings, onInfo }: { title: CatalogTitle | null; resume?: HouseholdItem; loading: boolean; onOpen: (t: CatalogTitle) => void; onResume: (item: HouseholdItem) => void; onSettings: () => void; onInfo: (t: CatalogTitle, trigger: HTMLElement) => void }) {
  if (!title) return loading
    ? <section class="hero hero-loading" aria-busy="true"><div class="hero-copy"><h2>Loading your catalog…</h2></div></section>
    : <section class="hero empty-hero"><div class="hero-copy"><h2>Connect your catalog</h2><p class="hero-overview">No titles are available yet. Enable a tracker in Settings, then come back to browse and play.</p><button class="primary" onClick={onSettings}><Icon name="settings" /><span>Open Settings</span></button></div></section>;
  const genres = (title.genres || []).slice(0, 3).join(' · ');
  return <section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="hero-kicker">{titleFacts(title).join(' · ')}</p><h2 id="hero-title">{title.title}</h2>{genres && <p class="hero-genres">{genres}</p>}{title.overview && <p class="hero-overview">{title.overview}</p>}{resume && <p class="hero-genres hero-resume">{[episodeCode(resume.seasonNumber, resume.episodeNumber), libraryProgress(resume).label].filter(Boolean).join(' · ')}</p>}<button class="primary" onClick={() => resume ? onResume(resume) : onOpen(title)}><Icon name="play" /><span>{resume ? resumeActionLabel(resume, title.kind) : title.kind === 'series' ? 'View episodes' : 'View versions'}</span></button><button class="hero-info" onClick={event => onInfo(title, event.currentTarget)}>Info</button></div><div class="hero-art"><Artwork title={title} kind="backdrop" /></div></section>;
}

// Empty and error states say the cause and the next action in one sentence each.
function EmptyState({ title, children, action }: { title: string; children: ComponentChildren; action?: ComponentChild }) {
  return <section class="empty-state" role="status"><h2>{title}</h2><p>{children}</p>{action}</section>;
}

function CatalogEmpty({ query, filtered, onSettings, onClear }: { query: string; filtered: boolean; onSettings: () => void; onClear: () => void }) {
  if (query) return <EmptyState title={`No titles match “${query}”`} action={<button type="button" onClick={onClear}>Clear search</button>}>Check the spelling or clear a filter. Searching asks every enabled tracker; filters only narrow what the catalog already holds.</EmptyState>;
  if (filtered) return <EmptyState title="No titles match these filters">Choose All categories, All resolutions or Movies and series to see more of the catalog.</EmptyState>;
  return <EmptyState title="The catalog is empty" action={<button type="button" class="primary" onClick={onSettings}>Open Settings</button>}>Enable a tracker in Settings, then run Fetch latest from Maintenance to fill it.</EmptyState>;
}

function CatalogTools(p: any) {
  const attention = (p.trackers || []).filter((t: any) => !t.enabled || !t.configured);
  return <form class="catalog-tools" role="search" onSubmit={p.onSubmit}>
    <div class="tools-primary">
      <label class="search"><Icon name="search" /><input value={p.draftQuery} onInput={(e: any) => p.setDraftQuery(e.currentTarget.value)} placeholder="Search titles, years or releases" aria-label="Search" /></label>
      <button class="search-submit primary" type="submit" disabled={p.searching}>{p.searching ? 'Searching…' : 'Search'}</button>
      {p.query && <button type="button" onClick={() => { p.setDraftQuery(''); p.onSubmit(undefined, '') }}>Clear</button>}
      <select value={p.kind} onChange={(e: any) => p.setKind(e.currentTarget.value)} aria-label="Media type"><option value="">Movies and series</option><option value="movie">Movies</option><option value="series">Series</option></select>
    </div>
    {p.recent?.length > 0 && <div class="recent-searches" role="group" aria-label="Recent searches"><span>Recent</span>{p.recent.map((term: string) => <button type="button" key={term} onClick={() => p.onRecent(term)}>{term}</button>)}<button type="button" class="recent-clear" onClick={p.onClearRecent}>Clear recent</button></div>}
    <div class="tools-secondary">
      <select value={p.category} onChange={(e: any) => p.setCategory(e.currentTarget.value)} aria-label="Category"><option value="">All categories</option>{p.facets.categories.map((x: string) => <option>{x}</option>)}</select>
      <select value={p.resolution} onChange={(e: any) => p.setResolution(e.currentTarget.value)} aria-label="Resolution"><option value="">All resolutions</option>{p.facets.resolutions.map((x: string) => <option>{x}</option>)}</select>
      <select value={p.sort} onChange={(e: any) => p.setSort(e.currentTarget.value)} aria-label="Sort"><option value="newest">Recently added</option><option value="title">Title A–Z</option><option value="rating">Highest rated</option><option value="rating-asc">Lowest rated</option><option value="seeders">Most seeders</option><option value="size">Largest size</option></select>
    </div>
    {attention.length > 0 && <p class="tracker-strip" role="status">{attention.map((t: any) => <span key={t.id} class={`tracker-chip off${trackerSourceKey(t.id) ? ` accent-${trackerSourceKey(t.id)}` : ''}`}><Icon name="alert" />{t.name}{t.enabled ? ' needs setup' : ' is disabled'}</span>)}</p>}
  </form>;
}
function CategoryGrid({ categories, onSelect }: { categories: string[]; onSelect: (c: string) => void }) { return <section class="category-grid">{categories.map(c => <button onClick={() => onSelect(c)}><Icon name="folder" /><strong>{c}</strong><span>Browse category</span></button>)}</section> }

function sourceActionLabel(source: CatalogSource) { return source.libraryState?.downloadState && source.libraryState.downloadState !== 'none' ? 'Play' : 'Play and download' }
type SeasonPackAction = 'download' | 'pause' | 'resume' | 'retry' | 'delete';
function SeasonPackCard({ source, season, open, onToggle, onAction, onDelete }: { source: CatalogSource; season: number; open: boolean; onToggle: () => void; onAction: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void>; onDelete: () => void }) {
  const state = source.libraryState; const [busy, setBusy] = useState(''); const managed = Boolean(state?.downloadId); const paused = state?.transferState === 'paused'; const complete = state?.downloadState === 'downloaded'; const error = state?.downloadState === 'error';
  const spec = sourceSpec(source);
  const run = async (action: SeasonPackAction) => { if (busy) return; setBusy(action); try { await onAction(source, season, action) } finally { setBusy('') } };
  return <article class={`season-pack-source ${open ? 'expanded' : ''}`}><button class="season-pack-header" aria-expanded={open} aria-controls={`pack-${source.release.id}`} onClick={onToggle}><span class="season-pack-copy"><strong>{spec.headline === 'Version' ? 'Season pack' : spec.headline}</strong>{(spec.chips.length > 0 || spec.audio) && <small>{[...spec.chips, spec.audio].filter(Boolean).join(' · ')}</small>}<TrackerBadge id={source.release.trackerId} name={source.release.trackerName} /></span><span class="season-pack-state"><MediaBadges state={state} /><b>{seasonPackActionLabel(state)}</b><small>{spec.size} · {spec.seeders}</small><small>{open ? 'Hide controls' : 'Show controls'}</small></span></button>{open && <div id={`pack-${source.release.id}`} class="season-pack-controls"><p class="source-release">{source.release.name}</p><progress value={state?.progress || 0} max="1" aria-label="Season download progress" />{!managed && <button class="primary" disabled={Boolean(busy)} onClick={() => void run('download')}>{busy ? 'Starting…' : 'Download season'}</button>}{managed && !complete && !error && <button disabled={Boolean(busy)} onClick={() => void run(paused ? 'resume' : 'pause')}>{busy ? `${paused ? 'Resuming' : 'Pausing'}…` : paused ? 'Resume' : 'Pause'}</button>}{error && <button class="primary" disabled={Boolean(busy)} onClick={() => void run('retry')}>{busy ? 'Retrying…' : 'Retry'}</button>}{managed && <button class="danger-button" disabled={Boolean(busy)} onClick={onDelete}>Delete download</button>}</div>}</article>;
}
function Detail({ detail, target, resume, favorite, onClose, onChoose, onResume, onSource, onPackAction, onFavorite, onError, onInfo }: { detail: CatalogDetail; target: DetailTarget; resume?: HouseholdItem; favorite: boolean; onClose: () => void; onChoose: (sources: CatalogSource[]) => void; onResume: (item: HouseholdItem) => void; onSource: (s: CatalogSource) => void; onPackAction: (s: CatalogSource, season: number, action: SeasonPackAction) => Promise<void>; onFavorite: (v: boolean) => void; onError: (message: string) => void; onInfo: (title: CatalogTitle, trigger: HTMLElement) => void }) {
  const initialIndex = Math.max(0, detail.seasons.findIndex(item => item.number === target.season));
  const [t, setT] = useState(initialIndex);
  const [expanded, setExpanded] = useState(target.episode ? `${target.season}:${target.episode}` : '');
  const [expandedPack, setExpandedPack] = useState('');
  const [packsOpen, setPacksOpen] = useState(false);
  const [pendingPack, setPendingPack] = useState<CatalogSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const season = detail.seasons[t];
  // Best version: Play prepares the top-ranked source of the selected season's target episode (movies: of the title); Choose version opens the whole ranked list.
  const playEpisode = season && (target.episode && target.season === season.number ? season.episodes.find(item => item.number === target.episode) : undefined) || season?.episodes[0];
  const firstSource = bestSourceForDetail(detail, { season: season?.number, episode: playEpisode?.number });
  const versionPool = detail.title.kind === 'series' && detail.seasons.length > 0 ? playEpisode?.sources || [] : detail.sources;
  const canPlay = Boolean(firstSource);
  const unknownKey = season ? `unknown:${season.number}` : '';
  const unknownOpen = expanded === unknownKey;
  useOverlayFocus(Boolean(pendingPack), () => { if (!deleting) setPendingPack(null) });
  const confirmDelete = async () => { if (!pendingPack || !season || deleting) return; setDeleting(true); try { await onPackAction(pendingPack, season.number, 'delete'); setPendingPack(null) } finally { setDeleting(false) } };
  // Refresh re-runs the whole pipeline with force: provider data and tracker
  // search (new sources, fresh seeds/peers), then the view rebuilds from the
  // existing catalog.updated SSE listener and 3s series polling.
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await api.refreshTitle(detail.title.id, detail.title.title, true) } catch (e) { onError((e as Error).message) } finally { setRefreshing(false) }
  };
  const episodeRow = (e: CatalogEpisode) => {
    const key = `${e.season}:${e.number}`;
    const open = expanded === key;
    return <article class={open ? 'expanded' : ''}><button class="episode-select" aria-expanded={open} onClick={() => setExpanded(current => current === key ? '' : key)}><span class="episode-copy"><strong>{e.number ? `${e.number}. ` : ''}{e.title}</strong><small>{episodeFacts(e)}</small></span><MediaBadges state={e.libraryState} /><b>{open ? 'Hide versions' : 'Show versions'}</b></button>{open && <SourceRows sources={e.sources} onSource={onSource} compact />}</article>;
  };
  return <div class="overlay" role="dialog" aria-modal="true" aria-label={`${detail.title.title} details`}><article class="detail"><button class="close" onClick={onClose}>Close</button><div class="detail-hero"><div class="detail-art" aria-hidden="true"><Artwork title={detail.title} kind="backdrop" /></div><div class="detail-scrim" /><div class="detail-poster"><Artwork title={detail.title} kind="poster" /></div><section class="detail-copy"><h2>{detail.title.title}</h2><p class="detail-facts">{titleFacts(detail.title).join(' · ')}</p>{detail.title.genres && detail.title.genres.length > 0 && <p class="title-genres">{detail.title.genres.join(' · ')}</p>}<MediaBadges state={detail.title.libraryState} />{detail.title.overview && <p class="detail-overview">{detail.title.overview}</p>}<div class="actions">{resume ? <button class="primary" onClick={() => onResume(resume)} aria-label={`${resumeActionLabel(resume, detail.title.kind)} at saved position`}><Icon name="play" />{resumeActionLabel(resume, detail.title.kind)}</button> : canPlay && firstSource && <><button class="primary" onClick={() => onSource(firstSource)}><Icon name="play" />{playActionLabel(firstSource)}</button><button onClick={() => onChoose(rankSources(versionPool, { season: season?.number, episode: playEpisode?.number }))}>Choose version</button></>}<button onClick={() => void onFavorite(!favorite)}><Icon name="heart" />{favorite ? 'Remove from My List' : 'Add to My List'}</button><button class="ghost" disabled={refreshing} title="Re-fetches series data from the metadata providers and searches all trackers again, then rebuilds this episode list." onClick={() => void refresh()}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh data'}</button><button onClick={event => onInfo(detail.title, event.currentTarget)}><Icon name="info" />Info</button></div>{resume && <small class="resume-file">{resumeLine(resume, detail.title.kind)}</small>}</section></div>{detail.title.kind === 'series' ? <><div class="season-tabs">{detail.seasons.map((s, i) => <button class={i === t ? 'selected' : ''} aria-pressed={i === t} onClick={() => { setT(i); setExpanded(''); setExpandedPack('') }}><span>{s.title}</span><MediaBadges state={s.libraryState} /></button>)}</div>{season?.packSources && season.packSources.length > 0 && <section class="season-pack-actions"><button class="packs-toggle" aria-expanded={packsOpen} onClick={() => setPacksOpen(current => !current)}><span class="packs-toggle-copy"><strong>Complete season versions ({season.packSources.length})</strong><small>{packsOpen ? 'Select a version to review it. Downloads start only from the button inside the expanded version.' : 'Show the complete season downloads.'}</small></span><b>{packsOpen ? 'Hide' : 'Show'}</b></button>{packsOpen && <div>{season.packSources.map(source => <SeasonPackCard key={source.release.id} source={source} season={season.number} open={expandedPack === source.release.id} onToggle={() => setExpandedPack(current => current === source.release.id ? '' : source.release.id)} onAction={onPackAction} onDelete={() => setPendingPack(source)} />)}</div>}</section>}{season && season.episodes.length > 0 ? <div class="episode-list">{season.episodes.map(e => episodeRow(e))}</div> : <p class="episode-loading" role="status">Preparing the individual episode list. This page updates automatically when it is ready.</p>}{season?.unknown && season.unknown.length > 0 && <section class="unknown-group"><button class="unknown-header" aria-expanded={unknownOpen} onClick={() => setExpanded(current => current === unknownKey ? '' : unknownKey)}><strong>Unknown episodes ({season.unknown.length})</strong><span>Files that did not match the metadata provider</span><b>{unknownOpen ? 'Hide' : 'Show'}</b></button>{unknownOpen && <div class="episode-list">{season.unknown.map(e => episodeRow(e))}</div>}</section>}</> : <SourceRows sources={detail.sources} onSource={onSource} />}</article>{pendingPack && <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="season-pack-delete-heading"><section class="removal-confirm"><h2 id="season-pack-delete-heading">Delete season download?</h2><p class="release-name">{pendingPack.release.name}</p><p class="tracker-name"><TrackerBadge id={pendingPack.release.trackerId} name={pendingPack.release.trackerName} /></p><p>This removes the shared season torrent from qBittorrent and permanently deletes every episode file in it.</p><div class="confirm-actions"><button disabled={deleting} onClick={() => setPendingPack(null)}>Cancel</button><button class="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete download'}</button></div></section></div>}</div>;
}
function SourceRow({ source, onSource }: { source: CatalogSource; onSource: (s: CatalogSource) => void }) {
  const spec = sourceSpec(source); const [open, setOpen] = useState(false); const detailsId = useId();
  return <article class="source-row"><button type="button" class="source-main" onClick={() => onSource(source)}><span class="source-spec"><strong class="source-headline">{spec.headline}</strong>{spec.chips.map(chip => <span class="chip" key={chip}>{chip}</span>)}{spec.audio && <span class="source-audio">{spec.audio}</span>}</span><span class="source-meta"><span class="source-facts"><span>{spec.size}</span><span>{spec.seeders}</span></span><TrackerBadge id={source.release.trackerId} name={source.release.trackerName} /></span><span class="source-action"><MediaBadges state={source.libraryState} /><b>{sourceActionLabel(source)}</b></span></button><button type="button" class="details-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(value => !value)}>{open ? 'Hide details' : 'Details'}</button>{open && <dl class="source-details" id={detailsId}>{spec.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</article>;
}
function SourceRows({ sources, onSource, compact = false }: { sources: CatalogSource[]; onSource: (s: CatalogSource) => void; compact?: boolean }) { const ordered = [...sources].sort((a, b) => { const rank = (source: CatalogSource) => source.libraryState?.downloadState === 'downloaded' ? 0 : source.libraryState?.downloadState && source.libraryState.downloadState !== 'none' ? 1 : 2; return rank(a) - rank(b) || b.release.seeders - a.release.seeders }); return <div class={`source-rows ${compact ? 'compact' : ''}`}>{ordered.map(s => <SourceRow key={`${s.release.id}:${s.fileIndex ?? ''}`} source={s} onSource={onSource} />)}</div> }
function SourcePicker({ sources, onClose, onChoose }: { sources: CatalogSource[]; onClose: () => void; onChoose: (s: CatalogSource) => void }) {
  const [sort, setSort] = useState('best'); const ranks: Record<string, number> = { "2160p": 4, "1080p": 3, "720p": 2, "480p": 1 }; const resolution = (value: string) => ranks[value] || 0;
  const sorted = sort === 'best' ? rankSources(sources) : [...sources].sort((a, b) => sort === 'size' ? (b.fileSizeBytes || b.release.sizeBytes) - (a.fileSizeBytes || a.release.sizeBytes) : sort === 'resolution' ? resolution(b.parsed.resolution || '') - resolution(a.parsed.resolution || '') : b.release.seeders - a.release.seeders);
  return <div class="overlay picker" role="dialog" aria-modal="true" aria-label="Choose version"><section><header><h2>Choose version</h2><select value={sort} onChange={event => setSort(event.currentTarget.value)} aria-label="Sort versions"><option value="best">Best match</option><option value="seeders">Most seeders</option><option value="resolution">Best resolution</option><option value="size">Largest file</option></select><button onClick={onClose}>Close</button></header><SourceRows sources={sorted} onSource={onChoose} /></section></div>
}

function LibraryCategories({ items, onOpen }: { items: LibraryCategory[]; onOpen: (item: HouseholdItem) => void }) { const [selected, setSelected] = useState(''); const [media, setMedia] = useState<HouseholdItem[]>([]); const [message, setMessage] = useState(''); async function open(name: string) { setSelected(name); setMessage('Loading your media…'); try { const page = await api.libraryCategories(name); setMedia(canonicalHouseholdItems(page.items as HouseholdItem[])); setMessage('') } catch (e) { setMessage((e as Error).message) } } return <section><p class="supporting">Downloaded, watched, in-progress, and favorited media grouped by tracker category.</p>{selected && <button onClick={() => { setSelected(''); setMedia([]) }}>All categories</button>}{message && <p role="status">{message}</p>}{selected ? <><div class="section-heading category-heading"><h2>{selected}</h2><span>{media.length} item{media.length === 1 ? '' : 's'}</span></div><div class="library-category-media">{media.map(item => <LegacyCard item={item} onOpen={onOpen} />)}</div>{media.length === 0 && <p class="empty">No media remains in this category.</p>}</> : <>{items.length === 0 && !message && <p class="empty">No library categories yet. Download or watch a title and its category appears here.</p>}<section class="category-grid">{items.map(item => <button onClick={() => void open(item.name)}><Icon name="folder" /><strong>{item.name}</strong><span>{item.count} item{item.count === 1 ? '' : 's'}</span></button>)}</section></>}</section> }

// Bootstrap when served from index.html; module imports (tests) skip the mount.
const appRoot = document.getElementById('app');
if (appRoot) render(<App />, appRoot);
