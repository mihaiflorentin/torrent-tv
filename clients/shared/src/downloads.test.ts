import { describe, expect, it } from 'vitest';
import { API, type Download, downloadTransferActions, groupDownloadsByTorrent, reconcileDownloads } from './index';

const row = (state: string, error?: string): Pick<Download, 'state' | 'error'> => ({ state, error });
const actions = (state: string, error?: string) => downloadTransferActions(row(state, error)).map(item => item.action);

// Table tests for the pure transfer-control seam shared by the web and TV
// Downloads screens: which of pause/resume/retry a row exposes, decided from
// the raw qBittorrent state string plus the surfaced engine/tracker error.
describe('Download transfer action decision', () => {
  it('offers pause for actively transferring rows', () => {
    const cases = ['downloading', 'metaDL', 'forcedDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'allocating'];
    for (const state of cases) expect(actions(state)).toEqual(['pause']);
  });
  it('offers resume for halted rows in both qBittorrent naming schemes', () => {
    const cases = ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'];
    for (const state of cases) expect(actions(state)).toEqual(['resume']);
  });
  it('offers retry when a tracker or engine error is surfaced regardless of state', () => {
    expect(actions('downloading', 'tracker announce failed')).toEqual(['retry']);
    expect(actions('pausedDL', 'engine unreachable')).toEqual(['retry']);
    expect(actions('unavailable', 'connection refused')).toEqual(['retry']);
  });
  it('offers retry for engine error states even before a message propagates', () => {
    expect(actions('error')).toEqual(['retry']);
    expect(actions('missingFiles')).toEqual(['retry']);
  });
  it('offers nothing for seeding, checking, or unknown rows', () => {
    const cases = ['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'checkingDL', 'checkingUP', 'checkingResumeData', 'moving', 'unknown', ''];
    for (const state of cases) expect(actions(state)).toEqual([]);
  });
  it('labels each action for idle and in-flight rendering', () => {
    expect(downloadTransferActions(row('downloading'))).toEqual([{ action: 'pause', label: 'Pause', pendingLabel: 'Pausing…' }]);
    expect(downloadTransferActions(row('pausedUP'))).toEqual([{ action: 'resume', label: 'Resume', pendingLabel: 'Resuming…' }]);
    expect(downloadTransferActions(row('error'))).toEqual([{ action: 'retry', label: 'Retry download', pendingLabel: 'Retrying…' }]);
  });
  it('normalizes case and surrounding whitespace before deciding', () => {
    expect(actions(' StalledDL ')).toEqual(['pause']);
    expect(actions('PAUSEDDL')).toEqual(['resume']);
  });
});

describe('Download reconciliation and provenance fingerprinting', () => {
  const sampleDownload = (id: string, trackerId = 'filelist', trackerName = 'FileList'): Download => ({
    id,
    releaseId: 'rel-' + id,
    trackerId,
    trackerName,
    engineId: 'qb:' + id,
    fileIndex: 0,
    filePath: `${id}.mkv`,
    mimeType: 'video/x-matroska',
    sizeBytes: 1000,
    state: 'downloading',
    progress: 0.5,
    playbackMode: 'progressive',
    downloadedBytes: 500,
    speedBytesPerSecond: 100,
    etaSeconds: 5,
    peers: 2,
    seeds: 3,
    leased: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    streamUrl: `/downloads/${id}/stream`,
  });

  it('reuses the unchanged object reference when fingerprint is unchanged', () => {
    const original = sampleDownload('item1', 'filelist', 'FileList');
    const incoming = sampleDownload('item1', 'filelist', 'FileList');
    const result = reconcileDownloads([original], [incoming]);
    expect(result[0]).toBe(original);
  });

  it('replaces the stale row object on provenance-only update', () => {
    const original = sampleDownload('item1', 'filelist', 'FileList');
    const incoming = sampleDownload('item1', 'piratebay', 'The Pirate Bay');
    const result = reconcileDownloads([original], [incoming]);
    expect(result[0]).not.toBe(original);
    expect(result[0].trackerId).toBe('piratebay');
    expect(result[0].trackerName).toBe('The Pirate Bay');
  });

  it('API methods forward AbortSignal and request options', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/trackers')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'filelist',
              name: 'FileList',
              enabled: true,
              configured: true,
              capabilities: { imdbSearch: true, seasonFilter: false, episodeFilter: false, categories: true },
            },
          ],
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: 'dl-1' }) } as Response;
    }) as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const api = new API('http://localhost:8097');
      const statuses = await api.trackers();
      expect(statuses[0].id).toBe('filelist');

      const controller = new AbortController();
      await api.prepare('rel-1', 2, controller.signal);
      expect(calls[1].init?.signal).toBe(controller.signal);
      expect(calls[1].url).toBe('http://localhost:8097/api/v1/releases/rel-1/prepare');

      await api.prepareSeason('rel-2', 1, controller.signal);
      expect(calls[2].init?.signal).toBe(controller.signal);
      expect(calls[2].url).toBe('http://localhost:8097/api/v1/releases/rel-2/prepare-season');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('Download grouping by torrent', () => {
    const packRow = (id: string, engineId: string, sizeBytes: number): Download => ({
      id,
      releaseId: 'rel-pack',
      trackerId: 'filelist',
      trackerName: 'FileList',
      engineId,
      fileIndex: Number(id.replace(/\D/g, '')) || 0,
      filePath: `${id}.mkv`,
      mimeType: 'video/x-matroska',
      sizeBytes,
      state: 'seeding',
      progress: 1,
      playbackMode: 'local',
      downloadedBytes: sizeBytes,
      speedBytesPerSecond: 0,
      etaSeconds: 0,
      peers: 0,
      seeds: 1,
      leased: false,
      streamUrl: `/downloads/${id}/stream`,
    });

    it('collapses rows sharing an engineId into one group led by the first row', () => {
      const rows = [packRow('ep2', 'qb:hash', 500), packRow('ep1', 'qb:hash', 700), packRow('other', 'qb:hash2', 300)];
      const groups = groupDownloadsByTorrent(rows);
      expect(groups).toHaveLength(2);
      expect(groups[0].representative.id).toBe('ep2');
      expect(groups[0].rows.map(row => row.id)).toEqual(['ep2', 'ep1']);
      expect(groups[0].totalSizeBytes).toBe(1200);
      expect(groups[1].rows.map(row => row.id)).toEqual(['other']);
      expect(groups[1].totalSizeBytes).toBe(300);
    });

    it('passes single-row groups through unchanged and keeps input order', () => {
      const rows = [packRow('a', 'qb:a', 10), packRow('b', 'qb:b', 20), packRow('c', 'qb:c', 30)];
      const groups = groupDownloadsByTorrent(rows);
      expect(groups.map(group => group.representative.id)).toEqual(['a', 'b', 'c']);
      expect(groups.every(group => group.rows.length === 1 && group.rows[0] === group.representative)).toBe(true);
    });
  });
});
