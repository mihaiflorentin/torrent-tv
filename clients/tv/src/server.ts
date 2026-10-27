// What the TV says about the server it is connected to, shared by the shell (the rail foot, the tracker
// banner) and Settings.
import type { API, TrackerStatus } from '@torrent-tv/shared';

/** The server's host and port as the viewer typed or discovered it ("192.168.1.20:8097"); '' when the address does not parse. */
export function serverHost(base: string): string {
  try { return new URL(base).host; } catch (error) { return ''; }
}

/** The trackers and whether each is on and set up; null when the server cannot say. Older test doubles have only `call`. */
export function trackerStatuses(api: API): Promise<TrackerStatus[] | null> {
  const request = typeof api.trackers === 'function' ? api.trackers() : api.call<TrackerStatus[]>('/trackers');
  return Promise.resolve(request).then(list => (Array.isArray(list) ? list : null), () => null);
}
