import { Fragment, render, type JSX } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { API, clearRecentSearches, deviceStorage, loadRecentSearches, recordRecentSearch, bestSourceForDetail, playActionLabel, rankSources, canonicalHouseholdItems, cueDisplayText, canonicalLanguage, ControlsVisibility, autoSubtitleOrder, fallbackSubtitleLanguage, subtitleItemDetail, subtitlePreferenceLanguage, languageDisplayName, CatalogDetail, CatalogEpisode, CatalogFacets, CatalogSeason, CatalogSource, CatalogTitle, Download, DownloadSort, downloadTransferActions, DownloadTransferAction, formatBytes, groupDownloadsByTorrent, HouseholdItem, HouseholdState, Job, JobLog, LibraryCategory, MediaState, orderDownloadIDs, PlaybackPreferences, PortalPromotion, PortalState, promotionScreenTimeMs, reconcileDownloads, Release, resumeActionLabel, resumeForTitle, seasonPackActionLabel, SubtitleCandidate, subtitleItemLabel, subtitleMenuGroups, TrackerStatus, UpdateStatus, type DownloadGroup, SettingsField } from '@torrent-tv/shared';
import { episodeAirLabel, episodePageView, formatRuntime, infoCrumbs, releaseLine, type InfoSeasonDetail, type TitleInfo } from '@torrent-tv/shared';
import { centredScrollTop, chooseStructuredTarget, focusElement, remoteAction, revealElement, useTVNavigation, visibleFocusables } from './navigation';
import { LANDING_REQUEST_EVENT, landingTarget, requestLanding, useLanding } from './landing';
import { confirmDialogStale, dialogRestoreKey, promotionsVisible, recoverySettles, snapshotEventAllowed } from './portal';
import { AVTrack, clampSeek, formatTime, isDownloadComplete, isEditableTarget, normalizeTrack, parseVTT, playerAction, preferredAudio, preferredSubtitle, SubtitleCue, subtitleAt } from './player';
import { PlayerKeyController, type PlayerFocus } from './player-keys';
import { HOME_ROW, homeExtraRowsDue, homeHero, homeRowItems, homeRowSpecs, householdSections, nearEnd } from './catalog-data';
import { discoverServers, DiscoveredServer, normalizeServerURL } from './discovery';
import { Backdrop } from './backdrop';
import { captureNav, type NavSnapshot } from './nav-snapshot';
import { Icon, AppMark } from './icons';
import { cardMeta, cardRating, continueCardLine, heroKind, heroTitleParts, episodeState, timeLeft, playsLine, titleKind, episodeMeta, episodeCode, prepareHint, readyLine, readyPercent, downloadStatus, heroFacts, jobKindLabel, jobStatusLine, libraryCardLine, playerChoiceLine, playerHeading, remainingTime, resumeLine, sourceChips, sourceHeadline, watchProgress, jobState, jobWhatRan, relativeTime, allocationUse, downloadFilterOf, downloadRow, type DownloadFilter } from './display';
import { appIdentity } from './app-name';
import { exitApplication, getNetworkInfo, onAppVisibilityChange, openExternalURL, registerMediaKeys } from './platform';
import { applyGraphicsClass, detectCapabilities } from './capability';
import { memo, useStableCallback } from './memo';
import { createStatusStore, useStatus, type StatusStore } from './status-store';
import { ART_SETTLE_MS, inReach, inRowReach, railWindows, resetFocusPoint, setFocusPoint, useArtReach, useListArtReach, useRowReach } from './lazy-art';
import { FamilyChips, FamilyTiles } from './families';
import type { CategoryFamily } from '@torrent-tv/shared';
import { TitleInfoPanel } from './title-info-panel';
import { MoreMenu, MoreMenuLayer } from './more-menu';
import { SETTINGS_GROUPS_REGION, TVSettings, settingsBack, settingsDirection } from './settings';
import { groupOfKey, type SettingsGroupId } from './settings-groups';
export { TVSettings };
import { HUBS, hubDestination, hubOf, knownRoute, loadHubMemory, rememberTab, saveHubMemory, screenHeading, type HubMemory, type TVRoute } from './hubs';
import '@torrent-tv/shared/design/fonts.css';
import '@torrent-tv/shared/design/tokens.css';
import './tv.css';
import './performance.css';

const STORAGE = 'filelist.serverUrl';
const HOME_SPECS = homeRowSpecs();
const emptyState: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const emptyFacets: CatalogFacets = { categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] };
const needsEpisodeExpansion = (detail: CatalogDetail) => detail.title.kind === 'series' && detail.seasons.some(season => (season.packSources?.length || 0) > 0 && season.episodes.length === 0);
type DetailTarget = { season?: number; episode?: number };

// Library state as words with a dot, so it never rests on colour alone. On a ~210 px card (`compact`) the words are the
// short ones that fit whole and the dot is dropped; the full state stays in the label.
function TVStateBadges({ state, compact }: { state?: MediaState; compact?: boolean }) {
 if (!state?.downloadState || !state.watchState) return null;
 const download = state.downloadState; const watch = state.watchState; const percent = Math.round((state.progress || 0) * 100);
 const downloadWord = download === 'downloaded' ? 'Downloaded' : download === 'partial' ? 'Some downloaded' : download === 'error' ? 'Needs attention' : download === 'queued' ? 'Queued' : `Downloading ${percent}%`;
 const watchWord = watch === 'watched' ? 'Watched' : watch === 'partial' ? 'Some watched' : 'In progress';
 const short = (word: string) => !compact ? word : word === 'Some downloaded' ? 'Partial' : word === 'Needs attention' ? 'Failed' : word.startsWith('Downloading') ? `${percent}% done` : word === 'Some watched' || word === 'In progress' ? 'Started' : word;
 return <span class="tv-state-badges">{download !== 'none' && <span class={`tv-state-badge download ${download}`} aria-label={downloadWord}>{!compact && <i aria-hidden="true" />}<b>{short(downloadWord)}</b></span>}{watch !== 'unwatched' && <span class={`tv-state-badge watch ${watch}`} aria-label={watchWord}>{!compact && <i aria-hidden="true" />}<b>{short(watchWord)}</b></span>}</span>;
}

type TVDownloadAnchor = { id: string; top: number; scrollTop: number };
function captureTVDownloadAnchor(): TVDownloadAnchor | null { const container = document.querySelector<HTMLElement>('.tv-content'); if (!container) return null; const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-download-id]')); const row = rows.find(item => item.getBoundingClientRect().bottom > container.getBoundingClientRect().top); return row ? { id: row.dataset.downloadId || '', top: row.getBoundingClientRect().top, scrollTop: container.scrollTop } : null }
function restoreTVDownloadAnchor(anchor: TVDownloadAnchor | null) { if (!anchor) return; const container = document.querySelector<HTMLElement>('.tv-content'); const row = document.querySelector<HTMLElement>(`[data-download-id="${CSS.escape(anchor.id)}"]`); if (!container || !row) return; const delta = row.getBoundingClientRect().top - anchor.top; if (Math.abs(delta) > 0.5) container.scrollTop += delta }

window.FileListBoot?.stage('Rendering interface');

type SubtitleMenuRow = { key: string; row: number; position: number; heading: string; candidate: SubtitleCandidate; detail: string };
function subtitleMenuRows(candidates: SubtitleCandidate[], firstRow: number, keyPrefix: string): SubtitleMenuRow[] {
 const rows: SubtitleMenuRow[] = [];
 let row = firstRow;
 for (const group of subtitleMenuGroups(candidates)) {
  let headingPending = true;
  for (const candidate of group.items) {
   const detail = subtitleItemDetail(candidate);
   rows.push({ key: `${keyPrefix}-${candidate.provider}-${candidate.id}`, row: row++, position: rows.length + 1, heading: headingPending ? group.label : '', candidate, detail });
   headingPending = false;
  }
 }
 return rows;
}

