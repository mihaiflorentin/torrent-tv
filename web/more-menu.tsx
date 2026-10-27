import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

// The More menu (#63): a round icon button that opens a short list of secondary or destructive
// actions, by the same rules as the TV boards (Refresh data on the title overlay, Delete download on
// a Downloads card). Opening moves focus to the first item; Up and Down move between items; Escape
// closes only the menu (the overlay behind it stays) and hands focus back to the button, as does
// choosing an item. A press outside the menu closes it without moving focus.

export type MoreItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

export function MoreMenu({ items, label = 'More actions' }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuItems = () => Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') || []);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus() };

  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus();
    const outside = (event: Event) => { if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false) };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab') { setOpen(false); return }
    const list = menuItems();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    list[(next + list.length) % list.length].focus();
  };

  return <div class="more-menu" ref={wrap} onKeyDown={open ? onKey : undefined}>
    <button type="button" ref={trigger} class="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name="more" /></button>
    {open && <div class="more-menu-list" role="menu" aria-label={label}>{items.map(item => <button type="button" role="menuitem" key={item.label} class={item.danger ? 'danger-button' : ''} disabled={item.disabled} onClick={() => { close(true); item.onSelect() }}>{item.label}</button>)}</div>}
  </div>;
}
