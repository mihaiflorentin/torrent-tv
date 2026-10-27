// TV Settings in two panes (#60, the "Settings" board): the group list on the left, each group with a short
// status beside its name, and the selected group's rows on the right (a value and a chevron, or a switch with
// On/Off); a row's help text shows only while it has focus. D-pad: the maps in dpad/maps/system.mjs.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { API, Job, SettingsField, TrackerStatus, UpdateStatus } from '@torrent-tv/shared';
import { chooseStructuredTarget, focusElement, visibleFocusables, type Direction } from './navigation';
import { REBUILD_DIALOG_REGION, UPDATE_DIALOG_REGION, updateApplyDisabled, updateApplyOutcome, updateNoticeVisible } from './portal';
import { openExternalURL } from './platform';
import { Icon } from './icons';
import { groupNote, settingsGroups, type SettingsGroupId } from './settings-groups';
import type { TVRoute } from './hubs';

export const SETTINGS_GROUPS_REGION = 'settings-groups';
// The pane's rows start below the group list's row numbers, so a row and a group never share a focus row.
const FIRST_ROW = 20;

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

// Each row's help, shown only while the row has focus.
const HELP: Record<string, string> = {
 'setting-audio-primary': 'Used first when a version has several audio tracks. You can still switch in the player.',
 'setting-subtitle-primary': 'Subtitles in this language are picked first. You can still switch in the player.',
 'setting-subtitle-fallback': 'Used when no subtitles exist in the preferred language.',
 'setting-watched': 'A title counts as watched once you pass this share of it.',
 'settings-save': 'Saves Playback, Trackers and Background jobs together for this household.',
 'setting-filelist-enabled': 'Turning a tracker off hides its discovery. Existing downloads stay listed and playable.',
 'setting-piratebay-enabled': 'Turning a tracker off hides its discovery. Existing downloads stay listed and playable.',
 'setting-piratebay-website': 'Address of The Pirate Bay website, used for links to torrent details.',
 'setting-piratebay-api': 'Address of the Pirate Bay JSON API used for search and discovery.',
 'catalog-fetch-latest': 'Pulls the newest releases from your trackers now instead of waiting for the hourly run. Follow it in Background jobs.',
 'settings-reload': 'Loads the catalog and your library from the server again.',
 'change-server': 'Connect this TV to a different server address.',
 'forget-server': 'Removes this server from the TV and returns to setup.',
 'settings-diagnostics': 'Checks that the server can reach each service. The result appears below the tests.',
 'settings-jobs': 'Catalog and metadata work the server runs in the background: what ran, when, Details and Retry.',
 'setting-workers': 'How many background jobs run at once. Restart the server to apply a change.',
 'setting-title-timeout': 'How long a title refresh may run before it stops. Restart the server to apply a change.',
 'update-check': 'Asks the server whether a newer version is published.',
 'update-release-link': 'Updates install on the server machine and interrupt playback on every connected player; this TV installs nothing itself.',
 'update-apply': 'Installs the new version on the server and restarts it. Playback stops on every device.',
 'settings-projects': 'Project sites published with this server.',
 'catalog-rebuild': 'Slow and heavy on your trackers and the server. It asks first.',
};

/** Moves a key press inside Settings (the Catalog shell asks first): Right on a group opens it; Left off the
 * rows' first column returns to the selected group. Returns true when it handled the press. */
export function settingsDirection(direction: Direction, current: HTMLElement): boolean {
 if (current.dataset.focusRegion === SETTINGS_GROUPS_REGION) {
  if (direction === 'right') { current.click(); return true; }
  return false;
 }
 if (direction === 'left' && current.closest('.tv-settings-pane') && !chooseStructuredTarget(current, visibleFocusables(), 'left')) { focusSelectedGroup(); return true; }
 return false;
}

/** Back from a row returns to its group (before the shell opens the rail). Returns true when it handled Back. */
export function settingsBack(): boolean {
 const active = document.activeElement;
 if (!(active instanceof HTMLElement) || !active.closest('.tv-settings-pane')) return false;
 focusSelectedGroup();
 return true;
}

function focusSelectedGroup() {
 focusElement(document.querySelector<HTMLElement>('.tv-settings-groups button.selected'));
}

function firstRow(): HTMLElement | null {
 return visibleFocusables().filter(element => element.dataset.focusRegion === 'content' && element.closest('.tv-settings-pane'))
  .sort((a, b) => Number(a.dataset.focusRow) - Number(b.dataset.focusRow) || Number(a.dataset.focusCol) - Number(b.dataset.focusCol))[0] || null;
}