const defaultPlayerPreferences: PlaybackPreferences = { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' };

// One Player toolbar control: a round icon button with its label under the circle. The label is the accessible
// name unless `name` adds a detail the screen does not print (the track count). Row 1 and the column are the pinned
// Control focus order (DESIGN.md "TV interaction").
function PlayerControl({ control, col, icon, label, name, primary, open, onClick }: { control: string; col: number; icon: string; label: string; name?: string; primary?: boolean; open?: boolean; onClick: () => void }) {
 const menu = open !== undefined;
 return <button data-player-control={control} data-focus-region="player-controls" data-focus-row="1" data-focus-col={String(col)} data-focus-key={`player-${control}`} class={primary ? 'primary' : open ? 'open' : undefined} aria-label={name} aria-haspopup={menu ? 'true' : undefined} aria-expanded={menu ? open : undefined} onClick={onClick}><span class="player-glyph"><Icon name={icon} /></span><span class="player-label">{label}</span></button>;
}
const trackCount = (count: number) => `${count} track${count === 1 ? '' : 's'}`;

export function Player({ api, download, resumeMs, preferences, onClose, onStateChanged, onComplete, onEpisode }: { api: API; download: Download; resumeMs: number; preferences?: PlaybackPreferences; onClose: () => void; onStateChanged: () => void; onComplete: (preferences: PlaybackPreferences) => void; onEpisode?: (next: Download, preferences: PlaybackPreferences) => void }) {
 const [message, setMessage] = useState('Opening stream…');
 const [phase, setPhase] = useState<'opening' | 'playing' | 'paused' | 'buffering' | 'waiting' | 'failed'>('opening');
 const [position, setPosition] = useState(resumeMs);
 const [total, setTotal] = useState(0);
 const [controlsVisible, setControlsVisible] = useState(true);
 const [tracks, setTracks] = useState<AVTrack[]>([]);
 const [menu, setMenu] = useState<null | 'audio' | 'subtitles' | 'find-subtitles' | 'options' | 'info'>(null);
 const [subtitleCandidates, setSubtitleCandidates] = useState<SubtitleCandidate[]>([]);
 const [subtitleDelay, setSubtitleDelay] = useState(0);
 const [externalSubtitle, setExternalSubtitle] = useState('');
 const [aspect, setAspect] = useState('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
 const [liveDownload, setLiveDownload] = useState(download);
 const [readyDownload, setReadyDownload] = useState<Download | null>(null);
 const [choice, setChoice] = useState(() => playerChoiceLine(preferences || defaultPlayerPreferences));
 const current = useRef(resumeMs);
 const duration = useRef(0);
 const lastSaved = useRef(0);
 const session = useRef(0);
 const completedRetryUsed = useRef(false);
 const pollTimer = useRef(0);
 const messageTimer = useRef(0);
 const audioTimer = useRef(0);
 const autoplayIntent = useRef(true);
 const suspendedState = useRef<{ position: number; playing: boolean } | null>(null);
 const controlsVisibleRef = useRef(true);
 const subtitleDelayRef = useRef(0);
 const subtitleCues = useRef<SubtitleCue[]>([]);
 const playing = useRef(false);
 const autoSubtitleAttempted = useRef(false);
 const preferenceRef = useRef<PlaybackPreferences>(preferences || defaultPlayerPreferences);
 const osdText = useRef('');
 const phaseRef = useRef(phase);
 const messageRef = useRef(message);
 const menuRef = useRef(menu);
 const lastControlFocus = useRef('play');
 const keysRef = useRef<PlayerKeyController | null>(null);
 const menuLauncher = useRef('play');
 const episodeBusy = useRef(false);
 phaseRef.current = phase;
 messageRef.current = message;
 menuRef.current = menu;
 controlsVisibleRef.current = controlsVisible;
 subtitleDelayRef.current = subtitleDelay;
 const controls = useMemo(() => new ControlsVisibility({ policy: { armWhilePaused: true, statusHolds: false }, onChange: value => { controlsVisibleRef.current = value; setControlsVisible(value); if (!value) keysRef.current?.controlsHidden(); } }), []);
 const save = async () => { if (duration.current > 0) try { await api.updatePlayback(download.id, current.current, duration.current); onStateChanged() } catch { } };
 const savePreferences = async (value: PlaybackPreferences) => { preferenceRef.current = value; setChoice(playerChoiceLine(value)); try { preferenceRef.current = await api.updatePlaybackPreferences(download.id, value); setChoice(playerChoiceLine(preferenceRef.current)) } catch { } };

 // Channel Up / Down: save progress, ask the server for the sibling episode, and hand it to the app. A result that
 // arrives after the player closed or suspended (session changed) is dropped, like a stale stream-completed event.
 async function skipEpisode(direction: 'next' | 'previous') {
  if (!onEpisode || episodeBusy.current) return false;
  episodeBusy.current = true;
  const token = session.current;
  try {
   await save();
   showTransientMessage(direction === 'next' ? 'Loading next episode…' : 'Loading previous episode…', 10_000);
   const target = await (direction === 'next' ? api.nextEpisode(download.id) : api.previousEpisode(download.id));
   if (token !== session.current) return false; // the player closed or suspended: no switch happened
   if (!target) { showTransientMessage(direction === 'next' ? 'No next episode' : 'No previous episode'); return false; }
   onEpisode(target, preferenceRef.current);
   return true;
  } catch (error) {
   if (token === session.current) showTransientMessage(`Could not start the ${direction} episode: ${(error as Error).message}`, 5000);
   return false;
  } finally { episodeBusy.current = false; }
 }

 function stopAVPlay() {
  const av = window.webapis?.avplay;
  try { av?.stop(); } catch { }
  try { av?.close(); } catch { }
 }

 function revealControls(sticky = false) {
  controlsVisibleRef.current = true;
  setControlsVisible(true);
  controls.reveal(sticky);
 }
 function hideControls() {
  controlsVisibleRef.current = false;
  setControlsVisible(false);
  controls.hide();
 }

 function showTransientMessage(value: string, duration = 3000) {
  window.clearTimeout(messageTimer.current);
  setMessage(value);
  messageTimer.current = window.setTimeout(() => { if (messageRef.current === value) setMessage('') }, duration);
 }

 function focusControl(key = lastControlFocus.current) {
  window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-player-control="${key}"]`)), 0);
 }
 function keepControl(key: string, action: () => void) { lastControlFocus.current = key; action(); revealControls(); focusControl(key) }

 function openMenu(next: Exclude<typeof menu, null>, launcher: string) {
  menuLauncher.current = launcher;
  lastControlFocus.current = launcher;
  setMenu(next);
  controls.setPanelOpen(true);
  revealControls(true);
  window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('.player-dialog button')), 0);
 }

 function closeMenu() {
  const launcher = menuLauncher.current;
  setMenu(null);
  controls.setPanelOpen(false);
  revealControls();
  focusControl(launcher);
 }
 function switchMenu(next: Exclude<typeof menu, null>, openerKey: string) {
  setMenu(next);
  controls.setPanelOpen(true);
  revealControls(true);
  window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${openerKey}"]`)), 0);
 }

 function refreshTracks() { const av = window.webapis?.avplay; try { const all = (av?.getTotalTrackInfo?.() || []).map(normalizeTrack); if (all.length) setTracks(all); } catch { } }

 function togglePlayback(force?: boolean) {
  const av = window.webapis?.avplay;
  try {
   const shouldPlay = force ?? !playing.current;
   autoplayIntent.current = shouldPlay;
   if (shouldPlay) { av.play(); playing.current = true; setPhase('playing'); setMessage(''); controls.setPlaying(true); revealControls(); }
   else { av.pause(); playing.current = false; setPhase('paused'); setMessage('Paused'); controls.setPlaying(false); revealControls(); save(); }
  } catch { }
 }

 async function recover(error: string, token: number) {
  if (token !== session.current) return;
  const recoveryToken = ++session.current;
  stopAVPlay();
  let latest = liveDownload;
  try { latest = (await api.downloads()).items.find(item => item.id === download.id) || latest; setLiveDownload(latest); } catch { }
  const terminal = /error|missing|unavailable|unknown/i.test(latest.state);
  if (!isDownloadComplete(latest) && !terminal) {
   playing.current = false;
   controls.setPlaying(false);
   setPhase('waiting');
   setMessage('Waiting for the next downloaded segment…');
   revealControls(true);
   const poll = async () => {
    if (recoveryToken !== session.current) return;
    try {
     const next = (await api.downloads()).items.find(item => item.id === download.id);
     if (next) {
      setLiveDownload(next);
      if (/error|missing|unavailable|unknown/i.test(next.state)) { setPhase('failed'); setMessage(`Playback failed: ${next.error || next.state}`); return; }
      setMessage(`${next.playbackMode === 'progressive' ? 'Streaming while downloading' : 'Download complete'} · ${Math.round(next.progress * 100)}% · ${formatBytes(next.downloadedBytes)} / ${formatBytes(next.sizeBytes)}${next.speedBytesPerSecond > 0 ? ` · ${formatBytes(next.speedBytesPerSecond)}/s` : ''}${next.etaSeconds > 0 ? ` · ${formatTime(next.etaSeconds * 1000)} left` : ''}`);
      void openPlayer(current.current); return;
     }
    } catch { }
    pollTimer.current = window.setTimeout(poll, 2000);
   };
   pollTimer.current = window.setTimeout(poll, 2000);
   return;
  }
  if (isDownloadComplete(latest) && !completedRetryUsed.current) { completedRetryUsed.current = true; void openPlayer(current.current); return; }
  playing.current = false;
  controls.setPlaying(false);
  setPhase('failed');
  setMessage(`Playback failed: ${error}`);
  revealControls(true);
 }

 function openPlayer(position: number, autoplay = true) {
  const av = window.webapis?.avplay;
  if (!av) { setPhase('failed'); setMessage('AVPlay is unavailable on this device.'); return; }
  window.clearTimeout(pollTimer.current);
  const token = ++session.current;
  autoplayIntent.current = autoplay;
  stopAVPlay();
  setPhase('opening'); setMessage(liveDownload.playbackMode === 'progressive' ? 'Opening progressive stream…' : 'Opening downloaded file…'); revealControls(true);
  try {
   av.open(api.streamURL(download.streamUrl));
   av.setDisplayRect(0, 0, 1920, 1080);
   av.setDisplayMethod(aspect);
   av.setListener({
    onbufferingstart: () => { if (token === session.current) { playing.current = false; setPhase('buffering'); setMessage('Buffering…'); controls.setPlaying(false); revealControls(true); } },
    onbufferingprogress: (progress: number) => { if (token === session.current) setMessage(`Buffering ${progress}%`); },
    onbufferingcomplete: () => {
     if (token === session.current) {
      refreshTracks();
      if (autoplayIntent.current) {
       playing.current = true;
       setPhase('playing');
       setMessage('');
       controls.setPlaying(true);
       revealControls();
      } else {
       playing.current = false;
       setPhase('paused');
       setMessage('Paused');
       controls.setPlaying(false);
       revealControls(true);
      }
     }
    },
    onstreamcompleted: () => { if (token === session.current) { current.current = duration.current; void save().then(() => onComplete(preferenceRef.current)); } },
    oncurrentplaytime: (value: number) => { if (token === session.current) { if (keysRef.current && !keysRef.current.playtime(value)) return; current.current = value; setPosition(value); if (subtitleCues.current.length) setExternalSubtitle(subtitleAt(subtitleCues.current, value, subtitleDelayRef.current)); if (Date.now() - lastSaved.current >= 10_000) { lastSaved.current = Date.now(); save(); } } },
    onsubtitlechange: (_duration: number, text: string) => { if (token === session.current) setExternalSubtitle(cueDisplayText(String(text || ''))); },
    ontrackschanged: () => { if (token === session.current) refreshTracks(); },
    onerror: (error: string) => void recover(error, token),
   });
   av.prepareAsync(() => {
    if (token !== session.current) return;
    duration.current = av.getDuration(); setTotal(duration.current);
    const allTracks = (av.getTotalTrackInfo?.() || []).map(normalizeTrack); setTracks(allTracks); applyAudioPreference(allTracks);
    if (!autoSubtitleAttempted.current) { autoSubtitleAttempted.current = true; void autoSelectSubtitles(allTracks); }
    if (position > 0 && position < duration.current) av.seekTo(clampSeek(position, duration.current));
    if (autoplay) { av.play(); playing.current = true; setPhase('playing'); setMessage(''); controls.setPlaying(true); revealControls(); }
    else { playing.current = false; setPhase('paused'); setMessage('Paused'); controls.setPlaying(false); revealControls(true); }
   }, (error: string) => void recover(error || 'AVPlay could not prepare this source.', token));
  } catch (error) { void recover((error as Error).message, token); }
 }

 useEffect(() => {
  let cancelled = false; void (async () => { try { preferenceRef.current = preferences || await api.playbackPreferences(download.id); if (!cancelled) setChoice(playerChoiceLine(preferenceRef.current)) } catch { } if (!cancelled) openPlayer(resumeMs) })();
  const focusTimer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-player-control="play"]')), 0);
  const disposeVisibility = onAppVisibilityChange(visible => {
   if (!visible) {
    void save();
    suspendedState.current = { position: current.current, playing: playing.current };
    session.current++;
    window.clearTimeout(pollTimer.current);
    keysRef.current?.dispose();
    window.clearTimeout(messageTimer.current);
    window.clearTimeout(audioTimer.current);
    controls.dispose();
    stopAVPlay();
    return;
   }
   if (suspendedState.current) {
    const { position, playing: wasPlaying } = suspendedState.current;
    suspendedState.current = null;
    openPlayer(position, wasPlaying);
   }
  });
  return () => { cancelled = true; disposeVisibility(); session.current++; window.clearTimeout(focusTimer); window.clearTimeout(pollTimer.current); controls.dispose(); keysRef.current?.dispose(); window.clearTimeout(messageTimer.current); window.clearTimeout(audioTimer.current); void save(); stopAVPlay(); };
 }, [download.id]);
 // Getting ready: while the stream opens, buffers or waits for a segment, poll the download every 2 s for the
 // progress panel. Render-only: never touches focus, controls or the key controller; a failed poll keeps the plain status.
 const gettingReady = phase === 'opening' || phase === 'buffering' || phase === 'waiting';
 useEffect(() => {
  if (!gettingReady) return;
  let stopped = false; let running = false;
  const refresh = async () => {
   if (stopped || running || suspendedState.current) return;
   running = true;
   try { const found = (await api.downloads()).items.find(item => item.id === download.id); if (!stopped && found) setReadyDownload(found); } catch { } finally { running = false; }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 2000);
  return () => { stopped = true; window.clearInterval(timer); };
 }, [download.id, gettingReady]);
 useEffect(() => {
  const remember = (event: FocusEvent) => {
   const target = event.target as HTMLElement | null;
   const key = target?.dataset.playerControl;
   if (key && key !== 'timeline') lastControlFocus.current = key;
  };
  const controlElements = () => Array.from(document.querySelectorAll<HTMLElement>(menuRef.current ? '.player-dialog button' : '[data-player-control]')).filter(element => element.offsetWidth > 0);
  const focused = (): PlayerFocus => {
   const active = document.activeElement as HTMLElement | null;
   if (!active || !controlElements().includes(active)) return { where: 'none', key: null, row: null };
   const row = active.dataset.focusRow ?? null;
   if (menuRef.current) return { where: 'menu', key: null, row };
   const key = active.dataset.playerControl ?? null;
   return { where: key === 'timeline' ? 'timeline' : 'toolbar', key, row };
  };
  const keys = new PlayerKeyController({
   controlsVisible: () => controlsVisibleRef.current,
   menuOpen: () => menuRef.current !== null,
   focused,
   remembered: () => lastControlFocus.current,
   remember: key => { lastControlFocus.current = key; },
   reveal: hold => revealControls(hold),
   duration: () => duration.current,
   position: () => current.current,
   setPosition: ms => { current.current = ms; setPosition(ms); },
   announce: ms => showTransientMessage(`${formatTime(ms)} / ${formatTime(duration.current)}`, 1500),
   avSeekTo: (ms, onSuccess, onError) => {
    const av = window.webapis?.avplay;
    if (!av) throw new Error('AVPlay is unavailable on this device.');
    av.seekTo(ms, onSuccess, (error: any) => onError(String(error?.message || error?.name || error || 'AVPlay could not seek.')));
   },
   seekFailed: error => { setMessage(`Seek failed: ${error}`); void recover(`Seek failed: ${error}`, session.current); },
   focusControl: key => focusControl(key),
   activateControl: key => document.querySelector<HTMLElement>(`[data-player-control="${key}"]`)?.click(),
   activateFocused: () => (document.activeElement as HTMLElement | null)?.click(),
   focusFirstMenuItem: () => focusElement(controlElements()[0] || null),
   navigate: direction => { const active = document.activeElement as HTMLElement | null; const target = active ? chooseStructuredTarget(active, controlElements(), direction) : null; if (target) focusElement(target); },
   togglePlayback: force => togglePlayback(force),
   back: () => { if (menuRef.current) closeMenu(); else { save(); onClose(); } },
   skipEpisode: direction => skipEpisode(direction),
  });
  keysRef.current = keys;
  const key = (event: KeyboardEvent) => {
   const action = playerAction(event.key, event.keyCode);
   if (!action || isEditableTarget(event.target as HTMLElement | null)) return;
   event.preventDefault();
   keys.handle(action, event.repeat);
  };
  addEventListener('focusin', remember);
  addEventListener('keydown', key);
  return () => { keys.dispose(); keysRef.current = null; removeEventListener('focusin', remember); removeEventListener('keydown', key); };
 }, [download.id]);

 function chooseTrack(type: 'AUDIO' | 'TEXT', index: number | null) {
  const av = window.webapis?.avplay;
  try {
   if (type === 'TEXT' && index === null) {
    av.setSilentSubtitle(true);
    subtitleCues.current = [];
    setExternalSubtitle('');
   } else {
    if (type === 'TEXT') {
     av.setSilentSubtitle(false);
     subtitleCues.current = [];
     setExternalSubtitle('');
    }
    av.setSelectTrack(type, index);
    if (type === 'AUDIO') {
     const wasPlaying = playing.current;
     if (!wasPlaying) av.play();
     window.clearTimeout(audioTimer.current);
     audioTimer.current = window.setTimeout(() => {
      try {
       av.seekTo(clampSeek(keysRef.current?.resumeTarget() ?? current.current, duration.current));
       if (!wasPlaying) av.pause();
       refreshTracks();
      } catch { }
     }, 120);
    }
   }
  } catch (error) {
   setMessage('Could not select the ' + (type === 'AUDIO' ? 'audio track' : 'subtitle') + ': ' + (error as Error).message);
   closeMenu();
   return;
  }
  closeMenu();
  const selected = index === null ? null : tracks.find(track => track.type === type && track.index === index);
  if (type === 'AUDIO' && selected) void savePreferences({ ...preferenceRef.current, audioLanguage: selected.language || 'en', audioTrackIndex: selected.index });
  if (type === 'TEXT') void savePreferences({ ...preferenceRef.current, subtitleLanguage: subtitlePreferenceLanguage(selected?.language, preferenceRef.current.subtitleLanguage), subtitleProvider: selected ? 'native' : '', subtitleCandidateId: selected ? String(selected.index) : '', subtitleMode: selected ? 'selected' : 'off' });
  showTransientMessage(index === null ? 'Subtitles off' : `${selected?.label || (type === 'AUDIO' ? 'Audio track' : 'Subtitle')} selected`);
 }
 function applyAudioPreference(allTracks: AVTrack[]) { const wanted = preferenceRef.current; const selected = preferredAudio(allTracks, wanted.audioLanguage, wanted.audioTrackIndex); if (selected) { try { window.webapis?.avplay.setSelectTrack('AUDIO', selected.index) } catch { } setChoice(playerChoiceLine({ ...wanted, audioLanguage: selected.language || wanted.audioLanguage })) } }
 async function autoSelectSubtitles(allTracks: AVTrack[]) { const saved = preferenceRef.current; if (saved.subtitleMode === 'off') { try { window.webapis?.avplay.setSilentSubtitle(true) } catch { } return } if (saved.subtitleMode === 'selected' && saved.subtitleProvider === 'native') { const track = allTracks.find(item => item.type === 'TEXT' && String(item.index) === saved.subtitleCandidateId); if (track) { try { window.webapis?.avplay.setSilentSubtitle(false); window.webapis?.avplay.setSelectTrack('TEXT', track.index); return } catch { } } } if (saved.subtitleMode === 'selected' && saved.subtitleProvider && saved.subtitleCandidateId) { if (await installSubtitle({ id: saved.subtitleCandidateId, provider: saved.subtitleProvider, language: saved.subtitleLanguage, title: 'Saved subtitle', score: 1000, cached: true }, false)) return } try { const wanted = saved.subtitleLanguage || 'ro'; const local = await api.subtitles(download.id, wanted, 'local'); setSubtitleCandidates(local.items); for (const candidate of autoSubtitleOrder(local.items, { language: wanted })) if (await installSubtitle(candidate, true)) return; const native = preferredSubtitle(allTracks, wanted); if (native) { try { window.webapis?.avplay.setSilentSubtitle(false); window.webapis?.avplay.setSelectTrack('TEXT', native.index); await savePreferences({ ...saved, subtitleLanguage: subtitlePreferenceLanguage(native.language, saved.subtitleLanguage), subtitleProvider: 'native', subtitleCandidateId: String(native.index), subtitleMode: 'selected' }); return } catch { } } const searched = new Set<string>(); for (const code of [canonicalLanguage(wanted) || 'ro', fallbackSubtitleLanguage(wanted)]) { if (searched.has(code)) continue; searched.add(code); const remote = await api.subtitles(download.id, code, 'remote'); setSubtitleCandidates(current => [...current, ...remote.items]); for (const candidate of remote.items) if (await installSubtitle(candidate, true)) return } setMessage(`No ${[...searched].map(code => languageDisplayName(code)).join(' or ')} subtitle was found.`) } catch (error) { setMessage(`Subtitles unavailable: ${(error as Error).message}`) } }
 async function findSubtitles(automatic = false, scope: 'local' | 'remote' | 'all' = 'remote') {
  if (!automatic && scope === 'remote') openMenu('find-subtitles', 'subtitles');
  setMessage(scope === 'local' ? 'Checking included subtitles…' : 'Searching for Romanian subtitles…');
  try {
   const page = await api.subtitles(download.id, preferenceRef.current.subtitleLanguage || 'ro', scope);
   const candidates = page.items;
   setSubtitleCandidates(candidates);
   if (automatic && candidates.length > 0) { await installSubtitle(candidates[0]); return; }
   setMessage(candidates.length > 0 ? '' : page.warnings?.length ? page.warnings.map(w => `${w.provider}: ${w.message}`).join(' · ') : automatic ? 'No included subtitle was found.' : 'No matching online subtitles were found.');
  } catch (error) { setMessage(`Subtitle search failed: ${(error as Error).message}`); }
 }
 async function installSubtitle(candidate: SubtitleCandidate, persist = true): Promise<boolean> {
  setMessage(candidate.provider === 'embedded' ? `Extracting ${candidate.title}… the first time can take a few minutes` : `Preparing ${candidate.title}…`); if (menuRef.current) closeMenu(); else revealControls(true);
  try {
   const asset = await api.prepareSubtitle(download.id, candidate.provider, candidate.id, 'vtt');
   const response = await fetch(api.streamURL(asset.url)); if (!response.ok) throw new Error(`server returned ${response.status}`); const cues = parseVTT(await response.text()); if (!cues.length) throw new Error('the downloaded subtitle contained no readable cues'); subtitleCues.current = cues; try { window.webapis?.avplay.setSilentSubtitle(true); } catch { } setExternalSubtitle(subtitleAt(cues, current.current, subtitleDelayRef.current)); if (persist) await savePreferences({ ...preferenceRef.current, subtitleLanguage: subtitlePreferenceLanguage(candidate.language, preferenceRef.current.subtitleLanguage), subtitleProvider: candidate.provider, subtitleCandidateId: candidate.id, subtitleMode: 'selected' }); showTransientMessage(`${subtitleItemLabel(candidate, 1)} selected`); revealControls(); return true;
  } catch (error) { setMessage(`Subtitle preparation failed: ${(error as Error).message}`); return false; }
 }
 function changeDelay(delta: number) { const next = Math.max(-10_000, Math.min(10_000, subtitleDelay + delta)); setSubtitleDelay(next); try { window.webapis?.avplay.setSubtitlePosition(next); } catch { } }
 function changeAspect(value: string) { setAspect(value); try { window.webapis?.avplay.setDisplayMethod(value); } catch { } }
 const percent = total > 0 ? Math.min(100, position / total * 100) : liveDownload.progress * 100;
 // The downloaded share of the file, drawn under the played range; the latest record the Player polled (getting ready, waiting) wins.
 const buffered = Math.max(percent, Math.min(100, Math.max(liveDownload.progress, readyDownload?.progress ?? 0) * 100));
 const heading = playerHeading(download);
 const audioTracks = tracks.filter(track => track.type === 'AUDIO');
 const subtitleTracks = tracks.filter(track => track.type === 'TEXT');
 // The server lists every embedded text track already; the device's own list stays only when it has none (picture subtitles or a failed probe), so one physical track is never offered twice.
 const nativeSubtitleTracks = subtitleCandidates.some(candidate => candidate.provider === 'embedded') ? [] : subtitleTracks;
 const subtitleRows = subtitleMenuRows(subtitleCandidates, 1, 'player-subtitle');
 const foundRows = subtitleMenuRows(subtitleCandidates, 0, 'player-found-subtitle');
 if (message) osdText.current = message;
 const osd = message || osdText.current;
 return <div class="player-shell"><object id="av-player" type="application/avplayer"></object><div class={`player ${controlsVisible ? 'controls-visible' : ''}`}>
  {externalSubtitle && <div class="external-subtitle">{externalSubtitle}</div>}
  {gettingReady && readyDownload && <div class="player-ready" aria-live="polite"><strong class="player-ready-title">{readyTitle(download)}</strong><div class="player-ready-bar"><span class="player-ready-fill" style={{ width: `${readyPercent(readyDownload)}%` }} /></div><div class="player-ready-facts"><b>{readyPercent(readyDownload)}%</b>{readyLine(readyDownload) && <span>{readyLine(readyDownload)}</span>}</div></div>}
  {osd && <div class={`player-message${message ? ' on' : ''}`} aria-live="polite">{osd}</div>}
  <div class="player-controls">
   <div class="player-heading"><div class="player-name">{heading.kicker && <div class="player-kicker">{heading.kicker}</div>}<div class="player-title">{heading.title}</div></div>{choice && <div class="player-choice">{choice}</div>}</div>
   <div class="player-bar">
   <button class="player-timeline" data-player-control="timeline" data-focus-region="player-controls" data-focus-row="0" data-focus-col="0" data-focus-key="player-timeline" onClick={() => { revealControls(); focusControl('timeline') }} aria-label="Playback timeline; use left and right to seek"><span class="player-buffered" style={{ width: `${buffered}%` }} /><span class="player-fill" style={{ width: `${percent}%` }}><i /></span></button>
   <div class="player-time"><span>{formatTime(position)}</span><span>{remainingTime(position, total)}</span></div>
   <div class="player-toolbar">
    <PlayerControl control="restart" col={0} icon="restart" label="Restart" onClick={() => keepControl('restart', () => keysRef.current?.seekTo(0))} />
    <PlayerControl control="back-10" col={1} icon="back-10" label="−10 s" onClick={() => keepControl('back-10', () => keysRef.current?.seekBy(-10_000))} />
    <PlayerControl control="play" col={2} icon={playing.current ? 'pause' : 'play'} label={playing.current ? 'Pause' : 'Play'} primary onClick={() => keepControl('play', () => togglePlayback())} />
    <PlayerControl control="forward-10" col={3} icon="forward-10" label="+10 s" onClick={() => keepControl('forward-10', () => keysRef.current?.seekBy(10_000))} />
    <PlayerControl control="audio" col={4} icon="audio" label="Audio" name={`Audio, ${trackCount(audioTracks.length)}`} open={menu === 'audio'} onClick={() => openMenu('audio', 'audio')} />
    <PlayerControl control="subtitles" col={5} icon="subtitles" label="Subtitles" name={`Subtitles, ${trackCount(nativeSubtitleTracks.length + subtitleCandidates.length)}`} open={menu === 'subtitles' || menu === 'find-subtitles'} onClick={() => { openMenu('subtitles', 'subtitles'); void findSubtitles(false, 'local') }} />
    <PlayerControl control="options" col={6} icon="options" label="Options" open={menu === 'options' || menu === 'info'} onClick={() => openMenu('options', 'options')} />
    <PlayerControl control="back" col={7} icon="back" label="Back" onClick={() => { save(); onClose(); }} />
    <PlayerControl control="hide" col={8} icon="hide" label="Hide" onClick={hideControls} />
   </div>
   {phase === 'failed' && <button class="player-retry primary" data-player-control="retry" data-focus-region="player-controls" data-focus-row="2" data-focus-col="2" data-focus-key="player-retry" onClick={() => { completedRetryUsed.current = false; openPlayer(current.current); }}>Retry playback</button>}
  </div></div>
  {menu && <div class="player-dialog">
   {menu === 'audio' && <><h2>Audio track</h2><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-audio-refresh" onClick={refreshTracks}>Refresh tracks</button>{audioTracks.map((track, index) => <button data-focus-region="player-menu" data-focus-row={index + 1} data-focus-col="0" data-focus-key={`player-audio-${track.index}`} onClick={() => chooseTrack('AUDIO', track.index)}>{track.label}</button>)}</>}
   {menu === 'subtitles' && <><h2>Subtitles</h2><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-subtitles-off" onClick={() => chooseTrack('TEXT', null)}>Off</button>{subtitleRows.map(item => <Fragment key={item.key}>{item.heading ? <h3>{item.heading}</h3> : null}<button data-focus-region="player-menu" data-focus-row={item.row} data-focus-col="0" data-focus-key={item.key} onClick={() => void installSubtitle(item.candidate)}><strong>{subtitleItemLabel(item.candidate, item.position)}</strong>{item.detail ? <><br /><small>{item.detail}</small></> : null}</button></Fragment>)}{nativeSubtitleTracks.length > 0 && <><h3>Built-in tracks</h3>{nativeSubtitleTracks.map((track, index) => <button data-focus-region="player-menu" data-focus-row={subtitleRows.length + index + 1} data-focus-col="0" data-focus-key={`player-native-subtitle-${track.index}`} onClick={() => chooseTrack('TEXT', track.index)}>{track.label}</button>)}</>}<button data-focus-region="player-menu" data-focus-row={subtitleRows.length + nativeSubtitleTracks.length + 1} data-focus-col="0" data-focus-key="player-subtitles-find" onClick={() => void findSubtitles(false, 'remote')}>Find online subtitles…</button></>}
   {menu === 'find-subtitles' && <><h2>Download subtitles</h2>{foundRows.length === 0 ? <p>No matching provider subtitles are available.</p> : foundRows.map(item => <Fragment key={item.key}>{item.heading ? <h3>{item.heading}</h3> : null}<button data-focus-region="player-menu" data-focus-row={item.row} data-focus-col="0" data-focus-key={item.key} onClick={() => void installSubtitle(item.candidate)}><strong>{subtitleItemLabel(item.candidate, item.position)}</strong>{item.detail ? <><br /><small>{item.detail}</small></> : null}{item.candidate.releaseName ? <><br /><small>{item.candidate.releaseName}</small></> : null}</button></Fragment>)}</>}
   {menu === 'options' && <><h2>Playback options</h2><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-subtitle-earlier" onClick={() => changeDelay(-500)}>Subtitle earlier (−0.5s)</button><button data-focus-region="player-menu" data-focus-row="1" data-focus-col="0" data-focus-key="player-subtitle-later" onClick={() => changeDelay(500)}>Subtitle later (+0.5s)</button><button data-focus-region="player-menu" data-focus-row="2" data-focus-col="0" data-focus-key="player-subtitle-reset" onClick={() => changeDelay(-subtitleDelay)}>Reset subtitle delay ({subtitleDelay / 1000}s)</button><button data-focus-region="player-menu" data-focus-row="3" data-focus-col="0" data-focus-key="player-aspect-auto" onClick={() => changeAspect('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO')}>Aspect: Auto</button><button data-focus-region="player-menu" data-focus-row="4" data-focus-col="0" data-focus-key="player-aspect-letterbox" onClick={() => changeAspect('PLAYER_DISPLAY_MODE_LETTER_BOX')}>Aspect: Letterbox</button><button data-focus-region="player-menu" data-focus-row="5" data-focus-col="0" data-focus-key="player-aspect-full" onClick={() => changeAspect('PLAYER_DISPLAY_MODE_FULL_SCREEN')}>Aspect: Full screen</button><button data-focus-region="player-menu" data-focus-row="6" data-focus-col="0" data-focus-key="player-info" onClick={() => openMenu('info', 'options')}>Playback information</button></>}
   {menu === 'info' && <><h2>Playback information</h2><p>{download.displayTitle || download.filePath}</p><p>Tracker: {download.trackerName}</p><p>{download.mimeType}</p><p>{formatBytes(download.sizeBytes)} · {tracks.length} tracks</p><p>{formatTime(position)} / {formatTime(total)} · {aspect.replace('PLAYER_DISPLAY_MODE_', '')}</p><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-info-back" onClick={() => switchMenu('options', 'player-info')}>Back to options</button></>}
   <button data-focus-region="player-menu" data-focus-row="99" data-focus-col="0" data-focus-key="player-menu-close" onClick={closeMenu}>Close</button>
  </div>}
 </div></div>;
}

export function Setup({ draft, server, status, onDraft, onConnect, onForget }: { draft: string; server: string; status: string; onDraft: (value: string) => void; onConnect: (url: string) => void; onForget: () => void }) {
 const address = useRef<HTMLInputElement>(null);
 const connect = useRef<HTMLButtonElement>(null);
 const rescan = useRef<HTMLButtonElement>(null);
 const scanGeneration = useRef(0);
 const [manual, setManual] = useState(Boolean(server));
 const [searching, setSearching] = useState(false);
 const [results, setResults] = useState<DiscoveredServer[]>([]);
 const [discoveryStatus, setDiscoveryStatus] = useState('');
 useEffect(() => () => { scanGeneration.current++; }, []);
 const scan = async () => {
  if (searching) return;
  const generation = ++scanGeneration.current;
  setSearching(true);
  setResults([]);
  try {
   const info = await getNetworkInfo();
   if (!info?.ip || !info.subnetMask) throw new Error('Automatic discovery is unavailable on this device. Use Manual address.');
   let customPort = 0;
   try { customPort = Number(new URL(normalizeServerURL(draft)).port || (/^https:/i.test(draft) ? 443 : 80)) } catch { }
   const found = await discoverServers(info.ip, info.subnetMask, [8097, customPort], (done, total) => {
    if (generation !== scanGeneration.current) return;
    if (done === total || done % 32 === 0) setDiscoveryStatus(`Searching your network… ${done} of ${total}`);
   });
   if (generation !== scanGeneration.current) return;
   setResults(found);
   setDiscoveryStatus(found.length ? `${found.length} Torrent TV server${found.length === 1 ? '' : 's'} found.` : 'No Torrent TV server was found. Check that it is running or use Manual address.');
  } catch (error) {
   if (generation !== scanGeneration.current) return;
   setDiscoveryStatus((error as Error).message);
   setManual(true);
  } finally {
   if (generation === scanGeneration.current) setSearching(false);
  }
 };
 useEffect(() => { if (!server) void scan() }, []);
 useEffect(() => { if (!results.length) return; const timer = window.setTimeout(() => { if (document.activeElement === rescan.current) focusElement(document.querySelector<HTMLElement>('[data-focus-key="discovered-server-0"]')) }, 0); return () => window.clearTimeout(timer) }, [results.length]);
 useTVNavigation({ getInitialFocus: () => rescan.current || connect.current, inputExitTarget: () => connect.current, onBack: () => { if (manual && !server) { setManual(false); window.setTimeout(() => focusElement(rescan.current), 0) } else exitApplication() } });
 return <main class="setup"><AppMark class="setup-mark" /><h1>{appIdentity().name}</h1><p class="setup-lead">Choose a Torrent TV server on this private network.</p><div class="setup-mode-actions"><button ref={rescan} data-focus-region="setup" data-focus-row="0" data-focus-col="0" data-focus-key="setup-rescan" class={!manual ? 'primary' : ''} aria-disabled={searching ? 'true' : undefined} onClick={() => void scan()}>{searching ? 'Searching…' : 'Rescan'}</button><button data-focus-region="setup" data-focus-row="0" data-focus-col="1" data-focus-key="setup-manual" class={manual ? 'primary' : ''} onClick={() => setManual(value => !value)}>Manual address</button></div><p class="focus-hint" aria-live="polite">{discoveryStatus || 'Automatic discovery checks only the television’s local network.'}</p>{results.length > 0 && <section class="setup-results" aria-label="Discovered servers">{results.map((item, index) => <button data-focus-region="setup" data-focus-row={1 + index} data-focus-col="0" data-focus-key={`discovered-server-${index}`} onClick={() => onConnect(item.url)}><strong>{item.info.instanceName || item.info.name}</strong><span>{item.url}</span><small>Version {item.info.version}{item.info.configured ? ' · Ready' : ' · Setup required'}</small></button>)}</section>}{manual && <section class="setup-manual"><h2>Manual address</h2><div class="setup-controls"><input ref={address} readOnly data-focus-region="setup" data-focus-row="40" data-focus-col="0" data-focus-key="setup-address" type="url" inputMode="url" autoComplete="off" spellcheck={false} value={draft} onInput={event => onDraft(event.currentTarget.value)} placeholder="http://server.lan:8097" /><button ref={connect} data-focus-region="setup" data-focus-row="40" data-focus-col="1" data-focus-key="setup-connect" class="primary" onClick={() => onConnect(draft)}>Connect</button></div><p class="focus-hint">Select the address and press OK to edit it. Select Connect when ready.</p></section>}<p class="setup-status" aria-live="polite">{status}</p>{server && <button data-focus-region="setup" data-focus-row="41" data-focus-col="0" data-focus-key="setup-forget" onClick={onForget}>Forget saved server</button>}</main>;
}

// Art for the backdrop: the title's backdrop, then its poster; empty when it has neither.
const artURL = (api: API, title?: Pick<CatalogTitle, 'backdropUrl' | 'posterUrl'>) => { const path = title?.backdropUrl || title?.posterUrl; return path ? api.streamURL(path) : '' };
// The focus-following backdrop is drawn at half resolution, so it asks for the w780 backdrop: a third of the pixels to decode on every new title (the title page keeps the full one).
const followArtURL = (api: API, title?: Pick<CatalogTitle, 'backdropUrl' | 'posterUrl'>) => { const path = title?.backdropUrl ? title.backdropUrl.replace(/\/backdrop$/, '/backdrop-small') : title?.posterUrl; return path ? api.streamURL(path) : '' };
const HOUSEHOLD_EMPTY: Record<string, string> = {
 continue: 'Nothing to resume yet. Start a title and it appears here.',
 favorites: 'Your list is empty. Open a title and choose Add to My List.',
 recent: 'Nothing viewed recently. Titles you open appear here.',
 watched: 'Nothing watched yet. Titles you finish appear here.',
};
// The server connection: '' before the event stream first answers, 'connected', or the lost message
// ("Server connection lost. Reconnecting in 4s…"). Its own store, so a reconnect tick re-renders two small nodes.
const CONNECTED = 'connected';
function connectionLost(value: string) { return value !== '' && value !== CONNECTED }
function serverHost(base: string) { const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(base || ''); return match ? match[1] : base }
// The foot of the rail: where the household checks the connection without a line on every screen.
function RailConnection({ store, host }: { store?: StatusStore; host: string }) { const value = useStatus(store, ''); const lost = connectionLost(value); return <p class={`tv-rail-connection ${lost ? 'lost' : value === CONNECTED ? 'ok' : ''}`}><i aria-hidden="true" /><span>{lost ? 'Reconnecting…' : value === CONNECTED ? `Connected to ${host}` : `Connecting to ${host}`}</span></p> }
// A banner on the screen only while something is wrong: the server is unreachable, or a tracker needs setting up.
function ScreenBanner({ store, tracker }: { store?: StatusStore; tracker: string }) { const value = useStatus(store, ''); const text = connectionLost(value) ? value : tracker ? `${tracker} needs setting up before it can find new titles. Open Settings to finish it.` : ''; return text ? <p class="tv-banner" role="alert">{text}</p> : null }
// One empty or error state: what happened, then what to do next.
function EmptyState({ title, children, action }: { title: string; children: string; action?: JSX.Element }) { return <div class="tv-empty" role="status"><h2>{title}</h2><p>{children}</p>{action}</div> }

export type TVPreparingState = {
 trackerName: string;
 label: string;
 seeders?: number;
 error?: string;
 hint?: string;
};

function readyTitle(download: Download): string {
 const name = download.displayTitle || download.filePath;
 const code = episodeCode(download.parsed?.seasonStart, download.parsed?.episodeStart);
 return code && name.indexOf(code) < 0 ? `${name} · ${code}` : name;
}

// Prepare is one blocking request, so the only honest progress is time. Counts seconds and, after 15 s, says why
// it is slow. Not focusable; Cancel stays the only control. The interval dies with the modal.
function PrepareElapsed({ seeders }: { seeders?: number }) {
 const [seconds, setSeconds] = useState(0);
 useEffect(() => { const started = Date.now(); const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000); return () => window.clearInterval(timer) }, []);
 const hint = prepareHint(seconds, seeders);
 return <div class="tv-prepare-wait" role="status"><span class="tv-prepare-elapsed">{seconds} s</span>{hint && <p class="supporting">{hint}</p>}</div>;
}

export function Catalog({ api, status, statusStore, connectionStore, titles, facets, household, downloads, jobs, restoreFocus, portal, updateStatus, onUpdateStatus, onFocus, onRetry, onChangeServer, onForgetServer, onPlay, onPlayDownload, onManageDownload, onManageSeasonPack, onRefreshDownloads, onFavorite, preparing, onCancelPrepare, onRetryPrepare, initialNav, onNav }: { api: API; status?: string; statusStore?: StatusStore; connectionStore?: StatusStore; titles: CatalogTitle[]; facets: CatalogFacets; household: HouseholdState; downloads: Download[]; jobs: Job[]; restoreFocus: string | null; portal: PortalState | null; updateStatus: UpdateStatus | null; onUpdateStatus: (status: UpdateStatus) => void; onFocus: (key: string) => void; onRetry: () => void; onChangeServer: () => void; onForgetServer: () => void; onPlay: (release: Release, fileIndex?: number, resumeMs?: number) => void; onPlayDownload: (download: Download) => void; onManageDownload: (download: Download, action: string) => Promise<void>; onManageSeasonPack: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean>; onRefreshDownloads: () => Promise<void>; onFavorite: (title: CatalogTitle, value: boolean) => void; preparing?: TVPreparingState | null; onCancelPrepare?: () => void; onRetryPrepare?: () => void ; initialNav?: NavSnapshot; onNav?: (snapshot: NavSnapshot) => void }) {
 // initialNav (absent: Home, nothing open) rehydrates where the viewer was before playback took the screen.
 const [route, setRoute] = useState<TVRoute>(() => initialNav ? knownRoute(initialNav.route) : 'home');
 const [menuOpen, setMenuOpen] = useState(false);
 // Each hub's last-used tab (Library, Discover): its rail item opens there. The selected tab itself is the route.
 const [hubMemory, setHubMemory] = useState<HubMemory>(loadHubMemory);
 useEffect(() => { setHubMemory(memory => { const next = rememberTab(memory, route); if (next !== memory) saveHubMemory(next); return next }) }, [route]);
 // A control to focus once the next route has drawn (Back from Background jobs lands on its Settings entry), instead of the landing.
 const pendingFocus = useRef('');
 useEffect(() => { const key = pendingFocus.current; if (!key) return; pendingFocus.current = ''; const timer = window.setTimeout(() => { const target = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`); if (target) focusElement(target); else landing.arm() }, 0); return () => window.clearTimeout(timer) }, [route]);
 // Trackers that are switched on but not set up: the banner names the first.
 const [trackerAttention, setTrackerAttention] = useState('');
 useEffect(() => { const promise = typeof api.trackers === 'function' ? api.trackers() : api.call<TrackerStatus[]>('/trackers'); Promise.resolve(promise).then(list => { if (!catalogMounted.current || !Array.isArray(list)) return; const pending = list.filter(tracker => tracker && tracker.enabled && !tracker.configured)[0]; setTrackerAttention(pending ? pending.name : '') }).catch(() => { }) }, [api]);
 const [projectsMessage, setProjectsMessage] = useState('');
 const [updateConfirm, setUpdateConfirm] = useState(false);
 const updateReturnKey = useRef<string | null>(null);
 const [rebuildConfirm, setRebuildConfirm] = useState(false);
 const rebuildReturnKey = useRef<string | null>(null);
 const catalogMounted = useRef(true);
 useEffect(() => () => { catalogMounted.current = false; resetFocusPoint(); }, []);
 const [draftQuery, setDraftQuery] = useState(() => initialNav ? initialNav.query : '');
 const [query, setQuery] = useState(() => initialNav ? initialNav.query : '');
 const [searching, setSearching] = useState(false);
 // How many titles the current query found (the server's total, not the loaded pages); the field shows it.
 const [resultTotal, setResultTotal] = useState<number | null>(null);
 const [recent, setRecent] = useState(() => loadRecentSearches(deviceStorage()));
 const [category, setCategory] = useState(() => initialNav ? initialNav.category : '');
 // The open Category family and its category chip (Categories pages). Catalog keeps them so a title page or the Player can come and go; familyBack lets Back close the family first.
 const [familyKey, setFamilyKey] = useState(() => initialNav?.family || '');
 const [familyChip, setFamilyChip] = useState(() => initialNav?.familyCategory || '');
 const familyBack = useRef<(() => string) | null>(null);
 // The open Settings group (#60): kept here so a return from Background jobs or Other projects opens its pane.
 const [settingsGroup, setSettingsGroup] = useState<SettingsGroupId>(() => groupOfKey(restoreFocus || ''));
 const familyCache = useRef<Record<string, FamilyCacheEntry>>({});
 const [sort, setSort] = useState<'newest' | 'seeders' | 'title' | 'rating'>(() => initialNav ? initialNav.sort : 'newest');
 const [remoteTitles, setRemoteTitles] = useState(titles.slice(0, 12));
 // Discovery rows under Recently added load one at a time as focus reaches the row before. They are dropped with the route, so Home holds at most four extra rows of ten posters.
 const [extraRows, setExtraRows] = useState<Record<string, CatalogTitle[]>>({});
 const [homeDepth, setHomeDepth] = useState(0);
 const homeRequested = useRef<Record<string, boolean>>({});
 const homeGeneration = useRef(0);
 const [nextCursor, setNextCursor] = useState<string | null>(null);
 const loadingMore = useRef(false);
 const [detail, setDetail] = useState<CatalogDetail | null>(null);
 const [detailTarget, setDetailTarget] = useState<DetailTarget>({});
 const [detailMessage, setDetailMessage] = useState('');
 // The episode whose Versions view the open title page shows ('' = the episode list). Reported by the page so the navigation snapshot can bring the viewer back to it after playback; restoreVersions hands the saved one to the first page that opens.
 const [versionsKey, setVersionsKey] = useState('');
 const restoreVersions = useRef(initialNav?.versions || '');
 const reportVersions = useCallback((key: string) => { if (!key) restoreVersions.current = ''; setVersionsKey(key) }, []);
 // Home hero Info panel: the title whose details are open, so Back can return focus to the hero button.
 const [heroInfo, setHeroInfo] = useState<CatalogTitle | null>(null);
 // Loading and failure feedback for opening a title: the detail screen is not mounted yet, so its own message cannot show it.
 const [notice, setNotice] = useState('');
 const first = useRef<HTMLButtonElement>(null);
 const lastContent = useRef<string | null>(restoreFocus);
 // Landing focus: a screen opens on its first card (landing.ts), never on the header Refresh button.
 const landing = useLanding();
 useEffect(() => { if (!restoreFocus) landing.arm() }, []);
 useEffect(() => { const again = () => landing.arm(); window.addEventListener(LANDING_REQUEST_EVENT, again); return () => window.removeEventListener(LANDING_REQUEST_EVENT, again) }, []);
 const detailRef = useRef<CatalogDetail | null>(null);
 // ETag of the open detail: the 3-second poll sends it back and a 304 skips the download, the parse and the re-render.
 const detailETag = useRef({ id: '', etag: '' });
 const loadDetail = async (id: string) => { const loaded = (await api.titleIfChanged(id, ''))!; detailETag.current = { id, etag: loaded.etag }; return loaded.detail };
 const refreshDownloadsRef = useRef(onRefreshDownloads);
 detailRef.current = detail;
 refreshDownloadsRef.current = onRefreshDownloads;
 const favoriteIDs = new Set(household.favorites.map(item => item.titleId || item.catalog?.id).filter(Boolean));
 const fetchPage = (cursor = '') => api.titles({ search: query.trim().length >= 3 ? query.trim() : undefined, category, sort, pageSize: 12, cursor }).then(page => { setRemoteTitles(page.items); setNextCursor(page.nextCursor); setResultTotal(page.total); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); return page; });
 useEffect(() => { void fetchPage('').catch(() => { }) }, [query, category, sort]);
 // App-level titles only change identity on an explicit snapshot refresh
 // (visible-return). The newest-first snapshot only matches the unfiltered
 // view; under a query, category or other sort, reload the first page with
 // the current ones. Accumulated pages release with it either way.
 const seenTitles = useRef(titles);
 useEffect(() => { if (seenTitles.current === titles) return; seenTitles.current = titles; if (query.trim().length < 3 && !category && sort === 'newest') setRemoteTitles(titles.slice()); else void fetchPage('').catch(() => { }) }, [titles]);
 // A metadata update patches the matching card in place so loaded pages,
 // query, category and sort survive it.
 useEffect(() => { const patch = (event: Event) => { const updated = (event as CustomEvent).detail?.title as CatalogTitle | undefined; if (!updated?.id) return; setRemoteTitles(current => current.some(item => item.id === updated.id) ? current.map(item => item.id === updated.id ? updated : item) : current) }; window.addEventListener('catalog-metadata-updated', patch); return () => window.removeEventListener('catalog-metadata-updated', patch) }, []);
 useEffect(() => {
  if (route !== 'home') return;
  const generation = homeGeneration.current;
  for (const spec of homeExtraRowsDue(homeDepth, HOME_SPECS)) {
   if (homeRequested.current[spec.key]) continue;
   homeRequested.current[spec.key] = true;
   api.titles(spec.query).then(page => {
    if (generation !== homeGeneration.current || !catalogMounted.current) return;
    const items = homeRowItems(spec, page.items);
    setExtraRows(current => ({ ...current, [spec.key]: items }));
    void api.ensureMetadata(items.map(item => item.id)).catch(() => { });
   }).catch(() => { });
  }
 }, [homeDepth, route]);
 // A discovery row mounts above My List after focus has already moved down to it. Engines without scroll anchoring (Chromium 53/56) leave the scroll offset alone, so the focused card would end up pushed below the fold; bring it back into view in the same commit.
 useLayoutEffect(() => { const active = document.activeElement; if (route === 'home' && active instanceof HTMLElement && active.dataset.focusRegion === 'content') revealElement(active) }, [extraRows]);
 // Entering a catalog view with nothing held loads its first page; leaving
 // one drops the accumulated pages so memory resets between sections.
 useEffect(() => { if (['home', 'browse', 'search', 'tracker'].includes(route) && remoteTitles.length === 0) void fetchPage('').catch(() => { }) }, [route]);
 useEffect(() => { const refresh = (event: Event) => { const searched = String((event as CustomEvent).detail?.query || '').toLowerCase(); if (query && searched === query.toLowerCase()) { setDetailMessage('Catalog search completed.'); void fetchPage('').catch(error => setDetailMessage((error as Error).message)); } }; window.addEventListener('catalog-search-completed', refresh); return () => window.removeEventListener('catalog-search-completed', refresh) }, [query, category, sort]);
 const submitSearch = async () => { if (searching) return; const mark = landing.mark(); const value = draftQuery.trim(); setSearching(true); try { if (value) { setRecent(recordRecentSearch(deviceStorage(), value)); const page = await api.searchTitles(value); setRemoteTitles(page.items); setNextCursor(page.nextCursor); setResultTotal(page.total); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); } setQuery(value); landing.arm({ cardsOnly: true, since: mark }); } catch (error) { setDetailMessage((error as Error).message); } finally { setSearching(false) } };
 // Typing never contacts the trackers: when the IME closes the cache results follow the field (three characters or more).
 // Only the Search button asks the trackers. A recent chip re-runs its term from the cache too.
 const refreshFromCache = (value: string) => { const term = value.trim(); if (term.length >= 3 && term !== query) setQuery(term) };
 const focusSearchField = () => window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="search-input"]')), 0);
 const runRecent = (term: string) => { setDraftQuery(term); setQuery(term); setRecent(recordRecentSearch(deviceStorage(), term)); focusSearchField() };
 const forgetRecent = () => { clearRecentSearches(deviceStorage()); setRecent([]); focusSearchField() };
 const loadMore = () => { if (loadingMore.current || !nextCursor) return; loadingMore.current = true; api.titles({ search: query.trim().length >= 3 ? query.trim() : undefined, category, sort, pageSize: 12, cursor: nextCursor }).then(page => { setRemoteTitles(current => [...current, ...page.items]); setNextCursor(page.nextCursor); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); }).catch(() => { }).then(() => { loadingMore.current = false; }); };
 useEffect(() => { const updated = (event: Event) => { const titleId = String((event as CustomEvent).detail?.titleId || ''); if (!titleId || detailRef.current?.title.id !== titleId) return; void loadDetail(titleId).then(next => { setDetail(next); setDetailMessage(needsEpisodeExpansion(next) ? 'Preparing the individual episode list…' : '') }).catch(error => setDetailMessage((error as Error).message)) }; window.addEventListener('catalog-title-updated', updated); return () => window.removeEventListener('catalog-title-updated', updated) }, [api]);
 useEffect(() => {
  const titleId = detail?.title.kind === 'series' ? detail.title.id : ''; if (!titleId) return; let stopped = false; let running = false; const refresh = async () => {
   if (stopped || running) return; running = true; try {
    const known = detailETag.current; const loaded = await api.titleIfChanged(titleId, known.id === titleId ? known.etag : '');
    // Unchanged (304): nothing to parse or render, so focus survives idle cycles.
    if (loaded && !stopped && detailRef.current?.title.id === titleId) {
     detailETag.current = { id: titleId, etag: loaded.etag };
     setDetail(loaded.detail); setDetailMessage(needsEpisodeExpansion(loaded.detail) ? 'Preparing the individual episode list…' : '')
    }
   } catch (error) { if (!stopped) setDetailMessage((error as Error).message) } finally { running = false }
  }; const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) }
 }, [api, detail?.title.id]);
 useEffect(() => { if (route !== 'downloads') return; let stopped = false; let running = false; const refresh = async () => { if (stopped || running) return; running = true; try { await refreshDownloadsRef.current() } finally { running = false } }; void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) } }, [route]);
 const openTitle = async (title: CatalogTitle, target: DetailTarget = {}) => { setDetailMessage('Loading versions…'); setNotice('Loading versions…'); setDetailTarget(target); try { const next = await loadDetail(title.id); setNotice(''); setDetail(next); if (needsEpisodeExpansion(next)) { setDetailMessage('Preparing the individual episode list…'); void api.refreshTitle(title.id, title.title).catch(error => setDetailMessage((error as Error).message)) } else setDetailMessage(''); } catch (error) { setDetailMessage((error as Error).message); setNotice(`Could not open ${title.title}: ${(error as Error).message}. Check the server connection and press OK to try again.`); } };
 const openTitleStable = useStableCallback(openTitle);
 useEffect(() => { if (detail) landing.cancel() }, [detail]);
 const openLibraryItem = useStableCallback(async (item: HouseholdItem) => { const id = item.titleId || item.catalog?.id; if (!id) { setDetailMessage('This library item is not linked to a catalog title yet. Refresh the catalog and try again.'); return } const title = item.catalog || { id, title: item.release.name, kind: 'movie', trackers: item.release.trackerId ? [{ id: item.release.trackerId, name: item.release.trackerName }] : [], categories: [], resolutions: [], sourceCount: 1, bestSeeders: item.release.seeders, largestSizeBytes: item.release.sizeBytes } as CatalogTitle; await openTitle(title, { season: item.seasonNumber, episode: item.episodeNumber }) });
 // Rehydrate the open title through the same path as a normal open (fresh fetch, so Resume reflects the new position; failure falls back to the route list with the usual notice), and report the current spot so App can keep it while the Player owns the screen.
 useEffect(() => { if (initialNav && initialNav.titleId) void openTitle({ id: initialNav.titleId, title: initialNav.titleName, kind: 'movie', trackers: [], categories: [], resolutions: [], sourceCount: 0, bestSeeders: 0, largestSizeBytes: 0 } as CatalogTitle, initialNav.target) }, []);
 useEffect(() => { onNav?.(captureNav({ route, detail: detail ? { id: detail.title.id, title: detail.title.title } : null, target: detailTarget, query, category, sort, family: familyKey, familyCategory: familyChip, versions: detail ? versionsKey : '' })) }, [route, detail?.title.id, detailTarget, query, category, sort, familyKey, familyChip, versionsKey]);
 const manageSeasonPack = async (source: CatalogSource, season: number, action: SeasonPackAction) => {
  const isAcquire = action === 'download' || (action === 'retry' && !source.libraryState?.downloadId);
  if (!isAcquire) setDetailMessage(`Updating season ${season} download…`);
  try {
   const ok = await onManageSeasonPack(source, season, action);
   if (ok === false) return;
   if (detailRef.current) {
    const next = await loadDetail(detailRef.current.title.id).catch(() => null);
    // Keep the detail target: it is part of the TitleDetail key, and a new key
    // would remount the screen and drop focus from the pressed control.
    if (next) setDetail(next);
   }
   if (isAcquire) setDetailMessage(`Season ${season} is downloading. Episode tiles will update here.`);
   else setDetailMessage(action === 'delete' ? `Season ${season} download deleted.` : action === 'pause' ? `Season ${season} download paused.` : `Season ${season} download resumed.`);
  } catch (error) {
   if (!isAcquire) { setDetailMessage((error as Error).message); throw error; }
  }
 };
 const chooseRoute = (next: TVRoute, focusKey = '') => { resetFocusPoint(); setNotice(''); homeGeneration.current++; homeRequested.current = {}; setExtraRows({}); setHomeDepth(0); if (!['home', 'browse', 'search', 'tracker'].includes(next)) { setRemoteTitles([]); setNextCursor(null); } lastContent.current = null; familyCache.current = {}; setFamilyKey(''); setFamilyChip(''); setSettingsGroup(groupOfKey(focusKey)); setRoute(next); setDetail(null); setMenuOpen(false); if (focusKey) { landing.cancel(); pendingFocus.current = focusKey } else landing.arm(); };
 // Projects route: activation hands the link to the platform browser. When
 // no browser takes it (several ATV boxes ship none) the address stays on
 // the card and the hint says so — the URL is the fallback.
 const openProjectLink = async (link: PortalState['links'][number]) => {
  const launched = await openExternalURL(link.url);
  if (!catalogMounted.current) return;
  if (launched) setProjectsMessage('');
  else setProjectsMessage('Open this address on another device: ' + link.url);
 };
 useEffect(() => { if (confirmDialogStale(updateConfirm, updateStatus)) setUpdateConfirm(false) }, [updateConfirm, updateStatus]);
 useEffect(() => {
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) return;
  const timer = window.setTimeout(() => {
   const active = document.activeElement;
   if (active instanceof HTMLElement && active !== document.body) return;
   const restored = lastContent.current ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(lastContent.current)}"]`) : null;
   focusElement(restored || landingTarget());
  }, 0);
  return () => window.clearTimeout(timer);
 }, [portal, updateStatus]);
 const restoreAfterDialog = (key: string) => { const target = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`); window.setTimeout(() => focusElement(target || landingTarget()), 0) };
 const openUpdateConfirm = () => { updateReturnKey.current = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey || null : null; setUpdateConfirm(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="update-confirm-cancel"]')), 0) };
 const closeUpdateConfirm = () => { setUpdateConfirm(false); restoreAfterDialog(dialogRestoreKey(updateReturnKey.current, 'update-apply')) };
 // Rebuild catalog is destructive in cost, not data: the dialog opens on Cancel and Back or Cancel returns to the Rebuild button.
 const openRebuildConfirm = () => { rebuildReturnKey.current = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey || null : null; setRebuildConfirm(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="rebuild-confirm-cancel"]')), 0) };
 const closeRebuildConfirm = () => { setRebuildConfirm(false); restoreAfterDialog(dialogRestoreKey(rebuildReturnKey.current, 'catalog-rebuild')) };
 const prepareCancelRef = useRef<HTMLButtonElement>(null);
 const prepareRetryRef = useRef<HTMLButtonElement>(null);
 const prepareCloseRef = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (!preparing) return;
  const timer = window.setTimeout(() => {
   focusElement(preparing.error ? prepareRetryRef.current : prepareCancelRef.current);
  }, 0);
  const key = (event: KeyboardEvent) => {
   const action = remoteAction(event.key, event.keyCode);
   if (!action || action === 'ime-done' || action === 'ime-cancel') return;
   event.preventDefault();
   event.stopImmediatePropagation();
   if (action === 'back') { onCancelPrepare?.(); return; }
   if (action === 'enter') {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement) active.click();
    return;
   }
   if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
    if (!preparing.error) {
     focusElement(prepareCancelRef.current);
     return;
    }
    const active = document.activeElement;
    if (active === prepareCloseRef.current) focusElement(prepareRetryRef.current);
    else focusElement(prepareCloseRef.current);
   }
  };
  document.addEventListener('keydown', key, true);
  return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key, true); };
 }, [preparing?.error, preparing?.label, onCancelPrepare]);
 // Back to the card the viewer left, or, when it is gone (another route, a reload), land like a fresh screen.
 const restoreContentFocus = () => { const key = lastContent.current; const target = key ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null; if (target) focusElement(target); else landing.arm() };
 const onBack = () => { if (preparing) { onCancelPrepare?.(); return; } if (updateConfirm) { closeUpdateConfirm(); return; } if (rebuildConfirm) { closeRebuildConfirm(); return; } if (detail) { setDetail(null); window.setTimeout(restoreContentFocus, 0); return; } if (menuOpen) { setMenuOpen(false); window.setTimeout(restoreContentFocus, 0); return; } const closedFamily = familyBack.current?.(); if (closedFamily) { window.setTimeout(() => { const tile = document.querySelector<HTMLElement>(`[data-focus-key="family-${closedFamily}"]`); if (tile) focusElement(tile); else landing.arm() }, 0); return; } if (route === 'jobs' || route === 'projects') { chooseRoute('settings', `settings-${route}`); return; } if (route === 'settings' && settingsBack()) return; openRail(); };
 const openRail = () => { setMenuOpen(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-menu-hub="${hubOf(route).id}"]`) || document.querySelector<HTMLElement>('[data-focus-region="sidebar"]')), 0) };
 useTVNavigation({
  getInitialFocus: () => landingTarget() || first.current, restoreKey: restoreFocus, onFocusKey: key => { onFocus(key); if (route === 'home' && document.activeElement instanceof HTMLElement) { const row = Number(document.activeElement.dataset.focusRow); if (row >= HOME_ROW.recent) setHomeDepth(depth => Math.max(depth, row)) } if (document.activeElement instanceof HTMLElement && (document.activeElement.dataset.focusRegion === 'content' || document.activeElement.dataset.focusRegion === SETTINGS_GROUPS_REGION) && !detail) { lastContent.current = key; setFocusPoint(Number(document.activeElement.dataset.focusRow), Number(document.activeElement.dataset.focusCol)) } }, onBack, onLongBack: exitApplication, onDirection: (direction, current) => {
   if (detail || updateConfirm || rebuildConfirm) return false;
   if (route === 'settings' && settingsDirection(direction, current)) return true;
   // Near the end of a title rail (Tracker), or within two lines of the end of the Search and Browse grid, fire the
   // next page without consuming the keypress: focus still moves while the append lands.
   if ((current.dataset.focusKey || '').startsWith('title-')) {
    const col = Number(current.dataset.focusCol || -1);
    if (route === 'search' || route === 'browse') { if ((direction === 'down' || direction === 'right') && nearEnd(gridIndex(Number(current.dataset.focusRow), col, GRID_FIRST_ROW), visible.length, GRID_COLUMNS * 2)) loadMore() }
    else if (direction === 'right' && nearEnd(col, visible.length)) loadMore();
   }
   if (route === 'jobs' && direction === 'down' && (current.dataset.focusKey || '').startsWith('job-')) window.dispatchEvent(new CustomEvent('tv-jobs-near-end'));
   const region = current.dataset.focusRegion;
   if ((region === 'content' || region === SETTINGS_GROUPS_REGION) && direction === 'left' && current.dataset.focusCol === '0') { openRail(); return true; }
   // Down from a tab enters the content at its first stop (the first card of the first line), whatever tab it left.
   if (region === 'content' && direction === 'down' && current.dataset.hubTab) { const below = visibleFocusables().filter(element => element.dataset.focusRegion === 'content' && !element.dataset.hubTab && Number.isFinite(Number(element.dataset.focusRow)) && Number(element.dataset.focusRow) > 0).sort((a, b) => Number(a.dataset.focusRow) - Number(b.dataset.focusRow) || Number(a.dataset.focusCol) - Number(b.dataset.focusCol))[0]; if (below) focusElement(below); return true; }
   // Up from the content into the tab strip lands on the selected tab, whatever column the cursor was in.
   if (region === 'content' && direction === 'up' && !current.dataset.hubTab) { const above = chooseStructuredTarget(current, visibleFocusables(), 'up'); if (above && above.dataset.hubTab) { focusElement(document.querySelector<HTMLElement>('[data-hub-tab][aria-selected="true"]') || above); return true; } }
   if (region === 'sidebar' && direction === 'right') { setMenuOpen(false); window.setTimeout(restoreContentFocus, 0); return true; }
   return false;
  }
 });
 const librarySections = useMemo(() => householdSections(route, household), [route, household]);
 // The chip line (row 2): Sort and its chips, then on Search the recent searches other than the one in the field.
 const recentShown = recent.filter(term => term.toLocaleLowerCase() !== query.trim().toLocaleLowerCase()).slice(0, RECENT_CHIPS);
 const recentCol = category ? 5 : 4;
 const visible = useMemo(() => {
  let list = remoteTitles;
  if (category) list = list.filter(title => title.categories.includes(category));
  if (sort === 'seeders') list = [...list].sort((a, b) => b.bestSeeders - a.bestSeeders); if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title)); if (sort === 'rating') list = [...list].sort((a, b) => Number(Boolean(b.ratingVotes)) - Number(Boolean(a.ratingVotes)) || (b.rating || 0) - (a.rating || 0));
  return list;
 }, [remoteTitles, category, sort]);
 const hub = hubOf(route);
 const heading = screenHeading(route);
 // The Downloads count: torrents moving right now (a season pack's files count once).
 const activeTransfers = useMemo(() => { const moving: Record<string, true> = {}; for (const item of downloads) if (downloadStatus(item).tone === 'active') moving[item.releaseId || item.id] = true; return Object.keys(moving).length }, [downloads]);
 const resumeHero = route === 'home' ? homeHero(librarySections.filter(section => section.key === 'continue').reduce<HouseholdItem[]>((all, section) => all.concat(section.items), []), undefined) : undefined;
 const hero = resumeHero?.title || visible[0] || titles[0];
 const rows = useMemo<Array<{ key: string; title: string; items: CatalogTitle[]; row?: number; keyPrefix?: string }>>(() => route === 'home' ? [
  { key: 'new', title: 'Recently added', items: remoteTitles, row: HOME_ROW.recent },
  ...HOME_SPECS.map((spec, index) => ({ key: `rail-${spec.key}`, title: spec.title, items: extraRows[spec.key] || [], row: HOME_ROW.extra + index, keyPrefix: `rail-${spec.key}` })),
 ] : route === 'tracker' ? [{ key: 'tracker-new', title: 'Recently added', items: visible }, { key: 'tracker-seeded', title: 'Strong swarms', items: [...visible].sort((a, b) => b.bestSeeders - a.bestSeeders), keyPrefix: 'tracker-seeded' }] : ['continue', 'favorites', 'watched', 'library', 'downloads', 'library-categories', 'jobs', 'settings', 'categories'].includes(route) ? [] : [{ key: route, title: '', items: visible }], [route, remoteTitles, extraRows, visible]);
 // Rails whose artwork loads: the focused rail and its neighbours (lazy-art.ts). Rail rows are ascending in document order.
 const homeLibrary = librarySections.filter(section => route !== 'home' || section.key === 'continue');
 const homeFavorites = route === 'home' ? librarySections.filter(section => section.key === 'favorites') : [];
 const shownRows = rows.filter(row => row.items.length > 0);
 const railRows = [...homeLibrary.map((section, index) => section.items.length > 0 ? 3 + index : -1).filter(row => row >= 0), ...shownRows.map((row, rowIndex) => row.row ?? rowIndex + 10), ...homeFavorites.filter(section => section.items.length > 0).map(() => HOME_ROW.favorites)];
 const railSpans = railWindows(railRows);
 const spanOf = (row: number) => railSpans[railRows.indexOf(row)] || { from: -Infinity, until: Infinity };
 const libraryArt = librarySections[0]?.items[0]?.catalog;
 const initialArt = artURL(api, route === 'home' ? hero : librarySections.length > 0 ? libraryArt : visible[0]);
 const preparingModal = preparing ? (
  <section role="dialog" aria-modal="true" aria-labelledby="tv-prepare-heading" class="tv-prepare-confirm">
   <h2 id="tv-prepare-heading">{preparing.error ? 'Could not start this download' : `Preparing from ${preparing.trackerName}`}</h2>
   <strong class="release-name">{preparing.label}</strong>
   {preparing.error ? <>
    <p class="supporting">{preparing.trackerName}: {preparing.error}</p>
    {preparing.hint && <p class="supporting">{preparing.hint}</p>}
    <div class="tv-prepare-actions">
     <button ref={prepareRetryRef} data-focus-region="prepare-dialog" data-focus-row="0" data-focus-col="0" data-focus-key="prepare-retry" onClick={onRetryPrepare}>Retry</button>
     <button ref={prepareCloseRef} data-focus-region="prepare-dialog" data-focus-row="0" data-focus-col="1" data-focus-key="prepare-close" onClick={onCancelPrepare}>Close</button>
    </div>
   </> : <>
    <p class="supporting">Asking {preparing.trackerName} for this release. Playback starts as soon as the server has the download ready. Press Back to cancel.</p>
    <PrepareElapsed seeders={preparing.seeders} />
    <button ref={prepareCancelRef} data-focus-region="prepare-dialog" data-focus-row="0" data-focus-col="0" data-focus-key="prepare-cancel" onClick={onCancelPrepare}>Cancel</button>
   </>}
  </section>
 ) : null;
 if (detail) return <><TitleDetail key={`${detail.title.id}:${detailTarget.season || 0}:${detailTarget.episode || 0}`} api={api} detail={detail} target={detailTarget} message={detailMessage} resume={resumeForTitle(household.continueWatching, detail.title.id)} initialVersions={initialNav?.titleId === detail.title.id ? restoreVersions.current : ''} restoreKey={initialNav?.focusKey || ''} onVersions={reportVersions} favorite={favoriteIDs.has(detail.title.id)} onClose={onBack} onFavorite={onFavorite} onResume={item => onPlay(item.release, item.fileIndex, item.positionMs)} onPlay={onPlay} onPackAction={manageSeasonPack} />{preparingModal}</>;
 return <div class={`tv-app ${menuOpen ? 'menu-open' : ''}`} data-route={route}>
  <Backdrop key={route} initial={initialArt} />
  <i class="tv-veil" aria-hidden="true" />
  <aside class="tv-sidebar"><div class="tv-brand"><AppMark /><b>{appIdentity().name}</b></div><nav class="tv-rail" aria-label="Main">{HUBS.map((item, index) => <button data-menu-hub={item.id} data-focus-region="sidebar" data-focus-row={index} data-focus-col="0" data-focus-key={`menu-${item.id}`} class={hub.id === item.id ? 'active' : ''} aria-current={hub.id === item.id ? 'page' : undefined} onClick={() => chooseRoute(hubDestination(item, hubMemory))}><i><Icon name={item.icon} /></i><span><b>{item.label}</b><small class="tv-rail-hint">{item.hint}</small></span>{item.id === 'downloads' && activeTransfers > 0 && <em class="tv-rail-count" aria-label={`${activeTransfers} active`}>{activeTransfers}</em>}</button>)}</nav><RailConnection store={connectionStore} host={serverHost(api.base)} /></aside>
  <main class="tv-content">
   {(heading || hub.tabs) && <header class="tv-top">{heading && <h1>{heading}</h1>}{hub.tabs && <div class="tv-tabs" role="tablist" aria-label={hub.label}>{hub.tabs.map((tab, index) => <button role="tab" data-hub-tab={tab.route} data-focus-region="content" data-focus-row="0" data-focus-col={index} data-focus-key={`tab-${tab.route}`} data-landing="chrome" class={tab.route === route ? 'active' : ''} aria-selected={tab.route === route ? 'true' : 'false'} onClick={() => { if (tab.route !== route) chooseRoute(tab.route) }}>{tab.label}</button>)}</div>}</header>}
   <ScreenBanner store={connectionStore} tracker={trackerAttention} />
   {notice && <p class="tv-notice" role="status">{notice}</p>}
   {route === 'search' && <div class="tv-search"><span class="tv-search-field"><Icon name="search" /><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="search-input" data-landing="control" value={draftQuery} onInput={event => setDraftQuery(event.currentTarget.value)} onBlur={event => refreshFromCache(event.currentTarget.value)} placeholder="Search titles; press OK to type" />{query && resultTotal !== null && <span class="tv-search-count" aria-live="polite">{resultTotal === 1 ? '1 result' : `${resultTotal} results`}</span>}</span><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="search-submit" class="primary" aria-disabled={searching ? 'true' : undefined} onClick={() => void submitSearch()}>{searching ? 'Searching…' : 'Search'}</button>{query && <button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="search-clear" onClick={() => { setDraftQuery(''); setQuery('') }}>Clear</button>}</div>}
   {['tracker', 'browse', 'search'].includes(route) && <div class="tv-filters tv-chip-line" role="group" aria-label={route === 'search' ? 'Sort and recent searches' : 'Sort titles'}><span class="tv-chip-label">Sort</span><button data-focus-region="content" data-focus-row="2" data-focus-col="0" data-focus-key="sort-newest" class={sort === 'newest' ? 'active' : ''} onClick={() => setSort('newest')}>Newest</button><button data-focus-region="content" data-focus-row="2" data-focus-col="1" data-focus-key="sort-seeders" class={sort === 'seeders' ? 'active' : ''} onClick={() => setSort('seeders')}>Most seeded</button><button data-focus-region="content" data-focus-row="2" data-focus-col="2" data-focus-key="sort-rating" class={sort === 'rating' ? 'active' : ''} onClick={() => setSort('rating')}>Rating</button><button data-focus-region="content" data-focus-row="2" data-focus-col="3" data-focus-key="sort-title" class={sort === 'title' ? 'active' : ''} onClick={() => setSort('title')}>A–Z</button>{category && <button data-focus-region="content" data-focus-row="2" data-focus-col="4" data-focus-key="clear-category" onClick={() => setCategory('')}>Clear {category}</button>}{route === 'search' && recent.length > 0 && <><span class="tv-chip-label tv-chip-label-next">Recent</span>{recentShown.map((term, index) => <button class="tv-recent-chip" data-focus-region="content" data-focus-row="2" data-focus-col={recentCol + index} data-focus-key={`recent-${index}`} onClick={() => runRecent(term)}>{term}</button>)}<button data-focus-region="content" data-focus-row="2" data-focus-col={recentCol + recentShown.length} data-focus-key="recent-clear" onClick={forgetRecent}>Clear recent</button></>}</div>}
   {route === 'projects' ? <section class="tv-projects"><p class="tv-muted">Project sites published with this server. Press OK on a card to open it.</p>{portal && portal.links.length > 0 ? portal.links.map((link, index) => <button class="tv-project" key={link.id} data-landing="card" data-focus-region="content" data-focus-row={3 + index} data-focus-col="0" data-focus-key={`project-${link.id}`} onClick={() => openProjectLink(link)}><strong>{link.title}</strong>{link.description && <p>{link.description}</p>}<code>{link.url}</code></button>) : <EmptyState title="No project links yet">They appear here when the server publishes them.</EmptyState>}{projectsMessage && <p class="focus-hint" aria-live="polite">{projectsMessage}</p>}</section> : route === 'settings' ? <TVSettings api={api} hasProjects={Boolean(portal && portal.links.length > 0)} projectCount={portal ? portal.links.length : 0} jobs={jobs} group={settingsGroup} onGroup={setSettingsGroup} onOpen={next => chooseRoute(next)} onReload={onRetry} onChangeServer={onChangeServer} onForgetServer={onForgetServer} updateStatus={updateStatus} onUpdateStatus={onUpdateStatus} confirmOpen={updateConfirm} onConfirmOpen={openUpdateConfirm} onConfirmClose={closeUpdateConfirm} rebuildConfirmOpen={rebuildConfirm} onRebuildConfirmOpen={openRebuildConfirm} onRebuildConfirmClose={closeRebuildConfirm} /> : route === 'downloads' ? <TVDownloads api={api} items={downloads} eager={Boolean(lastContent.current)} onPlay={onPlayDownload} onManage={onManageDownload} /> : route === 'library-categories' ? <TVFamilies api={api} mode="library" familyKey={familyKey} chip={familyChip} sort={sort} setFamilyKey={setFamilyKey} setChip={setFamilyChip} setSort={setSort} cache={familyCache} backRef={familyBack} onOpenTitle={openTitleStable} onOpenLibraryItem={openLibraryItem} /> : route === 'jobs' ? <TVJobs api={api} items={jobs} /> : route === 'categories' ? <TVFamilies api={api} mode="catalog" familyKey={familyKey} chip={familyChip} sort={sort} setFamilyKey={setFamilyKey} setChip={setFamilyChip} setSort={setSort} cache={familyCache} backRef={familyBack} onOpenTitle={openTitleStable} onOpenLibraryItem={openLibraryItem} /> : <>
    {route === 'home' && hero && <HomeHero api={api} hero={hero} resume={resumeHero?.resume} favorite={favoriteIDs.has(hero.id)} primaryRef={first} onPlay={onPlay} onOpen={openTitle} onInfo={setHeroInfo} onFavorite={onFavorite} />}
    {homeLibrary.map((section, index) => <HouseholdRail api={api} title={['continue', 'favorites', 'watched'].includes(route) ? '' : section.title} items={section.items} landscape={section.key === 'continue'} row={3 + index} from={spanOf(3 + index).from} until={spanOf(3 + index).until} empty={route === 'home' ? '' : HOUSEHOLD_EMPTY[section.key]} onOpen={openLibraryItem} />)}
    <div class="tv-rows">{shownRows.map((row, rowIndex) => { const railRow = row.row ?? rowIndex + 10; const span = spanOf(railRow); if (route === 'search' || route === 'browse') return <TitleGrid api={api} items={row.items} firstRow={GRID_FIRST_ROW} focusRef={!hero && rowIndex === 0 ? first : undefined} onOpen={openTitleStable} />; return <TitleRail api={api} heading={row.title} items={row.items} row={railRow} from={span.from} until={span.until} keyPrefix={row.keyPrefix} seeders={row.key === 'tracker-seeded'} focusRef={!hero && rowIndex === 0 ? first : undefined} onOpen={openTitleStable} /> })}</div>
    {homeFavorites.map(section => <HouseholdRail api={api} title={section.title} items={section.items} row={HOME_ROW.favorites} from={spanOf(HOME_ROW.favorites).from} until={spanOf(HOME_ROW.favorites).until} empty="" onOpen={openLibraryItem} />)}
    {['home', 'search', 'browse', 'tracker'].includes(route) && rows.every(row => row.items.length === 0) && (query ? <EmptyState title={`No titles match “${query}”`}>Try fewer or different words, or press Clear to see everything.</EmptyState> : route === 'search' ? <EmptyState title="Search the catalog">Press OK on the search field, type a title, then choose Search.</EmptyState> : <EmptyState title="No titles to show yet" action={<button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="empty-reload" data-landing="chrome" onClick={onRetry}>Reload library</button>}>Wait a minute for the catalog to sync and choose Reload library, or turn on a tracker in Settings.</EmptyState>)}
   </>}
  </main>
  {route === 'home' && promotionsVisible(portal) && <TVPromotions api={api} />}
  {preparingModal}
  {heroInfo && <TitleInfoPanel api={api} title={heroInfo} onClose={() => { setHeroInfo(null); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="hero-info-${heroInfo.id}"]`)), 0) }} />}
 </div>;
}

// Home's hero (DESIGN.md "Home"): straight on the focus-following backdrop, no panel. The kind line, the title (a
// "Title: Subtitle" splits into a title and a subtitle line), facts with the resolution chip, a two-line overview, then
// the primary (Resume says what is left) and Info and My List as round icon buttons in the next columns.
function HomeHero({ api, hero, resume, favorite, primaryRef, onPlay, onOpen, onInfo, onFavorite }: { api: API; hero: CatalogTitle; resume?: HouseholdItem; favorite: boolean; primaryRef: { current: HTMLButtonElement | null }; onPlay: (release: Release, fileIndex?: number, resumeMs?: number) => void; onOpen: (title: CatalogTitle) => void; onInfo: (title: CatalogTitle) => void; onFavorite: (title: CatalogTitle, value: boolean) => void }) {
 const [main, sub] = heroTitleParts(hero.title);
 const facts = heroFacts(hero);
 const resolution = hero.resolutions?.[0];
 const left = resume ? timeLeft(resume) : '';
 const art = followArtURL(api, hero);
 return <section class="tv-hero">
  <p class="tv-hero-kind">{resume && <i class="tv-hero-dot" aria-hidden="true" />}{heroKind(hero, Boolean(resume))}</p>
  <h2 aria-label={hero.title}><span class="tv-hero-title">{main}</span>{sub && <span class="tv-hero-subtitle">{sub}</span>}</h2>
  {(facts.length > 0 || resolution) && <p class="tv-hero-facts">{facts.map((fact, index) => <Fragment key={index}>{index > 0 && <i class="detail-dot" aria-hidden="true">·</i>}{fact}</Fragment>)}{resolution && <span class="tv-hero-chip">{resolution}</span>}</p>}
  {hero.overview && <p class="tv-hero-overview">{hero.overview}</p>}
  <div class="tv-hero-actions">
   <button ref={primaryRef} data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key={`hero-${hero.id}`} data-landing="control" data-art={art} class="primary" onClick={() => { if (resume) onPlay(resume.release, resume.fileIndex, resume.positionMs); else onOpen(hero) }}>{resume ? <><Icon name="play" />{resumeActionLabel(resume, hero.kind)}{left && <span class="detail-primary-note">{` · ${left}`}</span>}</> : 'View versions'}</button>
   <button class="tv-hero-icon" data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key={`hero-info-${hero.id}`} data-art={art} aria-haspopup="dialog" aria-label="Info" onClick={() => onInfo(hero)}><Icon name="info" /></button>
   <button class="tv-hero-icon" data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key={`hero-favorite-${hero.id}`} data-art={art} aria-pressed={favorite} aria-label={favorite ? 'In My List' : 'Add to My List'} onClick={() => onFavorite(hero, !favorite)}><Icon name={favorite ? 'check' : 'plus'} /></button>
  </div>
 </section>;
}

// One card for the household's titles: a poster (My List, Watched, Library grids) or, for Continue watching, a 16:9
// landscape card on the title's w780 backdrop (the picture the backdrop follow already decodes) with the progress
// bar on the art and the episode code and time left under it.
const LibraryCard = memo(function LibraryCard({ api, item, row, col, focusKey, loadArt, landscape, onOpen }: { api: API; item: HouseholdItem; row: number; col: number; focusKey: string; loadArt?: boolean; landscape?: boolean; onOpen: (item: HouseholdItem) => void }) {
 // A raw release row (no catalog match) keeps the release name as its title: nothing better exists.
 const label = item.catalog?.title || item.release.name;
 const progress = watchProgress(item);
 const art = landscape ? followArtURL(api, item.catalog) : item.catalog?.posterUrl ? api.streamURL(item.catalog.posterUrl) : '';
 return <button class={`poster-card library-poster-card${landscape ? ' landscape-card' : ''}`} data-landing="card" data-focus-region="content" data-focus-row={row} data-focus-col={col} data-focus-key={focusKey} data-art={followArtURL(api, item.catalog)} onClick={() => onOpen(item)}><span class="card-art">{art ? <PosterArt src={art} load={loadArt !== false} /> : <span class="poster-fallback">{label.slice(0, 1)}</span>}<TVStateBadges state={item.catalog?.libraryState} compact />{item.positionMs > 0 && !item.watched && <i class="tv-card-progress" aria-label={`${progress}% watched`}><b style={{ width: `${progress}%` }} /></i>}</span><span class="poster-copy"><strong>{label}</strong><span>{landscape ? continueCardLine(item) : libraryCardLine(item)}</span></span></button>;
});
const HouseholdRail = memo(function HouseholdRail({ api, title, items, row, from, until, empty, landscape, onOpen }: { api: API; title: string; items: HouseholdState['continueWatching']; row: number; from: number; until: number; empty: string; landscape?: boolean; onOpen: (item: HouseholdItem) => void }) {
 const reach = useArtReach({ from, until });
 // The Home route passes no empty copy: an empty rail there simply is not drawn, so discovery leads.
 if (items.length === 0) return empty ? <section>{title && <div class="row-heading"><h2>{title}</h2></div>}<p class="tv-muted">{empty}</p></section> : null;
 return <section>{title && <div class="row-heading"><h2>{title}</h2></div>}<div class={`poster-rail${landscape ? ' landscape-rail' : ''}`}>{items.map((item, col) => <LibraryCard api={api} item={item} row={row} col={col} landscape={landscape} focusKey={`library-${item.titleId || item.catalog?.id || item.release.id}-${item.seasonNumber || 0}-${item.episodeNumber || 0}-${col}`} loadArt={inReach(reach, col)} onOpen={onOpen} />)}</div></section>
});
// A poster is requested only once its rail and column are near focus (lazy-art.ts); the placeholder keeps the card's geometry and surface.
function PosterArt({ src, load }: { src: string; load: boolean }) { return load ? <img src={src} alt="" decoding="async" /> : <div class="poster-pending" /> }
const TitleRail = memo(function TitleRail({ api, heading, items, row, from, until, keyPrefix, seeders, focusRef, onOpen }: { api: API; heading: string; items: CatalogTitle[]; row: number; from: number; until: number; keyPrefix?: string; seeders?: boolean; focusRef?: { current: HTMLButtonElement | null }; onOpen: (title: CatalogTitle) => void }) {
 const reach = useArtReach({ from, until });
 return <section>{heading && <div class="row-heading"><h2>{heading}</h2></div>}<div class="poster-rail">{items.map((title, col) => <TitleCard api={api} title={title} row={row} focusKey={keyPrefix ? `${keyPrefix}-${title.id}` : undefined} col={col} seeders={seeders} focusRef={col === 0 ? focusRef : undefined} loadArt={inReach(reach, col)} onOpen={onOpen} />)}</div></section>
});
// The poster grid of Search, Browse and the family pages (#58): the shared cards seven to a line, wrapped with flex
// and margins (tv.css), focus rows numbered as the lines are drawn. Artwork loads by line around focus (lazy-art.ts).
const GRID_COLUMNS = 7;
const GRID_FIRST_ROW = 10;
const gridIndex = (row: number, col: number, firstRow: number) => (row - firstRow) * GRID_COLUMNS + col;
const gridLines = (count: number) => Math.ceil(count / GRID_COLUMNS);
const TitleGrid = memo(function TitleGrid({ api, items, firstRow, keyPrefix, focusRef, onOpen }: { api: API; items: CatalogTitle[]; firstRow: number; keyPrefix?: string; focusRef?: { current: HTMLButtonElement | null }; onOpen: (title: CatalogTitle) => void }) {
 const reach = useRowReach(firstRow);
 return <div class="tv-poster-grid">{items.map((title, index) => { const row = firstRow + Math.floor(index / GRID_COLUMNS); return <TitleCard api={api} title={title} row={row} col={index % GRID_COLUMNS} focusKey={keyPrefix ? `${keyPrefix}-${title.id}` : undefined} focusRef={index === 0 ? focusRef : undefined} loadArt={inRowReach(reach, row)} onOpen={onOpen} /> })}</div>;
});
// Recent searches drawn on the chip line beside the sort chips: two, as on the board, so the line fits 1656 px.
const RECENT_CHIPS = 2;
type PendingDownloadRemoval = { download: Download; scope: 'torrent' | 'file' };
// A route change draws the first screenful of downloads at once and the rest once the screen has opened, a few rows
// per task, so a long list never holds the main thread (one long task, and the remote dead for that long) while the
// screen opens. A screen reopened with a focus key to restore draws everything at once: the key may sit in a row that
// has not been drawn yet.
const DOWNLOADS_FIRST_DRAW = 6;
const DOWNLOADS_DRAW_STEP = 6;
// "The screen has opened": the rows below the first screenful, the row thumbnails and the Allocation wait this long
// after the screen mounts, so the route change itself draws, asks and decodes only what the first frame needs.
const DOWNLOADS_SETTLED_MS = 400;
type DownloadsFilter = 'all' | DownloadFilter;
const DOWNLOAD_FILTERS: Array<[DownloadsFilter, string]> = [['all', 'All'], ['active', 'Active'], ['done', 'Downloaded'], ['paused', 'Paused'], ['attention', 'Needs attention']];
const DOWNLOAD_SORTS: Array<[DownloadSort, string]> = [['recent', 'Recent'], ['title', 'Title A–Z'], ['progress', 'Progress'], ['size', 'File size'], ['speed', 'Speed']];
// The row's thumbnail is the title's w780 backdrop (the one the focus-following backdrop uses), drawn small.
const downloadThumb = (api: API, download: Download) => download.titleId ? api.streamURL(`/api/v1/artwork/${encodeURIComponent(download.titleId)}/backdrop-small`) : '';
// One Downloads row. Memoized: a progressive draw step, a poll tick or a busy action re-diffs only the rows whose
// download, art or state changed (a group object is rebuilt on every list change, so its rows are compared instead).
const sameGroup = (a: DownloadGroup, b: DownloadGroup) => a === b || (a.totalSizeBytes === b.totalSizeBytes && a.rows.length === b.rows.length && a.rows.every((row, index) => row === b.rows[index]));
type TVDownloadRowProps = { group: DownloadGroup; index: number; thumb: string; busy: string; detailsShown: boolean; expanded: boolean; onPlay: (download: Download) => void; onAction: (download: Download, action: DownloadTransferAction) => void; onMore: (id: string) => void; onRemoveFile: (download: Download) => void };
const TVDownloadRow = memo(function TVDownloadRow({ group, index, thumb, busy, detailsShown, expanded, onPlay, onAction, onMore, onRemoveFile }: TVDownloadRowProps) {
 const download = group.representative;
 const band = 2 + index * 20;
 const multi = group.rows.length > 1;
 const view = downloadRow(download, group.rows.length);
 return <div role="group" aria-label={download.displayTitle || download.filePath} data-download-id={download.id} data-download-index={index} data-active-row="" class="tv-download-row">
  <div class="tv-download-line">
   <span class="tv-download-thumb" aria-hidden="true">{thumb && <img src={thumb} alt="" decoding="async" onError={hideImage} />}</span>
   <div class="tv-download-main"><strong class="tv-download-title" title={download.displayTitle || download.filePath}>{download.displayTitle || download.filePath}</strong><span class="tv-download-state"><b class={`tv-download-status ${view.tone}`}>{view.state}</b>{view.meter && <i class={`tv-meter ${view.tone}`} role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}><b style={{ width: `${view.percent}%` }} /></i>}<small class="tv-download-facts">{view.facts}</small></span></div>
   <span class="tv-download-size">{formatBytes(group.totalSizeBytes)}</span>
   <div class="tv-download-actions"><button data-landing="card" data-focus-region="content" data-focus-row={band} data-focus-col="0" data-focus-key={`download-${download.id}-play`} class="primary" onClick={() => onPlay(download)}><Icon name="play" />Play</button>{downloadTransferActions(download).map(item => <button key={item.action} aria-disabled={busy ? 'true' : undefined} data-focus-region="content" data-focus-row={band} data-focus-col="1" data-focus-key={`download-${download.id}-${item.action}`} onClick={() => onAction(download, item.action)}>{busy === download.id + ':' + item.action ? item.pendingLabel : item.label}</button>)}<button class="tv-download-more" data-focus-region="content" data-focus-row={band} data-focus-col="2" data-focus-key={`download-${download.id}-more`} aria-haspopup="dialog" aria-label={multi ? 'More: Details, Show files, Delete download' : 'More: Details, Delete download'} onClick={() => onMore(download.id)}><Icon name="more" /></button></div>
  </div>
  {detailsShown && <dl class="tv-download-details"><dt>Release</dt><dd>{download.releaseName || download.filePath}</dd><dt>{multi ? 'Files' : 'File'}</dt><dd>{multi ? `${group.rows.length} files in this torrent` : `${download.filePath} (file ${download.fileIndex})`}</dd><dt>Tracker</dt><dd>{download.trackerName} release {download.releaseId}{download.trackerSeeders !== undefined ? ` · ${download.trackerSeeders} seeders` : ''}{download.releaseSizeBytes ? ` · ${formatBytes(download.releaseSizeBytes)} total` : ''}</dd><dt>Transfer</dt><dd>{download.seeds} connected seeds · {download.peers} peers</dd></dl>}
  {multi && expanded && <div class="tv-download-files">{group.rows.map((row, rowIndex) => <div key={row.id} class="tv-download-file"><strong title={row.displayTitle || row.filePath}>{row.displayTitle || row.filePath}</strong><small>{formatBytes(row.sizeBytes)}</small><span><button data-focus-region="content" data-focus-row={band + 1 + rowIndex} data-focus-col="2" data-focus-key={`download-${row.id}-file-${row.fileIndex}-play`} onClick={() => onPlay(row)}>Play</button><button class="danger-button" data-focus-region="content" data-focus-row={band + 1 + rowIndex} data-focus-col="3" data-focus-key={`download-${row.id}-file-${row.fileIndex}-remove`} onClick={() => onRemoveFile(row)}>Remove</button></span></div>)}</div>}
 </div>;
}, (a, b) => sameGroup(a.group, b.group) && a.index === b.index && a.thumb === b.thumb && a.busy === b.busy && a.detailsShown === b.detailsShown && a.expanded === b.expanded);

// The heading's storage line. It asks the server's settings for the Allocation itself, so the answer re-renders this
// line only, not the list.
function TVAllocationUse({ api, storedBytes }: { api: API; storedBytes: number }) {
 const [allocation, setAllocation] = useState<number | undefined>(undefined);
 useEffect(() => {
  // Asked once the screen has opened, so the request and its answer stay out of the route change.
  let live = true;
  const timer = window.setTimeout(() => api.call<Record<string, unknown>>('/settings').then(settings => { const value = Number(settings?.allocationGb); if (live && Number.isFinite(value)) setAllocation(value) }).catch(() => { }), DOWNLOADS_SETTLED_MS);
  return () => { live = false; window.clearTimeout(timer) };
 }, []);
 const use = allocationUse(storedBytes, allocation);
 return <p class="tv-download-use">{use.label}{use.percent >= 0 && <i class="tv-meter" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={use.percent}><b style={{ width: `${use.percent}%` }} /></i>}</p>;
}
function TVDownloads({ api, items, eager = false, onPlay, onManage }: { api: API; items: Download[]; eager?: boolean; onPlay: (download: Download) => void; onManage: (download: Download, action: string) => Promise<void> }) {
 const [pending, setPending] = useState<PendingDownloadRemoval | null>(null);
 const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
 const [removing, setRemoving] = useState(false);
 const [detailsOpen, setDetailsOpen] = useState<Set<string>>(() => new Set());
 const [busyAction, setBusyAction] = useState('');
 // The download whose More sheet is open (its id), or ''.
 const [more, setMore] = useState('');
 // A failed action shows its message here and leaves the list where it was; the fatal panel is for startup failures only.
 const [actionMessage, setActionMessage] = useState('');
 const [query, setQuery] = useState('');
 const [filter, setFilter] = useState<DownloadsFilter>('all');
 const [sort, setSort] = useState<DownloadSort>('recent');
 const [order, setOrder] = useState<string[]>(() => orderDownloadIDs(items, 'recent'));
 const cancelButton = useRef<HTMLButtonElement>(null);
 const confirmButton = useRef<HTMLButtonElement>(null);
 const art = useListArtReach();
 const artTimer = useRef(0);
 // Thumbnails wait until the screen has opened and focus rests, so the route change itself decodes no pictures.
 const [artReady, setArtReady] = useState(false);
 useEffect(() => {
  const ready = window.setTimeout(() => setArtReady(true), DOWNLOADS_SETTLED_MS);
  return () => { window.clearTimeout(ready); window.clearTimeout(artTimer.current) };
 }, []);
 const focusKey = (key: string) => window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) || document.querySelector<HTMLElement>('[data-focus-key="downloads-search"]')), 0);
 const closeConfirmation = () => { if (removing) return; const key = pending ? (pending.scope === 'file' ? `download-${pending.download.id}-file-${pending.download.fileIndex}-remove` : `download-${pending.download.id}-more`) : ''; setPending(null); focusKey(key) };
 useEffect(() => {
  if (!pending) return;
  const timer = removing ? 0 : window.setTimeout(() => focusElement(cancelButton.current), 0);
  const key = (event: KeyboardEvent) => {
   const action = remoteAction(event.key, event.keyCode);
   if (!action || action === 'ime-done' || action === 'ime-cancel') return;
   event.preventDefault();
   event.stopImmediatePropagation();
   if (removing) return;
   if (action === 'back') { closeConfirmation(); return; }
   if (action === 'up') { focusElement(cancelButton.current); return; }
   if (action === 'down') { focusElement(confirmButton.current); return; }
   if (action === 'left' || action === 'right') return;
   const active = document.activeElement;
   if (active instanceof HTMLButtonElement && (active === cancelButton.current || active === confirmButton.current)) active.click();
   else focusElement(cancelButton.current);
  };
  document.addEventListener('keydown', key, true);
  return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key, true) };
 }, [pending?.download.id, removing]);
 const idsKey = items.map(item => item.id).join('\u0000');
 useEffect(() => setOrder(current => { const available = new Set(items.map(item => item.id)); const retained = current.filter(id => available.has(id)); const known = new Set(retained); const added = items.filter(item => !known.has(item.id)).map(item => item.id); return [...added, ...retained] }), [idsKey]);
 const counts = useMemo(() => { const result: Record<DownloadsFilter, number> = { all: items.length, active: 0, done: 0, paused: 0, attention: 0 }; for (const item of items) result[downloadFilterOf(item)]++; return result }, [items]);
 const storedBytes = useMemo(() => items.reduce((sum, item) => sum + Math.max(0, item.sizeBytes || 0), 0), [items]);
 const visible = useMemo(() => { const term = query.trim().toLocaleLowerCase(); const byID = new Map(items.map(item => [item.id, item])); const ordered = (order.length ? order : items.map(item => item.id)).map(id => byID.get(id)).filter((item): item is Download => Boolean(item)); return ordered.filter(download => { const text = [download.displayTitle, download.releaseName, download.filePath, download.category, download.state].filter(Boolean).join(' ').toLocaleLowerCase(); return (!term || text.includes(term)) && (filter === 'all' || downloadFilterOf(download) === filter) }) }, [items, order, query, filter]);
 const groups = useMemo(() => groupDownloadsByTorrent(visible), [visible]);
 const [progressive] = useState(!eager);
 const [drawn, setDrawn] = useState(DOWNLOADS_FIRST_DRAW);
 useEffect(() => {
  if (!progressive || drawn >= groups.length) return;
  const timer = window.setTimeout(() => setDrawn(count => count + DOWNLOADS_DRAW_STEP), drawn === DOWNLOADS_FIRST_DRAW ? DOWNLOADS_SETTLED_MS : 0);
  return () => window.clearTimeout(timer);
 }, [progressive, drawn, groups.length]);
 const shownGroups = progressive && drawn < groups.length ? groups.slice(0, drawn) : groups;
 const toggleDetails = (id: string) => setDetailsOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next });
 const toggleFiles = (engineId: string) => setExpandedGroups(current => { const next = new Set(current); if (next.has(engineId)) next.delete(engineId); else next.add(engineId); return next });
 const chooseFilter = (value: DownloadsFilter) => { if (value === filter) return; setFilter(value); art.reset() };
 const cycleSort = () => { const values = DOWNLOAD_SORTS.map(([value]) => value); const next = values[(values.indexOf(sort) + 1) % values.length]; setSort(next); setOrder(orderDownloadIDs(items, next)) };
 const playRow = useStableCallback((download: Download) => onPlay(download));
 const actRow = useStableCallback((download: Download, action: DownloadTransferAction) => void runAction(download, action));
 const removeFile = useStableCallback((download: Download) => setPending({ download, scope: 'file' }));
 const runAction = async (download: Download, action: DownloadTransferAction) => { if (busyAction) return; setActionMessage(''); setBusyAction(`${download.id}:${action}`); try { await onManage(download, action) } catch (error) { setActionMessage((error as Error).message) } finally { setBusyAction('') } };
 const confirmRemoval = async () => { if (!pending || removing) return; setActionMessage(''); setRemoving(true); try { await onManage(pending.download, pending.scope === 'file' ? 'remove-file' : 'remove'); setPending(null); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="downloads-search"]')), 0) } catch (error) { setActionMessage((error as Error).message) } finally { setRemoving(false) } };
 // Thumbnails load around the row that holds focus once focus rests, so a held key decodes no new pictures.
 const followFocus = (event: FocusEvent) => { const row = (event.target as HTMLElement | null)?.closest?.('[data-download-index]') as HTMLElement | null; if (!row) return; const index = Number(row.dataset.downloadIndex); window.clearTimeout(artTimer.current); artTimer.current = window.setTimeout(() => art.focus(index), ART_SETTLE_MS) };
 if (pending) return <section role="dialog" aria-modal="true" aria-labelledby="download-delete-heading" aria-describedby="download-delete-description" class="tv-settings tv-removal-confirm">{pending.scope === 'file' ? <><h2 id="download-delete-heading">Remove episode from downloads?</h2><strong>{pending.download.displayTitle || pending.download.filePath}</strong><p id="download-delete-description">The episode leaves the download list. Its file stays on the server until the whole download is deleted.</p></> : <><h2 id="download-delete-heading">Delete download?</h2><strong>{pending.download.displayTitle || pending.download.releaseName || pending.download.filePath}</strong><p>{formatBytes(pending.download.sizeBytes)} · {pending.download.trackerName}</p><p id="download-delete-description">This permanently deletes the download and every file it stored, including unfinished ones. You can download the title again later.</p></>}{actionMessage && <p role="alert" class="focus-hint">{actionMessage}</p>}<button ref={cancelButton} aria-disabled={removing ? 'true' : undefined} data-focus-region="download-dialog" data-focus-row="1" data-focus-col="0" data-focus-key="download-cancel" onClick={closeConfirmation}>Cancel</button><button ref={confirmButton} aria-disabled={removing ? 'true' : undefined} class="danger-button" data-focus-region="download-dialog" data-focus-row="2" data-focus-col="0" data-focus-key="download-confirm" onClick={() => void confirmRemoval()}>{removing ? (pending.scope === 'file' ? 'Removing…' : 'Deleting…') : pending.scope === 'file' ? 'Remove episode' : 'Delete download'}</button></section>;
 const sortLabel = DOWNLOAD_SORTS.find(([value]) => value === sort)?.[1];
 const moreGroup = more ? groups.find(group => group.representative.id === more) : undefined;
 const moreSheet = moreGroup && (() => {
  const download = moreGroup.representative;
  const moreKey = `download-${download.id}-more`;
  const close = () => setMore('');
  const after = (run: () => void) => { close(); run(); focusKey(moreKey) };
  const files = moreGroup.rows.length;
  return <MoreMenuLayer title={download.displayTitle || download.filePath} returnKey={moreKey} onClose={close} items={[
   { key: 'details', label: detailsOpen.has(download.id) ? 'Hide details' : 'Details', detail: 'Release, file, tracker and peers', onSelect: () => after(() => toggleDetails(download.id)) },
   ...(files > 1 ? [{ key: 'files', label: expandedGroups.has(download.engineId) ? 'Hide files' : 'Show files', detail: `${files} files in this torrent, each to play or remove`, onSelect: () => after(() => toggleFiles(download.engineId)) }] : []),
   { key: 'delete', label: 'Delete download', danger: true, detail: 'Deletes the download and every file it stored', onSelect: () => { close(); setPending({ download, scope: 'torrent' }) } },
  ]} />;
 })();
 return <section class="tv-list tv-download-list" onFocusCapture={followFocus}>
  <TVAllocationUse api={api} storedBytes={storedBytes} />
  {actionMessage && <p role="status" class="focus-hint">{actionMessage}</p>}
  <div class="tv-filters tv-download-tools">{DOWNLOAD_FILTERS.map(([value, label], col) => <button data-focus-region="content" data-focus-row="1" data-focus-col={col} data-focus-key={`downloads-filter-${value}`} class={filter === value ? 'active' : ''} aria-pressed={filter === value ? 'true' : 'false'} onClick={() => chooseFilter(value)}>{label}<em class="tv-chip-count">{counts[value]}</em></button>)}<button class="tv-download-sort" data-focus-region="content" data-focus-row="1" data-focus-col={DOWNLOAD_FILTERS.length} data-focus-key="downloads-sort" onClick={cycleSort}>Sort: {sortLabel}</button><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col={DOWNLOAD_FILTERS.length + 1} data-focus-key="downloads-search" value={query} onInput={event => { setQuery(event.currentTarget.value); art.reset() }} placeholder="Find a download" aria-label="Find a download; press OK to type" /></div>
  {query.trim() !== '' && items.length > 0 && <p class="tv-download-count" aria-live="polite">{`${groups.length} of ${items.length} downloads match “${query.trim()}”`}</p>}
  {groups.length === 0 ? (items.length === 0 ? <EmptyState title="No downloads yet">Open a title, choose a version and press Play and download; it shows here while it transfers.</EmptyState> : <EmptyState title="No downloads match">{`Choose All or clear the search to see all ${items.length} downloads.`}</EmptyState>) : shownGroups.map((group, groupIndex) => <TVDownloadRow key={group.representative.id} group={group} index={groupIndex} thumb={artReady && inReach(art.reach, groupIndex) ? downloadThumb(api, group.representative) : ''} busy={busyAction.startsWith(group.representative.id + ':') ? busyAction : ''} detailsShown={detailsOpen.has(group.representative.id)} expanded={expandedGroups.has(group.representative.engineId)} onPlay={playRow} onAction={actRow} onMore={setMore} onRemoveFile={removeFile} />)}
  {moreSheet}
 </section>
}
// Category families (both Categories pages). Tiles first; opening a family lists its titles (Tracker) or managed items (My Library)
// with a chip per raw tracker category. Lists are cached in Catalog so Back from a title page lands on already-rendered cards.
type FamilyCacheEntry = { families?: CategoryFamily[]; titles?: CatalogTitle[]; items?: HouseholdItem[]; nextCursor?: string | null; focusKey?: string };
const FAMILY_PAGE = 60;
const FAMILY_CHIP_ROW = 2;
const FAMILY_SORT_ROW = 3;
const FAMILY_LIST_ROW = 10;
function TVFamilies({ api, mode, familyKey, chip, sort, setFamilyKey, setChip, setSort, cache, backRef, onOpenTitle, onOpenLibraryItem }: { api: API; mode: 'catalog' | 'library'; familyKey: string; chip: string; sort: 'newest' | 'seeders' | 'title' | 'rating'; setFamilyKey: (key: string) => void; setChip: (category: string) => void; setSort: (sort: 'newest' | 'seeders' | 'title' | 'rating') => void; cache: { current: Record<string, FamilyCacheEntry> }; backRef: { current: (() => string) | null }; onOpenTitle: (title: CatalogTitle) => void; onOpenLibraryItem: (item: HouseholdItem) => void }) {
 const unit = mode === 'library' ? 'item' : 'title';
 const tilesKey = `${mode}:tiles`;
 const listKey = `${mode}:${familyKey}:${chip}:${mode === 'catalog' ? sort : ''}`;
 const [families, setFamilies] = useState<CategoryFamily[] | null>(() => cache.current[tilesKey]?.families || null);
 const [list, setList] = useState<FamilyCacheEntry | null>(() => cache.current[listKey] || null);
 const [message, setMessage] = useState('');
 const [loadingMore, setLoadingMore] = useState(false);
 const reach = useRowReach(FAMILY_LIST_ROW);
 useEffect(() => {
  let live = true;
  (mode === 'library' ? api.libraryFamilies() : api.families()).then(page => { if (!live) return; cache.current[tilesKey] = { families: page.items }; setFamilies(page.items); setMessage('') }).catch(error => { if (live) setMessage((error as Error).message) });
  return () => { live = false };
 }, [api, mode]);
 useEffect(() => {
  if (!familyKey) { setList(null); return }
  let live = true;
  setList(cache.current[listKey] || null);
  const load: Promise<FamilyCacheEntry> = mode === 'library'
   ? api.libraryFamilyItems(familyKey, chip).then(page => ({ items: canonicalHouseholdItems(page.items as HouseholdItem[]), nextCursor: null }))
   : api.titles({ family: familyKey, category: chip, sort, pageSize: FAMILY_PAGE }).then(page => { void api.ensureMetadata(page.items.map(item => item.id)).catch(() => { }); return { titles: page.items, nextCursor: page.nextCursor } });
  load.then(entry => { if (!live) return; cache.current[listKey] = entry; setList(entry); setMessage('') }).catch(error => { if (live) { setList({ titles: [], items: [], nextCursor: null }); setMessage((error as Error).message) } });
  return () => { live = false };
 }, [api, mode, familyKey, chip, sort]);
 const family = families?.find(item => item.key === familyKey) || null;
 const open = (key: string) => { setChip(''); setFamilyKey(key); requestLanding() };
 const pickChip = (category: string) => { setChip(category); requestLanding() };
 backRef.current = () => { if (!familyKey) return ''; const closing = familyKey; setFamilyKey(''); setChip(''); return closing };
 useEffect(() => () => { backRef.current = null }, []);
 const more = () => {
  if (loadingMore || !list?.nextCursor || mode !== 'catalog') return;
  setLoadingMore(true);
  api.titles({ family: familyKey, category: chip, sort, pageSize: FAMILY_PAGE, cursor: list.nextCursor }).then(page => { void api.ensureMetadata(page.items.map(item => item.id)).catch(() => { }); const entry = { titles: [...(list.titles || []), ...page.items], nextCursor: page.nextCursor }; cache.current[listKey] = entry; setList(entry) }).catch(error => setMessage((error as Error).message)).then(() => setLoadingMore(false));
 };
 if (!familyKey) {
  if (families && families.length === 0) return <EmptyState title={mode === 'library' ? 'No library categories yet' : 'No categories yet'}>{mode === 'library' ? 'Download or watch a title and its category appears here.' : 'Choose Fetch latest in Settings to run the first catalog sync.'}</EmptyState>;
  return <section class="tv-family-page">{message && <p class="tv-muted" aria-live="polite">{message}</p>}{!families && !message && <p class="tv-muted" aria-live="polite">Loading categories…</p>}{families && <FamilyTiles api={api} families={families} unit={unit} onOpen={open} />}</section>;
 }
 const name = family?.name || familyKey;
 const titles = list?.titles || [];
 const items = list?.items || [];
 const empty = list !== null && titles.length === 0 && items.length === 0;
 const heading = <div class="tv-filters"><button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="family-back" onClick={() => { const closing = familyKey; setFamilyKey(''); setChip(''); window.setTimeout(() => { const tile = document.querySelector<HTMLElement>(`[data-focus-key="family-${closing}"]`); if (tile) focusElement(tile); else requestLanding() }, 0) }}><Icon name="chevron-left" />All categories</button></div>;
 return <section class="tv-family-page">
  {heading}
  <FamilyChips name={name} categories={family?.categories || []} active={chip} row={FAMILY_CHIP_ROW} onPick={pickChip} />
  {mode === 'catalog' && <div class="tv-filters tv-chip-line" role="group" aria-label="Sort titles"><span class="tv-chip-label">Sort</span>{([['newest', 'Newest'], ['seeders', 'Most seeded'], ['rating', 'Rating'], ['title', 'A–Z']] as const).map(([value, label], index) => <button class={sort === value ? 'active' : ''} aria-pressed={sort === value ? 'true' : 'false'} data-focus-region="content" data-focus-row={FAMILY_SORT_ROW} data-focus-col={index} data-focus-key={`family-sort-${value}`} onClick={() => setSort(value)}>{label}</button>)}</div>}
  {message && <p class="tv-muted" aria-live="polite">{message}</p>}
  {list === null && !message && <p class="tv-muted" aria-live="polite">Loading…</p>}
  {mode === 'catalog' && titles.length > 0 && <><div class="row-heading"><h2>{name}</h2></div><TitleGrid api={api} items={titles} firstRow={FAMILY_LIST_ROW} keyPrefix="family-title" onOpen={onOpenTitle} /></>}
  {mode === 'library' && items.length > 0 && <><div class="row-heading"><h2>{name}</h2></div><div class="tv-poster-grid">{items.map((item, index) => { const row = FAMILY_LIST_ROW + Math.floor(index / GRID_COLUMNS); return <LibraryCard api={api} item={item} row={row} col={index % GRID_COLUMNS} focusKey={`library-item-${item.titleId || item.catalog?.id || item.release.id}`} loadArt={inRowReach(reach, row)} onOpen={onOpenLibraryItem} /> })}</div></>}
  {mode === 'catalog' && list?.nextCursor && <div class="tv-filters"><button data-focus-region="content" data-focus-row={FAMILY_LIST_ROW + gridLines(titles.length)} data-focus-col="0" data-focus-key="family-more" aria-disabled={loadingMore ? 'true' : undefined} onClick={more}>{loadingMore ? 'Loading…' : 'Show more titles'}</button></div>}
  {empty && !message && <p class="tv-muted">{mode === 'library' ? 'Nothing is left in this category. Press All categories to go back.' : 'No titles in this category yet. Choose All or another category.'}</p>}
 </section>;
}
function TVJobs({ api, items: initial }: { api: API; items: Job[] }) {
 const [items, setItems] = useState(initial); const [query, setQuery] = useState(''); const [state, setState] = useState(''); const [kind, setKind] = useState(''); const [retryable, setRetryable] = useState(''); const [updatedHours, setUpdatedHours] = useState(''); const [next, setNext] = useState<string | null>(null); const [message, setMessage] = useState(''); const [detail, setDetail] = useState<{ job: Job; logs: JobLog[]; next: string | null } | null>(null);
 async function load(target = '', append = false) { try { const page = await api.jobs({ search: query, state, kind, retryable, updatedHours, pageSize: 12, cursor: target }); setItems(value => append ? [...value, ...page.items] : page.items); setNext(page.nextCursor) } catch (error) { setMessage('Background jobs could not be loaded. Try again in a minute.') } }
 // The job row a detail was opened from: closing the detail puts the cursor back on it (D-pad map job-detail).
 const opened = useRef('');
 async function open(job: Job) { opened.current = job.id; try { const [result, logs] = await Promise.all([api.job(job.id), api.jobLogs(job.id)]); setDetail({ job: result.job, logs: logs.items, next: logs.nextCursor }) } catch (error) { setMessage('Background jobs could not be loaded. Try again in a minute.') } }
 async function older() { if (!detail?.next) return; try { const page = await api.jobLogs(detail.job.id, detail.next); setDetail({ ...detail, logs: [...detail.logs, ...page.items], next: page.nextCursor }) } catch (error) { setMessage('Background jobs could not be loaded. Try again in a minute.') } }
 useEffect(() => { const timer = window.setTimeout(() => { void load('') }, 400); return () => clearTimeout(timer) }, [query, state, kind, retryable, updatedHours]);
 useEffect(() => {
  // Catalog signals a jobs keypress near the list end; appends are guarded
  // so rapid keypresses cannot double-fetch the same page.
  let busy = false;
  const onNear = () => { if (busy || !next) return; busy = true; api.jobs({ search: query, state, kind, retryable, updatedHours, pageSize: 12, cursor: next }).then(page => { setItems(value => [...value, ...page.items]); setNext(page.nextCursor) }).catch(error => setMessage('Background jobs could not be loaded. Try again in a minute.')).then(() => { busy = false }) };
  window.addEventListener('tv-jobs-near-end', onNear);
  return () => window.removeEventListener('tv-jobs-near-end', onNear);
 });
 const closeDetail = () => { setDetail(null); window.setTimeout(() => { const row = document.querySelector<HTMLElement>(`[data-focus-key="job-${CSS.escape(opened.current)}"]`); if (row) focusElement(row); else requestLanding() }, 0) };
 if (detail) return <TVJobDetail detail={detail} onBack={closeDetail} onOlder={older} />;
 const cycle = (value: string, values: string[], set: (value: string) => void) => set(values[(values.indexOf(value) + 1) % values.length]);
 return <section class="tv-list tv-jobs"><div class="tv-filters"><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="jobs-search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search; press OK to type" /><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="jobs-state" onClick={() => cycle(state, ['', 'failed', 'completed', 'running', 'queued'], setState)}>State: {state || 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="jobs-kind" onClick={() => cycle(kind, ['', 'metadata', 'catalog-title-refresh', 'catalog-sync'], setKind)}>Kind: {kind ? jobKindLabel(kind) : 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="3" data-focus-key="jobs-retry" onClick={() => cycle(retryable, ['', 'true', 'false'], setRetryable)}>Retry: {retryable === 'true' ? 'can retry' : retryable === 'false' ? 'cannot retry' : 'any'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="4" data-focus-key="jobs-time" onClick={() => cycle(updatedHours, ['', '24', '168', '720'], setUpdatedHours)}>Updated: {updatedHours === '24' ? 'last day' : updatedHours === '168' ? 'last week' : updatedHours === '720' ? 'last month' : 'any time'}</button></div>{message && <p class="tv-job-message" role="status">{message}</p>}{items.length === 0 ? <EmptyState title="No jobs match">Set State to all, or choose a longer Updated range.</EmptyState> : items.map((job, index) => { const shown = jobState(job); return <article class={`tv-job ${shown.tone}`}><span class="tv-job-state"><Icon name={shown.icon} /><b>{shown.word}</b></span><div class="tv-job-main"><strong>{jobWhatRan(job)}</strong><span>{[relativeTime(job.updatedAt), job.state === 'running' ? `${Math.round((job.progress || 0) * 100)}%` : '', job.error || ''].filter(Boolean).join(' · ')}</span></div><div class="tv-job-actions"><button data-landing="card" data-focus-region="content" data-focus-row={2 + index} data-focus-col="0" data-focus-key={`job-${job.id}`} onClick={() => void open(job)}>Details</button><button disabled={job.state === 'queued' || job.state === 'running' || job.state === 'retry_wait'} data-focus-region="content" data-focus-row={2 + index} data-focus-col="1" data-focus-key={`job-${job.id}-retry`} onClick={() => void api.retryJob(job.id).then(() => api.job(job.id)).then(({ job: fresh }) => { setMessage('Job queued again.'); setItems(value => value.map(item => item.id === fresh.id ? fresh : item)) }).catch(() => setMessage('The job could not be queued again. Try again in a minute.'))}>Retry</button></div></article> })}</section>
}

function TVJobDetail({ detail, onBack, onOlder }: { detail: { job: Job; logs: JobLog[]; next: string | null }; onBack: () => void; onOlder: () => void }) {
 const [level, setLevel] = useState(''); const [attempt, setAttempt] = useState(''); const [expanded, setExpanded] = useState<number | null>(null);
 const logs = detail.logs.filter(log => (!level || log.level === level) && (!attempt || String(log.attempt) === attempt));
 // The detail replaces the job list, so the job row that had focus is gone: start on the back-to-Jobs button.
 // Back closes the detail first (before the shell would open the rail); consumed on keydown so the
 // shell's Back-on-keyup never starts.
 const backButton = useRef<HTMLButtonElement | null>(null);
 const latestBack = useRef(onBack); latestBack.current = onBack;
 useEffect(() => {
  focusElement(backButton.current);
  // With the rail open over the detail, Back closes the rail first (the shell's own Back).
  const key = (event: KeyboardEvent) => { if (remoteAction(event.key, event.keyCode) !== 'back' || document.querySelector('.tv-app.menu-open')) return; event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) latestBack.current() };
  document.addEventListener('keydown', key, true);
  return () => document.removeEventListener('keydown', key, true);
 }, []);
 // Row 0.5: below the header Refresh (row 0), above the log filters, so Up and Down both reach it.
 return <section class="tv-list job-detail"><button ref={backButton} data-focus-region="content" data-focus-row="0.5" data-focus-col="0" data-focus-key="job-detail-back" onClick={onBack}><Icon name="chevron-left" />Jobs</button><h2>{jobWhatRan(detail.job)}</h2><p class="tv-muted">{jobStatusLine(detail.job)} · attempt {detail.job.attempt}</p><div class="tv-filters"><button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="log-level" onClick={() => setLevel(value => value === '' ? 'error' : value === 'error' ? 'warn' : '')}>Level: {level || 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="log-attempt" onClick={() => setAttempt(value => value === '' ? String(detail.job.attempt) : '')}>Attempt: {attempt || 'all'}</button></div>{logs.length === 0 ? <p class="tv-muted">No logs match. Set Level and Attempt to all to see every entry.</p> : logs.map((log, index) => { const open = expanded === log.id; return <button type="button" aria-expanded={open} data-focus-region="content" data-focus-row={2 + index} data-focus-col="0" data-focus-key={`job-log-${log.id}`} class={`job-log ${log.level} ${open ? 'expanded' : ''}`} onClick={() => setExpanded(value => value === log.id ? null : log.id)}><span class="job-log-heading"><strong>{log.phase} · {log.level}</strong><i>{open ? 'Hide details' : 'Show details'}</i></span><span>{new Date(log.createdAt).toLocaleString()} · attempt {log.attempt}</span><small>{log.message}</small>{open && <div class="job-log-expanded"><dl><dt>Job</dt><dd>{log.jobId}</dd><dt>Log entry</dt><dd>{log.id}</dd><dt>Attempt</dt><dd>{log.attempt}</dd></dl>{log.context && Object.keys(log.context).length > 0 ? <pre>{JSON.stringify(log.context, null, 2)}</pre> : <p>No structured context was recorded.</p>}</div>}</button> })}{detail.next && <button data-focus-region="content" data-focus-row={3 + logs.length} data-focus-col="0" data-focus-key="job-logs-older" onClick={() => void onOlder()}>Load older logs</button>}</section>
}


// Promotion slot on the home route. It is one focus stop: OK hands the
// creative's click URL to the platform browser (the server resolves
// tracking and redirects), and the address stays on the tile as the
// fallback for boxes without a browser. A hidden, failed, or empty
// delivery still leaves nothing in the DOM; delivery advances after each
// creative's screen time and stops on unmount or a hidden document.
export function TVPromotions({ api }: { api: API }) {
 const [promotion, setPromotion] = useState<PortalPromotion | null>(null);
 useEffect(() => {
  let stopped = false;
  let timer = 0;
  let controller: AbortController | null = null;
  const cancelDelivery = () => { window.clearTimeout(timer); timer = 0; if (controller) { controller.abort(); controller = null } };
  const deliver = async () => {
   if (stopped || document.hidden) return;
   cancelDelivery();
   // Tizen 5 (Chromium 63) has no AbortController: skip cancellation there.
   // A late response is dropped through the stopped flag instead.
   controller = detectCapabilities().supportsAbortController ? new AbortController() : null;
   try {
    const [creative] = await api.call<PortalPromotion[]>('/portal/promotions?count=1', controller ? { signal: controller.signal } : {});
    if (stopped || document.hidden) return;
    setPromotion(creative || null);
    if (creative) timer = window.setTimeout(() => { timer = 0; void deliver() }, promotionScreenTimeMs(creative.screenTime));
   } catch { if (!stopped) setPromotion(null) }
  };
  const visibility = () => { if (document.hidden) cancelDelivery(); else void deliver() };
  void deliver();
  document.addEventListener('visibilitychange', visibility);
  return () => { stopped = true; cancelDelivery(); document.removeEventListener('visibilitychange', visibility) };
 }, [api]);
 if (!promotion) return null;
 const url = api.promotionClickURL(promotion.provider, promotion.id);
 return <button class="tv-promo" data-focus-region="content" data-focus-row="95" data-focus-col="0" data-focus-key="promo" onClick={() => { void openExternalURL(url) }}><small>Advertisement</small>{/^https?:\/\//.test(promotion.image) && <img src={promotion.image} alt="" />}{promotion.title && <strong>{promotion.title}</strong>}{promotion.text && <p>{promotion.text}</p>}{promotion.link ? <code>{promotion.link}</code> : null}</button>;
}

// Poster card: the poster with its library-state badge, then the title (up to two lines) and one short fact.
const TitleCard = memo(function TitleCard({ api, title, row, col, focusKey, seeders, focusRef, loadArt, onOpen }: { api: API; title: CatalogTitle; row: number; col: number; focusKey?: string; seeders?: boolean; focusRef?: { current: HTMLButtonElement | null }; loadArt: boolean; onOpen: (title: CatalogTitle) => void }) {
 return <button ref={focusRef} class="poster-card" data-landing="card" data-focus-region="content" data-focus-row={row} data-focus-col={col} data-focus-key={focusKey || `title-${title.id}`} data-art={followArtURL(api, title)} onClick={() => onOpen(title)}><span class="card-art">{title.posterUrl ? <PosterArt src={api.streamURL(title.posterUrl)} load={loadArt} /> : <span class="poster-fallback">{title.title.slice(0, 1)}</span>}<TVStateBadges state={title.libraryState} compact /></span><span class="poster-copy"><strong>{title.title}</strong><span>{cardMeta(title, { seeders })}</span></span></button>;
});
function sourceActionLabel(source: CatalogSource) { return source.libraryState?.downloadState && source.libraryState.downloadState !== 'none' ? 'Play' : 'Play and download' }
// The versions row, shared by the movie list and an episode's Versions view: one line of aligned columns (resolution, the
// Best match slot, quality and codec, size and seeders in tabular figures, tracker and audio, library state and the action),
// then the release and file name, which is evidence: its line is reserved and shows while the row has focus.
function SourceButton({ source, row, onPlay, focusKey, region = 'content', best }: { source: CatalogSource; row: number; onPlay: (release: Release, fileIndex?: number) => void; focusKey?: string; region?: string; best?: boolean }) {
 const name = source.filePath || source.release.name;
 const tracker = [source.release.trackerName, source.parsed.audio].filter(Boolean).join(' · ');
 return <button class={`source-button ${best ? 'best' : ''}`} data-focus-region={region} data-focus-row={row} data-focus-col="0" data-focus-key={focusKey || `source-${source.release.id}-${source.fileIndex ?? -1}`} onClick={() => onPlay(source.release, source.fileIndex)}>
  <span class="source-main"><b class="source-resolution">{sourceHeadline(source.parsed)}</b>{best ? <span class="source-best">Best match</span> : <span class="source-best-slot" aria-hidden="true" />}<span class="source-quality">{sourceChips(source.parsed, source.release.category).join(' · ')}</span><span class="source-size">{formatBytes(source.fileSizeBytes || source.release.sizeBytes)}</span><span class="source-seeders">{source.release.seeders} seeders</span><span class="source-tracker">{tracker}</span><span class="source-action"><TVStateBadges state={source.libraryState} /><b class="source-action-label">{sourceActionLabel(source)}</b></span></span>
  <span class="source-detail"><span class="source-filename" title={name}>{name}</span></span>
 </button>;
}

type SeasonPackAction = 'download' | 'pause' | 'resume' | 'retry' | 'delete';
// A complete-season pack in the versions pane: always open, one row of actions, no disclosure to step through.
function TVSeasonPackCard({ source, season, row, onAction, onDelete }: { source: CatalogSource; season: number; row: number; onAction: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean>; onDelete: () => void }) {
 const state = source.libraryState; const [busy, setBusy] = useState(''); const managed = Boolean(state?.downloadId); const paused = state?.transferState === 'paused'; const complete = state?.downloadState === 'downloaded'; const error = state?.downloadState === 'error';
 const run = async (action: SeasonPackAction) => { if (busy) return; setBusy(action); try { await onAction(source, season, action) } catch { /* the detail area already shows the message */ } finally { setBusy('') } };
 const base = `season-pack-${source.release.id}`;
 return <article class="season-pack-card">
  <div class="season-pack-head">
   <span class="season-pack-copy"><strong>{source.parsed.resolution ? sourceHeadline(source.parsed) : 'Season pack'}</strong>{sourceChips(source.parsed).length > 0 && <small>{sourceChips(source.parsed).join(' · ')}</small>}<small>{formatBytes(source.release.sizeBytes)} · {source.release.seeders} seeders</small><small>{[source.release.trackerName, source.parsed.audio].filter(Boolean).join(' · ')}</small></span>
   <span class="season-pack-action"><TVStateBadges state={state} /><b>{seasonPackActionLabel(state)}</b></span>
  </div>
  <p class="source-filename">{source.release.name}</p>
  {managed && <progress value={state?.progress || 0} max="1" aria-label="Season download progress" />}
  <div class="season-pack-controls">{!managed && <button class="primary" aria-disabled={busy ? 'true' : undefined} data-focus-region="versions" data-focus-row={row} data-focus-col="0" data-focus-key={`${base}-download`} onClick={() => void run('download')}>{busy ? 'Starting…' : 'Download season'}</button>}{managed && !complete && !error && <button aria-disabled={busy ? 'true' : undefined} data-focus-region="versions" data-focus-row={row} data-focus-col="1" data-focus-key={`${base}-toggle`} onClick={() => void run(paused ? 'resume' : 'pause')}>{busy ? `${paused ? 'Resuming' : 'Pausing'}…` : paused ? 'Resume' : 'Pause'}</button>}{error && <button class="primary" aria-disabled={busy ? 'true' : undefined} data-focus-region="versions" data-focus-row={row} data-focus-col="2" data-focus-key={`${base}-retry`} onClick={() => void run('retry')}>{busy ? 'Retrying…' : 'Retry'}</button>}{managed && <button class="danger-button" aria-disabled={busy ? 'true' : undefined} data-focus-region="versions" data-focus-row={row} data-focus-col="3" data-focus-key={`${base}-delete`} onClick={() => { if (!busy) onDelete() }}>Delete download</button>}</div>
 </article>;
}

const hideImage = (event: Event) => { (event.currentTarget as HTMLElement).style.display = 'none' };
const episodeKeyOf = (episode: { season: number; number: number }) => `${episode.season}:${episode.number}`;
// The season an episode key ("2:4", or "unknown-2" for the loose files) belongs to; 0 for none.
const versionsSeasonOf = (key: string) => Number(/^(?:unknown-)?(\d+)/.exec(key)?.[1] || 0);
// The episode that opens selected in the versions pane: the link's target, the saved progress, else the first one not yet watched.
function defaultEpisodeOf(season: CatalogSeason | undefined, target: DetailTarget, resume?: HouseholdItem): CatalogEpisode | undefined {
 if (!season) return undefined;
 const targeted = target.episode && target.season === season.number ? season.episodes.find(item => item.number === target.episode) : undefined;
 const saved = resume?.seasonNumber === season.number && resume.episodeNumber ? season.episodes.find(item => item.number === resume.episodeNumber) : undefined;
 return targeted || saved || season.episodes.find(item => item.libraryState?.watchState !== 'watched') || season.episodes[0];
}
// The version a saved resume points at, so the line under the actions can name it; undefined when the list no longer has it.
function findSource(detail: CatalogDetail, item: HouseholdItem): CatalogSource | undefined {
 const same = (source: CatalogSource) => source.release.id === item.release.id && (source.fileIndex ?? -1) === (item.fileIndex ?? -1);
 const pool = detail.sources.concat(...detail.seasons.map(season => ([] as CatalogSource[]).concat(...season.episodes.map(episode => episode.sources))));
 return pool.find(same) || pool.find(source => source.release.id === item.release.id);
}
const paneFocusable = (selector: string) => document.querySelector<HTMLElement>(selector);

function TitleDetail({ api, detail, target, message, resume, initialVersions = '', restoreKey = '', onVersions, favorite, onClose, onFavorite, onResume, onPlay, onPackAction }: { api: API; detail: CatalogDetail; target: DetailTarget; message: string; resume?: HouseholdItem; initialVersions?: string; restoreKey?: string; onVersions?: (key: string) => void; favorite: boolean; onClose: () => void; onFavorite: (title: CatalogTitle, value: boolean) => void; onResume: (item: HouseholdItem) => void; onPlay: (release: Release, fileIndex?: number) => void; onPackAction: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean> }) {
 // Season to open: the Versions view being restored, else the link's target, else the season of the saved progress, else the first.
 const [season, setSeason] = useState(() => { const restored = versionsSeasonOf(initialVersions); return (detail.seasons.some(item => item.number === restored) ? restored : 0) || target.season || (resume?.seasonNumber && detail.seasons.some(item => item.number === resume.seasonNumber) ? resume.seasonNumber : 0) || detail.seasons[0]?.number || 0 });
 // The focused episode, which the list marks; '' follows the default. Focus selects it after a short pause.
 const [picked, setPicked] = useState('');
 // The episode whose full-screen Versions view is open; '' shows the episode list.
 const [opened, setOpened] = useState(initialVersions);
 const [pendingPack, setPendingPack] = useState<CatalogSource | null>(null);
 const [deleting, setDeleting] = useState(false);
 const [refreshing, setRefreshing] = useState(false);
 const [refreshNote, setRefreshNote] = useState('');
 const [infoOpen, setInfoOpen] = useState(false);
 const [moreOpen, setMoreOpen] = useState(false);
 // The provider's description (a movie's runtime, the certification) is asked once, a moment after the page shows; the facts line
 // never waits on it, and the Info panel opens on the same answer instead of asking again.
 const [titleInfo, setTitleInfo] = useState<TitleInfo | undefined>(undefined);
 useEffect(() => {
  let live = true;
  const timer = window.setTimeout(() => { try { Promise.resolve(api.titleInfo(detail.title.id)).then(answer => { if (live && answer && answer.available) setTitleInfo(answer) }, () => { }) } catch { /* no Info support: the facts stay as they are */ } }, 400);
  return () => { live = false; window.clearTimeout(timer) };
 }, [detail.title.id]);
 const selected = detail.seasons.find(item => item.number === season);
 // Season info (stills, runtime, rating, synopsis) is asked once per season, a moment after the season shows, and kept for the page.
 // The page never waits on it: without an answer every row and block falls back to what the title detail holds.
 const seasonInfo = useRef(new Map<number, InfoSeasonDetail | null>());
 const [, setInfoTick] = useState(0);
 useEffect(() => {
  if (!season || seasonInfo.current.has(season)) return;
  const timer = window.setTimeout(() => {
   if (seasonInfo.current.has(season)) return;
   seasonInfo.current.set(season, null);
   // A failed fetch is forgotten, so coming back to the season asks again; an unavailable answer is a real answer and stays.
   const forget = () => { if (seasonInfo.current.get(season) === null) seasonInfo.current.delete(season) };
   try { Promise.resolve(api.seasonInfo(detail.title.id, season)).then(answer => { if (answer && answer.available) { seasonInfo.current.set(season, answer); setInfoTick(count => count + 1) } }, forget) } catch { forget() }
  }, 400);
  return () => window.clearTimeout(timer);
 }, [season]);
 const infoOf = (episode: { season: number; number: number }) => seasonInfo.current.get(episode.season)?.episodes.find(item => item.number === episode.number);
 const art = useListArtReach();
 useEffect(() => { art.reset() }, [season, opened]);
 useEffect(() => {
  // The episode list keeps the focused row in its middle (the board's E03 above, E04 focused, E05 below), so a row
  // never sits cut off at the list's top edge; one scroll write, the row and list sizes come from the layout already done.
  const focused = (event: FocusEvent) => {
   const target = event.target as HTMLElement | null;
   const row = target?.closest?.('[data-art-index]') as HTMLElement | null;
   if (row) art.focus(Number(row.dataset.artIndex));
   const pane = target && target.dataset && target.dataset.focusRegion === 'episodes' ? target.closest('.episode-pane') as HTMLElement | null : null;
   if (pane) pane.scrollTop = centredScrollTop({ top: target!.offsetTop, height: target!.offsetHeight }, { height: pane.clientHeight, scrollHeight: pane.scrollHeight });
  };
  document.addEventListener('focusin', focused);
  return () => document.removeEventListener('focusin', focused);
 }, []);
 const titleArt = detail.title.backdropUrl || detail.title.posterUrl || '';
 // Best version: the primary Play prepares the top-ranked source of the selected season's target episode (movies: of the title).
 const playEpisode = selected && (target.episode && target.season === selected.number ? selected.episodes.find(item => item.number === target.episode) : undefined) || selected?.episodes[0];
 const firstSource = bestSourceForDetail(detail, { season: selected?.number, episode: playEpisode?.number });
 const defaultEpisode = defaultEpisodeOf(selected, target, resume);
 const unknownKey = selected?.unknown && selected.unknown.length > 0 ? `unknown-${selected.number}` : '';
 // A pick that vanished in a data refresh falls back to the default; one that is still there never moves.
 const pickedValid = picked !== '' && (picked === unknownKey || Boolean(selected?.episodes.some(item => episodeKeyOf(item) === picked)));
 const selectedKey = pickedValid ? picked : defaultEpisode ? episodeKeyOf(defaultEpisode) : unknownKey;
 const selectedEpisode = selected?.episodes.find(item => episodeKeyOf(item) === selectedKey);
 // A Versions view whose episode vanished in a data refresh falls back to the list; one that is still there never closes.
 const openedValid = opened !== '' && (opened === unknownKey || Boolean(selected?.episodes.some(item => episodeKeyOf(item) === opened)));
 const openedEpisode = openedValid ? selected?.episodes.find(item => episodeKeyOf(item) === opened) : undefined;
 // A season that only has packs (its episode list is still being prepared) shows them in the Versions view straight away.
 const packsOnly = Boolean(selected && selected.episodes.length === 0 && !unknownKey && (selected.packSources?.length || 0) > 0);
 const versionsShown = openedValid || packsOnly;
 const openedPage = openedEpisode ? episodePageView(openedEpisode.season, openedEpisode, infoOf(openedEpisode), detail.title.overview || '') : undefined;
 const timer = useRef(0);
 const focusIntent = useRef<'' | 'versions' | 'list'>('');
 const returnKey = useRef('');
 // The page scroll a view change sets: the Versions view opens with the season pills at the safe edge (the header steps away),
 // and the list state, which fits the screen, returns the page to its top so the header shows again.
 const scrollPage = (view: HTMLElement | null) => { const screen = document.querySelector<HTMLElement>('.detail-screen'); if (screen) screen.scrollTop = view ? Math.max(0, view.offsetTop - (parseFloat(getComputedStyle(screen).paddingTop) || 0)) : 0 };
 const focusVersions = () => { scrollPage(paneFocusable('.season-browser')); const first = paneFocusable('[data-focus-region="versions"]') || paneFocusable(`[data-focus-key="season-${season}"]`); if (first) focusElement(first) };
 // Open the Versions view for an episode; focus follows its render, on the Best match.
 const openVersions = (key: string) => { window.clearTimeout(timer.current); focusIntent.current = 'versions'; setPicked(key); setOpened(key) };
 // Back to the episode list, focused on the episode the view was opened from.
 const closeVersions = () => { if (!openedValid) return; window.clearTimeout(timer.current); returnKey.current = opened; focusIntent.current = 'list'; setOpened('') };
 useEffect(() => {
  if (focusIntent.current === 'versions' && openedValid) { focusIntent.current = ''; focusVersions() }
  else if (focusIntent.current === 'list' && !openedValid) { focusIntent.current = ''; scrollPage(null); focusElement(paneFocusable(`[data-episode-key="${returnKey.current}"]`) || paneFocusable('[data-focus-region="episodes"]')) }
 });
 // A list that appears (the page opens, another season, back from Versions) shows its selected episode in the middle,
 // as the board does, even before the cursor goes there; once the cursor is in the list, focus keeps it centred.
 useEffect(() => {
  if (versionsShown) return;
  const row = paneFocusable('.episode-pane .episode-tile.selected');
  const pane = row ? row.closest('.episode-pane') as HTMLElement | null : null;
  if (row && pane && !pane.contains(document.activeElement)) pane.scrollTop = centredScrollTop({ top: row.offsetTop, height: row.offsetHeight }, { height: pane.clientHeight, scrollHeight: pane.scrollHeight });
 }, [season, versionsShown]);
 useEffect(() => { onVersions?.(openedValid ? opened : '') }, [opened, openedValid]);
 useEffect(() => () => { window.clearTimeout(timer.current); onVersions?.('') }, []);
 const scheduleSelect = (key: string) => { window.clearTimeout(timer.current); if (key === selectedKey) return; timer.current = window.setTimeout(() => setPicked(key), 150) };
 const chooseVersion = () => { if (detail.seasons.length === 0) { focusElement(document.querySelector<HTMLElement>('.source-button')); return } const key = playEpisode ? episodeKeyOf(playEpisode) : selectedKey; if (key) openVersions(key); else focusVersions() };
 // A page restored into its Versions view lands on the version the viewer left from, else the Best match, instead of the hero.
 useEffect(() => { const t = window.setTimeout(() => { const back = initialVersions && restoreKey ? paneFocusable(`[data-focus-region="versions"][data-focus-key="${CSS.escape(restoreKey)}"]`) : null; if (initialVersions) scrollPage(paneFocusable('.season-browser')); focusElement(back || (initialVersions ? paneFocusable('[data-focus-region="versions"]') : null) || document.querySelector<HTMLElement>('[data-detail-initial]')) }, 0); return () => window.clearTimeout(t); }, []);
 useEffect(() => { if (!pendingPack) return; const t = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="season-pack-delete-cancel"]')), 0); return () => window.clearTimeout(t) }, [pendingPack]);
 const closePackDialog = () => { const pack = pendingPack; setPendingPack(null); if (pack) window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="season-pack-${pack.release.id}-delete"]`)), 0) };
 useEffect(() => { if (!pendingPack) return; const key = (event: KeyboardEvent) => { if (remoteAction(event.key, event.keyCode) !== 'back') return; event.preventDefault(); event.stopImmediatePropagation(); if (!deleting) closePackDialog() }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [pendingPack, deleting]);
 // Moves between the episode list, the Versions view and the season bar. Up, Down and in-row moves inside each use the structured attributes.
 const latest = useRef({ season, selectedKey, versionsShown, openVersions, closeVersions });
 latest.current = { season, selectedKey, versionsShown, openVersions, closeVersions };
 useEffect(() => {
  const handle = (event: KeyboardEvent) => {
   const action = remoteAction(event.key, event.keyCode);
   const active = document.activeElement as HTMLElement | null;
   const now = latest.current;
   const consume = () => { event.preventDefault(); event.stopImmediatePropagation() };
   // Back pops the Versions view before the page, from wherever the cursor is, unless a dialog sits on top and handles Back itself.
   if (action === 'back' && now.versionsShown && !document.querySelector('[role="dialog"]')) { consume(); now.closeVersions(); return }
   if (!action || !active || !active.dataset) return;
   const region = active.dataset.focusRegion;
   const go = (element: HTMLElement | null) => { consume(); focusElement(element) };
   const seasonTab = () => paneFocusable(`[data-focus-key="season-${now.season}"]`);
   if (region === 'episodes') {
    if (action === 'right') { consume(); now.openVersions(active.dataset.episodeKey || now.selectedKey) }
    else if (action === 'up' && active.dataset.focusRow === '0') go(seasonTab());
    else if (action === 'left') go(active);
   } else if (region === 'versions') {
    if (action === 'up' && active.dataset.focusRow === '0') go(seasonTab());
    else if (action === 'left' && !chooseStructuredTarget(active, visibleFocusables(), 'left')) { consume(); now.closeVersions() }
   } else if (region === 'content' && action === 'down' && (active.dataset.focusKey || '').indexOf('season-') === 0 && active.dataset.focusRow === '2') {
    go(now.versionsShown ? paneFocusable('[data-focus-region="versions"]') || active : paneFocusable(`[data-focus-region="episodes"][data-episode-key="${now.selectedKey}"]`) || paneFocusable('[data-focus-region="episodes"]') || active);
   }
  };
  document.addEventListener('keydown', handle, true);
  return () => document.removeEventListener('keydown', handle, true);
 }, []);
 const confirmDelete = async () => { if (!pendingPack || !selected || deleting) return; setDeleting(true); try { await onPackAction(pendingPack, selected.number, 'delete'); setPendingPack(null) } catch { /* the detail area already shows the message; the dialog stays open */ } finally { setDeleting(false) } };
 const refresh = async () => {
  if (refreshing) return;
  setRefreshing(true);
  setRefreshNote('');
  try { await api.refreshTitle(detail.title.id, detail.title.title, true) } catch (e) { setRefreshNote((e as Error).message) } finally { setRefreshing(false) }
 };
 const packs = selected?.packSources || [];
 const resumeSource = resume ? findSource(detail, resume) : undefined;
 const plays = playsLine({ source: resume ? resumeSource : firstSource, resume, kind: detail.title.kind });
 const playLabel = firstSource ? { action: sourceActionLabel(firstSource), version: [firstSource.parsed?.resolution, firstSource.parsed?.quality].filter(Boolean).join(' ') } : { action: '', version: '' };
 const rating = cardRating(detail.title);
 const facts: Array<string | JSX.Element> = [releaseLine(detail.title), detail.title.kind === 'series' ? '' : formatRuntime(titleInfo?.runtimeMinutes), (detail.title.genres || []).slice(0, 3).join(', ')].filter(Boolean);
 if (rating) facts.push(<b class="tv-rating" aria-label={`Rated ${rating}`}><Icon name="star" />{rating}</b>);
 if (titleInfo?.certification) facts.push(<span class="detail-certification">{titleInfo.certification}</span>);
 const paneSources = openedEpisode ? rankSources(openedEpisode.sources, { season: openedEpisode.season, episode: openedEpisode.number }) : [];
 const unknownSources: CatalogSource[] = [];
 if (unknownKey && openedValid && opened === unknownKey && selected?.unknown) selected.unknown.forEach(episode => episode.sources.forEach(source => unknownSources.push(source)));
 const code = (value: number) => (value < 10 ? '0' : '') + value;
 const paneTitle = openedEpisode ? `S${code(openedEpisode.season)} · E${code(openedEpisode.number)} · ${openedEpisode.title}` : openedValid && selected ? `S${code(selected.number)} · Unknown episodes` : selected ? `Season ${selected.number}` : '';
 const packBase = Math.max(paneSources.length, unknownSources.length);
 return <main class={`detail-screen${detail.seasons.length > 0 ? ' series-page' : ''}`}>
  <Backdrop initial={artURL(api, detail.title)} follow={false} sharp posterOnly={!detail.title.backdropUrl && !!detail.title.posterUrl} />
  <button data-focus-region="content" data-focus-row="0" data-focus-col="0" data-focus-key="detail-back" onClick={onClose}><Icon name="chevron-left" />Back</button>
  <div class="detail-copy">
   <span class="detail-kind">{titleKind(detail.title)}</span>
   <h1>{detail.title.title}</h1>
   {facts.length > 0 && <p class="detail-facts">{facts.map((fact, index) => <Fragment key={index}>{index > 0 && <i class="detail-dot" aria-hidden="true">·</i>}{fact}</Fragment>)}</p>}
   <TVStateBadges state={detail.title.libraryState} />
   {/* A series page leaves the overview to Info (the "Series page" board), so its seasons and episodes sit on the first screen. */}
   {detail.seasons.length === 0 && <p class="detail-overview">{detail.title.overview || 'No description yet. Pick a version to play.'}</p>}
   <div class="detail-actions">
    {resume ? <button class="primary" data-detail-initial data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="detail-playback" onClick={() => onResume(resume)} aria-label={`${resumeActionLabel(resume, detail.title.kind)} from ${formatTime(resume.positionMs)}`}><Icon name="play" />{resumeActionLabel(resume, detail.title.kind)}<span class="detail-primary-note"> from {formatTime(resume.positionMs)}</span></button> : firstSource && <button class="primary" data-detail-initial data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="detail-playback" onClick={() => onPlay(firstSource.release, firstSource.fileIndex)}><Icon name="play" />{playLabel.action}{playLabel.version && <span class="detail-primary-note">{` · ${playLabel.version}`}</span>}</button>}
    {firstSource && <button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="detail-versions" onClick={chooseVersion}>Choose version</button>}
    <button class="detail-icon" data-detail-initial={resume || firstSource ? undefined : true} data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="detail-favorite" aria-pressed={favorite} aria-label={favorite ? 'In My List' : 'Add to My List'} onClick={() => onFavorite(detail.title, !favorite)}><Icon name={favorite ? 'check' : 'plus'} /></button>
    <button class="detail-icon" data-focus-region="content" data-focus-row="1" data-focus-col="4" data-focus-key="detail-info" aria-haspopup="dialog" aria-label="Info" onClick={() => setInfoOpen(true)}><Icon name="info" /></button>
    <button class="detail-icon" data-focus-region="content" data-focus-row="1" data-focus-col="5" data-focus-key="detail-more" aria-haspopup="dialog" aria-label="More: Refresh data" onClick={() => setMoreOpen(true)}><Icon name="more" /></button>
   </div>
   {plays && <p class="detail-plays">{plays}</p>}
  </div>
  {message && <p class="detail-message" aria-live="polite">{message}</p>}
  {refreshNote && !moreOpen && <p class="detail-message" role="alert">{refreshNote}</p>}
  {detail.seasons.length > 0 && <section class="season-browser">
   <div class="season-tabs" role="group" aria-label="Seasons">{detail.seasons.map((item, index) => <button key={item.number} data-focus-region="content" data-focus-row="2" data-focus-col={index} data-focus-key={`season-${item.number}`} class={season === item.number ? 'active' : ''} onClick={() => { window.clearTimeout(timer.current); setSeason(item.number); setPicked(''); setOpened('') }}><span>Season {item.number}</span><TVStateBadges state={item.libraryState} /></button>)}</div>
   {versionsShown ? <section class="versions-view" aria-label="Versions">
    <header class="versions-head"><h3 class="versions-title"><span class="versions-label">Versions</span> · {paneTitle}</h3></header>
    {openedValid && <p class="info-crumbs" aria-label="You are here">{(openedEpisode ? infoCrumbs(detail.title.title, [{ kind: 'episode', season: openedEpisode.season, episode: openedEpisode.number }]) : [detail.title.title, `Season ${selected!.number}`, 'Unknown episodes']).join(' › ')}</p>}
    {openedEpisode && <div class="versions-episode">
     {(openedPage!.stillUrl || titleArt) && <span class="info-still" aria-hidden="true"><img src={api.streamURL(openedPage!.stillUrl || titleArt)} alt="" onError={hideImage} /></span>}
     <div class="versions-episode-copy">
      <span class="info-meta">{[openedPage!.code].concat(openedPage!.meta).join(' · ')}</span>
      <span class="info-episode-title">{openedPage!.title}</span>
      {openedPage!.badges.length > 0 && <span class="info-genres">{openedPage!.badges.join(' · ')}</span>}
      {openedPage!.overview && <p class="info-overview">{openedPage!.overview}</p>}
      {openedPage!.credits.map(credit => <span class="info-credit-line"><b>{credit.label}</b> {credit.names}</span>)}
     </div>
    </div>}
    {openedValid && <h3 class="info-subheading">Choose a version</h3>}
    {packsOnly && <p class="episode-loading" role="status">Preparing the individual episode list. This page updates by itself when it is ready.</p>}
    <div class="versions-list">
     {paneSources.map((source, index) => <SourceButton key={`${source.release.id}:${source.fileIndex ?? -1}`} source={source} region="versions" row={index} best={index === 0} onPlay={onPlay} />)}
     {unknownSources.map((source, index) => <SourceButton key={`unknown-${source.release.id}:${source.fileIndex ?? -1}:${index}`} source={source} region="versions" row={index} focusKey={`unknown-source-${index}`} best={false} onPlay={onPlay} />)}
     {openedEpisode && paneSources.length === 0 && <p class="versions-empty" role="status">No versions of this episode yet.</p>}
     {packs.length > 0 && <div class="season-pack-downloads"><h4>Complete season</h4><p class="supporting">Download every episode of season {selected!.number} at once.</p>{packs.map((source, index) => <TVSeasonPackCard key={source.release.id} source={source} season={selected!.number} row={packBase + index} onAction={onPackAction} onDelete={() => setPendingPack(source)} />)}</div>}
    </div>
   </section> : <div class="season-panes">
    <div class="episode-column">
    <div class="episode-pane" role="list" aria-label={`Season ${season} episodes`}>
     {selected && selected.episodes.length === 0 && !unknownKey ? <p class="episode-loading" role="status">Preparing the individual episode list. This page updates by itself when it is ready.</p> : selected?.episodes.map((episode, index) => {
      const key = episodeKeyOf(episode);
      const chosen = selectedKey === key;
      const libraryState = episode.libraryState;
      const progress = libraryState && libraryState.watchState !== 'watched' && libraryState.positionMs ? watchProgress({ positionMs: libraryState.positionMs, durationMs: libraryState.durationMs || 0 }) : 0;
      const page = episodePageView(episode.season, episode, infoOf(episode));
      const still = page.stillUrl || titleArt;
      const state = episodeState(libraryState, progress);
      // One row of the "Series page" board: the still (with the progress bar on it while the episode is under way), the code
      // and name, the facts line, a two-line synopsis, the one library-state word and the chevron that says "opens".
      return <article key={key} role="listitem" class="episode-row">
       <button class={`info-stop info-row episode-tile ${chosen ? 'selected' : ''}`} aria-current={chosen ? 'true' : undefined} data-episode-key={key} data-art-index={index} data-focus-region="episodes" data-focus-row={index} data-focus-col="0" data-focus-key={`episode-${key}`} onFocus={() => scheduleSelect(key)} onClick={() => openVersions(key)}>
        <span class="info-still-small" aria-hidden="true">{still && inReach(art.reach, index) && <img src={api.streamURL(still)} alt="" onError={hideImage} />}{progress > 0 && <span class="episode-progress"><b style={{ width: `${progress}%` }} /></span>}</span>
        <span class="info-row-copy"><b>{episode.number ? <><span class="episode-code">{`E${episode.number < 10 ? '0' : ''}${episode.number}`}</span>{' '}</> : ''}{episode.title}</b><small>{episodeMeta(episode, page)}</small>{page.overview && <span class="episode-synopsis">{page.overview}</span>}</span>
        {state && <span class={`episode-state ${state.tone}`}>{state.text}</span>}
        <Icon name="chevron-right" class="info-chevron" />
       </button>
      </article>;
     })}
     {selected && unknownKey && <article key={unknownKey} role="listitem" class="episode-row unknown-group">
      <button class={`info-stop info-row episode-tile ${selectedKey === unknownKey ? 'selected' : ''}`} aria-current={selectedKey === unknownKey ? 'true' : undefined} data-episode-key={unknownKey} data-focus-region="episodes" data-focus-row={selected.episodes.length} data-focus-col="0" data-focus-key={unknownKey} onFocus={() => scheduleSelect(unknownKey)} onClick={() => openVersions(unknownKey)}>
       <span class="info-row-copy"><b>Unknown episodes ({selected.unknown!.length})</b><small>Files without episode information</small></span>
       <Icon name="chevron-right" class="info-chevron" />
      </button>
     </article>}
    </div>
    </div>
   </div>}
  </section>}
  {detail.seasons.length === 0 && detail.sources.length === 0 && <section class="source-list"><EmptyState title="No versions yet">The trackers have none for this title now; choose More, then Refresh data, to search them again.</EmptyState></section>}
  {detail.seasons.length === 0 && detail.sources.length > 0 && <section class="source-list" aria-label="Versions"><header class="source-list-head"><h2>Versions</h2><span>{`${detail.sources.length} available · best first`}</span></header>{rankSources(detail.sources).map((source, index) => <SourceButton key={`${source.release.id}:${source.fileIndex ?? -1}`} source={source} row={2 + index} best={index === 0} onPlay={onPlay} />)}</section>}
  {moreOpen && <MoreMenu title={detail.title.title} returnKey="detail-more" message={refreshNote} onClose={() => setMoreOpen(false)} items={[{ key: 'refresh', label: 'Refresh data', busy: refreshing, busyLabel: 'Refreshing…', detail: detail.title.kind === 'series' ? 'Fetch fresh series information and search every tracker again, then rebuild the episode list.' : 'Fetch fresh information and search every tracker again for new versions.', onSelect: () => void refresh() }]} />}
  {infoOpen && <TitleInfoPanel api={api} title={detail.title} initialInfo={titleInfo} onClose={() => { setInfoOpen(false); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="detail-info"]')), 0) }} />}
  {pendingPack && <section role="dialog" aria-modal="true" aria-labelledby="tv-season-pack-delete-heading" class="tv-settings tv-removal-confirm tv-season-pack-confirm"><h2 id="tv-season-pack-delete-heading">Delete season download?</h2><strong>Season {selected?.number}</strong><p>{pendingPack.release.name} · {pendingPack.release.trackerName}</p><p>This permanently deletes the season download and every episode file in it. You can download the season again later.</p><button aria-disabled={deleting ? 'true' : undefined} data-focus-region="season-pack-dialog" data-focus-row="0" data-focus-col="0" data-focus-key="season-pack-delete-cancel" onClick={() => { if (!deleting) closePackDialog() }}>Cancel</button><button aria-disabled={deleting ? 'true' : undefined} class="danger-button" data-focus-region="season-pack-dialog" data-focus-row="1" data-focus-col="0" data-focus-key="season-pack-delete-confirm" onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete download'}</button></section>}
 </main>;
}

function SetupWithStatus({ store, ...props }: { store: StatusStore } & Omit<Parameters<typeof Setup>[0], 'status'>) { return <Setup {...props} status={useStatus(store)} /> }

export function App() {
 const [server, setServer] = useState(localStorage.getItem(STORAGE) || '');
 const [draft, setDraft] = useState(server || 'http://server.lan:8097');
 const [api, setAPI] = useState<API | null>(null);
 const [titles, setTitles] = useState<CatalogTitle[]>([]);
 const [facets, setFacets] = useState<CatalogFacets>(emptyFacets);
 const [household, setHousehold] = useState<HouseholdState>(emptyState);
 const [downloads, setDownloads] = useState<Download[]>([]);
 const [jobs, setJobs] = useState<Job[]>([]);
 // The status line lives in its own store: an event-stream tick re-renders the status span, not the catalog tree.
 const statusStore = useRef<StatusStore | null>(null);
 if (!statusStore.current) statusStore.current = createStatusStore();
 const setStatus = statusStore.current.set;
 const connectionStore = useRef<StatusStore | null>(null);
 if (!connectionStore.current) connectionStore.current = createStatusStore();
 const [portal, setPortal] = useState<PortalState | null>(null);
 const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
 type PrepareAttempt =
  | { kind: 'source'; release: Release; fileIndex: number; resumeMs: number }
  | { kind: 'season'; source: CatalogSource; season: number };
 const [player, setPlayer] = useState<{ download: Download; resumeMs: number; preferences?: PlaybackPreferences } | null>(null);
 const [preparing, setPreparing] = useState<TVPreparingState | null>(null);
 const prepareAttempt = useRef<PrepareAttempt | null>(null);
 const prepareToken = useRef(0);
 const prepareController = useRef<AbortController | null>(null);
 const prepareOriginKey = useRef<string | null>(null);
 const catalogFocus = useRef<string | null>(null);
 // Where the viewer is in Catalog (navLive, reported by Catalog) and where they were when playback took the screen (navSnapshot, handed back as Catalog's initialNav when the Player closes). Only a viewer-started play writes it; next-episode swaps inside the Player never do.
 const navLive = useRef<NavSnapshot | null>(null);
 const navSnapshot = useRef<NavSnapshot | null>(null);
 const rememberNav = (focusKey: string | null) => { navSnapshot.current = navLive.current ? { ...navLive.current, focusKey: focusKey || '' } : null };
 const viewportInput = useRef(0);
 const loadState = async (client = api) => { if (client) try { setHousehold(await client.state()); } catch (error) { setStatus((error as Error).message); } };
 async function connect(url = draft) { setStatus('Connecting…'); try { const normalized = normalizeServerURL(url); if (normalized !== server) navSnapshot.current = null; const client = new API(normalized); const info = await client.info(); const [titlePage, catalogFacets, downloadPage, jobPage] = await Promise.all([client.titles({ pageSize: 12, sort: 'newest' }), client.facets(), client.downloads().catch(() => ({ items: [], nextCursor: null, total: 0 })), client.jobs({ pageSize: 24 }).catch(() => ({ items: [], nextCursor: null, total: 0 }))]); localStorage.setItem(STORAGE, normalized); setServer(normalized); setDraft(normalized); setAPI(client); setStatus(`${info.instanceName || info.name} ${info.version}`); setTitles(titlePage.items); setFacets(catalogFacets); void client.ensureMetadata(titlePage.items.map(item => item.id)).catch(error => setStatus((error as Error).message)); } catch (error) { setStatus((error as Error).message); } }
 async function runPrepare(attempt: PrepareAttempt): Promise<boolean> {
  if (!api) return false;
  prepareAttempt.current = attempt;
  const token = ++prepareToken.current;
  const capabilities = detectCapabilities();
  const controller = capabilities.supportsAbortController ? new AbortController() : null;
  prepareController.current = controller;
  if (!prepareOriginKey.current && document.activeElement instanceof HTMLElement) {
   prepareOriginKey.current = document.activeElement.dataset.focusKey || null;
  }
  const label = attempt.kind === 'source' ? (attempt.release.name || 'Selected version') : `Season ${attempt.season} · ${attempt.source.release.name}`;
  setPreparing({ trackerName: attempt.kind === 'source' ? attempt.release.trackerName : attempt.source.release.trackerName, label, seeders: attempt.kind === 'source' ? attempt.release.seeders : attempt.source.release.seeders });
  try {
   if (attempt.kind === 'source') {
    const download = await api.prepare(attempt.release.id, attempt.fileIndex, controller?.signal);
    if (token !== prepareToken.current) return false;
    prepareController.current = null;
    prepareAttempt.current = null;
    rememberNav(prepareOriginKey.current);
    prepareOriginKey.current = null;
    setPreparing(null);
    let resumeMs = attempt.resumeMs;
    if (!resumeMs) {
     resumeMs = await api.playback(download.id).then(v => v.watched ? 0 : v.positionMs).catch(() => 0);
    }
    setPlayer({ download, resumeMs });
   } else {
    await api.prepareSeason(attempt.source.release.id, attempt.season, controller?.signal);
    if (token !== prepareToken.current) return false;
    prepareController.current = null;
    prepareAttempt.current = null;
    const origin = prepareOriginKey.current;
    prepareOriginKey.current = null;
    setPreparing(null);
    await refreshDownloads();
    setStatus(`Season ${attempt.season} added to Downloads.`);
    if (origin) window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(origin)}"]`)), 0);
   }
   return true;
  } catch (error) {
   if (token !== prepareToken.current) return false;
   prepareController.current = null;
   const err = error as Error & { status?: number };
   const canceled = controller?.signal.aborted === true || err.name === 'AbortError';
   if (canceled) {
    const origin = prepareOriginKey.current;
    prepareAttempt.current = null;
    prepareOriginKey.current = null;
    setPreparing(null);
    if (origin) window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(origin)}"]`)), 0);
    return false;
   }
   let hint = '';
   if (err.status === 409) {
    hint = 'Check tracker settings or choose another available version.';
   } else if (err.status === 504) {
    hint = 'Metadata search timed out. Check the swarm health or try again.';
   }
   setPreparing(current => current ? { ...current, error: err.message, hint } : current);
   return false;
  }
 }
 function cancelPrepare() {
  prepareToken.current++;
  try { prepareController.current?.abort(); } catch { }
  prepareController.current = null;
  prepareAttempt.current = null;
  const origin = prepareOriginKey.current;
  prepareOriginKey.current = null;
  setPreparing(null);
  if (origin) window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(origin)}"]`) || landingTarget()), 0);
 }
 function retryPrepare() {
  const attempt = prepareAttempt.current;
  if (attempt) void runPrepare(attempt);
 }
 async function play(release: Release, fileIndex = -1, resumeMs = 0) {
  if (!api) return;
  prepareOriginKey.current = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey || null : null;
  await runPrepare({ kind: 'source', release, fileIndex, resumeMs });
 }
 async function favorite(title: CatalogTitle, value: boolean) { if (!api) return; try { await api.titleFavorite(title.id, value); await loadState(); } catch (error) { setStatus((error as Error).message); } }
 const refreshDownloads = async () => { if (!api) return; const anchor = captureTVDownloadAnchor(); const inputVersion = viewportInput.current; try { const incoming = (await api.downloads()).items; setDownloads(current => reconcileDownloads(current, incoming)); window.requestAnimationFrame(() => { if (inputVersion === viewportInput.current) restoreTVDownloadAnchor(anchor) }) } catch (error) { setStatus((error as Error).message) } };
 async function downloadSeason(source: CatalogSource, season: number): Promise<boolean> {
  if (!api) throw new Error('Server is not connected.');
  prepareOriginKey.current = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey || null : null;
  return await runPrepare({ kind: 'season', source, season });
 }
 async function manageSeasonPack(source: CatalogSource, season: number, action: SeasonPackAction): Promise<boolean> {
  if (!api) throw new Error('Server is not connected.');
  if (action === 'download' || (action === 'retry' && !source.libraryState?.downloadId)) {
   return await downloadSeason(source, season);
  }
  const id = source.libraryState?.downloadId;
  if (!id) throw new Error('This season download is not registered yet. Refresh the title and try again.');
  try {
   if (action === 'delete') await api.deleteDownload(id);
   else await api.call(`/downloads/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
   await refreshDownloads();
   return true;
  } catch (error) {
   setStatus((error as Error).message);
   throw error;
  }
 }
 function switchEpisode(next: Download, preferences: PlaybackPreferences) { void Promise.all([loadState(), refreshDownloads()]); setPlayer({ download: next, resumeMs: 0, preferences: { ...preferences, sourceId: next.id, subtitleMode: preferences.subtitleMode === 'off' ? 'off' : 'auto', subtitleProvider: '', subtitleCandidateId: '' } }) }
 async function advanceEpisode(preferences: PlaybackPreferences) { if (!api || !player) return; try { const next = await api.nextEpisode(player.download.id); await Promise.all([loadState(), refreshDownloads()]); if (next) setPlayer({ download: next, resumeMs: 0, preferences: { ...preferences, sourceId: next.id, subtitleMode: preferences.subtitleMode === 'off' ? 'off' : 'auto', subtitleProvider: '', subtitleCandidateId: '' } }); else setPlayer(null) } catch (error) { setStatus(`Could not start the next episode: ${(error as Error).message}`); setPlayer(null) } }
 async function manageDownload(download: Download, action: string) { if (!api) throw new Error('Server is not connected.'); try { if (action === 'remove') await api.deleteDownload(download.id); else await api.call(`/downloads/${encodeURIComponent(download.id)}/${action}`, { method: 'POST' }); const incoming = (await api.downloads()).items; setDownloads(current => reconcileDownloads(current, incoming)); } catch (error) { setStatus((error as Error).message); throw error } }
 useEffect(() => { registerMediaKeys(); if (server) void connect(server); }, []);
 useEffect(() => { const input = () => { viewportInput.current++ }; window.addEventListener('keydown', input); return () => window.removeEventListener('keydown', input) }, []);
 useEffect(() => {
  if (!api) return;
  let stream: EventSource | null = null;
  let timer = 0;
  let stopped = false;
  let suspended = false;
  let failures = 0;
  let recovering = false;
  let recoveryGeneration = 0;
  // Visibility-edge-scoped epoch for the visible-return snapshot refresh.
  // onopen bumps recoveryGeneration (replay suppression only); it must not
  // invalidate a pending visible-edge titles/facets/jobs refresh.
  let visibilityEpoch = 0;
  const eventPayload = (event: MessageEvent) => { const envelope = JSON.parse(event.data); return typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload };
  const loadPortal = () => api.call<PortalState>('/portal/state').then(value => setPortal(value)).catch(() => setPortal(null));
  const loadUpdate = () => api.call<UpdateStatus>('/updates/current').then(value => setUpdateStatus(value)).catch(() => setUpdateStatus(null));
  const metadata = (event: MessageEvent) => { try { const payload = eventPayload(event); const title = payload.title as CatalogTitle | undefined; if (!title?.id) return; window.dispatchEvent(new CustomEvent('catalog-metadata-updated', { detail: { title } })) } catch (error) { void api.diagnostic('warn', 'Could not process metadata event', { error: String(error) }).catch(() => { }) } };
  const catalogUpdated = (event: MessageEvent) => { try { const payload = eventPayload(event); const titleId = String(payload.titleId || payload.title?.id || ''); if (titleId) window.dispatchEvent(new CustomEvent('catalog-title-updated', { detail: { titleId } })); setStatus(titleId ? 'Episode list updated.' : 'Catalog updated.') } catch (error) { void api.diagnostic('warn', 'Could not process catalog event', { error: String(error) }).catch(() => { }) } };
  const searchCompleted = (event: MessageEvent) => { try { const payload = eventPayload(event); window.dispatchEvent(new CustomEvent('catalog-search-completed', { detail: payload })); setStatus(`Search for ${payload.query || 'title'} completed.`) } catch (error) { void api.diagnostic('warn', 'Could not process search event', { error: String(error) }).catch(() => { }) } };
  const portalStateEvent = (event: MessageEvent) => { if (!snapshotEventAllowed(recovering, 'portal.state')) return; try { setPortal(eventPayload(event) as PortalState) } catch (error) { void api.diagnostic('warn', 'Could not process portal event', { error: String(error) }).catch(() => { }) } };
  const updateStatusEvent = (event: MessageEvent) => { if (!snapshotEventAllowed(recovering, 'updates.status')) return; try { setUpdateStatus(eventPayload(event) as UpdateStatus) } catch (error) { void api.diagnostic('warn', 'Could not process update event', { error: String(error) }).catch(() => { }) } };
  const updateFailedEvent = (event: MessageEvent) => { if (!snapshotEventAllowed(recovering, 'updates.failed')) return; try { const payload = eventPayload(event) as { message?: string }; setStatus(payload.message || 'A server update had a problem.') } catch (error) { void api.diagnostic('warn', 'Could not process update failure', { error: String(error) }).catch(() => { }) } };
  const open = () => {
   if (stopped || suspended) return;
   stream?.close();
   stream = new EventSource(`${api.base}/api/v1/events`);
   stream.onopen = () => {
    failures = 0;
    setStatus('Server connected');
    connectionStore.current?.set(CONNECTED);
    // Reconnect recovery: refetch both snapshots and drop replayed
    // portal/update events until the fresh state has landed, so a stale
    // replay can never override what the server reports now.
    recovering = true;
    const generation = ++recoveryGeneration;
    void Promise.all([loadPortal(), loadUpdate()]).then(() => { if (recoverySettles(generation, recoveryGeneration)) recovering = false });
   };
   stream.addEventListener('catalog.updated', catalogUpdated as EventListener);
   stream.addEventListener('catalog.search.completed', searchCompleted as EventListener);
   stream.addEventListener('metadata.updated', metadata as EventListener);
   stream.addEventListener('job.updated', () => setStatus('A background job was updated.'));
   stream.addEventListener('portal.state', portalStateEvent as EventListener);
   stream.addEventListener('updates.status', updateStatusEvent as EventListener);
   stream.addEventListener('updates.failed', updateFailedEvent as EventListener);
   stream.onerror = () => { stream?.close(); if (stopped || suspended) return; failures++; const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(5, failures - 1))); const lost = `Server connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s…`; setStatus(lost); connectionStore.current?.set(lost); void api.diagnostic('warn', 'TV event stream disconnected', { attempt: failures }).catch(() => { }); window.clearTimeout(timer); timer = window.setTimeout(open, delay); };
  };
  const disposeVisibility = onAppVisibilityChange(visible => {
   window.clearTimeout(timer);
   recoveryGeneration++;
   visibilityEpoch++;
   if (!visible) { suspended = true; stream?.close(); return; }
   suspended = false;
   open();
   void loadState();
   void refreshDownloads();
   const epoch = visibilityEpoch;
   void Promise.all([
    api.titles({ pageSize: 12, sort: 'newest' }),
    api.facets(),
    api.jobs({ pageSize: 24 }).catch(() => ({ items: [], nextCursor: null, total: 0 })),
   ]).then(([titlePage, catalogFacets, jobPage]) => {
    if (stopped || suspended || epoch !== visibilityEpoch) return;
    setTitles(titlePage.items);
    setFacets(catalogFacets);
    setJobs(jobPage.items);
   }).catch(() => { });
  });
  void loadPortal();
  void loadUpdate();
  void loadState();
  void refreshDownloads();
  open();
  return () => { stopped = true; disposeVisibility(); window.clearTimeout(timer); stream?.close() };
 }, [api]);
 if (player && api) return <Player key={player.download.id} api={api} download={player.download} resumeMs={player.resumeMs} preferences={player.preferences} onStateChanged={() => loadState()} onComplete={advanceEpisode} onEpisode={switchEpisode} onClose={() => setPlayer(null)} />;
 if (!api) return <SetupWithStatus store={statusStore.current} draft={draft} server={server} onDraft={setDraft} onConnect={url => void connect(url)} onForget={() => { localStorage.removeItem(STORAGE); setServer(''); setDraft(''); setStatus('Saved server forgotten.') }} />;
 return <Catalog api={api} statusStore={statusStore.current} connectionStore={connectionStore.current} titles={titles} facets={facets} household={household} downloads={downloads} jobs={jobs} restoreFocus={navSnapshot.current ? navSnapshot.current.focusKey : catalogFocus.current} initialNav={navSnapshot.current || undefined} onNav={snapshot => { navLive.current = snapshot }} portal={portal} updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} onFocus={key => { catalogFocus.current = key; }} onRetry={() => void connect(server)} onChangeServer={() => { cancelPrepare(); navSnapshot.current = null; setAPI(null); }} onForgetServer={() => { cancelPrepare(); navSnapshot.current = null; localStorage.removeItem(STORAGE); setAPI(null); setServer(''); setDraft(''); }} onPlay={play} onPlayDownload={download => { rememberNav(catalogFocus.current); void api.playback(download.id).then(value => setPlayer({ download, resumeMs: value.watched ? 0 : value.positionMs })).catch(() => setPlayer({ download, resumeMs: 0 })) }} onManageDownload={manageDownload} onManageSeasonPack={manageSeasonPack} onRefreshDownloads={refreshDownloads} onFavorite={favorite} preparing={preparing} onCancelPrepare={cancelPrepare} onRetryPrepare={retryPrepare} />;
}

try {
 const root = document.getElementById('app');
 if (!root) throw new Error('The application root element is missing.');
 applyGraphicsClass();
 render(<App />, root);
 window.FileListBoot?.ready();
} catch (error) {
 window.FileListBoot?.fail(error);
 throw error;
}
