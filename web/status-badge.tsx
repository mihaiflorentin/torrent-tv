// A status is always a word plus an icon, never color alone (DESIGN.md "Palette").
import { Icon } from './icons';
import type { StatusTone } from './presentation';

const TONE_ICON: Record<StatusTone, string> = { ok: 'check', busy: 'refresh', warn: 'alert', danger: 'alert', idle: 'clock' };

export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return <span class={`status-badge tone-${tone}`}><Icon name={TONE_ICON[tone]} />{label}</span>;
}