interface RowProps { focusKey: string; row: number; label: string; value?: string | JSX.Element; chevron?: 'right' | 'down'; class?: string; disabled?: boolean; busy?: boolean; expanded?: boolean; onClick: () => void }
function Row({ focusKey, row, label, value, chevron, class: extra, disabled, busy, expanded, onClick }: RowProps) {
 return <button class={extra ? `tv-setting-row ${extra}` : 'tv-setting-row'} disabled={disabled} aria-disabled={busy ? 'true' : undefined} aria-expanded={expanded} data-focus-region="content" data-focus-row={row} data-focus-col="0" data-focus-key={focusKey} onClick={onClick}>
  <span class="tv-setting-line"><span class="tv-setting-name">{label}</span>{(value || chevron) && <span class="tv-setting-value">{value}{chevron && <Icon name={`chevron-${chevron}`} class="tv-chevron" />}</span>}</span>
  {HELP[focusKey] && <span class="tv-setting-help">{HELP[focusKey]}</span>}
 </button>;
}

function Switch({ focusKey, row, label, on, managed, onToggle }: { focusKey: string; row: number; label: string; on: boolean; managed: boolean; onToggle: () => void }) {
 return <button class="tv-setting-row" role="switch" aria-checked={on ? 'true' : 'false'} disabled={managed} data-focus-region="content" data-focus-row={row} data-focus-col="0" data-focus-key={focusKey} onClick={onToggle}>
  <span class="tv-setting-line"><span class="tv-setting-name">{label}{managed && <small> · Environment managed</small>}</span><span class="tv-setting-value"><i class={`tv-switch ${on ? 'on' : ''}`} aria-hidden="true" /><b>{on ? 'On' : 'Off'}</b></span></span>
  {HELP[focusKey] && <span class="tv-setting-help">{HELP[focusKey]}</span>}
 </button>;
}

// A text or number field drawn as a row: the input carries focus and the value; the face behind it draws the
// row's fill and ring, and the help shows, through sibling selectors (no layout or script on focus).
function Field({ focusKey, row, label, value, managed, type, min, max, suffix, wide, onInput }: { focusKey: string; row: number; label: string; value: string; managed: boolean; type?: string; min?: string; max?: string; suffix?: string; wide?: boolean; onInput: (value: string) => void }) {
 return <div class={`tv-setting-row tv-setting-field ${wide ? 'wide' : ''}`}>
  <input aria-label={label} disabled={managed} type={type} min={min} max={max} data-focus-region="content" data-focus-row={row} data-focus-col="0" data-focus-key={focusKey} value={value} onInput={event => onInput(event.currentTarget.value)} />
  <span class="tv-setting-face" aria-hidden="true" />
  <span class="tv-setting-name">{label}{managed && <small> · Environment managed</small>}</span>
  {suffix && <span class="tv-setting-suffix">{suffix}</span>}
  <Icon name="chevron-right" class="tv-chevron" />
  {HELP[focusKey] && <span class="tv-setting-help">{HELP[focusKey]}</span>}
 </div>;
}

function Info({ label, value }: { label: string; value: string }) {
 return <div class="tv-setting-row tv-setting-info"><span class="tv-setting-line"><span class="tv-setting-name">{label}</span><span class="tv-setting-value">{value}</span></span></div>;
}

export interface TVSettingsProps {
 api: API;
 hasProjects?: boolean;
 projectCount?: number;
 jobs?: Job[];
 group?: SettingsGroupId;
 onGroup?: (group: SettingsGroupId) => void;
 onOpen?: (route: TVRoute) => void;
 onReload?: () => void;
 onChangeServer: () => void;
 onForgetServer: () => void;
 updateStatus: UpdateStatus | null;
 onUpdateStatus: (status: UpdateStatus) => void;
 confirmOpen: boolean;
 onConfirmOpen: () => void;
 onConfirmClose: () => void;
 rebuildConfirmOpen: boolean;
 onRebuildConfirmOpen: () => void;
 onRebuildConfirmClose: () => void;
}

