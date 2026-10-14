import { describe, expect, it } from 'vitest';
import type { CatalogSource, CatalogTitle, Download, HouseholdItem, Job } from '@torrent-tv/shared';
import { cardFacts, connectionStatus, downloadDetails, downloadFacts, downloadStatus, episodeCode, formatEta, jobDuration, jobStatus, kindLabel, libraryProgress, playerTitle, resumeLine, sourceSpec, titleFacts } from './presentation';

// The "Information priorities" table in DESIGN.md decides what each screen
// shows. These helpers are the one place that decision is made, so the tests
// pin it: primary and secondary facts appear, hidden ones do not, and an
// unknown fact is left out instead of printed as a placeholder.

const title = (patch: Partial<CatalogTitle> = {}): CatalogTitle => ({
  id: 't1', title: 'Lanterns', kind: 'movie', year: 2021, trackers: [{ id: 'filelist', name: 'FileList' }], categories: [], resolutions: ['2160p', '1080p'],
  sourceCount: 4, bestSeeders: 214, largestSizeBytes: 0, ...patch,
});

describe('title facts', () => {
  it('names a movie as Movie and a series by its season count', () => {
    expect(kindLabel(title())).toBe('Movie');
    expect(kindLabel(title({ kind: 'series', seasonCount: 3 }))).toBe('3 seasons');
    expect(kindLabel(title({ kind: 'series', seasonCount: 1 }))).toBe('1 season');
  });

  it('does not print 0 seasons when the count is unknown', () => {
    expect(kindLabel(title({ kind: 'series' }))).toBe('Series');
    expect(kindLabel(title({ kind: 'series', seasonCount: 0 }))).toBe('Series');
  });

  it('puts year and kind in the header line and omits an unknown year', () => {
    expect(titleFacts(title())).toEqual(['2021', 'Movie']);
    expect(titleFacts(title({ year: undefined }))).toEqual(['Movie']);
  });
});

describe('poster card facts', () => {
  it('shows year, best resolution and the rating once when it has votes', () => {
    expect(cardFacts(title({ rating: 7.46, ratingVotes: 120 }))).toEqual(['2021', '2160p', '★ 7.5']);
  });

  it('leaves out a rating without votes and a missing resolution', () => {
    expect(cardFacts(title({ rating: 7.4, ratingVotes: 0, resolutions: [] }))).toEqual(['2021']);
  });

  it('hides seeders, trackers and source counts by default', () => {
    const text = cardFacts(title()).join(' ');
    expect(text).not.toMatch(/seed|FileList|version|source/i);
  });

  it('shows seeders only for a row defined by seeders', () => {
    expect(cardFacts(title(), { showSeeders: true })).toEqual(['2021', '2160p', '214 seeders']);
  });
});

describe('library cards', () => {
  const item = (patch: Partial<HouseholdItem> = {}): HouseholdItem => ({
    profileId: 'p', sourceId: 's', releaseId: 'r', fileIndex: 0, filePath: 'Lanterns.S01E02.1080p.WEB-DL.mkv', positionMs: 0, durationMs: 0, watched: false, updatedAt: '2026-01-01T00:00:00Z',
    release: { id: 'r', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '1', browseClass: '', name: 'Lanterns.S01E02.1080p.WEB-DL', category: '', sizeBytes: 1, seeders: 3, leechers: 0, freeleech: false },
    favorite: false, ...patch,
  });

  it('formats an episode code with zero padding and omits it when unknown', () => {
    expect(episodeCode(1, 2)).toBe('S01E02');
    expect(episodeCode(12, 103)).toBe('S12E103');
    expect(episodeCode(undefined, 2)).toBe('');
    expect(episodeCode(1, undefined)).toBe('');
  });

  it('reports percent watched for a started title', () => {
    expect(libraryProgress(item({ positionMs: 410, durationMs: 1000 }))).toEqual({ percent: 41, label: '41% watched' });
  });

  it('reports Watched with a full bar once watched', () => {
    expect(libraryProgress(item({ watched: true, positionMs: 900, durationMs: 1000 }))).toEqual({ percent: 100, label: 'Watched' });
  });

  it('has no label and an empty bar for an untouched title', () => {
    expect(libraryProgress(item())).toEqual({ percent: 0, label: '' });
  });

  it('writes the resume line without a file path', () => {
    const line = resumeLine(item({ seasonNumber: 1, episodeNumber: 2, positionMs: 754000 }), 'series');
    expect(line).toBe('S01E02 · Continue at 12:34');
    expect(line).not.toContain('mkv');
  });
});

