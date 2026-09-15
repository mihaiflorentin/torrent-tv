import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '@torrent-tv/shared';
import { App } from './src';

// Downloads-page tests: the whole app mounts with the API mocked at the
// class boundary; the tests assert per-torrent cards surface live transfer
// facts (peers, ETA) and tracker errors without the old placeholder text.
// Prior art: settings.test.tsx.

const nativeDownload = {
 id: 'd1', releaseId: 'r1', engineId: 'native:abc123', fileIndex: 0,
 filePath: 'Silo.S01E01.Freedom.Day.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb.mkv', mimeType: 'video/x-matroska',
 sizeBytes: 4879437296, state: 'downloading', progress: 0.42, playbackMode: 'progressive',
 downloadedBytes: 2049363664, speedBytesPerSecond: 5242880, etaSeconds: 540, peers: 12, seeds: 3,
 leased: false, error: 'tracker gave failure reason: "Your client is not allowed!"', streamUrl: '/api/v1/downloads/d1/stream',
};

const qbDownload = {
 id: 'd2', releaseId: 'r2', engineId: 'qb:xyz789', fileIndex: 0,
 filePath: 'Silo.S02E01.1080p.mkv', mimeType: 'video/x-matroska',
 sizeBytes: 3889493092, state: 'seeding', progress: 1, playbackMode: 'local',
 downloadedBytes: 3889493092, speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 0,
 leased: false, error: '', streamUrl: '/api/v1/downloads/d2/stream',
};

const mountedHosts: HTMLElement[] = [];

class FakeEventSource { addEventListener() { } close() { } }

async function mountApp() {
 const host = document.createElement('div');
 document.body.appendChild(host);
 mountedHosts.push(host);
 await act(async () => { render(<App />, host) });
 await act(async () => { });
}

const sidebarButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')).find(button => button.textContent?.includes(label))!;

async function settle() {
 for (let i = 0; i < 5; i++) {
  await act(async () => {
   const { promise, resolve } = Promise.withResolvers<void>();
   setTimeout(resolve, 0);
   await promise;
  });
 }
}

beforeEach(() => {
 vi.stubGlobal('EventSource', FakeEventSource);
 vi.spyOn(API.prototype, 'facets').mockResolvedValue({ categories: [], kinds: [], resolutions: [], hdr: [], qualities: [], codecs: [] });
 vi.spyOn(API.prototype, 'titles').mockResolvedValue({ items: [], nextCursor: null, total: 0 });
 vi.spyOn(API.prototype, 'ensureMetadata').mockResolvedValue({ queued: 0 });
 vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [nativeDownload, qbDownload] as never[], nextCursor: null, total: 2 });
});

afterEach(() => {
 vi.restoreAllMocks();
 vi.unstubAllGlobals();
 for (const host of mountedHosts) host.remove();
 mountedHosts.length = 0;
 document.body.innerHTML = '';
});

async function openDownloads() {
 await mountApp();
 await act(async () => { sidebarButton('Downloads').click() });
 await settle();
}

describe('downloads page cards', () => {
 it('surfaces the tracker error on the affected card', async () => {
  await openDownloads();
  const text = document.body.textContent || '';
  expect(text).toContain('Your client is not allowed!');
 });

 it('never renders the old placeholder text', async () => {
  await openDownloads();
  expect(document.body.textContent).not.toContain('No download error');
 });

 it('shows which engine owns each download', async () => {
  await openDownloads();
  const text = document.body.textContent || '';
  expect(text).toContain('native engine');
  expect(text).toContain('qBittorrent');
 });

 it('shows live swarm facts and ETA per card', async () => {
  await openDownloads();
  const text = document.body.textContent || '';
  expect(text).toContain('12 peers');
  expect(text).toContain('3 connected seeds');
  expect(text).toContain('ETA 9 min');
  expect(text).toContain('5.2 MB/s');
 });
});