export function TVSettings({ api, hasProjects = false, projectCount = 0, jobs = [], group: shownGroup, onGroup, onOpen, onReload, onChangeServer, onForgetServer, updateStatus, onUpdateStatus, confirmOpen, onConfirmOpen, onConfirmClose, rebuildConfirmOpen, onRebuildConfirmOpen, onRebuildConfirmClose }: TVSettingsProps) {
 // The selected group: kept by the shell (so a return from Background jobs opens its pane), else here.
 const [ownGroup, setOwnGroup] = useState<SettingsGroupId>('playback');
 const groups = settingsGroups(hasProjects);
 const wanted = shownGroup ?? ownGroup;
 const group = groups.some(item => item.id === wanted) ? wanted : 'playback';
 const [value, setValue] = useState<Record<string, unknown> | null>(null); const [managed, setManaged] = useState<Set<string>>(new Set());
 const [loadFailed, setLoadFailed] = useState(false); const [dirty, setDirty] = useState(false); const [message, setMessage] = useState('');
 const [trackers, setTrackers] = useState<TrackerStatus[] | null>(null);
 const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
 const [coverage, setCoverage] = useState<{ observed: number; seeded: number } | null>(null);
 const [fetchMessage, setFetchMessage] = useState(''); const [rebuildMessage, setRebuildMessage] = useState(''); const [rebuilding, setRebuilding] = useState(false);
 const [checking, setChecking] = useState(false); const [applying, setApplying] = useState(false); const [updateMessage, setUpdateMessage] = useState('');
 const settingsMounted = useRef(true);
 // Set when a group is opened with OK or Right: the cursor moves to its first row once the pane is drawn.
 const enterPane = useRef(false);
 useEffect(() => () => { settingsMounted.current = false; }, []);
 const openReleaseLink = async (url: string) => { const launched = await openExternalURL(url); if (!settingsMounted.current) return; if (!launched) setUpdateMessage('Open this address on another device: ' + url); };
 const refreshTrackers = () => {
  const promise = typeof api.trackers === 'function' ? api.trackers() : api.call<TrackerStatus[]>('/trackers');
  return promise.then(list => { if (settingsMounted.current) setTrackers(Array.isArray(list) ? list : null); }).catch(() => { if (settingsMounted.current) setTrackers(null); });
 };
 const loadSettings = () => {
  setLoadFailed(false);
  Promise.all([api.call<Record<string, unknown>>('/settings'), api.call<{ items: SettingsField[] }>('/settings/schema')]).then(([settings, schema]) => {
   if (!settingsMounted.current) return;
   setValue(settings);
   setManaged(new Set(schema.items.filter(field => field.readOnly).map(field => field.key)));
   setMessage('');
  }).catch(() => { if (settingsMounted.current) setLoadFailed(true); });
 };
 useEffect(() => { loadSettings(); void refreshTrackers(); }, []);
 // What runs now, for the Background jobs status (the shell's job list is only a snapshot from startup).
 const [liveJobs, setLiveJobs] = useState<Job[] | null>(null);
 useEffect(() => { if (typeof api.jobs !== 'function') return; api.jobs({ state: 'running', pageSize: 24 }).then(page => { if (settingsMounted.current && page && Array.isArray(page.items)) setLiveJobs(page.items) }).catch(() => { }) }, []);
 // Read-only catalog coverage; a failed or malformed answer just leaves it out.
 useEffect(() => { api.call<Record<string, unknown>>('/catalog/status').then(status => { const observed = Number(status?.observedReleases); const seeded = Number(status?.discoverableReleases); if (settingsMounted.current && Number.isFinite(observed) && Number.isFinite(seeded)) setCoverage({ observed, seeded }) }).catch(() => { }) }, []);
 useEffect(() => {
  if (!updateStatus?.applying) return;
  const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>('[data-focus-key="update-check"]')), 0);
  return () => window.clearTimeout(timer);
 }, [updateStatus?.applying]);
 useEffect(() => {
  if (!enterPane.current) return;
  const row = firstRow();
  if (row) { enterPane.current = false; focusElement(row); }
 });
 const choose = (id: SettingsGroupId) => { enterPane.current = true; if (onGroup) onGroup(id); else setOwnGroup(id); if (id === group) { const row = firstRow(); if (row) { enterPane.current = false; focusElement(row); } } };
 const edit = (patch: Record<string, unknown>) => { if (!value) return; setValue({ ...value, ...patch }); setDirty(true); };
 async function save() {
  if (!value) return;
  const out = { ...value };
  Object.keys(out).filter(key => key.endsWith('Configured') || key === 'settingsPath' || key === 'engineRunning').forEach(key => delete out[key]);
  try {
   await api.call('/settings', { method: 'PUT', body: JSON.stringify(out) });
   setDirty(false);
   setMessage('Settings saved. Restart the server to apply worker-limit changes.');
   void refreshTrackers();
  } catch (error) {
   setMessage('Settings were not saved. Check the values, then choose Save again.');
  }
 }
 async function test(name: string) { const label = TEST_NAMES[name] || name; setMessage(`Testing ${label}…`); try { const result = await api.call<{ message: string }>(`/dependencies/${name}/test`, { method: 'POST' }); setMessage(result.message) } catch (error) { setMessage(`The ${label} test failed. Check its settings in the browser Settings.`) } }
 async function fetchLatest() { setFetchMessage('Queuing…'); try { const job = await api.syncCatalog('latest'); if (settingsMounted.current) setFetchMessage(`${job.label} queued. Follow it in Background jobs.`) } catch (error) { if (settingsMounted.current) setFetchMessage('Fetch latest could not start. Try again in a minute.') } }
 async function rebuildCatalog() { if (rebuilding) return; setRebuilding(true); try { const job = await api.syncCatalog('rebuild'); if (settingsMounted.current) setRebuildMessage(`${job.label} queued. Follow it in Background jobs.`) } catch (error) { if (settingsMounted.current) setRebuildMessage('Rebuild catalog could not start. Try again in a minute.') } finally { if (settingsMounted.current) setRebuilding(false); onRebuildConfirmClose() } }
 async function checkUpdate() {
  if (checking) return;
  setChecking(true); setUpdateMessage('Checking for updates…');
  try { const next = await api.call<UpdateStatus>('/updates/check', { method: 'POST' }); onUpdateStatus(next); setUpdateMessage(next.available ? `Version ${next.latest} is available.` : 'The server is up to date.') } catch (error) { setUpdateMessage('The update check failed. Try again later.') } finally { setChecking(false) }
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
   setUpdateMessage(outcome === 'conflict' ? 'The server refused the update for now. Try again when nothing is downloading.' : 'The update could not start. Try again later.');
  } finally { setApplying(false); onConfirmClose() }
 }
 const allDisabled = Boolean(trackers && trackers.length > 0 && trackers.every(item => !item.enabled));
 const host = (() => { try { return new URL(api.base).host } catch { return '' } })();
 const knownJobs = liveJobs || jobs;
 const running = knownJobs.filter(job => job.state === 'running').length;
 let next = FIRST_ROW; const at = () => next++;
 const locked = (key: string) => managed.has(key);
 const status = (text: string) => <p class="tv-setting-status" role="status">{text}</p>;
 // The rows of the groups that edit settings wait for them; a failed load is one sentence and Try again.
 const needsValue = (rows: (value: Record<string, unknown>) => JSX.Element) => value ? rows(value) : loadFailed
  ? <><p class="tv-setting-note">Settings could not be loaded from the server.</p><Row focusKey="settings-retry" row={at()} label="Try again" onClick={loadSettings} /></>
  : <p class="tv-setting-note">Loading settings…</p>;
 const saveRow = () => <Row focusKey="settings-save" row={at()} label="Save" value={dirty ? 'Unsaved changes' : 'Saved'} class="primary" onClick={() => void save()} />;
 const panes: Record<SettingsGroupId, () => JSX.Element> = {
  playback: () => <>{needsValue(v => <>
   <Field focusKey="setting-audio-primary" row={at()} label="Audio language" value={String(v.preferredAudioLanguage || 'en')} managed={locked('preferredAudioLanguage')} onInput={text => edit({ preferredAudioLanguage: text })} />
   <Field focusKey="setting-subtitle-primary" row={at()} label="Subtitle language" value={String(v.preferredSubtitleLanguage || '')} managed={locked('preferredSubtitleLanguage')} onInput={text => edit({ preferredSubtitleLanguage: text })} />
   <Field focusKey="setting-subtitle-fallback" row={at()} label="Fallback subtitle language" value={String(v.fallbackSubtitleLanguage || '')} managed={locked('fallbackSubtitleLanguage')} onInput={text => edit({ fallbackSubtitleLanguage: text })} />
   <Field focusKey="setting-watched" row={at()} label="Mark as watched at" type="number" suffix="%" value={String(v.watchedThresholdPercent || 90)} managed={locked('watchedThresholdPercent')} onInput={text => edit({ watchedThresholdPercent: Number(text) })} />
   {saveRow()}
  </>)}{status(message)}</>,
  trackers: () => <>{needsValue(v => <>
   <Switch focusKey="setting-filelist-enabled" row={at()} label="FileList" on={Boolean(v.fileListEnabled)} managed={locked('fileListEnabled')} onToggle={() => edit({ fileListEnabled: !v.fileListEnabled })} />
   <Switch focusKey="setting-piratebay-enabled" row={at()} label="The Pirate Bay" on={Boolean(v.pirateBayEnabled)} managed={locked('pirateBayEnabled')} onToggle={() => edit({ pirateBayEnabled: !v.pirateBayEnabled })} />
   <div class="tv-tracker-readiness">{trackers === null ? <span class="tv-tracker-chip disabled">Trackers unavailable</span> : trackers.map(t => <span key={t.id} class={`tv-tracker-chip ${!t.enabled ? 'disabled' : t.configured ? 'ready' : 'setup'}`}>{t.name} · {!t.enabled ? 'off' : t.configured ? 'ready' : 'needs setup'}</span>)}{allDisabled && <span class="tv-tracker-zero-note">No tracker is on; Downloads stay reachable.</span>}</div>
   <Field focusKey="setting-piratebay-website" row={at()} label="Pirate Bay website" wide value={String(v.pirateBayWebsiteUrl || '')} managed={locked('pirateBayWebsiteUrl')} onInput={text => edit({ pirateBayWebsiteUrl: text })} />
   <Field focusKey="setting-piratebay-api" row={at()} label="Pirate Bay API" wide value={String(v.pirateBayApiUrl || '')} managed={locked('pirateBayApiUrl')} onInput={text => edit({ pirateBayApiUrl: text })} />
   <p class="tv-setting-note">Selection controls new acquisitions. Existing downloads keep the engine that owns them.{engineFeedback(v)}</p>
   {saveRow()}
  </>)}{status(message)}</>,
  catalog: () => <>
   {coverage && <Info label="Releases kept" value={`${coverage.observed.toLocaleString('en-US')} · ${coverage.seeded.toLocaleString('en-US')} seeded now`} />}
   <Row focusKey="catalog-fetch-latest" row={at()} label="Fetch latest" class="primary" onClick={() => void fetchLatest()} />
   {status(fetchMessage)}
  </>,
  server: () => <>
   {host && <Info label="Connected server" value={host} />}
   <Row focusKey="settings-reload" row={at()} label="Reload library" onClick={() => onReload?.()} />
   <Row focusKey="change-server" row={at()} label="Change server address" chevron="right" onClick={onChangeServer} />
   <Row focusKey="forget-server" row={at()} label="Forget this server" onClick={onForgetServer} />
   <Row focusKey="settings-diagnostics" row={at()} label="Connection tests" value={diagnosticsOpen ? 'Hide' : 'Show'} chevron="down" expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen(open => !open)} />
   {diagnosticsOpen && <div class="tv-test-buttons">{['filelist', 'qbittorrent', 'storage', 'ffmpeg', 'ffprobe', 'tmdb', 'subdl', 'piratebay'].map((name, index) => { const row = index % 4 === 0 ? at() : next - 1; return <button data-focus-region="content" data-focus-row={row} data-focus-col={index % 4} data-focus-key={`test-${name}`} onClick={() => void test(name)}>Test {TEST_NAMES[name] || name}</button> })}</div>}
   {status(message)}
  </>,
  jobs: () => <>
   <Row focusKey="settings-jobs" row={at()} label="Background jobs" value={running ? `${running} running` : 'Nothing running'} chevron="right" onClick={() => onOpen?.('jobs')} />
   {needsValue(v => <>
    <Field focusKey="setting-workers" row={at()} label="Jobs at once" type="number" min="1" max="20" value={String(v.maxConcurrentJobs || 10)} managed={locked('maxConcurrentJobs')} onInput={text => edit({ maxConcurrentJobs: Number(text) })} />
    <Field focusKey="setting-title-timeout" row={at()} label="Title refresh timeout" type="number" min="5" max="120" suffix="min" value={String(v.titleRefreshTimeoutMinutes || 30)} managed={locked('titleRefreshTimeoutMinutes')} onInput={text => edit({ titleRefreshTimeoutMinutes: Number(text) })} />
    {saveRow()}
   </>)}{status(message)}
  </>,
  updates: () => <>
   {updateStatus ? <Info label={`Version ${updateStatus.currentVersion}`} value={updateStatus.applying ? 'Installing an update' : updateStatus.available ? 'Update available' : updateStatus.selfUpdate ? 'Up to date' : 'Updates by hand'} /> : <p class="tv-setting-note">The server did not say which version it runs.</p>}
   {updateStatus && updateNoticeVisible(updateStatus) && <Row focusKey="update-release-link" row={at()} label={updateStatus.available ? `Version ${updateStatus.latest} is available` : 'This server updates only by hand'} value={updateStatus.releasesUrl} onClick={() => void openReleaseLink(updateStatus.releasesUrl)} />}
   <Row focusKey="update-check" row={at()} label="Check for updates" busy={checking} onClick={() => void checkUpdate()} />
   <Row focusKey="update-apply" row={at()} label={updateStatus?.applying || applying ? 'Installing…' : 'Install server update'} disabled={updateApplyDisabled(updateStatus, applying)} onClick={onConfirmOpen} />
   {status(updateMessage)}
  </>,
  projects: () => <Row focusKey="settings-projects" row={at()} label="Other projects" value={projectCount ? `${projectCount} ${projectCount === 1 ? 'site' : 'sites'}` : ''} chevron="right" onClick={() => onOpen?.('projects')} />,
  danger: () => <>
   <p class="tv-setting-note">Troubleshooting only. Rebuild catalog refreshes every enabled category's window and rebuilds the local projections. Use it only when something is broken.</p>
   <Row focusKey="catalog-rebuild" row={at()} label="Rebuild catalog" class="danger-button" onClick={onRebuildConfirmOpen} />
   {status(rebuildMessage)}
  </>,
 };
 const facts = { trackers, coverage, host, jobs: knownJobs, update: updateStatus };
 const label = groups.filter(item => item.id === group)[0].label;
 return <section class="tv-settings-page">
  <nav class="tv-settings-groups" aria-label="Settings groups">{groups.map((item, index) => { const note = groupNote(item.id, facts); return <button class={item.id === group ? 'selected' : ''} aria-current={item.id === group ? 'true' : undefined} data-settings-group={item.id} data-focus-region={SETTINGS_GROUPS_REGION} data-focus-row={1 + index} data-focus-col="0" data-focus-key={`settings-group-${item.id}`} onClick={() => choose(item.id)}><span>{item.label}</span>{note.text && <small class={note.attention ? 'attention' : ''}>{note.text}</small>}</button> })}</nav>
  <section class={`tv-settings-pane tv-settings-pane-${group}`} data-settings-pane={group} aria-label={label}><h2>{label}</h2>{panes[group]()}</section>
  {confirmOpen && updateStatus && <section role="dialog" aria-modal="true" aria-labelledby="tv-update-confirm-heading" class="tv-settings tv-update-confirm"><h2 id="tv-update-confirm-heading">Install version {updateStatus.latest}?</h2><p>The server downloads the release, installs it, and restarts. Playback is interrupted on every connected device, including this TV.</p><div><button data-focus-region={UPDATE_DIALOG_REGION} data-focus-row="0" data-focus-col="0" data-focus-key="update-confirm-cancel" onClick={onConfirmClose}>Cancel</button><button class="danger-button" data-focus-region={UPDATE_DIALOG_REGION} data-focus-row="0" data-focus-col="1" data-focus-key="update-confirm-apply" disabled={applying} onClick={() => void applyUpdate()}>{applying ? 'Starting…' : 'Install and restart'}</button></div></section>}
  {rebuildConfirmOpen && <section role="dialog" aria-modal="true" aria-labelledby="tv-rebuild-confirm-heading" class="tv-settings tv-rebuild-confirm"><h2 id="tv-rebuild-confirm-heading">Rebuild the catalog?</h2><p>This refreshes every enabled category's latest window and rebuilds the local projections over everything ever observed. It is slow and puts heavy load on your trackers and the server, so run it only when something is broken. Nothing is removed; follow the job in Background jobs.</p><div><button data-focus-region={REBUILD_DIALOG_REGION} data-focus-row="0" data-focus-col="0" data-focus-key="rebuild-confirm-cancel" onClick={onRebuildConfirmClose}>Cancel</button><button class="danger-button" data-focus-region={REBUILD_DIALOG_REGION} data-focus-row="0" data-focus-col="1" data-focus-key="rebuild-confirm-apply" disabled={rebuilding} onClick={() => void rebuildCatalog()}>{rebuilding ? 'Starting…' : 'Rebuild now'}</button></div></section>}
 </section>;
}

