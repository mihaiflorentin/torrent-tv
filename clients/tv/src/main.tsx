import { Fragment, render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { API, canonicalHouseholdItems, canonicalLanguage, ControlsVisibility, subtitleRank, CatalogDetail, CatalogFacets, CatalogSource, CatalogTitle, Download, DownloadSort, downloadTransferActions, DownloadTransferAction, formatBytes, groupDownloadsByTorrent, HouseholdItem, HouseholdState, Job, JobLog, LibraryCategory, MediaState, orderDownloadIDs, PlaybackPreferences, PortalPromotion, PortalState, promotionScreenTimeMs, reconcileDownloads, Release, resumeActionLabel, resumeForTitle, seasonPackActionLabel, SettingsField, SubtitleCandidate, subtitleItemLabel, subtitleMenuGroups, TrackerStatus, UpdateStatus } from '@torrent-tv/shared';
import { chooseStructuredTarget, focusElement, remoteAction, useTVNavigation } from './navigation';
import { PROJECTS_MENU_ROW, SETTINGS_CHANGE_SERVER_ROW, SETTINGS_DIAGNOSTICS_ROW, SETTINGS_FORGET_SERVER_ROW, SETTINGS_SAVE_ROW, SETTINGS_TEST_FIRST_ROW, UPDATE_APPLY_ROW, UPDATE_CHECK_ROW, UPDATE_DIALOG_REGION, UPDATE_RELEASE_LINK_ROW, confirmDialogStale, dialogRestoreKey, promotionsVisible, recoverySettles, snapshotEventAllowed, updateApplyDisabled, updateApplyOutcome, updateNoticeVisible } from './portal';
import { AVTrack, clampSeek, formatTime, isDownloadComplete, isEditableTarget, normalizeTrack, parseVTT, playerAction, preferredAudio, SubtitleCue, subtitleAt } from './player';
import { PlayerKeyController, type PlayerFocus } from './player-keys';
import { householdSections, nearEnd, trackerCategories } from './catalog-data';
import { discoverServers, DiscoveredServer, normalizeServerURL } from './discovery';
import { Backdrop } from './backdrop';
import { cardMeta, downloadFacts, downloadProgressLine, downloadStatus, heroFacts, jobKindLabel, jobStatusLine, libraryCardLine, playerChoiceLine, resumeLine, sourceChips, sourceHeadline, watchProgress } from './display';
import { appIdentity } from './app-name';
import { exitApplication, getNetworkInfo, onAppVisibilityChange, openExternalURL, registerMediaKeys } from './platform';
import { detectCapabilities } from './capability';
import '@torrent-tv/shared/design/fonts.css';
import '@torrent-tv/shared/design/tokens.css';
import './tv.css';
import './performance.css';

const STORAGE = 'filelist.serverUrl';
const emptyState: HouseholdState = { favorites: [], continueWatching: [], recent: [], watched: [] };
const emptyFacets: CatalogFacets = { categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] };
const needsEpisodeExpansion = (detail: CatalogDetail) => detail.title.kind === 'series' && detail.seasons.some(season => (season.packSources?.length || 0) > 0 && season.episodes.length === 0);
type DetailTarget = { season?: number; episode?: number };

function TVStateBadges({ state }: { state?: MediaState }) { if (!state?.downloadState || !state.watchState) return null; const download = state.downloadState; const watch = state.watchState; return <span class="tv-state-badges">{download !== 'none' && <span class={`tv-state-badge download ${download}`}><i aria-hidden="true" /><b>{download === 'downloaded' ? 'Downloaded' : download === 'partial' ? 'Some downloaded' : download === 'error' ? 'Needs attention' : download === 'queued' ? 'Queued' : `Downloading ${Math.round((state.progress || 0) * 100)}%`}</b></span>}{watch !== 'unwatched' && <span class={`tv-state-badge watch ${watch}`}><i aria-hidden="true" /><b>{watch === 'watched' ? 'Watched' : watch === 'partial' ? 'Some watched' : 'In progress'}</b></span>}</span> }

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
   const detail = [candidate.format, candidate.hearingImpaired ? 'hearing impaired' : ''].filter(Boolean).join(' · ');
   rows.push({ key: `${keyPrefix}-${candidate.provider}-${candidate.id}`, row: row++, position: rows.length + 1, heading: headingPending ? group.label : '', candidate, detail });
   headingPending = false;
  }
 }
 return rows;
}

const defaultPlayerPreferences: PlaybackPreferences = { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'auto' };
// Player control icons: 24 px viewBox, drawn at 40 px by the stylesheet, always paired with a visible label.
const ICON_PATHS: Record<string, string> = {
 restart: 'M6 5h2.5v14H6zM20 5v14L10 12z',
 'back-10': 'M11 6v12L2.5 12zM21 6v12l-8.5-6z',
 play: 'M8 5v14l11-7z',
 pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
 'forward-10': 'M13 6v12l8.5-6zM3 6v12l8.5-6z',
 audio: 'M4 9v6h4l5 4V5L8 9z',
 subtitles: 'M5 10h5v2H5zM12 10h7v2h-7zM5 14h8v2H5z',
 options: 'M4 7h6v2H4zM14 7h6v2h-6zM10 5h4v6h-4zM4 15h2v2H4zM10 15h10v2H10zM6 13h4v6H6z',
 back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
 hide: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
};
function Icon({ name }: { name: string }) {
 return <svg class="tv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICON_PATHS[name]} />{name === 'audio' && <path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />}{name === 'subtitles' && <rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2" />}</svg>;
}

