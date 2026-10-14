// The Downloads view: search/filter/sort toolbar, one card per torrent
// (episode files of the same engine route grouped), and the removal
// confirms. Extracted verbatim from src.tsx so the desktop GUI can mount
// it; data flows in through props and action callbacks, so the component
// needs no API client of its own. The modal focus machinery below is
// duplicated from src.tsx (pending a shared module) because the removal
// confirm owns an Escape-closable overlay.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Download, DownloadSort, downloadTransferActions, DownloadTransferAction, formatBytes, groupDownloadsByTorrent, orderDownloadIDs } from '@torrent-tv/shared';
import { Icon } from './icons';
import { downloadDetails, downloadFacts, downloadStatus, type DownloadTone } from './presentation';
import { TrackerBadge } from './tracker-badge';

// Canonical reconcileDownloads lives in @torrent-tv/shared; re-exported here
// so desktop consumers resolve it from this module alongside the view.
export { reconcileDownloads } from '@torrent-tv/shared';

type ViewportAnchor = { id: string; top: number };
export function captureDownloadAnchor(): ViewportAnchor | null { const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-download-id]')); const row = rows.find(item => item.getBoundingClientRect().bottom > 0); return row ? { id: row.dataset.downloadId || '', top: row.getBoundingClientRect().top } : null }
export function restoreDownloadAnchor(anchor: ViewportAnchor | null) { if (!anchor) return; const row = document.querySelector<HTMLElement>(`[data-download-id="${CSS.escape(anchor.id)}"]`); if (!row) return; const delta = row.getBoundingClientRect().top - anchor.top; if (Math.abs(delta) > 0.5) window.scrollBy(0, delta) }

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