describe('version rows', () => {
  const source = (parsed: Partial<CatalogSource['parsed']> = {}, patch: Partial<CatalogSource> = {}): CatalogSource => ({
    release: { id: 'rel-9', trackerId: 'filelist', trackerName: 'FileList', providerId: '9', categoryId: '4', browseClass: '', name: 'Lanterns.2021.2160p.UHD.BluRay.x265-GRP', category: 'Filme 4K', sizeBytes: 18_400_000_000, seeders: 214, leechers: 3, freeleech: false },
    parsed: { title: 'Lanterns', sortTitle: 'lanterns', kind: 'movie', resolution: '2160p', hdr: 'HDR', quality: 'BluRay', videoCodec: 'HEVC', audio: 'DTS-HD 5.1', ...parsed },
    fileIndex: 3, filePath: 'Lanterns.2021.2160p.mkv', ...patch,
  });

  it('puts resolution with HDR first, then quality, codec, size and seeders', () => {
    const spec = sourceSpec(source());
    expect(spec.headline).toBe('2160p HDR');
    expect(spec.chips).toEqual(['BluRay', 'HEVC']);
    expect(spec.size).toBe('18.4 GB');
    expect(spec.seeders).toBe('214 seeders');
    expect(spec.audio).toBe('DTS-HD 5.1');
  });

  it('keeps the release name for the details control and nowhere else', () => {
    const spec = sourceSpec(source());
    expect(spec.release).toBe('Lanterns.2021.2160p.mkv');
    expect([spec.headline, ...spec.chips, spec.size, spec.seeders, spec.audio].join(' ')).not.toContain('Lanterns');
    expect(spec.details.map(([label]) => label)).toEqual(['Release', 'File', 'Category', 'Release ID', 'File index']);
  });

  it('omits unknown facts instead of printing a placeholder', () => {
    const spec = sourceSpec(source({ resolution: undefined, hdr: undefined, quality: undefined, videoCodec: undefined, audio: undefined }, { filePath: undefined, fileIndex: undefined, fileSizeBytes: undefined }));
    expect(spec.headline).toBe('Version');
    expect(spec.chips).toEqual([]);
    expect(spec.audio).toBe('');
    expect(spec.release).toBe('Lanterns.2021.2160p.UHD.BluRay.x265-GRP');
    expect(spec.details.map(([label]) => label)).toEqual(['Release', 'Category', 'Release ID']);
  });

  it('prefers the file size over the release size', () => {
    expect(sourceSpec(source({}, { fileSizeBytes: 2_000_000_000 })).size).toBe('2 GB');
  });

  it('uses the singular for one seeder', () => {
    expect(sourceSpec(source({}, { release: { ...source().release, seeders: 1 } })).seeders).toBe('1 seeder');
  });
});

