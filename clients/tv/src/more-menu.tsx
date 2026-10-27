import { render, type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { focusElement, remoteAction } from './navigation';

// The More menu: a solid sheet in the Player-panel style for a screen's secondary actions (Refresh data on a title
// page; Delete download, Details and Show files on Downloads). It owns its own focus region, so the D-pad cannot
// leave it: one column of rows, then Close. Back (the key, or Close) shuts it and puts focus back on the button that
// opened it. A busy row keeps focus (aria-disabled) and says what it is doing; a failure is one sentence in the sheet.

export const MORE_REGION = 'more-menu';

export interface MoreItem {
  /** Focus key suffix: the row is `more-<key>`. */
  key: string;
  label: string;
  /** One short line under the label: what the action does. */
  detail?: string;
  busy?: boolean;
  busyLabel?: string;
  danger?: boolean;
  onSelect: () => void;
}

export function MoreMenu({ title, items, message, returnKey, onClose }: { title: string; items: MoreItem[]; message?: string; returnKey: string; onClose: () => void }): JSX.Element {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => {
    closeRef.current();
    window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`[data-focus-key="${returnKey}"]`)), 0);
  };
  const closeOnce = useRef(close);
  closeOnce.current = close;
  useEffect(() => {
    const timer = window.setTimeout(() => focusElement(document.querySelector<HTMLElement>(`.tv-more [data-focus-region="${MORE_REGION}"]`)), 0);
    const key = (event: KeyboardEvent) => {
      if (remoteAction(event.key, event.keyCode) !== 'back') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOnce.current();
    };
    document.addEventListener('keydown', key, true);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key, true) };
  }, []);
  return <section role="dialog" aria-modal="true" aria-labelledby="tv-more-heading" class="tv-more">
    <div class="tv-more-sheet">
      <h2 id="tv-more-heading">{title}</h2>
      {items.map((item, index) => <button class={item.danger ? 'tv-more-row danger-button' : 'tv-more-row'} aria-disabled={item.busy ? 'true' : undefined} data-focus-region={MORE_REGION} data-focus-row={index} data-focus-col="0" data-focus-key={`more-${item.key}`} onClick={() => { if (!item.busy) item.onSelect() }}>
        <b>{item.busy ? item.busyLabel || `${item.label}…` : item.label}</b>
        {item.detail && <small>{item.detail}</small>}
      </button>)}
      {message && <p class="tv-more-message" role="alert">{message}</p>}
      <button class="tv-more-row tv-more-close" data-focus-region={MORE_REGION} data-focus-row={items.length} data-focus-col="0" data-focus-key="more-close" onClick={close}><b>Close</b></button>
    </div>
  </section>;
}

/**
 * The More sheet drawn into its own layer on <body>, for a screen that lives inside the shell's content column
 * (Downloads). That column scrolls and is contained (contain: layout paint), so a fixed sheet inside it would be
 * placed and clipped by the column instead of the screen. The layer follows every render of its host and goes away
 * with it.
 */
export function MoreMenuLayer(props: Parameters<typeof MoreMenu>[0]): null {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const layer = document.createElement('div');
    layer.className = 'tv-more-layer';
    document.body.appendChild(layer);
    host.current = layer;
    return () => { render(null, layer); document.body.removeChild(layer); host.current = null };
  }, []);
  useEffect(() => { if (host.current) render(<MoreMenu {...props} />, host.current) });
  return null;
}