describe('downloads page torrent grouping', () => {
 const packRow = (id: string, fileIndex: number, displayTitle: string) => ({
  id, releaseId: 'r-pack', engineId: 'native:pack', fileIndex,
  filePath: `Attack.On.Titan.S01.E${String(fileIndex + 1).padStart(2, '0')}.1080p.BluRay.x264.D-Z0N3.mkv`, displayTitle, mimeType: 'video/x-matroska',
  sizeBytes: 4000000000 + fileIndex, state: 'seeding', progress: 1, playbackMode: 'local',
  downloadedBytes: 4000000000 + fileIndex, speedBytesPerSecond: 0, etaSeconds: 0, peers: 0, seeds: 1,
  leased: false, error: '', streamUrl: `/api/v1/downloads/${id}/stream`,
 });
 const mountPack = async (extra: object[] = []) => {
  vi.spyOn(API.prototype, 'downloads').mockResolvedValue({ items: [packRow('ep1', 0, 'Attack On Titan · S01E01'), packRow('ep2', 1, 'Attack On Titan · S01E02'), ...extra] as never[], nextCursor: null, total: 2 + extra.length });
  await openDownloads();
 };

 it('collapses rows of one torrent into a single card with an expandable file list', async () => {
  await mountPack([qbDownload]);
  const cards = document.querySelectorAll('.download-list article');
  expect(cards).toHaveLength(2);
  expect(document.body.textContent).toContain('2 files');
  expect(document.body.textContent).not.toContain('Attack On Titan · S01E02');
  await act(async () => {
   Array.from(cards[0].querySelectorAll('button')).find(b => b.textContent === 'Show files')!.click();
  });
  expect(document.body.textContent).toContain('Attack On Titan · S01E01');
 });

 it('plays and removes the clicked file row, not the representative', async () => {
  const playback = vi.spyOn(API.prototype, 'playback').mockResolvedValue({ profileId: 'p', sourceId: 'ep1', releaseId: 'r-pack', fileIndex: 0, filePath: 'x', positionMs: 0, durationMs: 0, watched: false, updatedAt: '' });
  const call = vi.spyOn(API.prototype, 'call').mockImplementation(async function mockApiCall(this: API, path: string) {
   if (path === '/state') return { favorites: [], continueWatching: [], recent: [], watched: [] } as never;
   if (path.endsWith('/remove-file')) return undefined as never;
   throw new Error('unexpected API call: ' + path);
  });
  await mountPack();
  const card = document.querySelector('.download-list article')!;
  await act(async () => {
   Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Show files')!.click();
  });
  const fileRows = card.querySelectorAll('.download-files li');
  expect(fileRows).toHaveLength(2);
  await act(async () => {
   Array.from(fileRows[1].querySelectorAll('button')).find(b => b.textContent === 'Play')!.click();
  });
  expect(playback).toHaveBeenCalledWith('ep2');
  await act(async () => {
   Array.from(fileRows[1].querySelectorAll('button')).find(b => b.textContent === 'Remove')!.click();
  });
  const confirm = document.querySelector('.removal-confirm')!;
  expect(confirm.textContent).toContain('The episode leaves the download list');
  await act(async () => {
   Array.from(confirm.querySelectorAll('button')).find(b => b.textContent === 'Remove episode')!.click();
  });
  expect(call).toHaveBeenCalledWith('/downloads/ep2/remove-file', { method: 'POST' });
 });

 it('keeps the group visible when the search matches a non-first file', async () => {
  await mountPack([qbDownload]);
  await act(async () => {
   const input = document.querySelector<HTMLInputElement>('.download-tools .search input')!;
   input.value = 'S01E02';
   input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  const cards = document.querySelectorAll('.download-list article');
  expect(cards).toHaveLength(1);
  expect(cards[0].textContent).toContain('Attack On Titan · S01E02');
  expect(cards[0].textContent).not.toContain('Attack On Titan · S01E01');
 });
});

describe('error modal layering', () => {
 it('surfaces errors as a topmost dialog while other modals are open', async () => {
  vi.spyOn(API.prototype, 'call').mockRejectedValue(new Error('the tracker refused this release'));
  await openDownloads();
  const cards = document.querySelectorAll('.download-list article');
  await act(async () => {
   Array.from(cards[0].querySelectorAll('button')).find(b => b.textContent === 'Retry download')?.click();
  });
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.textContent).toContain('the tracker refused this release');
  const overlays = Array.from(document.querySelectorAll('.overlay'));
  expect(overlays[overlays.length - 1]).toBe(dialog!.closest('.overlay'));
 });
});