describe('downloads', () => {
  const download = (patch: Partial<Download> = {}): Download => ({
    id: 'd1', releaseId: 'rel-1', trackerId: 'filelist', trackerName: 'FileList', displayTitle: 'Silo · S01E01', releaseName: 'Silo.S01E01.1080p.WEB-DL', engineId: 'native:abc', fileIndex: 2,
    filePath: 'Silo/Silo.S01E01.mkv', mimeType: 'video/x-matroska', sizeBytes: 4_879_437_296, state: 'downloading', progress: 0.42, playbackMode: 'progressive',
    downloadedBytes: 2_049_363_664, speedBytesPerSecond: 5_242_880, etaSeconds: 540, peers: 12, seeds: 3, leased: false, streamUrl: '/s', trackerSeeders: 88,
    parsed: { title: 'Silo', sortTitle: 'silo', kind: 'series', resolution: '1080p', videoCodec: 'H.264' }, ...patch,
  });

  it('shows percent, speed and ETA while a download is active', () => {
    expect(downloadStatus(download())).toMatchObject({ label: 'Downloading', tone: 'active', line: 'Downloading · 42% · 5.2 MB/s · ETA 9 min' });
  });

  it('shows Paused with the percent and no speed', () => {
    expect(downloadStatus(download({ state: 'pausedDL', speedBytesPerSecond: 0 }))).toMatchObject({ label: 'Paused', tone: 'paused', line: 'Paused · 42%' });
  });

  it('shows Error and keeps the message separate', () => {
    const status = downloadStatus(download({ state: 'error', error: 'tracker refused this release' }));
    expect(status).toMatchObject({ label: 'Error', tone: 'error', line: 'Error · 42%' });
  });

  it('treats a finished download as Downloaded', () => {
    expect(downloadStatus(download({ state: 'seeding', progress: 1, speedBytesPerSecond: 0, etaSeconds: 0, playbackMode: 'local' }))).toMatchObject({ label: 'Downloaded', tone: 'done', line: 'Downloaded' });
  });

  it('drops the ETA when the engine has none', () => {
    expect(downloadStatus(download({ etaSeconds: 0 })).line).toBe('Downloading · 42% · 5.2 MB/s');
  });

  it('formats long ETAs in hours', () => {
    expect(formatEta(30)).toBe('1 min');
    expect(formatEta(540)).toBe('9 min');
    expect(formatEta(3600 * 2 + 300)).toBe('2 h 5 min');
    expect(formatEta(0)).toBe('');
  });

  it('keeps size, quality and the progressive flag as secondary facts', () => {
    expect(downloadFacts(download())).toEqual(['4.9 GB', '1080p · H.264', 'Playable while downloading']);
    expect(downloadFacts(download({ playbackMode: 'local', parsed: undefined }))).toEqual(['4.9 GB']);
  });

  it('moves release name, path, file index, peers and engine into the details list', () => {
    const details = Object.fromEntries(downloadDetails(download()));
    expect(details['Release']).toBe('Silo.S01E01.1080p.WEB-DL');
    expect(details['File']).toBe('Silo/Silo.S01E01.mkv');
    expect(details['File index']).toBe('2');
    expect(details['Peers']).toBe('3 connected seeds · 12 peers · 15 known in swarm');
    expect(details['Tracker seeders']).toBe('88');
    expect(details['Engine']).toBe('native engine');
    expect(details['Engine route']).toBe('native:abc');
  });

  it('labels the qBittorrent engine and omits unknown details', () => {
    const details = Object.fromEntries(downloadDetails(download({ engineId: 'qb:xyz', releaseName: undefined, trackerSeeders: undefined })));
    expect(details['Engine']).toBe('qBittorrent');
    expect(details['Release']).toBeUndefined();
    expect(details['Tracker seeders']).toBeUndefined();
  });

  it('titles the player with the episode code only when the title lacks one', () => {
    expect(playerTitle(download())).toBe('Silo · S01E01');
    expect(playerTitle(download({ displayTitle: 'Silo', parsed: { title: 'Silo', sortTitle: 'silo', kind: 'series', seasonStart: 1, episodeStart: 4 } }))).toBe('Silo · S01E04');
    expect(playerTitle(download({ displayTitle: undefined, parsed: undefined }))).toBe('Silo/Silo.S01E01.mkv');
  });
});

describe('jobs', () => {
  const job = (patch: Partial<Job> = {}): Job => ({
    id: 'job-1', kind: 'catalog.sync', state: 'completed', label: 'Fetch latest', dedupeKey: 'k', progress: 1, attempt: 1, retryable: true,
    createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:03:20Z', ...patch,
  });

  it('names the status in words with a tone', () => {
    expect(jobStatus(job())).toEqual({ label: 'Completed', tone: 'ok' });
    expect(jobStatus(job({ state: 'failed' }))).toEqual({ label: 'Failed', tone: 'danger' });
    expect(jobStatus(job({ state: 'running' }))).toEqual({ label: 'Running', tone: 'busy' });
    expect(jobStatus(job({ state: 'queued' }))).toEqual({ label: 'Queued', tone: 'idle' });
    expect(jobStatus(job({ state: 'retry_wait' }))).toEqual({ label: 'Waiting to retry', tone: 'warn' });
  });

  it('reports a duration only for a finished job', () => {
    expect(jobDuration(job())).toBe('3 min');
    expect(jobDuration(job({ updatedAt: '2026-10-14T10:00:20Z' }))).toBe('20 s');
    expect(jobDuration(job({ state: 'running' }))).toBe('');
    expect(jobDuration(job({ updatedAt: 'garbage' }))).toBe('');
  });
});

describe('settings group status', () => {
  it('maps a test result to Connected, Needs attention or Checking and leaves untested groups unlabeled', () => {
    expect(connectionStatus('pass')).toEqual({ label: 'Connected', tone: 'ok' });
    expect(connectionStatus('fail')).toEqual({ label: 'Needs attention', tone: 'warn' });
    expect(connectionStatus('testing')).toEqual({ label: 'Checking', tone: 'busy' });
    expect(connectionStatus('')).toBeNull();
    expect(connectionStatus(undefined)).toBeNull();
  });
});