const TONE_ICON: Record<DownloadTone, string> = { active: 'download', paused: 'pause', error: 'alert', done: 'check', idle: 'clock' };
type PendingRemoval = { download: Download; scope: 'torrent' | 'file' };
export function Downloads({ items, onRefresh, onPlay, onRemove, onRemoveFile, onAction }: { items: Download[]; onRefresh: () => void; onPlay: (d: Download) => void; onRemove: (d: Download) => Promise<void>; onRemoveFile: (d: Download) => Promise<void>; onAction: (d: Download, action: DownloadTransferAction) => Promise<void> }) {
  const [pending, setPending] = useState<PendingRemoval | null>(null); const [removing, setRemoving] = useState(false); const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [sort, setSort] = useState<DownloadSort>('recent'); const [order, setOrder] = useState<string[]>(() => orderDownloadIDs(items, 'recent')); useOverlayFocus(Boolean(pending), () => { if (!removing) setPending(null) });
  const [busy, setBusy] = useState(''); const runAction = async (download: Download, action: DownloadTransferAction) => { const key = `${download.id}:${action}`; if (busy) return; setBusy(key); try { await onAction(download, action) } catch { } finally { setBusy('') } };
  const idsKey = items.map(item => item.id).join('\u0000');
  useEffect(() => setOrder(current => { const available = new Set(items.map(item => item.id)); const retained = current.filter(id => available.has(id)); const known = new Set(retained); const added = items.filter(item => !known.has(item.id)).map(item => item.id); return [...added, ...retained] }), [idsKey]);
  const changeSort = (next: DownloadSort) => { setSort(next); setOrder(orderDownloadIDs(items, next)) };
  const visible = useMemo(() => { const term = query.trim().toLocaleLowerCase(); const byID = new Map(items.map(item => [item.id, item])); const ordered = (order.length ? order : items.map(item => item.id)).map(id => byID.get(id)).filter((item): item is Download => Boolean(item)); return ordered.filter(download => { const text = [download.displayTitle, download.releaseName, download.filePath, download.category, download.state, download.trackerName].filter(Boolean).join(' ').toLocaleLowerCase(); const matchesFilter = filter === 'all' || filter === 'streaming' && download.playbackMode === 'progressive' || filter === 'complete' && download.playbackMode === 'local' || filter === 'paused' && /^(paused|stopped)/.test(download.state.toLocaleLowerCase()) || filter === 'errors' && Boolean(download.error); return (!term || text.includes(term)) && matchesFilter }) }, [items, order, query, filter]);
  // One card per physical torrent: predicates stay per-row, a group shows
  // when any of its rows matches, and the expanded file list carries the
  // rows that passed the filter.
  const groups = useMemo(() => groupDownloadsByTorrent(visible), [visible]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(() => new Set());
  const toggleDetails = (id: string) => setDetailsOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next });
  const toggleFiles = (engineId: string) => setExpandedGroups(current => { const next = new Set(current); if (next.has(engineId)) next.delete(engineId); else next.add(engineId); return next });
  const confirmRemoval = async () => { if (!pending || removing) return; setRemoving(true); try { await (pending.scope === 'file' ? onRemoveFile : onRemove)(pending.download); setPending(null) } finally { setRemoving(false) } };
  return <section><div class="catalog-tools download-tools"><div class="tools-primary"><label class="search"><Icon name="search" /><input value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search downloaded titles" aria-label="Search downloads" /></label><select value={filter} onChange={event => setFilter(event.currentTarget.value)} aria-label="Filter downloads"><option value="all">All downloads</option><option value="streaming">Still downloading</option><option value="complete">Downloaded</option><option value="paused">Paused</option><option value="errors">Needs attention</option></select></div><div class="tools-secondary"><select value={sort} onChange={event => changeSort(event.currentTarget.value as DownloadSort)} aria-label="Sort downloads"><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="progress">Most progress</option><option value="size">Largest file</option><option value="speed">Fastest download</option></select><button onClick={onRefresh}>Refresh</button><span class="tools-count" aria-live="polite">{groups.length} of {items.length} downloads shown</span></div></div><div class="download-list">{groups.length === 0 ? (items.length === 0 ? <div class="empty-state"><h2>No downloads yet</h2><p>Play or download a title and it appears here with its progress.</p></div> : <div class="empty-state"><h2>No downloads match</h2><p>Clear the search or choose All downloads to see the rest.</p></div>) : groups.map(group => { const download = group.representative; const status = downloadStatus(download); const expanded = expandedGroups.has(download.engineId); const open = detailsOpen.has(download.id); const multi = group.rows.length > 1; const facts = downloadFacts(download); if (multi) facts[0] = `${group.rows.length} files · ${formatBytes(group.totalSizeBytes)}`; return <article key={download.id} data-download-id={download.id} data-tone={status.tone}><div class="download-identity"><h2 title={download.displayTitle || download.filePath}>{download.displayTitle || download.filePath}</h2><p class="download-state"><Icon name={TONE_ICON[status.tone]} />{status.line}</p>{status.tone !== 'done' && <progress value={download.progress} max="1" aria-label="Download progress" />}{download.error && <p class="download-error" role="status">{download.error}</p>}<p class="download-facts">{facts.map(fact => <span key={fact}>{fact}</span>)}{(download.trackerName || download.trackerId) && <TrackerBadge id={download.trackerId} name={download.trackerName} />}{multi && <button class="files-toggle" aria-expanded={expanded} onClick={() => toggleFiles(download.engineId)}>{expanded ? 'Hide files' : 'Show files'}</button>}</p>{multi && expanded && <ul class="download-files">{group.rows.map(row => <li key={row.id}><span class="download-file-title" title={row.displayTitle || row.filePath}>{row.displayTitle || row.filePath}</span><span class="download-file-size">{formatBytes(row.sizeBytes)}</span><span class="download-file-actions"><button onClick={() => onPlay(row)}>Play</button><button class="danger-button" onClick={() => setPending({ download: row, scope: 'file' })}>Remove</button></span></li>)}</ul>}<button type="button" class="details-toggle" aria-expanded={open} aria-controls={`download-details-${download.id}`} onClick={() => toggleDetails(download.id)}>{open ? 'Hide details' : 'Details'}</button>{open && <dl class="download-details" id={`download-details-${download.id}`}>{downloadDetails(download).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</div><div class="download-actions"><button class="primary" onClick={() => onPlay(download)}>Play</button>{downloadTransferActions(download).map(item => <button key={item.action} disabled={busy.startsWith(download.id + ':')} onClick={() => void runAction(download, item.action)}>{busy === download.id + ':' + item.action ? item.pendingLabel : item.label}</button>)}<button class="danger-button" onClick={() => setPending({ download, scope: 'torrent' })}>Delete download</button></div></article> })}</div>{pending && <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="web-download-delete-heading"><section class="removal-confirm">{pending.scope === 'file' ? <><h2 id="web-download-delete-heading">Remove episode from downloads?</h2><p class="release-name">{pending.download.displayTitle || pending.download.filePath}</p><p>The episode leaves the download list. Its file stays on disk until the whole torrent is deleted.</p></> : <><h2 id="web-download-delete-heading">Delete download?</h2><p class="release-name">{pending.download.displayTitle || pending.download.releaseName || pending.download.filePath}</p><dl><div><dt>File</dt><dd>{pending.download.filePath}</dd></div><div><dt>Tracker</dt><dd><TrackerBadge id={pending.download.trackerId} name={pending.download.trackerName} /></dd></div><div><dt>Size</dt><dd>{formatBytes(pending.download.sizeBytes)}</dd></div></dl><p>This removes the torrent from qBittorrent and permanently deletes its incomplete and downloaded files.</p></>}<div class="confirm-actions"><button disabled={removing} onClick={() => setPending(null)}>Cancel</button><button class="danger-button" disabled={removing} onClick={() => void confirmRemoval()}>{removing ? (pending.scope === 'file' ? 'Removing…' : 'Deleting…') : pending.scope === 'file' ? 'Remove episode' : 'Delete download'}</button></div></section></div>}</section>
}
