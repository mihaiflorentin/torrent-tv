import { render } from 'preact';
import { act } from 'preact/test-utils';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type Download, type MediaInfo, type PlaybackPreferences } from '@torrent-tv/shared';
import { BrowserPlayer } from './src';
import { resolveShortcut } from './shortcuts';

const movie: Download = {
  id: 'dl-1', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', engineId: 'qb:x', fileIndex: 0, filePath: 'a.mkv',
  mimeType: 'video/x-matroska', sizeBytes: 1, state: 'downloading', progress: 0.1,
  downloadedBytes: 0, speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0,
  leased: false, streamUrl: '/api/v1/streams/dl-1', playbackMode: 'progressive',
};
const series: Download = { ...movie, parsed: { title: 'Show', sortTitle: 'show', kind: 'series', seasonStart: 1, episodeStart: 2 } };
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
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(API.prototype, 'mediaInfo').mockResolvedValue(mediaInfo);
  vi.spyOn(API.prototype, 'subtitles').mockResolvedValue({ items: [], warnings: [], nextCursor: null, total: 0 });
  vi.spyOn(API.prototype, 'updatePlayback').mockResolvedValue({} as never);
  vi.spyOn(API.prototype, 'updatePlaybackPreferences').mockImplementation((_id: string, value: PlaybackPreferences) => Promise.resolve(value));
});
afterEach(() => {
  vi.restoreAllMocks();
  while (hosts.length) render(null, hosts.pop()!);
  document.body.innerHTML = '';
});

async function mount(download: Download, onSkip?: Mock) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => {
    render(<BrowserPlayer active={{ download, resumeMs: 0, preferences }} onClose={vi.fn()} onStateChanged={vi.fn()} onAdvance={vi.fn()} onSkip={onSkip} />, host);
  });
  await act(async () => { });
  return host;
}
const button = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const press = async (host: HTMLElement, key: string) => { await act(async () => { host.querySelector('.video')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) }); await act(async () => { await new Promise(r => setTimeout(r, 0)) }) };

describe('shortcut bindings', () => {
  it('binds N and P to episode skips, single-fire', () => {
    expect(resolveShortcut('n', false, false)?.command).toEqual({ kind: 'next-episode' });
    expect(resolveShortcut('P', false, false)?.command).toEqual({ kind: 'previous-episode' });
    expect(resolveShortcut('n', true, false)).toBeNull();
  });
});

describe('episode buttons', () => {
  it('appear for series only', async () => {
    const onSkip = vi.fn().mockResolvedValue(true);
    expect(button(await mount(movie, onSkip), 'Next episode')).toBeNull();
    const host = await mount(series, onSkip);
    expect(button(host, 'Next episode')).not.toBeNull();
    expect(button(host, 'Previous episode')).not.toBeNull();
  });

  it('click saves progress then asks the app to skip', async () => {
    const onSkip = vi.fn().mockResolvedValue(true);
    const host = await mount(series, onSkip);
    await act(async () => { button(host, 'Previous episode')!.click() });
    expect(onSkip).toHaveBeenCalledWith('previous', expect.objectContaining({ audioLanguage: 'en' }));
  });

  it('N skips forward and shows a notice when there is no next episode', async () => {
    const onSkip = vi.fn().mockResolvedValue(false);
    const host = await mount(series, onSkip);
    await press(host, 'n');
    expect(onSkip).toHaveBeenCalledWith('next', expect.anything());
    expect(host.querySelector('.osd')?.textContent).toContain('No next episode');
  });

  it('N on a movie only shows the notice', async () => {
    const onSkip = vi.fn().mockResolvedValue(true);
    const host = await mount(movie, onSkip);
    await press(host, 'n');
    expect(onSkip).not.toHaveBeenCalled();
    expect(host.querySelector('.osd')?.textContent).toContain('No next episode');
  });
});