export function Player({ api, download, resumeMs, preferences, onClose, onStateChanged, onComplete }: { api: API; download: Download; resumeMs: number; preferences?: PlaybackPreferences; onClose: () => void; onStateChanged: () => void; onComplete: (preferences: PlaybackPreferences) => void }) {
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
 phaseRef.current = phase;
 messageRef.current = message;
 menuRef.current = menu;
 controlsVisibleRef.current = controlsVisible;
 subtitleDelayRef.current = subtitleDelay;
 const controls = useMemo(() => new ControlsVisibility({ policy: { armWhilePaused: true, statusHolds: false }, onChange: value => { controlsVisibleRef.current = value; setControlsVisible(value); if (!value) keysRef.current?.controlsHidden(); } }), []);
 const save = async () => { if (duration.current > 0) try { await api.updatePlayback(download.id, current.current, duration.current); onStateChanged() } catch { } };
 const savePreferences = async (value: PlaybackPreferences) => { preferenceRef.current = value; setChoice(playerChoiceLine(value)); try { preferenceRef.current = await api.updatePlaybackPreferences(download.id, value); setChoice(playerChoiceLine(preferenceRef.current)) } catch { } };

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
    onsubtitlechange: (_duration: number, text: string) => { if (token === session.current) setExternalSubtitle(String(text || '')); },
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
  if (type === 'TEXT') void savePreferences({ ...preferenceRef.current, subtitleLanguage: selected?.language || preferenceRef.current.subtitleLanguage, subtitleProvider: selected ? 'native' : '', subtitleCandidateId: selected ? String(selected.index) : '', subtitleMode: selected ? 'selected' : 'off' });
  showTransientMessage(index === null ? 'Subtitles off' : `${selected?.label || (type === 'AUDIO' ? 'Audio track' : 'Subtitle')} selected`);
 }
 function applyAudioPreference(allTracks: AVTrack[]) { const wanted = preferenceRef.current; const selected = preferredAudio(allTracks, wanted.audioLanguage, wanted.audioTrackIndex); if (selected) { try { window.webapis?.avplay.setSelectTrack('AUDIO', selected.index) } catch { } setChoice(playerChoiceLine({ ...wanted, audioLanguage: selected.language || wanted.audioLanguage })) } }
 async function autoSelectSubtitles(allTracks: AVTrack[]) { const saved = preferenceRef.current; if (saved.subtitleMode === 'off') { try { window.webapis?.avplay.setSilentSubtitle(true) } catch { } return } if (saved.subtitleMode === 'selected' && saved.subtitleProvider === 'native') { const track = allTracks.find(item => item.type === 'TEXT' && String(item.index) === saved.subtitleCandidateId); if (track) { try { window.webapis?.avplay.setSilentSubtitle(false); window.webapis?.avplay.setSelectTrack('TEXT', track.index); return } catch { } } } if (saved.subtitleMode === 'selected' && saved.subtitleProvider && saved.subtitleCandidateId) { if (await installSubtitle({ id: saved.subtitleCandidateId, provider: saved.subtitleProvider, language: saved.subtitleLanguage, title: 'Saved subtitle', score: 1000, cached: true }, false)) return } try { const local = await api.subtitles(download.id, saved.subtitleLanguage || 'ro', 'local'); setSubtitleCandidates(local.items); const ordered = [...local.items].sort((a, b) => subtitleRank(a.language, preferenceRef.current.subtitleLanguage || 'ro') - subtitleRank(b.language, preferenceRef.current.subtitleLanguage || 'ro')); for (const candidate of ordered) if (await installSubtitle(candidate, true)) return; const native = allTracks.filter(track => track.type === 'TEXT').sort((a, b) => subtitleRank(a.language, preferenceRef.current.subtitleLanguage || 'ro') - subtitleRank(b.language, preferenceRef.current.subtitleLanguage || 'ro'))[0]; if (native) { try { window.webapis?.avplay.setSilentSubtitle(false); window.webapis?.avplay.setSelectTrack('TEXT', native.index); await savePreferences({ ...saved, subtitleLanguage: native.language || 'en', subtitleProvider: 'native', subtitleCandidateId: String(native.index), subtitleMode: 'selected' }); return } catch { } } const remote = await api.subtitles(download.id, 'en', 'remote'); setSubtitleCandidates(current => [...current, ...remote.items]); for (const candidate of remote.items) if (await installSubtitle(candidate, true)) return; setMessage('No Romanian or English subtitle was found.') } catch (error) { setMessage(`Subtitles unavailable: ${(error as Error).message}`) } }
 async function findSubtitles(automatic = false, scope: 'local' | 'remote' | 'all' = 'remote') {
  if (!automatic && scope === 'remote') openMenu('find-subtitles', 'subtitles');
  setMessage(scope === 'local' ? 'Checking included subtitles…' : 'Searching for Romanian subtitles…');
  try {
   const page = await api.subtitles(download.id, 'ro', scope);
   const candidates = page.items;
   setSubtitleCandidates(candidates);
   if (automatic && candidates.length > 0) { await installSubtitle(candidates[0]); return; }
   setMessage(candidates.length > 0 ? '' : page.warnings?.length ? page.warnings.map(w => `${w.provider}: ${w.message}`).join(' · ') : automatic ? 'No included subtitle was found.' : 'No matching online subtitles were found.');
  } catch (error) { setMessage(`Subtitle search failed: ${(error as Error).message}`); }
 }
 async function installSubtitle(candidate: SubtitleCandidate, persist = true): Promise<boolean> {
  setMessage(`Preparing ${candidate.title}…`); if (menuRef.current) closeMenu(); else revealControls(true);
  try {
   const asset = await api.prepareSubtitle(download.id, candidate.provider, candidate.id, 'vtt');
   const response = await fetch(api.streamURL(asset.url)); if (!response.ok) throw new Error(`server returned ${response.status}`); const cues = parseVTT(await response.text()); if (!cues.length) throw new Error('the downloaded subtitle contained no readable cues'); subtitleCues.current = cues; try { window.webapis?.avplay.setSilentSubtitle(true); } catch { } setExternalSubtitle(subtitleAt(cues, current.current, subtitleDelayRef.current)); if (persist) await savePreferences({ ...preferenceRef.current, subtitleLanguage: candidate.language || 'en', subtitleProvider: candidate.provider, subtitleCandidateId: candidate.id, subtitleMode: 'selected' }); showTransientMessage(`${candidate.language || 'Subtitle'} selected`); revealControls(); return true;
  } catch (error) { setMessage(`Subtitle preparation failed: ${(error as Error).message}`); return false; }
 }
 function changeDelay(delta: number) { const next = Math.max(-10_000, Math.min(10_000, subtitleDelay + delta)); setSubtitleDelay(next); try { window.webapis?.avplay.setSubtitlePosition(next); } catch { } }
 function changeAspect(value: string) { setAspect(value); try { window.webapis?.avplay.setDisplayMethod(value); } catch { } }
 const percent = total > 0 ? Math.min(100, position / total * 100) : liveDownload.progress * 100;
 const audioTracks = tracks.filter(track => track.type === 'AUDIO');
 const subtitleTracks = tracks.filter(track => track.type === 'TEXT');
 const subtitleRows = subtitleMenuRows(subtitleCandidates, 1, 'player-subtitle');
 const foundRows = subtitleMenuRows(subtitleCandidates, 0, 'player-found-subtitle');
 if (message) osdText.current = message;
 const osd = message || osdText.current;
 return <div class="player-shell"><object id="av-player" type="application/avplayer"></object><div class={`player ${controlsVisible ? 'controls-visible' : ''}`}>
  {externalSubtitle && <div class="external-subtitle">{externalSubtitle}</div>}
  {osd && <div class={`player-message${message ? ' on' : ''}`} aria-live="polite">{osd}</div>}
  <div class="player-controls"><div class="player-bar">
   <div class="player-heading"><div class="player-title">{download.displayTitle || download.filePath}</div>{choice && <div class="player-choice">{choice}</div>}</div>
   <button class="player-timeline" data-player-control="timeline" data-focus-region="player-controls" data-focus-row="0" data-focus-col="0" data-focus-key="player-timeline" onClick={() => { revealControls(); focusControl('timeline') }} aria-label="Playback timeline; use left and right to seek"><span class="player-fill" style={{ width: `${percent}%` }}><i /></span></button>
   <div class="player-time"><span>{formatTime(position)}</span><span>{formatTime(total)}</span></div>
   <div class="player-toolbar">
    <button data-player-control="restart" data-focus-region="player-controls" data-focus-row="1" data-focus-col="0" data-focus-key="player-restart" onClick={() => keepControl('restart', () => keysRef.current?.seekTo(0))}><Icon name="restart" />Restart</button><button data-player-control="back-10" data-focus-region="player-controls" data-focus-row="1" data-focus-col="1" data-focus-key="player-back-10" onClick={() => keepControl('back-10', () => keysRef.current?.seekBy(-10_000))}><Icon name="back-10" />−10s</button>
    <button data-player-control="play" data-focus-region="player-controls" data-focus-row="1" data-focus-col="2" data-focus-key="player-play" class="primary" onClick={() => keepControl('play', () => togglePlayback())}><Icon name={playing.current ? 'pause' : 'play'} />{playing.current ? 'Pause' : 'Play'}</button><button data-player-control="forward-10" data-focus-region="player-controls" data-focus-row="1" data-focus-col="3" data-focus-key="player-forward-10" onClick={() => keepControl('forward-10', () => keysRef.current?.seekBy(10_000))}><Icon name="forward-10" />+10s</button>
    <button data-player-control="audio" data-focus-region="player-controls" data-focus-row="1" data-focus-col="4" data-focus-key="player-audio" class={menu === 'audio' ? 'open' : ''} aria-haspopup="true" aria-expanded={menu === 'audio'} onClick={() => openMenu('audio', 'audio')}><Icon name="audio" />Audio ({audioTracks.length})</button><button data-player-control="subtitles" data-focus-region="player-controls" data-focus-row="1" data-focus-col="5" data-focus-key="player-subtitles" class={menu === 'subtitles' || menu === 'find-subtitles' ? 'open' : ''} aria-haspopup="true" aria-expanded={menu === 'subtitles' || menu === 'find-subtitles'} onClick={() => { openMenu('subtitles', 'subtitles'); void findSubtitles(false, 'local') }}><Icon name="subtitles" />Subtitles ({subtitleTracks.length + subtitleCandidates.length})</button>
    <button data-player-control="options" data-focus-region="player-controls" data-focus-row="1" data-focus-col="6" data-focus-key="player-options" class={menu === 'options' || menu === 'info' ? 'open' : ''} aria-haspopup="true" aria-expanded={menu === 'options' || menu === 'info'} onClick={() => openMenu('options', 'options')}><Icon name="options" />Options</button><button data-player-control="back" data-focus-region="player-controls" data-focus-row="1" data-focus-col="7" data-focus-key="player-back" onClick={() => { save(); onClose(); }}><Icon name="back" />Back</button><button data-player-control="hide" data-focus-region="player-controls" data-focus-row="1" data-focus-col="8" data-focus-key="player-hide" onClick={hideControls}><Icon name="hide" />Hide</button>
   </div>
   {phase === 'failed' && <button class="player-retry primary" data-player-control="retry" data-focus-region="player-controls" data-focus-row="2" data-focus-col="2" data-focus-key="player-retry" onClick={() => { completedRetryUsed.current = false; openPlayer(current.current); }}>Retry playback</button>}
  </div></div>
  {menu && <div class="player-dialog">
   {menu === 'audio' && <><h2>Audio track</h2><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-audio-refresh" onClick={refreshTracks}>Refresh tracks</button>{audioTracks.map((track, index) => <button data-focus-region="player-menu" data-focus-row={index + 1} data-focus-col="0" data-focus-key={`player-audio-${track.index}`} onClick={() => chooseTrack('AUDIO', track.index)}>{track.label}</button>)}</>}
   {menu === 'subtitles' && <><h2>Subtitles</h2><button data-focus-region="player-menu" data-focus-row="0" data-focus-col="0" data-focus-key="player-subtitles-off" onClick={() => chooseTrack('TEXT', null)}>Off</button>{subtitleRows.map(item => <Fragment key={item.key}>{item.heading ? <h3>{item.heading}</h3> : null}<button data-focus-region="player-menu" data-focus-row={item.row} data-focus-col="0" data-focus-key={item.key} onClick={() => void installSubtitle(item.candidate)}><strong>{subtitleItemLabel(item.candidate, item.position)}</strong>{item.detail ? <><br /><small>{item.detail}</small></> : null}</button></Fragment>)}{subtitleTracks.length > 0 && <><h3>Built-in tracks</h3>{subtitleTracks.map((track, index) => <button data-focus-region="player-menu" data-focus-row={subtitleRows.length + index + 1} data-focus-col="0" data-focus-key={`player-native-subtitle-${track.index}`} onClick={() => chooseTrack('TEXT', track.index)}>{track.label}</button>)}</>}<button data-focus-region="player-menu" data-focus-row={subtitleRows.length + subtitleTracks.length + 1} data-focus-col="0" data-focus-key="player-subtitles-find" onClick={() => void findSubtitles(false, 'remote')}>Find online subtitles…</button></>}
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
 return <main class="setup"><span class="setup-mark" aria-hidden="true">{appIdentity().monogram}</span><h1>{appIdentity().name}</h1><p class="setup-lead">Choose a Torrent TV server on this private network.</p><div class="setup-mode-actions"><button ref={rescan} data-focus-region="setup" data-focus-row="0" data-focus-col="0" data-focus-key="setup-rescan" class={!manual ? 'primary' : ''} aria-disabled={searching ? 'true' : undefined} onClick={() => void scan()}>{searching ? 'Searching…' : 'Rescan'}</button><button data-focus-region="setup" data-focus-row="0" data-focus-col="1" data-focus-key="setup-manual" class={manual ? 'primary' : ''} onClick={() => setManual(value => !value)}>Manual address</button></div><p class="focus-hint" aria-live="polite">{discoveryStatus || 'Automatic discovery checks only the television’s local network.'}</p>{results.length > 0 && <section class="setup-results" aria-label="Discovered servers">{results.map((item, index) => <button data-focus-region="setup" data-focus-row={1 + index} data-focus-col="0" data-focus-key={`discovered-server-${index}`} onClick={() => onConnect(item.url)}><strong>{item.info.instanceName || item.info.name}</strong><span>{item.url}</span><small>Version {item.info.version}{item.info.configured ? ' · Ready' : ' · Setup required'}</small></button>)}</section>}{manual && <section class="setup-manual"><h2>Manual address</h2><div class="setup-controls"><input ref={address} readOnly data-focus-region="setup" data-focus-row="40" data-focus-col="0" data-focus-key="setup-address" type="url" inputMode="url" autoComplete="off" spellcheck={false} value={draft} onInput={event => onDraft(event.currentTarget.value)} placeholder="http://server.lan:8097" /><button ref={connect} data-focus-region="setup" data-focus-row="40" data-focus-col="1" data-focus-key="setup-connect" class="primary" onClick={() => onConnect(draft)}>Connect</button></div><p class="focus-hint">Select the address and press OK to edit it. Select Connect when ready.</p></section>}<p class="setup-status" aria-live="polite">{status}</p>{server && <button data-focus-region="setup" data-focus-row="41" data-focus-col="0" data-focus-key="setup-forget" onClick={onForget}>Forget saved server</button>}</main>;
}

// Art for the backdrop: the title's backdrop, then its poster; empty when it has neither.
const artURL = (api: API, title?: Pick<CatalogTitle, 'backdropUrl' | 'posterUrl'>) => { const path = title?.backdropUrl || title?.posterUrl; return path ? api.streamURL(path) : '' };
const HOUSEHOLD_EMPTY: Record<string, string> = {
 continue: 'Nothing to resume yet. Start a title and it appears here.',
 favorites: 'No favorites yet. Open a title and choose Add to favorites.',
 recent: 'Nothing viewed recently. Titles you open appear here.',
 watched: 'Nothing watched yet. Titles you finish appear here.',
};
// One empty or error state: what happened, then what to do next.
function EmptyState({ title, children }: { title: string; children: string }) { return <div class="tv-empty" role="status"><h2>{title}</h2><p>{children}</p></div> }

type TVRoute = 'home' | 'search' | 'library' | 'continue' | 'favorites' | 'watched' | 'downloads' | 'library-categories' | 'tracker' | 'browse' | 'categories' | 'jobs' | 'events' | 'settings' | 'projects';
const menuGroups: Array<{ label: string; items: Array<{ id: TVRoute; label: string; icon: string }> }> = [
 { label: '', items: [{ id: 'home', label: 'Home', icon: '⌂' }, { id: 'search', label: 'Search', icon: '⌕' }] },
 { label: 'My Library', items: [{ id: 'library', label: 'Dashboard', icon: '◫' }, { id: 'continue', label: 'Continue watching', icon: '▶' }, { id: 'favorites', label: 'Favorites', icon: '★' }, { id: 'watched', label: 'Watched', icon: '✓' }, { id: 'downloads', label: 'Downloads', icon: '↓' }, { id: 'library-categories', label: 'Categories', icon: '≡' }] },
 { label: 'Tracker', items: [{ id: 'tracker', label: 'Dashboard', icon: '◉' }, { id: 'browse', label: 'Browse', icon: '▦' }, { id: 'categories', label: 'Categories', icon: '≡' }] },
 { label: '', items: [{ id: 'jobs', label: 'Jobs', icon: '↻' }, { id: 'events', label: 'Events', icon: '!' }, { id: 'settings', label: 'Settings', icon: '⚙' }] },
];

export type TVPreparingState = {
 trackerName: string;
 label: string;
 error?: string;
 hint?: string;
};

export function Catalog({ api, status, titles, facets, household, downloads, jobs, restoreFocus, portal, updateStatus, onUpdateStatus, onFocus, onRetry, onChangeServer, onForgetServer, onPlay, onPlayDownload, onManageDownload, onManageSeasonPack, onRefreshDownloads, onFavorite, preparing, onCancelPrepare, onRetryPrepare }: { api: API; status: string; titles: CatalogTitle[]; facets: CatalogFacets; household: HouseholdState; downloads: Download[]; jobs: Job[]; restoreFocus: string | null; portal: PortalState | null; updateStatus: UpdateStatus | null; onUpdateStatus: (status: UpdateStatus) => void; onFocus: (key: string) => void; onRetry: () => void; onChangeServer: () => void; onForgetServer: () => void; onPlay: (release: Release, fileIndex?: number, resumeMs?: number) => void; onPlayDownload: (download: Download) => void; onManageDownload: (download: Download, action: string) => Promise<void>; onManageSeasonPack: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean>; onRefreshDownloads: () => Promise<void>; onFavorite: (title: CatalogTitle, value: boolean) => void; preparing?: TVPreparingState | null; onCancelPrepare?: () => void; onRetryPrepare?: () => void }) {
 const [route, setRoute] = useState<TVRoute>('home');
 const [menuOpen, setMenuOpen] = useState(false);
 const [projectsMessage, setProjectsMessage] = useState('');
 const [updateConfirm, setUpdateConfirm] = useState(false);
 const updateReturnKey = useRef<string | null>(null);
 const catalogMounted = useRef(true);
 useEffect(() => () => { catalogMounted.current = false; }, []);
 const [draftQuery, setDraftQuery] = useState('');
 const [query, setQuery] = useState('');
 const [searching, setSearching] = useState(false);
 const [category, setCategory] = useState('');
 const [sort, setSort] = useState<'newest' | 'seeders' | 'title' | 'rating'>('newest');
 const [remoteTitles, setRemoteTitles] = useState(titles.slice(0, 12));
 const [nextCursor, setNextCursor] = useState<string | null>(null);
 const loadingMore = useRef(false);
 const [detail, setDetail] = useState<CatalogDetail | null>(null);
 const [detailTarget, setDetailTarget] = useState<DetailTarget>({});
 const [detailMessage, setDetailMessage] = useState('');
 // Loading and failure feedback for opening a title: the detail screen is not mounted yet, so its own message cannot show it.
 const [notice, setNotice] = useState('');
 const first = useRef<HTMLButtonElement>(null);
 const lastContent = useRef<string | null>(restoreFocus);
 const detailRef = useRef<CatalogDetail | null>(null);
 const refreshDownloadsRef = useRef(onRefreshDownloads);
 detailRef.current = detail;
 refreshDownloadsRef.current = onRefreshDownloads;
 const favoriteIDs = new Set(household.favorites.map(item => item.titleId || item.catalog?.id).filter(Boolean));
 const fetchPage = (cursor = '') => api.titles({ search: query.trim().length >= 3 ? query.trim() : undefined, category, sort, pageSize: 12, cursor }).then(page => { setRemoteTitles(page.items); setNextCursor(page.nextCursor); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); return page; });
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
 // Entering a catalog view with nothing held loads its first page; leaving
 // one drops the accumulated pages so memory resets between sections.
 useEffect(() => { if (['home', 'browse', 'search', 'tracker'].includes(route) && remoteTitles.length === 0) void fetchPage('').catch(() => { }) }, [route]);
 useEffect(() => { const refresh = (event: Event) => { const searched = String((event as CustomEvent).detail?.query || '').toLowerCase(); if (query && searched === query.toLowerCase()) { setDetailMessage('Catalog search completed.'); void fetchPage('').catch(error => setDetailMessage((error as Error).message)); } }; window.addEventListener('catalog-search-completed', refresh); return () => window.removeEventListener('catalog-search-completed', refresh) }, [query, category, sort]);
 const submitSearch = async () => { if (searching) return; const value = draftQuery.trim(); setSearching(true); try { if (value) { const page = await api.searchTitles(value); setRemoteTitles(page.items); setNextCursor(page.nextCursor); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); } setQuery(value); } catch (error) { setDetailMessage((error as Error).message); } finally { setSearching(false) } };
 const loadMore = () => { if (loadingMore.current || !nextCursor) return; loadingMore.current = true; api.titles({ search: query.trim().length >= 3 ? query.trim() : undefined, category, sort, pageSize: 12, cursor: nextCursor }).then(page => { setRemoteTitles(current => [...current, ...page.items]); setNextCursor(page.nextCursor); void api.ensureMetadata(page.items.map(item => item.id)).catch(error => setDetailMessage((error as Error).message)); }).catch(() => { }).finally(() => { loadingMore.current = false; }); };
 useEffect(() => { const updated = (event: Event) => { const titleId = String((event as CustomEvent).detail?.titleId || ''); if (!titleId || detailRef.current?.title.id !== titleId) return; void api.title(titleId).then(next => { setDetail(next); setDetailMessage(needsEpisodeExpansion(next) ? 'Preparing the individual episode list…' : '') }).catch(error => setDetailMessage((error as Error).message)) }; window.addEventListener('catalog-title-updated', updated); return () => window.removeEventListener('catalog-title-updated', updated) }, [api]);
 useEffect(() => {
  const titleId = detail?.title.kind === 'series' ? detail.title.id : ''; if (!titleId) return; let stopped = false; let running = false; const refresh = async () => {
   if (stopped || running) return; running = true; try {
    const next = await api.title(titleId); if (!stopped && detailRef.current?.title.id === titleId) { // The 3-second poll re-renders the whole detail screen; skip the state update when nothing changed so focus survives idle cycles.
     if (JSON.stringify(next) === JSON.stringify(detailRef.current)) return;
     setDetail(next); setDetailMessage(needsEpisodeExpansion(next) ? 'Preparing the individual episode list…' : '')
    }
   } catch (error) { if (!stopped) setDetailMessage((error as Error).message) } finally { running = false }
  }; const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) }
 }, [api, detail?.title.id]);
 useEffect(() => { if (route !== 'downloads') return; let stopped = false; let running = false; const refresh = async () => { if (stopped || running) return; running = true; try { await refreshDownloadsRef.current() } finally { running = false } }; void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => { stopped = true; window.clearInterval(timer) } }, [route]);
 const openTitle = async (title: CatalogTitle, target: DetailTarget = {}) => { setDetailMessage('Loading versions…'); setNotice('Loading versions…'); setDetailTarget(target); try { const next = await api.title(title.id); setNotice(''); setDetail(next); if (needsEpisodeExpansion(next)) { setDetailMessage('Preparing the individual episode list…'); void api.refreshTitle(title.id, title.title).catch(error => setDetailMessage((error as Error).message)) } else setDetailMessage(''); } catch (error) { setDetailMessage((error as Error).message); setNotice(`Could not open ${title.title}: ${(error as Error).message}. Check the server connection and press OK to try again.`); } };
 const openLibraryItem = async (item: HouseholdItem) => { const id = item.titleId || item.catalog?.id; if (!id) { setDetailMessage('This library item is not linked to a catalog title yet. Refresh the catalog and try again.'); return } const title = item.catalog || { id, title: item.release.name, kind: 'movie', trackers: item.release.trackerId ? [{ id: item.release.trackerId, name: item.release.trackerName }] : [], categories: [], resolutions: [], sourceCount: 1, bestSeeders: item.release.seeders, largestSizeBytes: item.release.sizeBytes } as CatalogTitle; await openTitle(title, { season: item.seasonNumber, episode: item.episodeNumber }) };
 const manageSeasonPack = async (source: CatalogSource, season: number, action: SeasonPackAction) => {
  const isAcquire = action === 'download' || (action === 'retry' && !source.libraryState?.downloadId);
  if (!isAcquire) setDetailMessage(`Updating season ${season} download…`);
  try {
   const ok = await onManageSeasonPack(source, season, action);
   if (ok === false) return;
   if (detailRef.current) {
    const next = await api.title(detailRef.current.title.id).catch(() => null);
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
 const chooseRoute = (next: TVRoute) => { setNotice(''); if (!['home', 'browse', 'search', 'tracker'].includes(next)) { setRemoteTitles([]); setNextCursor(null); } setRoute(next); setDetail(null); setMenuOpen(false); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-region="content"]')), 0); };
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
   focusElement(restored || document.querySelector<HTMLElement>('[data-focus-region="content"]'));
  }, 0);
  return () => window.clearTimeout(timer);
 }, [portal, updateStatus]);
 const restoreAfterDialog = (key: string) => { const target = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`); window.setTimeout(() => focusElement(target || document.querySelector<HTMLElement>('[data-focus-region="content"]')), 0) };
 const openUpdateConfirm = () => { updateReturnKey.current = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey || null : null; setUpdateConfirm(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="update-confirm-cancel"]')), 0) };
 const closeUpdateConfirm = () => { setUpdateConfirm(false); restoreAfterDialog(dialogRestoreKey(updateReturnKey.current, 'update-apply')) };
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
 const onBack = () => { if (preparing) { onCancelPrepare?.(); return; } if (updateConfirm) { closeUpdateConfirm(); return; } if (detail) { setDetail(null); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(lastContent.current ? `[data-focus-key="${lastContent.current}"]` : '[data-focus-region="content"]')), 0); return; } if (menuOpen) { setMenuOpen(false); window.setTimeout(() => focusElement(lastContent.current ? document.querySelector<HTMLElement>(`[data-focus-key="${lastContent.current}"]`) : document.querySelector<HTMLElement>('[data-focus-region="content"]')), 0); return; } setMenuOpen(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-menu-route="${route}"]`)), 0); };
 useTVNavigation({
  getInitialFocus: () => first.current || document.querySelector<HTMLElement>('[data-focus-region="content"]'), restoreKey: restoreFocus, onFocusKey: key => { onFocus(key); if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.focusRegion === 'content') lastContent.current = key; }, onBack, onLongBack: exitApplication, onDirection: (direction, current) => {
   if (detail || updateConfirm) return false;
   // Near the end of a title rail, fire the next page without consuming the
   // keypress: focus still moves while the append lands.
   if (direction === 'right' && (current.dataset.focusKey || '').startsWith('title-') && nearEnd(Number(current.dataset.focusCol || -1), visible.length)) loadMore();
   if (route === 'jobs' && direction === 'down' && (current.dataset.focusKey || '').startsWith('job-')) window.dispatchEvent(new CustomEvent('tv-jobs-near-end'));
   if (route === 'events' && current.dataset.focusKey === 'event-latest' && direction === 'down') { focusElement(document.querySelector<HTMLElement>('[data-focus-key="event-rebuild"]')); return true; }
   if (route === 'events' && current.dataset.focusKey === 'event-rebuild' && direction === 'up') { focusElement(document.querySelector<HTMLElement>('[data-focus-key="event-latest"]')); return true; }
   const region = current.dataset.focusRegion;
   if (region === 'content' && direction === 'left' && current.dataset.focusCol === '0') { setMenuOpen(true); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-menu-route="${route}"]`) || document.querySelector<HTMLElement>('[data-focus-region="sidebar"]')), 0); return true; }
   if (region === 'sidebar' && direction === 'right') { setMenuOpen(false); window.setTimeout(() => focusElement(lastContent.current ? document.querySelector<HTMLElement>(`[data-focus-key="${lastContent.current}"]`) : document.querySelector<HTMLElement>('[data-focus-region="content"]')), 0); return true; }
   return false;
  }
 });
 const librarySections = householdSections(route, household);
 let visible = remoteTitles;
 if (category) visible = visible.filter(title => title.categories.includes(category));
 if (sort === 'seeders') visible = [...visible].sort((a, b) => b.bestSeeders - a.bestSeeders); if (sort === 'title') visible = [...visible].sort((a, b) => a.title.localeCompare(b.title)); if (sort === 'rating') visible = [...visible].sort((a, b) => Number(Boolean(b.ratingVotes)) - Number(Boolean(a.ratingVotes)) || (b.rating || 0) - (a.rating || 0));
 const heading = menuGroups.reduce<Array<{ id: TVRoute; label: string; icon: string }>>((items, group) => items.concat(group.items), []).find(item => item.id === route)?.label || (route === 'projects' ? 'Other projects' : 'Home');
 const hero = visible[0] || titles[0];
 const rows: Array<{ key: string; title: string; items: CatalogTitle[] }> = route === 'home' ? [
  { key: 'new', title: 'Recently added', items: remoteTitles },
 ] : route === 'tracker' ? [{ key: 'tracker-new', title: 'Recently added', items: visible }, { key: 'tracker-seeded', title: 'Strong swarms', items: [...visible].sort((a, b) => b.bestSeeders - a.bestSeeders) }] : ['continue', 'favorites', 'watched', 'library', 'downloads', 'library-categories', 'jobs', 'events', 'settings', 'categories'].includes(route) ? [] : [{ key: route, title: heading, items: visible }];
 const libraryArt = librarySections[0]?.items[0]?.catalog;
 const initialArt = artURL(api, route === 'home' ? hero : librarySections.length > 0 ? libraryArt : visible[0]);
 const preparingModal = preparing ? (
  <section role="dialog" aria-modal="true" aria-labelledby="tv-prepare-heading" class="tv-settings tv-removal-confirm tv-prepare-confirm">
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
    <button ref={prepareCancelRef} data-focus-region="prepare-dialog" data-focus-row="0" data-focus-col="0" data-focus-key="prepare-cancel" onClick={onCancelPrepare}>Cancel</button>
   </>}
  </section>
 ) : null;
 if (detail) return <><TitleDetail key={`${detail.title.id}:${detailTarget.season || 0}:${detailTarget.episode || 0}`} api={api} detail={detail} target={detailTarget} message={detailMessage} resume={resumeForTitle(household.continueWatching, detail.title.id)} favorite={favoriteIDs.has(detail.title.id)} onClose={onBack} onFavorite={onFavorite} onResume={item => onPlay(item.release, item.fileIndex, item.positionMs)} onPlay={onPlay} onPackAction={manageSeasonPack} />{preparingModal}</>;
 return <div class={`tv-app ${menuOpen ? 'menu-open' : ''}`}>
  <Backdrop key={route} initial={initialArt} />
  <aside class="tv-sidebar"><div class="tv-brand"><span>{appIdentity().monogram}</span><b>{appIdentity().name}</b></div>{menuGroups.map((group, groupIndex) => <div class="tv-menu-group">{group.label && <small>{group.label}</small>}{group.items.map((item, index) => <button data-menu-route={item.id} data-focus-region="sidebar" data-focus-row={groupIndex * 10 + index} data-focus-col="0" data-focus-key={`menu-${item.id}`} class={route === item.id ? 'active' : ''} aria-current={route === item.id ? 'page' : undefined} onClick={() => chooseRoute(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}</div>)}{portal && portal.links.length > 0 && <button data-menu-route="projects" data-focus-region="sidebar" data-focus-row={PROJECTS_MENU_ROW} data-focus-col="0" data-focus-key="menu-projects" class={route === 'projects' ? 'active' : ''} aria-current={route === 'projects' ? 'page' : undefined} onClick={() => chooseRoute('projects')}><i>↗</i><span>Other projects</span></button>}</aside>
  <main class="tv-content">
   <header class="tv-top"><h1>{heading}</h1><span class="tv-status" aria-live="polite">{status}</span><button data-focus-region="content" data-focus-row="0" data-focus-col="0" data-focus-key="header-retry" onClick={onRetry}>Refresh</button></header>
   {notice && <p class="tv-notice" role="status">{notice}</p>}
   {route === 'search' && <div class="tv-search"><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="search-input" value={draftQuery} onInput={event => setDraftQuery(event.currentTarget.value)} placeholder="Search titles; press OK to type" /><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="search-submit" class="primary" aria-disabled={searching ? 'true' : undefined} onClick={() => void submitSearch()}>{searching ? 'Searching…' : 'Search'}</button>{query && <button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="search-clear" onClick={() => { setDraftQuery(''); setQuery('') }}>Clear</button>}</div>}
   {['tracker', 'browse', 'categories', 'search'].includes(route) && <div class="tv-filters"><button data-focus-region="content" data-focus-row="2" data-focus-col="0" data-focus-key="sort-newest" class={sort === 'newest' ? 'active' : ''} onClick={() => setSort('newest')}>Newest</button><button data-focus-region="content" data-focus-row="2" data-focus-col="1" data-focus-key="sort-seeders" class={sort === 'seeders' ? 'active' : ''} onClick={() => setSort('seeders')}>Most seeded</button><button data-focus-region="content" data-focus-row="2" data-focus-col="2" data-focus-key="sort-rating" class={sort === 'rating' ? 'active' : ''} onClick={() => setSort('rating')}>Rating</button><button data-focus-region="content" data-focus-row="2" data-focus-col="3" data-focus-key="sort-title" class={sort === 'title' ? 'active' : ''} onClick={() => setSort('title')}>A–Z</button>{category && <button data-focus-region="content" data-focus-row="2" data-focus-col="4" data-focus-key="clear-category" onClick={() => setCategory('')}>Clear {category}</button>}</div>}
   {route === 'projects' ? <section class="tv-projects"><p class="tv-muted">Project sites published with this server. Press OK on a card to open it.</p>{portal && portal.links.length > 0 ? portal.links.map((link, index) => <button class="tv-project" key={link.id} data-focus-region="content" data-focus-row={3 + index} data-focus-col="0" data-focus-key={`project-${link.id}`} onClick={() => openProjectLink(link)}><strong>{link.title}</strong>{link.description && <p>{link.description}</p>}<code>{link.url}</code></button>) : <EmptyState title="No project links yet">They appear here when the server publishes them.</EmptyState>}{projectsMessage && <p class="focus-hint" aria-live="polite">{projectsMessage}</p>}</section> : route === 'settings' ? <TVSettings api={api} onChangeServer={onChangeServer} onForgetServer={onForgetServer} updateStatus={updateStatus} onUpdateStatus={onUpdateStatus} confirmOpen={updateConfirm} onConfirmOpen={openUpdateConfirm} onConfirmClose={closeUpdateConfirm} /> : route === 'events' ? <TVEvents api={api} /> : route === 'downloads' ? <TVDownloads items={downloads} onPlay={onPlayDownload} onManage={onManageDownload} /> : route === 'library-categories' ? <TVLibraryCategories api={api} onOpen={openLibraryItem} /> : route === 'jobs' ? <TVJobs api={api} items={jobs} /> : route === 'categories' ? trackerCategories(facets).length === 0 ? <EmptyState title="No categories yet">Categories appear after the first catalog sync. Open Events and choose Fetch latest.</EmptyState> : <section class="tv-category-grid">{trackerCategories(facets).map((name, index) => <button data-focus-region="content" data-focus-row={3 + Math.floor(index / 4)} data-focus-col={index % 4} data-focus-key={`category-${name}`} onClick={() => { setCategory(name); setRoute('browse') }}><strong>{name}</strong><span>Browse titles</span></button>)}</section> : <>
    {route === 'home' && hero && <section class="tv-hero"><div class="tv-hero-copy"><span class="eyebrow">{heroFacts(hero).join(' · ')}</span><h2>{hero.title}</h2>{hero.overview && <p class="tv-hero-overview">{hero.overview}</p>}{hero.genres && hero.genres.length > 0 && <p class="tv-hero-genres">{hero.genres.slice(0, 3).join(' · ')}</p>}<button ref={first} data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key={`hero-${hero.id}`} data-art={artURL(api, hero)} class="primary" onClick={() => void openTitle(hero)}>View versions</button></div></section>}
    {librarySections.filter(section => route !== 'home' || section.key === 'continue').map((section, index) => <HouseholdRail api={api} title={section.title} items={section.items} row={3 + index} empty={route === 'home' ? '' : HOUSEHOLD_EMPTY[section.key]} onOpen={openLibraryItem} />)}
    <div class="tv-rows">{rows.filter(row => row.items.length > 0).map((row, rowIndex) => <section><div class="row-heading"><h2>{row.title}</h2></div><div class="poster-rail">{row.items.map((title, col) => <TitleCard api={api} title={title} row={rowIndex + 10} col={col} seeders={row.key === 'tracker-seeded'} focusRef={!hero && rowIndex === 0 && col === 0 ? first : undefined} onOpen={() => void openTitle(title)} />)}</div></section>)}</div>
    {route === 'home' && librarySections.filter(section => section.key === 'favorites').map(section => <HouseholdRail api={api} title={section.title} items={section.items} row={20} empty="" onOpen={openLibraryItem} />)}
    {['home', 'search', 'browse', 'tracker'].includes(route) && rows.every(row => row.items.length === 0) && (query ? <EmptyState title={`No titles match “${query}”`}>Try fewer or different words, or press Clear to see everything.</EmptyState> : route === 'search' ? <EmptyState title="Search the catalog">Press OK on the search field, type a title, then choose Search.</EmptyState> : <EmptyState title="No titles to show yet">The catalog may still be syncing. Wait a minute and press Refresh, or check that a tracker is enabled in Settings.</EmptyState>)}
   </>}
  </main>
  {route === 'home' && promotionsVisible(portal) && <TVPromotions api={api} />}
  {preparingModal}
 </div>;
}

function LibraryCard({ api, item, row, col, focusKey, onOpen }: { api: API; item: HouseholdItem; row: number; col: number; focusKey: string; onOpen: (item: HouseholdItem) => void }) {
 // A raw release row (no catalog match) keeps the release name as its title: nothing better exists.
 const label = item.catalog?.title || item.release.name;
 const progress = watchProgress(item);
 return <button class="poster-card library-poster-card" data-focus-region="content" data-focus-row={row} data-focus-col={col} data-focus-key={focusKey} data-art={artURL(api, item.catalog)} onClick={() => onOpen(item)}>{item.catalog?.posterUrl ? <img src={api.streamURL(item.catalog.posterUrl)} alt="" loading="lazy" /> : <div class="poster-fallback">{label.slice(0, 1)}</div>}<TVStateBadges state={item.catalog?.libraryState} /><div class="poster-copy"><strong>{label}</strong><span>{libraryCardLine(item)}</span></div>{item.positionMs > 0 && !item.watched && <i class="tv-card-progress" aria-label={`${progress}% watched`}><b style={{ width: `${progress}%` }} /></i>}</button>;
}
function HouseholdRail({ api, title, items, row, empty, onOpen }: { api: API; title: string; items: HouseholdState['continueWatching']; row: number; empty: string; onOpen: (item: HouseholdItem) => void }) {
 // The Home route passes no empty copy: an empty rail there simply is not drawn, so discovery leads.
 if (items.length === 0) return empty ? <section><div class="row-heading"><h2>{title}</h2></div><p class="tv-muted">{empty}</p></section> : null;
 return <section><div class="row-heading"><h2>{title}</h2></div><div class="poster-rail">{items.map((item, col) => <LibraryCard api={api} item={item} row={row} col={col} focusKey={`library-${item.titleId || item.catalog?.id || item.release.id}-${item.seasonNumber || 0}-${item.episodeNumber || 0}-${col}`} onOpen={onOpen} />)}</div></section>
}
type PendingDownloadRemoval = { download: Download; scope: 'torrent' | 'file' };
function TVDownloads({ items, onPlay, onManage }: { items: Download[]; onPlay: (download: Download) => void; onManage: (download: Download, action: string) => Promise<void> }) {
 const [pending, setPending] = useState<PendingDownloadRemoval | null>(null);
 const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
 const [removing, setRemoving] = useState(false);
 const [detailsOpen, setDetailsOpen] = useState<Set<string>>(() => new Set());
 const [busyAction, setBusyAction] = useState('');
 // A failed action shows its message here and leaves the list where it was; the fatal panel is for startup failures only.
 const [actionMessage, setActionMessage] = useState('');
 const [query, setQuery] = useState('');
 const [filter, setFilter] = useState<'all' | 'streaming' | 'complete' | 'paused' | 'errors'>('all');
 const [sort, setSort] = useState<DownloadSort>('recent');
 const [order, setOrder] = useState<string[]>(() => orderDownloadIDs(items, 'recent'));
 const cancelButton = useRef<HTMLButtonElement>(null);
 const confirmButton = useRef<HTMLButtonElement>(null);
 const closeConfirmation = () => { if (removing) return; const key = pending ? (pending.scope === 'file' ? `download-${pending.download.id}-file-${pending.download.fileIndex}-remove` : `download-${pending.download.id}-delete`) : ''; setPending(null); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) || document.querySelector<HTMLElement>('[data-focus-key="downloads-search"]')), 0) };
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
 const visible = useMemo(() => { const term = query.trim().toLocaleLowerCase(); const byID = new Map(items.map(item => [item.id, item])); const ordered = (order.length ? order : items.map(item => item.id)).map(id => byID.get(id)).filter((item): item is Download => Boolean(item)); return ordered.filter(download => { const text = [download.displayTitle, download.releaseName, download.filePath, download.category, download.state].filter(Boolean).join(' ').toLocaleLowerCase(); const matchesFilter = filter === 'all' || filter === 'streaming' && download.playbackMode === 'progressive' || filter === 'complete' && download.playbackMode === 'local' || filter === 'paused' && /^(paused|stopped)/.test(download.state.toLocaleLowerCase()) || filter === 'errors' && Boolean(download.error); return (!term || text.includes(term)) && matchesFilter }) }, [items, order, query, filter]);
 const groups = useMemo(() => groupDownloadsByTorrent(visible), [visible]);
 const toggleDetails = (id: string) => setDetailsOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next });
 const toggleFiles = (engineId: string) => setExpandedGroups(current => { const next = new Set(current); if (next.has(engineId)) next.delete(engineId); else next.add(engineId); return next });
 const cycle = <T extends string,>(value: T, values: T[], set: (value: T) => void) => set(values[(values.indexOf(value) + 1) % values.length]);
 const cycleSort = () => { const values: DownloadSort[] = ['recent', 'title', 'progress', 'size', 'speed']; const next = values[(values.indexOf(sort) + 1) % values.length]; setSort(next); setOrder(orderDownloadIDs(items, next)) };
 const runAction = async (download: Download, action: DownloadTransferAction) => { if (busyAction) return; setActionMessage(''); setBusyAction(`${download.id}:${action}`); try { await onManage(download, action) } catch (error) { setActionMessage((error as Error).message) } finally { setBusyAction('') } };
 const confirmRemoval = async () => { if (!pending || removing) return; setActionMessage(''); setRemoving(true); try { await onManage(pending.download, pending.scope === 'file' ? 'remove-file' : 'remove'); setPending(null); window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="downloads-search"]')), 0) } catch (error) { setActionMessage((error as Error).message) } finally { setRemoving(false) } };
 if (pending) return <section role="dialog" aria-modal="true" aria-labelledby="download-delete-heading" aria-describedby="download-delete-description" class="tv-settings tv-removal-confirm">{pending.scope === 'file' ? <><h2 id="download-delete-heading">Remove episode from downloads?</h2><strong>{pending.download.displayTitle || pending.download.filePath}</strong><p id="download-delete-description">The episode leaves the download list. Its file stays on the server until the whole download is deleted.</p></> : <><h2 id="download-delete-heading">Delete download?</h2><strong>{pending.download.displayTitle || pending.download.releaseName || pending.download.filePath}</strong><p>{formatBytes(pending.download.sizeBytes)} · {pending.download.trackerName}</p><p id="download-delete-description">This permanently deletes the download and every file it stored, including unfinished ones. You can download the title again later.</p></>}{actionMessage && <p role="alert" class="focus-hint">{actionMessage}</p>}<button ref={cancelButton} aria-disabled={removing ? 'true' : undefined} data-focus-region="download-dialog" data-focus-row="1" data-focus-col="0" data-focus-key="download-cancel" onClick={closeConfirmation}>Cancel</button><button ref={confirmButton} aria-disabled={removing ? 'true' : undefined} class="danger-button" data-focus-region="download-dialog" data-focus-row="2" data-focus-col="0" data-focus-key="download-confirm" onClick={() => void confirmRemoval()}>{removing ? (pending.scope === 'file' ? 'Removing…' : 'Deleting…') : pending.scope === 'file' ? 'Remove episode' : 'Delete download'}</button></section>;
 const filterLabel = { all: 'All', streaming: 'Still downloading', complete: 'Downloaded', paused: 'Paused', errors: 'Needs attention' }[filter];
 const sortLabel = { recent: 'Recent', title: 'Title A–Z', progress: 'Progress', size: 'File size', speed: 'Speed' }[sort];
 const narrowed = filter !== 'all' || query.trim() !== '';
 return <section class="tv-list tv-download-list">{actionMessage && <p role="status" class="focus-hint">{actionMessage}</p>}<div class="tv-filters tv-download-tools"><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="downloads-search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search downloads; press OK to type" /><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="downloads-filter" onClick={() => cycle(filter, ['all', 'streaming', 'complete', 'paused', 'errors'], setFilter)}>Filter: {filterLabel}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="downloads-sort" onClick={cycleSort}>Sort: {sortLabel}</button></div><p class="tv-download-count" aria-live="polite">{items.length === 0 ? '' : narrowed ? `${groups.length} of ${items.length} downloads` : `${items.length} download${items.length === 1 ? '' : 's'}`}</p>{groups.length === 0 ? (items.length === 0 ? <EmptyState title="No downloads yet">Open a title, choose a version and press Play and download. It appears here while it transfers.</EmptyState> : <EmptyState title="No downloads match">{`Change the filter or clear the search to see all ${items.length} downloads.`}</EmptyState>) : groups.map((group, groupIndex) => {
  const download = group.representative;
  const band = 2 + groupIndex * 20;
  const expanded = expandedGroups.has(download.engineId);
  const detailsShown = detailsOpen.has(download.id);
  const multi = group.rows.length > 1;
  const status = downloadStatus(download);
  return <article key={download.id} data-download-id={download.id} class="tv-download-row"><div class="tv-download-main"><strong class="tv-download-title" title={download.displayTitle || download.filePath}>{download.displayTitle || download.filePath}</strong><span class={`tv-download-status ${status.tone}`}>{downloadProgressLine(download)}</span><i class={`tv-meter ${status.tone}`} role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent}><b style={{ width: `${status.percent}%` }} /></i><small class="tv-download-facts">{downloadFacts(download, { sizeBytes: group.totalSizeBytes, files: multi ? group.rows.length : 0 })}</small>{detailsShown && <dl class="tv-download-details"><dt>Release</dt><dd>{download.releaseName || download.filePath}</dd><dt>{multi ? 'Files' : 'File'}</dt><dd>{multi ? `${group.rows.length} files in this torrent` : `${download.filePath} (file ${download.fileIndex})`}</dd><dt>Tracker</dt><dd>{download.trackerName} release {download.releaseId}{download.trackerSeeders !== undefined ? ` · ${download.trackerSeeders} seeders` : ''}{download.releaseSizeBytes ? ` · ${formatBytes(download.releaseSizeBytes)} total` : ''}</dd><dt>Transfer</dt><dd>{download.seeds} connected seeds · {download.peers} peers</dd></dl>}</div><div class="tv-download-actions"><button data-focus-region="content" data-focus-row={band} data-focus-col="0" data-focus-key={`download-${download.id}-play`} class="primary" onClick={() => onPlay(download)}>Play</button>{downloadTransferActions(download).map(item => <button key={item.action} aria-disabled={busyAction.startsWith(download.id + ':') ? 'true' : undefined} data-focus-region="content" data-focus-row={band} data-focus-col="1" data-focus-key={`download-${download.id}-${item.action}`} onClick={() => void runAction(download, item.action)}>{busyAction === download.id + ':' + item.action ? item.pendingLabel : item.label}</button>)}<button class="danger-button" data-focus-region="content" data-focus-row={band} data-focus-col="2" data-focus-key={`download-${download.id}-delete`} onClick={() => setPending({ download, scope: 'torrent' })}>Delete download</button><button data-focus-region="content" data-focus-row={band} data-focus-col="3" data-focus-key={`download-${download.id}-details`} aria-expanded={detailsShown} onClick={() => toggleDetails(download.id)}>{detailsShown ? 'Hide details' : 'Details'}</button>{multi && <button data-focus-region="content" data-focus-row={band} data-focus-col="4" data-focus-key={`download-${download.id}-files`} aria-expanded={expanded} onClick={() => toggleFiles(download.engineId)}>{expanded ? 'Hide files' : 'Show files'}</button>}</div>{multi && expanded && <div class="tv-download-files">{group.rows.map((row, rowIndex) => <div key={row.id} class="tv-download-file"><strong title={row.displayTitle || row.filePath}>{row.displayTitle || row.filePath}</strong><small>{formatBytes(row.sizeBytes)}</small><span><button data-focus-region="content" data-focus-row={band + 1 + rowIndex} data-focus-col="0" data-focus-key={`download-${row.id}-file-${row.fileIndex}-play`} onClick={() => onPlay(row)}>Play</button><button class="danger-button" data-focus-region="content" data-focus-row={band + 1 + rowIndex} data-focus-col="1" data-focus-key={`download-${row.id}-file-${row.fileIndex}-remove`} onClick={() => setPending({ download: row, scope: 'file' })}>Remove</button></span></div>)}</div>}</article>;
 })}</section>
}
function TVLibraryCategories({ api, onOpen }: { api: API; onOpen: (item: HouseholdItem) => void }) { const [categories, setCategories] = useState<LibraryCategory[]>([]); const [items, setItems] = useState<HouseholdItem[]>([]); const [selected, setSelected] = useState(''); const [message, setMessage] = useState('Loading library categories…'); useEffect(() => { api.libraryCategories().then(page => { setCategories(page.items as LibraryCategory[]); setMessage('') }).catch(error => setMessage(error.message)) }, []); async function open(name: string) { setSelected(name); setMessage('Loading category…'); try { const page = await api.libraryCategories(name); setItems(canonicalHouseholdItems(page.items as HouseholdItem[])); setMessage('') } catch (error) { setMessage((error as Error).message) } } if (selected) return <section><button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="library-category-back" onClick={() => { setSelected(''); setItems([]) }}>All categories</button><div class="row-heading"><h2>{selected}</h2></div>{message && <p aria-live="polite">{message}</p>}<div class="tv-library-grid">{items.map((item, index) => <LibraryCard api={api} item={item} row={2 + Math.floor(index / 5)} col={index % 5} focusKey={`library-item-${item.titleId || item.catalog?.id || item.release.id}`} onOpen={onOpen} />)}</div>{items.length === 0 && !message && <p class="tv-muted">Nothing is left in this category. Press All categories to go back.</p>}</section>; return <section class="tv-category-grid">{message && <p aria-live="polite">{message}</p>}{categories.map((category, index) => <button data-focus-region="content" data-focus-row={1 + Math.floor(index / 4)} data-focus-col={index % 4} data-focus-key={`library-category-${category.name}`} onClick={() => void open(category.name)}><strong>{category.name}</strong><span>{category.count} item{category.count === 1 ? '' : 's'}</span></button>)}</section> }
function TVJobs({ api, items: initial }: { api: API; items: Job[] }) {
 const [items, setItems] = useState(initial); const [query, setQuery] = useState(''); const [state, setState] = useState(''); const [kind, setKind] = useState(''); const [retryable, setRetryable] = useState(''); const [updatedHours, setUpdatedHours] = useState(''); const [next, setNext] = useState<string | null>(null); const [message, setMessage] = useState(''); const [detail, setDetail] = useState<{ job: Job; logs: JobLog[]; next: string | null } | null>(null);
 async function load(target = '', append = false) { try { const page = await api.jobs({ search: query, state, kind, retryable, updatedHours, pageSize: 12, cursor: target }); setItems(value => append ? [...value, ...page.items] : page.items); setNext(page.nextCursor) } catch (error) { setMessage((error as Error).message) } }
 async function open(job: Job) { try { const [result, logs] = await Promise.all([api.job(job.id), api.jobLogs(job.id)]); setDetail({ job: result.job, logs: logs.items, next: logs.nextCursor }) } catch (error) { setMessage((error as Error).message) } }
 async function older() { if (!detail?.next) return; try { const page = await api.jobLogs(detail.job.id, detail.next); setDetail({ ...detail, logs: [...detail.logs, ...page.items], next: page.nextCursor }) } catch (error) { setMessage((error as Error).message) } }
 useEffect(() => { const timer = window.setTimeout(() => { void load('') }, 400); return () => clearTimeout(timer) }, [query, state, kind, retryable, updatedHours]);
 useEffect(() => {
  // Catalog signals a jobs keypress near the list end; appends are guarded
  // so rapid keypresses cannot double-fetch the same page.
  let busy = false;
  const onNear = () => { if (busy || !next) return; busy = true; api.jobs({ search: query, state, kind, retryable, updatedHours, pageSize: 12, cursor: next }).then(page => { setItems(value => [...value, ...page.items]); setNext(page.nextCursor) }).catch(error => setMessage((error as Error).message)).finally(() => { busy = false }) };
  window.addEventListener('tv-jobs-near-end', onNear);
  return () => window.removeEventListener('tv-jobs-near-end', onNear);
 });
 if (detail) return <TVJobDetail detail={detail} onBack={() => setDetail(null)} onOlder={older} />;
 const cycle = (value: string, values: string[], set: (value: string) => void) => set(values[(values.indexOf(value) + 1) % values.length]);
 return <section class="tv-list"><div class="tv-filters"><input readOnly data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="jobs-search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search; press OK to type" /><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="jobs-state" onClick={() => cycle(state, ['', 'failed', 'completed', 'running', 'queued'], setState)}>State: {state || 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="jobs-kind" onClick={() => cycle(kind, ['', 'metadata', 'catalog-title-refresh', 'catalog-sync'], setKind)}>Kind: {kind ? jobKindLabel(kind) : 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="3" data-focus-key="jobs-retry" onClick={() => cycle(retryable, ['', 'true', 'false'], setRetryable)}>Retry: {retryable === 'true' ? 'can retry' : retryable === 'false' ? 'cannot retry' : 'any'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="4" data-focus-key="jobs-time" onClick={() => cycle(updatedHours, ['', '24', '168', '720'], setUpdatedHours)}>Updated: {updatedHours === '24' ? 'last day' : updatedHours === '168' ? 'last week' : updatedHours === '720' ? 'last month' : 'any time'}</button></div>{message && <p>{message}</p>}{items.length === 0 ? <EmptyState title="No jobs match">Set State to all, or choose a longer Updated range.</EmptyState> : items.map((job, index) => <article><div><strong>{job.label || jobKindLabel(job.kind)}</strong><span>{jobStatusLine(job)}</span></div><div><button data-focus-region="content" data-focus-row={2 + index} data-focus-col="0" data-focus-key={`job-${job.id}`} onClick={() => void open(job)}>Details</button><button disabled={job.state === 'queued' || job.state === 'running' || job.state === 'retry_wait'} data-focus-region="content" data-focus-row={2 + index} data-focus-col="1" data-focus-key={`job-${job.id}-retry`} onClick={() => void api.retryJob(job.id).then(() => api.job(job.id)).then(({ job: fresh }) => { setMessage('Job queued again.'); setItems(value => value.map(item => item.id === fresh.id ? fresh : item)) }).catch(error => setMessage(error.message))}>Retry</button></div></article>)}</section>
}

function TVJobDetail({ detail, onBack, onOlder }: { detail: { job: Job; logs: JobLog[]; next: string | null }; onBack: () => void; onOlder: () => void }) {
 const [level, setLevel] = useState(''); const [attempt, setAttempt] = useState(''); const [expanded, setExpanded] = useState<number | null>(null);
 const logs = detail.logs.filter(log => (!level || log.level === level) && (!attempt || String(log.attempt) === attempt));
 return <section class="tv-list job-detail"><button data-focus-region="content" data-focus-row="0" data-focus-col="0" data-focus-key="job-detail-back" onClick={onBack}>← Jobs</button><h2>{detail.job.label}</h2><p class="tv-muted">{jobStatusLine(detail.job)} · attempt {detail.job.attempt}</p><div class="tv-filters"><button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="log-level" onClick={() => setLevel(value => value === '' ? 'error' : value === 'error' ? 'warn' : '')}>Level: {level || 'all'}</button><button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="log-attempt" onClick={() => setAttempt(value => value === '' ? String(detail.job.attempt) : '')}>Attempt: {attempt || 'all'}</button></div>{logs.length === 0 ? <p class="tv-muted">No logs match. Set Level and Attempt to all to see every entry.</p> : logs.map((log, index) => { const open = expanded === log.id; return <button type="button" aria-expanded={open} data-focus-region="content" data-focus-row={2 + index} data-focus-col="0" data-focus-key={`job-log-${log.id}`} class={`job-log ${log.level} ${open ? 'expanded' : ''}`} onClick={() => setExpanded(value => value === log.id ? null : log.id)}><span class="job-log-heading"><strong>{log.phase} · {log.level}</strong><i>{open ? 'Hide details' : 'Show details'}</i></span><span>{new Date(log.createdAt).toLocaleString()} · attempt {log.attempt}</span><small>{log.message}</small>{open && <div class="job-log-expanded"><dl><dt>Job</dt><dd>{log.jobId}</dd><dt>Log entry</dt><dd>{log.id}</dd><dt>Attempt</dt><dd>{log.attempt}</dd></dl>{log.context && Object.keys(log.context).length > 0 ? <pre>{JSON.stringify(log.context, null, 2)}</pre> : <p>No structured context was recorded.</p>}</div>}</button> })}{detail.next && <button data-focus-region="content" data-focus-row={3 + logs.length} data-focus-col="0" data-focus-key="job-logs-older" onClick={() => void onOlder()}>Load older logs</button>}</section>
}

function TVEvents({ api }: { api: API }) { const [message, setMessage] = useState(''); const [coverage, setCoverage] = useState<Record<string, unknown> | null>(null); useEffect(() => { api.call<Record<string, unknown>>('/catalog/status').then(setCoverage).catch(error => setMessage(error.message)) }, []); async function run(mode: 'latest' | 'rebuild') { try { const job = await api.syncCatalog(mode); setMessage(`${job.label} queued. Follow it on Jobs.`) } catch (error) { setMessage((error as Error).message) } } return <section class="tv-settings"><h2>Catalog actions</h2>{coverage && <p class="tv-muted"><strong>{Number(coverage.observedReleases).toLocaleString()}</strong> releases kept · <strong>{Number(coverage.discoverableReleases).toLocaleString()}</strong> currently seeded</p>}<p>Fetch latest pulls the newest releases from your trackers. Rebuild catalog refreshes everything and takes longer. Both run in the background; follow them on Jobs.</p><button data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="event-latest" class="primary" onClick={() => void run('latest')}>Fetch latest</button><button data-focus-region="content" data-focus-row="2" data-focus-col="0" data-focus-key="event-rebuild" onClick={() => void run('rebuild')}>Rebuild catalog</button><p class="tv-muted" aria-live="polite">{message}</p></section> }

const TEST_NAMES: Record<string, string> = {
 filelist: 'FileList',
 qbittorrent: 'qBittorrent',
 storage: 'storage',
 ffmpeg: 'FFmpeg',
 ffprobe: 'FFprobe',
 tmdb: 'TMDB',
 subdl: 'SubDL',
 piratebay: 'Pirate Bay',
};

// Display label for engine values ('native' | 'qbittorrent') in saved-vs-running feedback.
const engineName = (v: unknown) => (v === 'native' ? 'Native' : 'qBittorrent');
// The TV never edits the engine selection, so the feedback is read-only: the
// ownership explanation always renders, and the running notice appears only
// when this process started with a different engine than the saved one. Old
// servers without engineRunning render the static copy only.
const engineFeedback = (value: Record<string, unknown>) => {
 const running = typeof value.engineRunning === 'string' ? value.engineRunning : '';
 const saved = String(value.downloadEngine ?? '');
 if (running === '' || running === saved) return '';
 return ` Running now: ${engineName(running)} — the saved selection (${engineName(saved)}) applies to new downloads after restart.`;
};

export function TVSettings({ api, onChangeServer, onForgetServer, updateStatus, onUpdateStatus, confirmOpen, onConfirmOpen, onConfirmClose }: { api: API; onChangeServer: () => void; onForgetServer: () => void; updateStatus: UpdateStatus | null; onUpdateStatus: (status: UpdateStatus) => void; confirmOpen: boolean; onConfirmOpen: () => void; onConfirmClose: () => void }) {
 const [value, setValue] = useState<Record<string, unknown> | null>(null); const [managed, setManaged] = useState<Set<string>>(new Set()); const [message, setMessage] = useState('Loading settings…');
 const [trackers, setTrackers] = useState<TrackerStatus[] | null>(null);
 const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
 const [checking, setChecking] = useState(false); const [applying, setApplying] = useState(false); const [updateMessage, setUpdateMessage] = useState('');
 const settingsMounted = useRef(true);
 useEffect(() => () => { settingsMounted.current = false; }, []);
 const openReleaseLink = async (url: string) => { const launched = await openExternalURL(url); if (!settingsMounted.current) return; if (!launched) setUpdateMessage('Open this address on another device: ' + url); };
 const refreshTrackers = () => {
  const promise = typeof api.trackers === 'function' ? api.trackers() : api.call<TrackerStatus[]>('/trackers');
  return promise.then(list => { if (settingsMounted.current) setTrackers(Array.isArray(list) ? list : null); }).catch(() => { if (settingsMounted.current) setTrackers(null); });
 };
 useEffect(() => {
  Promise.all([api.call<Record<string, unknown>>('/settings'), api.call<{ items: SettingsField[] }>('/settings/schema')]).then(([settings, schema]) => {
   setValue(settings);
   setManaged(new Set(schema.items.filter(field => field.readOnly).map(field => field.key)));
   setMessage('');
  }).catch(error => setMessage(error.message));
  void refreshTrackers();
 }, []);
 useEffect(() => {
  if (!updateStatus?.applying) return;
  const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="update-check"]')), 0);
  return () => window.clearTimeout(timer);
 }, [updateStatus?.applying]);
 async function save() {
  if (!value) return;
  const out = { ...value };
  Object.keys(out).filter(key => key.endsWith('Configured') || key === 'settingsPath' || key === 'engineRunning').forEach(key => delete out[key]);
  try {
   await api.call('/settings', { method: 'PUT', body: JSON.stringify(out) });
   setMessage('Settings saved. Restart the server to apply worker-limit changes.');
   void refreshTrackers();
  } catch (error) {
   setMessage((error as Error).message);
  }
 }
 async function test(name: string) { setMessage(`Testing ${TEST_NAMES[name] || name}…`); try { const result = await api.call<{ message: string }>(`/dependencies/${name}/test`, { method: 'POST' }); setMessage(result.message) } catch (error) { setMessage((error as Error).message) } }
 async function checkUpdate() {
  if (checking) return;
  setChecking(true); setUpdateMessage('Checking for updates…');
  try { const next = await api.call<UpdateStatus>('/updates/check', { method: 'POST' }); onUpdateStatus(next); setUpdateMessage(next.available ? `Version ${next.latest} is available.` : 'The server is up to date.') } catch (error) { setUpdateMessage(`Update check failed: ${(error as Error).message}`) } finally { setChecking(false) }
 }
 async function applyUpdate() {
  if (applying) return;
  setApplying(true);
  try {
   const next = await api.call<UpdateStatus>('/updates/apply', { method: 'POST' });
   onUpdateStatus(next);
   setUpdateMessage(next.applying ? 'Update accepted. The server restarts; playback resumes when it is back.' : 'The server is already up to date.');
  } catch (error) {
   const outcome = updateApplyOutcome((error as Error & { status?: number }).status);
   setUpdateMessage(outcome === 'conflict' ? `Update refused: ${(error as Error).message}` : `Update failed: ${(error as Error).message}`);
  } finally { setApplying(false); onConfirmClose() }
 }
 const allDisabled = Boolean(trackers && trackers.length > 0 && trackers.every(item => !item.enabled));
const host = (() => { try { return new URL(api.base).host } catch { return '' } })();
 const lockedNote = (key: string) => managed.has(key) && <small>Environment managed</small>;
 return <section class="tv-settings tv-settings-page"><h2>Playback</h2><p class="tv-muted">Language and watched settings for this household. API keys and file paths stay in browser Settings.</p>{value && <>
  <div class="tv-safe-fields">
   <label>Preferred audio language{lockedNote('preferredAudioLanguage')}<input disabled={managed.has('preferredAudioLanguage')} data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="setting-audio-primary" value={String(value.preferredAudioLanguage || 'en')} onInput={event => setValue({ ...value, preferredAudioLanguage: event.currentTarget.value })} /></label>
   <label>Preferred subtitle language{lockedNote('preferredSubtitleLanguage')}<input disabled={managed.has('preferredSubtitleLanguage')} data-focus-region="content" data-focus-row="2" data-focus-col="0" data-focus-key="setting-subtitle-primary" value={String(value.preferredSubtitleLanguage || '')} onInput={event => setValue({ ...value, preferredSubtitleLanguage: event.currentTarget.value })} /></label>
   <label>Fallback subtitle language{lockedNote('fallbackSubtitleLanguage')}<input disabled={managed.has('fallbackSubtitleLanguage')} data-focus-region="content" data-focus-row="3" data-focus-col="0" data-focus-key="setting-subtitle-fallback" value={String(value.fallbackSubtitleLanguage || '')} onInput={event => setValue({ ...value, fallbackSubtitleLanguage: event.currentTarget.value })} /></label>
   <label>Mark as watched at (percent){lockedNote('watchedThresholdPercent')}<input disabled={managed.has('watchedThresholdPercent')} type="number" data-focus-region="content" data-focus-row="4" data-focus-col="0" data-focus-key="setting-watched" value={String(value.watchedThresholdPercent || 90)} onInput={event => setValue({ ...value, watchedThresholdPercent: Number(event.currentTarget.value) })} /></label>
  </div>
  <h3>Background work</h3>
  <div class="tv-safe-fields">
   <label>Concurrent background jobs{lockedNote('maxConcurrentJobs')}<input disabled={managed.has('maxConcurrentJobs')} type="number" min="1" max="20" data-focus-region="content" data-focus-row="5" data-focus-col="0" data-focus-key="setting-workers" value={String(value.maxConcurrentJobs || 10)} onInput={event => setValue({ ...value, maxConcurrentJobs: Number(event.currentTarget.value) })} /></label>
   <label>Title refresh timeout (minutes){lockedNote('titleRefreshTimeoutMinutes')}<input disabled={managed.has('titleRefreshTimeoutMinutes')} type="number" min="5" max="120" data-focus-region="content" data-focus-row="6" data-focus-col="0" data-focus-key="setting-title-timeout" value={String(value.titleRefreshTimeoutMinutes || 30)} onInput={event => setValue({ ...value, titleRefreshTimeoutMinutes: Number(event.currentTarget.value) })} /></label>
  </div>
  <div class="tv-tracker-controls">
   <h3>Trackers</h3>
   <p class="tv-muted">Turning a tracker off hides its discovery. Existing downloads stay listed and playable.</p>
   <button class={`tv-tracker-toggle ${value.fileListEnabled ? 'active' : ''}`} disabled={managed.has('fileListEnabled')} data-focus-region="content" data-focus-row="7" data-focus-col="0" data-focus-key="setting-filelist-enabled" aria-pressed={Boolean(value.fileListEnabled)} onClick={() => setValue({ ...value, fileListEnabled: !value.fileListEnabled })}>FileList: {value.fileListEnabled ? 'On' : 'Off'}{managed.has('fileListEnabled') && <small> · Environment managed</small>}</button>
   <button class={`tv-tracker-toggle ${value.pirateBayEnabled ? 'active' : ''}`} disabled={managed.has('pirateBayEnabled')} data-focus-region="content" data-focus-row="8" data-focus-col="0" data-focus-key="setting-piratebay-enabled" aria-pressed={Boolean(value.pirateBayEnabled)} onClick={() => setValue({ ...value, pirateBayEnabled: !value.pirateBayEnabled })}>The Pirate Bay: {value.pirateBayEnabled ? 'On' : 'Off'}{managed.has('pirateBayEnabled') && <small> · Environment managed</small>}</button>
   <div class="tv-tracker-readiness">{trackers === null ? <span class="tv-tracker-chip disabled">Trackers unavailable</span> : trackers.map(t => <span key={t.id} class={`tv-tracker-chip ${!t.enabled ? 'disabled' : t.configured ? 'ready' : 'setup'}`}>{t.name} · {!t.enabled ? 'disabled' : t.configured ? 'ready' : 'needs setup'}</span>)}{allDisabled && <span class="tv-tracker-zero-note">Zero trackers enabled; Downloads remain reachable.</span>}</div>
   <div class="tv-safe-fields">
    <label>The Pirate Bay website URL{lockedNote('pirateBayWebsiteUrl')}<input disabled={managed.has('pirateBayWebsiteUrl')} data-focus-region="content" data-focus-row="9" data-focus-col="0" data-focus-key="setting-piratebay-website" value={String(value.pirateBayWebsiteUrl || '')} onInput={event => setValue({ ...value, pirateBayWebsiteUrl: event.currentTarget.value })} /></label>
    <label>The Pirate Bay API URL{lockedNote('pirateBayApiUrl')}<input disabled={managed.has('pirateBayApiUrl')} data-focus-region="content" data-focus-row="10" data-focus-col="0" data-focus-key="setting-piratebay-api" value={String(value.pirateBayApiUrl || '')} onInput={event => setValue({ ...value, pirateBayApiUrl: event.currentTarget.value })} /></label>
   </div>
  </div>
  <p class="tv-muted">Selection controls new acquisitions. Existing downloads keep the engine that owns them.{engineFeedback(value)}</p>
  <button class="primary" data-focus-region="content" data-focus-row={SETTINGS_SAVE_ROW} data-focus-col="0" data-focus-key="settings-save" onClick={() => void save()}>Save preferences</button>
 </>}<p class="tv-settings-message" role="status">{message}</p>
  {updateStatus && <div class="tv-update-panel"><h3>Updates</h3><p>Version {updateStatus.currentVersion}{updateStatus.applying ? ' · installing an update' : updateStatus.available ? ' · update available' : updateStatus.selfUpdate ? ' · up to date' : ''}</p>{updateNoticeVisible(updateStatus) && <div class="tv-update-notice"><strong>{updateStatus.available ? `Version ${updateStatus.latest} is available.` : 'This server updates only by hand.'}</strong><p>Updates install on the server machine and interrupt playback on every connected player; this TV installs nothing itself.</p><button class="tv-release-link" data-focus-region="content" data-focus-row={UPDATE_RELEASE_LINK_ROW} data-focus-col="0" data-focus-key="update-release-link" onClick={() => void openReleaseLink(updateStatus.releasesUrl)}>{updateStatus.releasesUrl}</button></div>}</div>}
  <div class="tv-diagnostics"><button class="tv-diagnostics-toggle" data-focus-region="content" data-focus-row={SETTINGS_DIAGNOSTICS_ROW} data-focus-col="0" data-focus-key="settings-diagnostics" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen(open => !open)}>{diagnosticsOpen ? 'Hide connection tests' : 'Connection tests'}</button>
  {diagnosticsOpen && <><p class="tv-muted">Checks that the server can reach each service. The result appears under the Save button.</p><div class="tv-test-buttons">{['filelist', 'qbittorrent', 'storage', 'ffmpeg', 'ffprobe', 'tmdb', 'subdl', 'piratebay'].map((name, index) => <button data-focus-region="content" data-focus-row={SETTINGS_TEST_FIRST_ROW + Math.floor(index / 4)} data-focus-col={index % 4} data-focus-key={`test-${name}`} onClick={() => void test(name)}>Test {TEST_NAMES[name] || name}</button>)}</div></>}</div>
  <div class="tv-server"><h2>Server</h2>{host && <p class="tv-server-line"><strong>{host}</strong></p>}
  <div class="tv-server-actions"><button data-focus-region="content" data-focus-row={SETTINGS_CHANGE_SERVER_ROW} data-focus-col="0" data-focus-key="change-server" onClick={onChangeServer}>Change server address</button><button data-focus-region="content" data-focus-row={SETTINGS_FORGET_SERVER_ROW} data-focus-col="0" data-focus-key="forget-server" onClick={onForgetServer}>Forget this server</button>
  <button data-focus-region="content" data-focus-row={UPDATE_APPLY_ROW} data-focus-col="0" data-focus-key="update-apply" disabled={updateApplyDisabled(updateStatus, applying)} onClick={onConfirmOpen}>{updateStatus?.applying || applying ? 'Installing…' : 'Install server update'}</button></div>
  <p aria-live="polite">{updateMessage}</p></div>
  {confirmOpen && updateStatus && <section role="dialog" aria-modal="true" aria-labelledby="tv-update-confirm-heading" class="tv-settings tv-update-confirm"><h2 id="tv-update-confirm-heading">Install version {updateStatus.latest}?</h2><p>The server downloads the release, installs it, and restarts. Playback is interrupted on every connected device, including this TV.</p><div><button data-focus-region={UPDATE_DIALOG_REGION} data-focus-row="0" data-focus-col="0" data-focus-key="update-confirm-cancel" onClick={onConfirmClose}>Cancel</button><button class="danger-button" data-focus-region={UPDATE_DIALOG_REGION} data-focus-row="0" data-focus-col="1" data-focus-key="update-confirm-apply" disabled={applying} onClick={() => void applyUpdate()}>{applying ? 'Starting…' : 'Install and restart'}</button></div></section>}
 </section>;
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

function TitleCard({ api, title, row, col, seeders, focusRef, onOpen }: { api: API; title: CatalogTitle; row: number; col: number; seeders?: boolean; focusRef?: { current: HTMLButtonElement | null }; onOpen: () => void }) {
 return <button ref={focusRef} class="poster-card" data-focus-region="content" data-focus-row={row} data-focus-col={col} data-focus-key={`title-${title.id}`} data-art={artURL(api, title)} onClick={onOpen}>{title.posterUrl ? <img src={api.streamURL(title.posterUrl)} alt="" loading="lazy" /> : <div class="poster-fallback">{title.title.slice(0, 1)}</div>}<TVStateBadges state={title.libraryState} /><div class="poster-copy"><strong>{title.title}</strong><span>{cardMeta(title, { seeders })}</span></div></button>;
}

function sourceActionLabel(source: CatalogSource) { return source.libraryState?.downloadState && source.libraryState.downloadState !== 'none' ? 'Play' : 'Play and download' }
function SourceButton({ source, row, onPlay, focusKey }: { source: CatalogSource; row: number; onPlay: (release: Release, fileIndex?: number) => void; focusKey?: string }) {
 const name = source.filePath || source.release.name;
 const secondary = [source.release.trackerName, source.parsed.audio].filter(Boolean).join(' · ');
 // The decision point: resolution, chips, size and seeders lead. Tracker and audio are secondary; the release and file name is evidence and shows only while the row has focus.
 return <button class="source-button" data-focus-region="content" data-focus-row={row} data-focus-col="0" data-focus-key={focusKey || `source-${source.release.id}-${source.fileIndex ?? -1}`} onClick={() => onPlay(source.release, source.fileIndex)}>
  <span class="source-main"><b class="source-resolution">{sourceHeadline(source.parsed)}</b>{sourceChips(source.parsed, source.release.category).map(chip => <span class="source-chip">{chip}</span>)}<span class="source-facts">{formatBytes(source.fileSizeBytes || source.release.sizeBytes)} · {source.release.seeders} seeders</span><span class="source-action"><TVStateBadges state={source.libraryState} /><b class="source-action-label">{sourceActionLabel(source)}</b></span></span>
  {secondary && <span class="source-secondary">{secondary}</span>}
  <span class="source-filename" title={name}>{name}</span>
 </button>;
}

type SeasonPackAction = 'download' | 'pause' | 'resume' | 'retry' | 'delete';
function TVSeasonPackCard({ source, season, index, baseRow, open, onToggle, onAction, onDelete }: { source: CatalogSource; season: number; index: number; baseRow: number; open: boolean; onToggle: () => void; onAction: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean>; onDelete: () => void }) {
 const state = source.libraryState; const [busy, setBusy] = useState(''); const managed = Boolean(state?.downloadId); const paused = state?.transferState === 'paused'; const complete = state?.downloadState === 'downloaded'; const error = state?.downloadState === 'error';
 const run = async (action: SeasonPackAction) => { if (busy) return; setBusy(action); try { await onAction(source, season, action) } catch { /* the detail area already shows the message */ } finally { setBusy('') } };
 // Unique structured row band per pack card: shared rows collided across
 // cards, so D-pad movement crossed into sibling headers and controls.
 const row = baseRow + index * 4;
 return <article class={`season-pack-card ${open ? 'expanded' : ''}`}>
  <button class="season-pack-button" data-focus-region="content" data-focus-row={row} data-focus-col={index} data-focus-key={`season-pack-${source.release.id}`} aria-expanded={open} aria-controls={`tv-pack-${source.release.id}`} onClick={onToggle} aria-label={`${source.parsed.resolution || 'Season pack'} · ${seasonPackActionLabel(state)} · ${open ? 'hide' : 'show'} controls`}>
   <span class="season-pack-copy"><strong>{source.parsed.resolution ? sourceHeadline(source.parsed) : 'Season pack'}</strong>{sourceChips(source.parsed).length > 0 && <small>{sourceChips(source.parsed).join(' · ')}</small>}<small>{formatBytes(source.release.sizeBytes)} · {source.release.seeders} seeders</small><small>{[source.release.trackerName, source.parsed.audio].filter(Boolean).join(' · ')}</small></span>
   <span class="season-pack-action"><TVStateBadges state={state} /><b>{seasonPackActionLabel(state)}</b></span>
  </button>
  {open && <div id={`tv-pack-${source.release.id}`} class="season-pack-controls"><p class="source-filename">{source.release.name}</p><progress value={state?.progress || 0} max="1" aria-label="Season download progress" />{!managed && <button class="primary" aria-disabled={busy ? 'true' : undefined} data-focus-region="content" data-focus-row={row + 1} data-focus-col="0" data-focus-key={`season-pack-${source.release.id}-download`} onClick={() => void run('download')}>{busy ? 'Starting…' : 'Download season'}</button>}{managed && !complete && !error && <button aria-disabled={busy ? 'true' : undefined} data-focus-region="content" data-focus-row={row + 1} data-focus-col="1" data-focus-key={`season-pack-${source.release.id}-toggle`} onClick={() => void run(paused ? 'resume' : 'pause')}>{busy ? `${paused ? 'Resuming' : 'Pausing'}…` : paused ? 'Resume' : 'Pause'}</button>}{error && <button class="primary" aria-disabled={busy ? 'true' : undefined} data-focus-region="content" data-focus-row={row + 1} data-focus-col="2" data-focus-key={`season-pack-${source.release.id}-retry`} onClick={() => void run('retry')}>{busy ? 'Retrying…' : 'Retry'}</button>}{managed && <button class="danger-button" aria-disabled={busy ? 'true' : undefined} data-focus-region="content" data-focus-row={row + 1} data-focus-col="3" data-focus-key={`season-pack-${source.release.id}-delete`} onClick={() => { if (!busy) onDelete() }}>Delete download</button>}</div>}
 </article>;
}
function TitleDetail({ api, detail, target, message, resume, favorite, onClose, onFavorite, onResume, onPlay, onPackAction }: { api: API; detail: CatalogDetail; target: DetailTarget; message: string; resume?: HouseholdItem; favorite: boolean; onClose: () => void; onFavorite: (title: CatalogTitle, value: boolean) => void; onResume: (item: HouseholdItem) => void; onPlay: (release: Release, fileIndex?: number) => void; onPackAction: (source: CatalogSource, season: number, action: SeasonPackAction) => Promise<void | boolean> }) {
 const [season, setSeason] = useState(target.season || detail.seasons[0]?.number || 0);
 const [expanded, setExpanded] = useState(target.episode ? `${target.season}:${target.episode}` : '');
 const [expandedPack, setExpandedPack] = useState('');
 const [pendingPack, setPendingPack] = useState<CatalogSource | null>(null);
 const [deleting, setDeleting] = useState(false);
 const [refreshing, setRefreshing] = useState(false);
 const [refreshNote, setRefreshNote] = useState('');
 const [packsOpen, setPacksOpen] = useState(false);
 const selected = detail.seasons.find(item => item.number === season);
 // The packs toggle owns row 3. Expanded pack cards occupy 4-row bands
 // from row 4 (4 + index * 4); collapsed packs render no cards at all, so
 // episode rows start right after the toggle and the bands stay disjoint
 // for any pack count.
 const packCount = selected?.packSources?.length || 0;
 const episodeRowBase = packsOpen && packCount > 0 ? 5 + packCount * 4 : 4;
 const firstSource = detail.sources[0] || selected?.episodes[0]?.sources[0];
 useEffect(() => { const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-detail-initial]')), 0); return () => window.clearTimeout(timer); }, []);
 useEffect(() => { if (!pendingPack) return; const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="season-pack-delete-cancel"]')), 0); return () => window.clearTimeout(timer) }, [pendingPack]);
 useEffect(() => { if (!expanded && !expandedPack && !pendingPack) return; const key = (event: KeyboardEvent) => { if (remoteAction(event.key, event.keyCode) !== 'back') return; event.preventDefault(); event.stopImmediatePropagation(); if (pendingPack && !deleting) setPendingPack(null); else if (expandedPack) setExpandedPack(''); else setExpanded('') }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [expanded, expandedPack, pendingPack, deleting]);
 const confirmDelete = async () => { if (!pendingPack || !selected || deleting) return; setDeleting(true); try { await onPackAction(pendingPack, selected.number, 'delete'); setPendingPack(null) } catch { /* the detail area already shows the message; the dialog stays open */ } finally { setDeleting(false) } };
 const refresh = async () => {
  if (refreshing) return;
  setRefreshing(true);
  setRefreshNote('');
  try { await api.refreshTitle(detail.title.id, detail.title.title, true) } catch (e) { setRefreshNote((e as Error).message) } finally { setRefreshing(false) }
 };
 return <main class="detail-screen">
  <Backdrop initial={artURL(api, detail.title)} follow={false} />
  <button data-detail-initial data-focus-region="content" data-focus-row="0" data-focus-col="0" data-focus-key="detail-back" onClick={onClose}>Back</button>
  <div class="detail-copy">
   <span class="eyebrow">{heroFacts(detail.title).join(' · ')}</span>
   <h1>{detail.title.title}</h1>
   {detail.title.genres && detail.title.genres.length > 0 && <p class="detail-genres">{detail.title.genres.join(' · ')}</p>}
   <TVStateBadges state={detail.title.libraryState} />
   <p class="detail-overview">{detail.title.overview || 'No description yet. Pick a version to play.'}</p>
   <div class="detail-actions">
    {resume ? <button class="primary" data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="detail-playback" onClick={() => onResume(resume)} aria-label={`${resumeActionLabel(resume, detail.title.kind)} at saved position`}>{resumeActionLabel(resume, detail.title.kind)}</button> : firstSource && <button class="primary" data-focus-region="content" data-focus-row="1" data-focus-col="0" data-focus-key="detail-playback" onClick={() => onPlay(firstSource.release, firstSource.fileIndex)}>{sourceActionLabel(firstSource)}</button>}
    <button data-focus-region="content" data-focus-row="1" data-focus-col="1" data-focus-key="detail-favorite" aria-pressed={favorite} onClick={() => onFavorite(detail.title, !favorite)}>{favorite ? 'In favorites' : 'Add to favorites'}</button>
    <button data-focus-region="content" data-focus-row="1" data-focus-col="2" data-focus-key="detail-refresh" aria-disabled={refreshing ? 'true' : undefined} aria-label="Refresh data: fetches fresh series information from the metadata providers and searches all trackers again, then rebuilds the episode list." onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh data'}</button>
   </div>
   {resume && <small class="resume-file">{resumeLine(resume, detail.title.kind)}</small>}
  </div>
  {message && <p class="detail-message" aria-live="polite">{message}</p>}
  {refreshNote && <p class="detail-message" role="alert">{refreshNote}</p>}
  {detail.seasons.length > 0 && <section class="season-browser">
   <h2>Seasons</h2>
   <div class="season-tabs">{detail.seasons.map((item, index) => <button key={item.number} data-focus-region="content" data-focus-row="2" data-focus-col={index} data-focus-key={`season-${item.number}`} class={season === item.number ? 'active' : ''} onClick={() => { setSeason(item.number); setExpanded(''); setExpandedPack('') }}><span>Season {item.number}</span><TVStateBadges state={item.libraryState} /></button>)}</div>
   {selected?.packSources && selected.packSources.length > 0 && <div class="season-pack-downloads">
    <button class="episode-tile packs-toggle" aria-expanded={packsOpen} data-focus-region="content" data-focus-row="3" data-focus-col="0" data-focus-key={`packs-toggle-${selected.number}`} onClick={() => setPacksOpen(current => !current)}>
     <span><b>Complete season versions ({selected.packSources.length})</b><small>Download every episode of this season at once. Open a version to review it first.</small></span>
     <b>{packsOpen ? 'Hide' : 'Show'}</b>
    </button>
    {packsOpen && <div class="season-pack-grid">{selected.packSources.map((source, index) => <TVSeasonPackCard key={source.release.id} source={source} season={selected.number} index={index} baseRow={4} open={expandedPack === source.release.id} onToggle={() => setExpandedPack(current => current === source.release.id ? '' : source.release.id)} onAction={onPackAction} onDelete={() => setPendingPack(source)} />)}</div>}
   </div>}
   {selected && selected.episodes.length === 0 ? <p class="episode-loading" role="status">Preparing the individual episode list. This page updates by itself when it is ready.</p> : selected?.episodes.map((episode, index) => {
    const key = `${episode.season}:${episode.number}`;
    const open = expanded === key;
    const row = episodeRowBase + index * 20;
    return <article key={key} class={`episode-row ${open ? 'expanded' : ''}`}>
     <button class="episode-tile" aria-expanded={open} data-focus-region="content" data-focus-row={row} data-focus-col="0" data-focus-key={`episode-${key}`} onClick={() => setExpanded(current => current === key ? '' : key)}>
      <span><b>{episode.number ? `${episode.number}. ` : ''}{episode.title}</b><small>{episode.sourceCount} version{episode.sourceCount === 1 ? '' : 's'}</small></span>
      <TVStateBadges state={episode.libraryState} />
     </button>
     {open && episode.sources.map((source, sourceIndex) => <SourceButton key={`${source.release.id}:${source.fileIndex ?? -1}`} source={source} row={row + 1 + sourceIndex} onPlay={onPlay} />)}
    </article>;
   })}
   {selected && selected.unknown && selected.unknown.length > 0 && (() => {
    const groupKey = `unknown-${selected.number}`;
    const groupOpen = expanded === groupKey;
    const groupRow = episodeRowBase + selected.episodes.length * 20;
    // Built with forEach+push: flatMap/flat are absent from the Tizen 5.0
    // engine floor and the pack validator rejects them.
    const children: JSX.Element[] = [];
    selected.unknown.forEach((episode, episodeIndex) => {
     const key = `unknown-episode-${episode.season}:${episode.number}`;
     episode.sources.forEach((source, sourceIndex) => {
      children.push(<SourceButton key={`${key}-${sourceIndex}`} source={source} row={groupRow + 1 + episodeIndex * 2 + sourceIndex} focusKey={`${key}-${sourceIndex}`} onPlay={onPlay} />);
     });
    });
    return <article key={groupKey} class="episode-row unknown-group">
     <button class="episode-tile" aria-expanded={groupOpen} data-focus-region="content" data-focus-row={groupRow} data-focus-col="0" data-focus-key={groupKey} onClick={() => setExpanded(current => current === groupKey ? '' : groupKey)}>
      <span><b>Unknown episodes ({selected.unknown.length})</b><small>Files without episode information</small></span>
     </button>
     {groupOpen && children}
    </article>;
   })()}
  </section>}
  {detail.seasons.length === 0 && detail.sources.length === 0 && <section class="source-list"><EmptyState title="No versions yet">The trackers have no release for this title right now. Press Refresh data to search them again.</EmptyState></section>}
  {detail.seasons.length === 0 && detail.sources.length > 0 && <section class="source-list"><h2>Versions</h2>{detail.sources.map((source, index) => <SourceButton key={`${source.release.id}:${source.fileIndex ?? -1}`} source={source} row={2 + index} onPlay={onPlay} />)}</section>}
  {pendingPack && <section role="dialog" aria-modal="true" aria-labelledby="tv-season-pack-delete-heading" class="tv-settings tv-removal-confirm tv-season-pack-confirm"><h2 id="tv-season-pack-delete-heading">Delete season download?</h2><strong>Season {selected?.number}</strong><p>{pendingPack.release.name} · {pendingPack.release.trackerName}</p><p>This permanently deletes the season download and every episode file in it. You can download the season again later.</p><button aria-disabled={deleting ? 'true' : undefined} data-focus-region="season-pack-dialog" data-focus-row="0" data-focus-col="0" data-focus-key="season-pack-delete-cancel" onClick={() => { if (!deleting) setPendingPack(null) }}>Cancel</button><button aria-disabled={deleting ? 'true' : undefined} class="danger-button" data-focus-region="season-pack-dialog" data-focus-row="1" data-focus-col="0" data-focus-key="season-pack-delete-confirm" onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : 'Delete download'}</button></section>}
 </main>;
}

export function App() {
 const [server, setServer] = useState(localStorage.getItem(STORAGE) || '');
 const [draft, setDraft] = useState(server || 'http://server.lan:8097');
 const [api, setAPI] = useState<API | null>(null);
 const [titles, setTitles] = useState<CatalogTitle[]>([]);
 const [facets, setFacets] = useState<CatalogFacets>(emptyFacets);
 const [household, setHousehold] = useState<HouseholdState>(emptyState);
 const [downloads, setDownloads] = useState<Download[]>([]);
 const [jobs, setJobs] = useState<Job[]>([]);
 const [status, setStatus] = useState('');
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
 const viewportInput = useRef(0);
 const loadState = async (client = api) => { if (client) try { setHousehold(await client.state()); } catch (error) { setStatus((error as Error).message); } };
 async function connect(url = draft) { setStatus('Connecting…'); try { const normalized = normalizeServerURL(url); const client = new API(normalized); const info = await client.info(); const [titlePage, catalogFacets, downloadPage, jobPage] = await Promise.all([client.titles({ pageSize: 12, sort: 'newest' }), client.facets(), client.downloads().catch(() => ({ items: [], nextCursor: null, total: 0 })), client.jobs({ pageSize: 24 }).catch(() => ({ items: [], nextCursor: null, total: 0 }))]); localStorage.setItem(STORAGE, normalized); setServer(normalized); setDraft(normalized); setAPI(client); setStatus(`${info.instanceName || info.name} ${info.version}`); setTitles(titlePage.items); setFacets(catalogFacets); void client.ensureMetadata(titlePage.items.map(item => item.id)).catch(error => setStatus((error as Error).message)); } catch (error) { setStatus((error as Error).message); } }
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
  setPreparing({ trackerName: attempt.kind === 'source' ? attempt.release.trackerName : attempt.source.release.trackerName, label });
  try {
   if (attempt.kind === 'source') {
    const download = await api.prepare(attempt.release.id, attempt.fileIndex, controller?.signal);
    if (token !== prepareToken.current) return false;
    prepareController.current = null;
    prepareAttempt.current = null;
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
  if (origin) window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(origin)}"]`) || document.querySelector<HTMLElement>('[data-focus-region="content"]')), 0);
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
   stream.onerror = () => { stream?.close(); if (stopped || suspended) return; failures++; const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(5, failures - 1))); setStatus(`Server connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s…`); void api.diagnostic('warn', 'TV event stream disconnected', { attempt: failures }).catch(() => { }); window.clearTimeout(timer); timer = window.setTimeout(open, delay); };
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
 if (player && api) return <Player key={player.download.id} api={api} download={player.download} resumeMs={player.resumeMs} preferences={player.preferences} onStateChanged={() => loadState()} onComplete={advanceEpisode} onClose={() => setPlayer(null)} />;
 if (!api) return <Setup draft={draft} server={server} status={status} onDraft={setDraft} onConnect={url => void connect(url)} onForget={() => { localStorage.removeItem(STORAGE); setServer(''); setDraft(''); setStatus('Saved server forgotten.') }} />;
 return <Catalog api={api} status={status} titles={titles} facets={facets} household={household} downloads={downloads} jobs={jobs} restoreFocus={catalogFocus.current} portal={portal} updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} onFocus={key => { catalogFocus.current = key; }} onRetry={() => void connect(server)} onChangeServer={() => { cancelPrepare(); setAPI(null); }} onForgetServer={() => { cancelPrepare(); localStorage.removeItem(STORAGE); setAPI(null); setServer(''); setDraft(''); }} onPlay={play} onPlayDownload={download => void api.playback(download.id).then(value => setPlayer({ download, resumeMs: value.watched ? 0 : value.positionMs })).catch(() => setPlayer({ download, resumeMs: 0 }))} onManageDownload={manageDownload} onManageSeasonPack={manageSeasonPack} onRefreshDownloads={refreshDownloads} onFavorite={favorite} preparing={preparing} onCancelPrepare={cancelPrepare} onRetryPrepare={retryPrepare} />;
}

try {
 const root = document.getElementById('app');
 if (!root) throw new Error('The application root element is missing.');
 render(<App />, root);
 window.FileListBoot?.ready();
} catch (error) {
 window.FileListBoot?.fail(error);
 throw error;
}
