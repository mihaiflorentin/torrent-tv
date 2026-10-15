import { formatBytes, type Download } from './index';

// "Getting ready" wording shared by the web and TV clients. Pure text: an unknown fact is omitted, never a placeholder.

const joined = (parts: string[]) => parts.filter(Boolean).join(' · ');

/** Time left as a calm phrase ("12 min left"); empty when unknown. */
export function formatEtaLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s left`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(total / 3600);
  const rest = Math.round(total % 3600 / 60);
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

/** Percent of the download, 0 to 100. */
export function readyPercent(download: Pick<Download, 'progress'> | undefined): number {
  return download ? Math.round(Math.max(0, Math.min(1, download.progress || 0)) * 100) : 0;
}

/** Peers, speed, time left. A part that is not known yet is left out. */
export function readyLine(download: Pick<Download, 'peers' | 'speedBytesPerSecond' | 'etaSeconds'>): string {
  const peers = download.peers > 0 ? `${download.peers} peer${download.peers === 1 ? '' : 's'}` : '';
  return joined([peers, download.speedBytesPerSecond > 0 ? `${formatBytes(download.speedBytesPerSecond)}/s` : '', formatEtaLeft(download.etaSeconds)]);
}

/** One calm sentence once Prepare has taken 15 seconds; nothing before that. */
export function prepareHint(elapsedSeconds: number, seeders?: number): string {
  if (elapsedSeconds < 15) return '';
  return seeders && seeders > 0 ? `Still looking for peers. This release has ${seeders} seeder${seeders === 1 ? '' : 's'}, so it can take a little longer.` : 'Still looking for peers. It can take a little longer.';
}
