import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type Download, type MediaInfo, type PlaybackPreferences } from '@torrent-tv/shared';
import { BrowserPlayer } from './src';

// The Player shows the getting-ready panel while the stream opens or buffers, and removes it once playback runs.

const movie: Download = {
  id: 'dl-1', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', engineId: 'qb:x', fileIndex: 0, filePath: 'a.mkv', displayTitle: 'Severance',
  mimeType: 'video/x-matroska', sizeBytes: 1000, state: 'downloading', progress: 0.37, downloadedBytes: 370,
  speedBytesPerSecond: 2_100_000, etaSeconds: 240, peers: 12, seeds: 9, leased: false, streamUrl: '/api/v1/streams/dl-1', playbackMode: 'progressive',
};
const preferences: PlaybackPreferences = { audioLanguage: 'en', audioTrackIndex: -1, subtitleLanguage: 'ro', subtitleMode: 'off' };
const mediaInfo = { durationMs: 600_000, audioTracks: [{ streamIndex: 0, codec: 'aac', default: true, language: 'en' }] } as MediaInfo;

const memoryStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });

const hosts: HTMLElement[] = [];
let resolveInfo: (info: MediaInfo) => void;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(API.prototype, 'mediaInfo').mockImplementation(() => new Promise<MediaInfo>(resolve => { resolveInfo = resolve }));
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [movie], nextCursor: null, total: 1 });
  vi.spyOn(API.prototype, 'subtitles').mockResolvedValue({ items: [], warnings: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'updatePlayback').mockResolvedValue({} as never);
  vi.spyOn(API.prototype, 'updatePlaybackPreferences').mockImplementation((_id: string, value: PlaybackPreferences) => Promise.resolve(value));
});
afterEach(() => {
  vi.restoreAllMocks();
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => {
    render(<BrowserPlayer active={{ download: movie, resumeMs: 0, preferences }} onClose={vi.fn()} onStateChanged={vi.fn()} onAdvance={vi.fn()} />, host);
  });
  await act(async () => { });
  return host;
}
const fire = async (host: HTMLElement, name: string) => { await act(async () => { host.querySelector('video')!.dispatchEvent(new Event(name)) }) };

describe('Player getting ready panel', () => {
  it('shows progress while the media details are still being read', async () => {
    const host = await mount();
    const panel = host.querySelector<HTMLElement>('.player-ready')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Severance');
    expect(panel.textContent).toContain('37%');
    expect(panel.textContent).toContain('12 peers · 2.1 MB/s · 4 min left');
  });

  it('goes away once playback is running and comes back when it stalls', async () => {
    const host = await mount();
    await act(async () => { resolveInfo(mediaInfo) });
    await fire(host, 'playing');
    expect(host.querySelector('.player-ready')).toBeNull();
    await fire(host, 'waiting');
    expect(host.querySelector('.player-ready')).not.toBeNull();
    await fire(host, 'canplay');
    expect(host.querySelector('.player-ready')).toBeNull();
  });
});
