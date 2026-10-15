import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Download } from '@torrent-tv/shared';
import { PlayerReady, PrepareElapsed } from './getting-ready';

// "Getting ready" feedback on the web, matching the TV: Prepare is one blocking request so the honest progress is
// elapsed time plus a calm hint after 15 s; the Player shows the download's own progress while the stream opens.

const live: Download = {
  id: 'dl-1', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', engineId: 'qb:x', fileIndex: 0, filePath: 'a.mkv',
  mimeType: 'video/x-matroska', sizeBytes: 1000, state: 'downloading', progress: 0.37, downloadedBytes: 370,
  speedBytesPerSecond: 2_100_000, etaSeconds: 240, peers: 12, seeds: 9, leased: false, streamUrl: '/s', playbackMode: 'progressive',
};

const hosts: HTMLElement[] = [];
const mount = async (jsx: Parameters<typeof render>[0]) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  await act(async () => { render(jsx, host) });
  return host;
};
afterEach(() => {
  while (hosts.length) { const host = hosts.pop()!; render(null, host); host.remove() }
  vi.useRealTimers();
});

describe('PrepareElapsed', () => {
  beforeEach(() => { vi.useFakeTimers() });

  it('counts seconds and stays quiet for the first 15', async () => {
    const host = await mount(<PrepareElapsed seeders={7} />);
    expect(host.querySelector('.prepare-elapsed')?.textContent).toBe('0 s');
    await act(async () => { vi.advanceTimersByTime(3000) });
    expect(host.querySelector('.prepare-elapsed')?.textContent).toBe('3 s');
    expect(host.querySelector('.prepare-hint')?.textContent).toBe('');
  });

  it('says why it is slow after 15 seconds, in a polite live region that holds its space', async () => {
    const host = await mount(<PrepareElapsed seeders={7} />);
    const hint = host.querySelector('.prepare-hint')!;
    expect(hint.getAttribute('aria-live')).toBe('polite');
    await act(async () => { vi.advanceTimersByTime(16_000) });
    expect(hint.textContent).toContain('Still looking for peers. This release has 7 seeders');
    expect(hint.isConnected).toBe(true);
  });

  it('keeps the counter out of the live region so it is not read every second', async () => {
    const host = await mount(<PrepareElapsed />);
    expect(host.querySelector('.prepare-elapsed')?.closest('[aria-live]')).toBeNull();
  });

  it('stops its interval when the modal goes away', async () => {
    const host = await mount(<PrepareElapsed />);
    await act(async () => { render(null, host) });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PlayerReady', () => {
  it('shows title, percent, peers, speed and time left from the polled download', async () => {
    const api = { downloads: vi.fn().mockResolvedValue({ items: [live], nextCursor: null, total: 1 }) };
    const host = await mount(<PlayerReady api={api} download={{ ...live, progress: 0, peers: 0, speedBytesPerSecond: 0, etaSeconds: 0 }} title="Severance · S02E04" />);
    const panel = host.querySelector<HTMLElement>('.player-ready')!;
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(panel.textContent).toContain('Severance · S02E04');
    expect(panel.textContent).toContain('37%');
    expect(panel.textContent).toContain('12 peers · 2.1 MB/s · 4 min left');
    expect(panel.querySelector<HTMLElement>('.player-ready-fill')!.style.width).toBe('37%');
    expect(panel.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('37');
    expect(panel.querySelector('button, [tabindex], a, input')).toBeNull();
  });

  it('keeps the plain panel when the poll fails', async () => {
    const api = { downloads: vi.fn().mockRejectedValue(new Error('offline')) };
    const host = await mount(<PlayerReady api={api} download={{ ...live, progress: 0, peers: 0, speedBytesPerSecond: 0, etaSeconds: 0 }} title="Severance" />);
    expect(host.querySelector('.player-ready')?.textContent).toContain('Severance');
    expect(host.querySelector('.player-ready-facts span')).toBeNull();
  });

  it('stops polling when it goes away', async () => {
    vi.useFakeTimers();
    const api = { downloads: vi.fn().mockResolvedValue({ items: [live], nextCursor: null, total: 1 }) };
    const host = await mount(<PlayerReady api={api} download={live} title="Severance" />);
    await act(async () => { vi.advanceTimersByTime(2100) });
    await act(async () => { render(null, host) });
    const calls = api.downloads.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10_000) });
    expect(api.downloads.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PlayerReady across episodes and failures', () => {
  const second: Download = { ...live, id: 'dl-2', filePath: 'b.mkv', progress: 0.05, peers: 3, speedBytesPerSecond: 500_000, etaSeconds: 600 };

  it('shows the new download at once when the episode changes, not the previous one', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => { });
    const api = { downloads: vi.fn().mockResolvedValueOnce({ items: [live], nextCursor: null, total: 1 }).mockReturnValue(never) };
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    await act(async () => { render(<PlayerReady api={api} download={{ ...live, progress: 0 }} title="E1" />, host) });
    await act(async () => { });
    expect(host.textContent).toContain('37%');
    await act(async () => { render(<PlayerReady api={api} download={second} title="E2" />, host) });
    await act(async () => { });
    expect(host.textContent).toContain('E2');
    expect(host.textContent).toContain('5%');
    expect(host.textContent).not.toContain('37%');
  });

  it('does not poll while the page is hidden and resumes when it is visible again', async () => {
    vi.useFakeTimers();
    const api = { downloads: vi.fn().mockResolvedValue({ items: [live], nextCursor: null, total: 1 }) };
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      await mount(<PlayerReady api={api} download={live} title="Severance" />);
      await act(async () => { vi.advanceTimersByTime(10_000) });
      expect(api.downloads).not.toHaveBeenCalled();
      hidden.mockReturnValue(false);
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) });
      expect(api.downloads).toHaveBeenCalledTimes(1);
    } finally { hidden.mockRestore() }
  });

  it('keeps the last progress after a failed poll but says it is no longer updating', async () => {
    vi.useFakeTimers();
    const api = { downloads: vi.fn().mockResolvedValueOnce({ items: [live], nextCursor: null, total: 1 }).mockRejectedValue(new Error('offline')) };
    const host = await mount(<PlayerReady api={api} download={{ ...live, progress: 0 }} title="Severance" />);
    expect(host.textContent).toContain('37%');
    expect(host.querySelector('.player-ready-stale')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(2100) });
    expect(host.textContent).toContain('37%');
    expect(host.querySelector('.player-ready-stale')?.textContent).toContain('not updating');
    api.downloads.mockResolvedValue({ items: [{ ...live, progress: 0.5 }], nextCursor: null, total: 1 });
    await act(async () => { vi.advanceTimersByTime(2100) });
    expect(host.textContent).toContain('50%');
    expect(host.querySelector('.player-ready-stale')).toBeNull();
  });
});
