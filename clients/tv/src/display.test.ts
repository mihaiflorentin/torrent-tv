import { describe, expect, it } from 'vitest';
import type { CatalogTitle, Download, HouseholdItem, Job, ParsedRelease, PlaybackPreferences } from '@torrent-tv/shared';
import { cardMeta, cardRating, prepareHint, readyLine, readyPercent, downloadFacts, downloadProgressLine, downloadStatus, episodeCode, formatEta, heroFacts, jobKindLabel, jobStatusLine, jobState, jobWhatRan, relativeTime, libraryCardLine, playerChoiceLine, playerHeading, remainingTime, resumeLine, sourceChips, sourceHeadline, titleKind, watchProgress } from './display';

// DESIGN.md "Information priorities": what each TV screen shows, decided as pure text so the
// markup only places it. Unknown facts are omitted, never printed as a placeholder.

const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 't', title: 'Alpha', kind: 'movie', trackers: [{ id: 'filelist', name: 'FileList' }], categories: [], resolutions: [], sourceCount: 3, bestSeeders: 42, largestSizeBytes: 1, ...over });

describe('episodeCode', () => {
  it('pads season and episode', () => expect(episodeCode(1, 2)).toBe('S01E02'));
  it('is empty when either part is missing', () => {
    expect(episodeCode(1, undefined)).toBe('');
    expect(episodeCode(undefined, 3)).toBe('');
    expect(episodeCode(0, 0)).toBe('');
  });
});

describe('titleKind', () => {
  it('names a movie', () => expect(titleKind(title())).toBe('Movie'));
  it('counts seasons for a series', () => {
    expect(titleKind(title({ kind: 'series', seasonCount: 3 }))).toBe('3 seasons');
    expect(titleKind(title({ kind: 'series', seasonCount: 1 }))).toBe('1 season');
  });
  it('falls back to Series when the season count is unknown', () => expect(titleKind(title({ kind: 'series' }))).toBe('Series'));
});

describe('heroFacts', () => {
  it('lists kind and year', () => expect(heroFacts(title({ year: 2019 }))).toEqual(['Movie', '2019']));
  it('omits an unknown year instead of printing a placeholder', () => expect(heroFacts(title())).toEqual(['Movie']));
});

describe('cardMeta', () => {
  it('shows year, best resolution and a rating that has votes', () => {
    expect(cardMeta(title({ year: 2019, resolutions: ['1080p', '720p'], rating: 7.44, ratingVotes: 120 }))).toBe('2019 · 1080p');
    expect(cardRating(title({ year: 2019, resolutions: ['1080p', '720p'], rating: 7.44, ratingVotes: 120 }))).toBe('7.4');
  });
  it('drops a rating without votes', () => { expect(cardMeta(title({ year: 2019, rating: 9, ratingVotes: 0 }))).toBe('2019'); expect(cardRating(title({ year: 2019, rating: 9, ratingVotes: 0 }))).toBe(''); });
  it('never prints seeders, tracker names or source counts', () => {
    const text = cardMeta(title({ year: 2019, bestSeeders: 999, sourceCount: 7 }));
    expect(text).not.toMatch(/seeders|FileList|source/i);
  });
  it('shows seeders, first so a narrow card never cuts them, only for a row defined by them', () => expect(cardMeta(title({ year: 2019, resolutions: ['1080p'], bestSeeders: 42 }), { seeders: true })).toBe('42 seeders · 2019 · 1080p'));
  it('names the kind when nothing else is known', () => expect(cardMeta(title({ kind: 'series' }))).toBe('Series'));
});

const parsed = (over: Partial<ParsedRelease> = {}): ParsedRelease => ({ title: 'Alpha', sortTitle: 'alpha', kind: 'movie', ...over });

describe('source row facts', () => {
  it('leads with resolution and HDR', () => expect(sourceHeadline(parsed({ resolution: '2160p', hdr: 'HDR10' }))).toBe('2160p · HDR10'));
  it('names the resolution alone and says Version when it is unknown', () => {
    expect(sourceHeadline(parsed({ resolution: '1080p' }))).toBe('1080p');
    expect(sourceHeadline(parsed())).toBe('Version');
  });
  it('lists quality and codec chips and omits unknown ones', () => {
    expect(sourceChips(parsed({ quality: 'WEB-DL', videoCodec: 'HEVC' }))).toEqual(['WEB-DL', 'HEVC']);
    expect(sourceChips(parsed({ videoCodec: 'x264' }))).toEqual(['x264']);
    expect(sourceChips(parsed())).toEqual([]);
  });
  it('falls back to the tracker category only for the quality chip', () => expect(sourceChips(parsed(), 'Movies HD')).toEqual(['Movies HD']));
});

const item = (over: Partial<HouseholdItem> = {}): HouseholdItem => ({ profileId: 'h', sourceId: 's', releaseId: 'r', fileIndex: 0, filePath: 'Alpha.S01E02.1080p.mkv', positionMs: 0, durationMs: 0, watched: false, updatedAt: '', release: { id: 'r', trackerId: 'filelist', trackerName: 'FileList', providerId: '1', categoryId: '1', browseClass: 'video', name: 'Alpha.S01E02.1080p', category: 'TV', sizeBytes: 1, seeders: 5, leechers: 0, freeleech: false }, favorite: false, ...over });

describe('library cards', () => {
  it('shows the episode code and percent watched', () => {
    expect(libraryCardLine(item({ seasonNumber: 1, episodeNumber: 2, positionMs: 410, durationMs: 1000 }))).toBe('S01E02 · 41% watched');
  });
  it('shows the year for a movie in progress', () => {
    expect(libraryCardLine(item({ positionMs: 500, durationMs: 1000, catalog: title({ year: 2019 }) }))).toBe('2019 · 50% watched');
  });
  it('says Watched for a finished title', () => expect(libraryCardLine(item({ watched: true, positionMs: 1000, durationMs: 1000 }))).toBe('Watched'));
  it('says Ready to play when nothing was watched yet', () => expect(libraryCardLine(item())).toBe('Ready to play'));
  it('never leaks the tracker, release name or file path', () => {
    const text = libraryCardLine(item({ positionMs: 500, durationMs: 1000 }));
    expect(text).not.toMatch(/FileList|Alpha\.S01|mkv/);
  });
  it('clamps progress into 0 to 100', () => {
    expect(watchProgress(item({ positionMs: 5000, durationMs: 1000 }))).toBe(100);
    expect(watchProgress(item({ positionMs: 5, durationMs: 0 }))).toBe(0);
  });
});

describe('resumeLine', () => {
  it('summarises the resume point without the file path', () => {
    const text = resumeLine(item({ seasonNumber: 1, episodeNumber: 2, positionMs: 754_000, durationMs: 3_000_000 }), 'series');
    expect(text).toBe('S01E02 · Continue at 12:34');
    expect(text).not.toContain('mkv');
  });
  it('omits the code for a movie', () => expect(resumeLine(item({ positionMs: 61_000, durationMs: 3_000_000 }), 'movie')).toBe('Continue at 1:01'));
});

const download = (over: Partial<Download> = {}): Download => ({ id: 'd', releaseId: 'r', trackerId: 'filelist', trackerName: 'FileList', engineId: 'e', fileIndex: 0, filePath: 'a/b.mkv', mimeType: 'video/x-matroska', sizeBytes: 4_000_000_000, state: 'downloading', progress: 0.41, playbackMode: 'local', downloadedBytes: 1_640_000_000, speedBytesPerSecond: 4_200_000, etaSeconds: 720, peers: 3, seeds: 9, leased: false, streamUrl: '/s', ...over });

describe('downloads', () => {
  it('formats an ETA in the largest sensible unit', () => {
    expect(formatEta(45)).toBe('45 s left');
    expect(formatEta(720)).toBe('12 min left');
    expect(formatEta(7500)).toBe('2 h 5 min left');
    expect(formatEta(0)).toBe('');
  });
  it('reports an active transfer with percent, speed and ETA', () => {
    expect(downloadStatus(download()).label).toBe('Downloading 41%');
    expect(downloadProgressLine(download())).toBe('Downloading 41% · 4.2 MB/s · 12 min left');
  });
  it('reports paused, queued, finished and failed states in words', () => {
    expect(downloadStatus(download({ state: 'pausedDL' })).label).toBe('Paused at 41%');
    expect(downloadStatus(download({ state: 'queuedDL' })).label).toBe('Queued');
    expect(downloadStatus(download({ state: 'uploading', progress: 1 })).label).toBe('Downloaded');
    expect(downloadStatus(download({ state: 'error' })).label).toBe('Needs attention');
    expect(downloadProgressLine(download({ error: 'disk full' }))).toBe('Needs attention · disk full');
  });
  it('tones follow the state, never colour alone', () => {
    expect(downloadStatus(download()).tone).toBe('active');
    expect(downloadStatus(download({ state: 'pausedDL' })).tone).toBe('paused');
    expect(downloadStatus(download({ state: 'uploading', progress: 1 })).tone).toBe('done');
    expect(downloadStatus(download({ error: 'x' })).tone).toBe('error');
  });
  it('does not print speed or ETA for a paused download', () => expect(downloadProgressLine(download({ state: 'pausedDL', speedBytesPerSecond: 0 }))).toBe('Paused at 41%'));
  it('lists the secondary facts and announces progressive playback', () => {
    const text = downloadFacts(download({ playbackMode: 'progressive', parsed: parsed({ resolution: '1080p', quality: 'WEB-DL', videoCodec: 'HEVC' }) }));
    expect(text).toBe('1080p · WEB-DL · HEVC · 4 GB · FileList · Playable while downloading');
  });
  it('sums a multi-file torrent instead of one file', () => {
    expect(downloadFacts(download({ parsed: parsed({ resolution: '1080p' }) }), { sizeBytes: 12_000_000_000, files: 3 })).toBe('1080p · 3 files · 12 GB · FileList');
  });
  it('hides release name, path and peers from the facts', () => {
    const text = downloadFacts(download({ releaseName: 'Alpha.2019.1080p', filePath: 'a/b.mkv' }));
    expect(text).not.toMatch(/Alpha\.2019|b\.mkv|peers|seeds/);
  });
});

describe('player choice line', () => {
  const prefs = (over: Partial<PlaybackPreferences> = {}): PlaybackPreferences => ({ audioLanguage: 'en', audioTrackIndex: 1, subtitleLanguage: 'ro', subtitleMode: 'selected', ...over });
  it('names the audio and subtitle choice', () => expect(playerChoiceLine(prefs())).toBe('Audio English · Subtitles Romanian'));
  it('says Off when subtitles are off', () => expect(playerChoiceLine(prefs({ subtitleMode: 'off' }))).toBe('Audio English · Subtitles Off'));
  it('says Auto while the subtitle is picked automatically', () => expect(playerChoiceLine(prefs({ subtitleMode: 'auto' }))).toBe('Audio English · Subtitles Auto'));
  it('is empty without preferences', () => expect(playerChoiceLine(undefined)).toBe(''));
});

describe('jobs', () => {
  const job = (over: Partial<Job> = {}): Job => ({ id: 'job-123', kind: 'catalog-sync', state: 'completed', label: 'Fetch latest', dedupeKey: 'k', progress: 1, attempt: 1, retryable: false, createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:05:00Z', ...over });
  it('names kinds in plain words', () => {
    expect(jobKindLabel('catalog-sync')).toBe('Catalog sync');
    expect(jobKindLabel('catalog-title-refresh')).toBe('Title refresh');
    expect(jobKindLabel('metadata')).toBe('Metadata');
    expect(jobKindLabel('')).toBe('All');
    expect(jobKindLabel('custom')).toBe('custom');
  });
  it('puts the status first and the last message after it, never the job id', () => {
    const text = jobStatusLine(job({ state: 'failed', progress: 0.5, error: 'tracker timed out' }));
    expect(text).toBe('Failed · tracker timed out');
    expect(text).not.toContain('job-123');
  });
  it('shows progress only while running', () => expect(jobStatusLine(job({ state: 'running', progress: 0.25 }))).toBe('Running · 25%'));
  it('names a completed job and its update time', () => expect(jobStatusLine(job(), () => '14 Oct, 10:05')).toBe('Completed · 14 Oct, 10:05'));
  it('says what ran as the action, the title and the tracker', () => {
    expect(jobWhatRan(job({ kind: 'catalog-title-refresh', label: 'Refresh FileList for Copper Archive' }))).toBe('Refresh · Copper Archive · FileList');
    expect(jobWhatRan(job({ label: 'Fetch latest releases · 120 refreshed · 80 retained (40 discoverable)' }))).toBe('Fetch latest releases · 120 refreshed · 80 retained (40 discoverable)');
    expect(jobWhatRan(job({ label: '', kind: 'metadata' }))).toBe('Metadata');
  });
  it('names the state in one capitalised word with its tone and icon', () => {
    expect(jobState(job({ state: 'running' }))).toEqual({ word: 'Running', tone: 'active', icon: 'jobs' });
    expect(jobState(job({ state: 'failed' }))).toEqual({ word: 'Failed', tone: 'error', icon: 'alert' });
    expect(jobState(job({ state: 'succeeded' }))).toEqual({ word: 'Completed', tone: 'done', icon: 'check' });
    expect(jobState(job({ state: 'completed' }))).toEqual({ word: 'Completed', tone: 'done', icon: 'check' });
    expect(jobState(job({ state: 'queued' }))).toEqual({ word: 'Queued', tone: 'quiet', icon: 'clock' });
    expect(jobState(job({ state: 'retry_wait' }))).toEqual({ word: 'Retrying', tone: 'quiet', icon: 'clock' });
  });
  it('dates a job relative to now', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(relativeTime('2026-10-14T11:59:40Z', now)).toBe('Just now');
    expect(relativeTime('2026-10-14T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-14T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-13T09:00:00Z', now)).toBe('Yesterday');
    expect(relativeTime('2026-10-10T09:00:00Z', now)).toBe('4 days ago');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('getting ready panel', () => {
  const live = (over: Partial<Download> = {}): Download => ({ id: 'd', releaseId: 'r', trackerId: 't', trackerName: 'FileList', engineId: 'e', fileIndex: 0, filePath: 'a.mkv', mimeType: 'video/x-matroska', sizeBytes: 1000, state: 'downloading', progress: 0.37, playbackMode: 'progressive', downloadedBytes: 370, speedBytesPerSecond: 2_100_000, etaSeconds: 240, peers: 12, seeds: 9, leased: false, streamUrl: '/s', ...over });
  it('lists peers, speed and time left', () => expect(readyLine(live())).toBe('12 peers · 2.1 MB/s · 4 min left'));
  it('says one peer in the singular', () => expect(readyLine(live({ peers: 1, speedBytesPerSecond: 0, etaSeconds: 0 }))).toBe('1 peer'));
  it('omits every unknown part', () => expect(readyLine(live({ peers: 0, speedBytesPerSecond: 0, etaSeconds: 0 }))).toBe(''));
  it('rounds the percent and keeps it between 0 and 100', () => {
    expect(readyPercent(live())).toBe(37);
    expect(readyPercent(live({ progress: 4 }))).toBe(100);
    expect(readyPercent(live({ progress: -1 }))).toBe(0);
    expect(readyPercent(undefined)).toBe(0);
  });
  it('stays quiet during the first 15 seconds', () => expect(prepareHint(14, 7)).toBe(''));
  it('names the seeder count once it takes longer', () => expect(prepareHint(15, 7)).toBe('Still looking for peers. This release has 7 seeders, so it can take a little longer.'));
  it('uses the singular for one seeder', () => expect(prepareHint(20, 1)).toContain('1 seeder,'));
  it('omits the seeder count when it is unknown or zero', () => {
    expect(prepareHint(30)).toBe('Still looking for peers. It can take a little longer.');
    expect(prepareHint(30, 0)).toBe('Still looking for peers. It can take a little longer.');
  });
});

// The Player heading (#61): the show and episode code as a muted kicker over the episode name; a movie, or an
// episode the server has no name for, is one line. The server sends "Show · S01E04 · Name" as displayTitle.
describe('player heading', () => {
  const download = (displayTitle: string | undefined, parsed?: Partial<ParsedRelease>) => ({ displayTitle, filePath: 'files/v.mkv', parsed }) as unknown as Download;
  it('puts the show and code above the episode name', () => expect(playerHeading(download('Velvet Witness · S01E04 · The Lantern Room'))).toEqual({ kicker: 'Velvet Witness · S01E04', title: 'The Lantern Room' }));
  it('keeps a name that itself has a middle dot whole', () => expect(playerHeading(download('Velvet Witness · S01E04 · Part one · The Fall'))).toEqual({ kicker: 'Velvet Witness · S01E04', title: 'Part one · The Fall' }));
  it('adds the code from the parsed release when the title lacks it, on one line', () => expect(playerHeading(download('Velvet Witness', { seasonStart: 1, episodeStart: 4 }))).toEqual({ kicker: '', title: 'Velvet Witness · S01E04' }));
  it('keeps an episode without a name on one line', () => expect(playerHeading(download('Velvet Witness · S01E04-E05'))).toEqual({ kicker: '', title: 'Velvet Witness · S01E04-E05' }));
  it('shows a movie title alone', () => expect(playerHeading(download('Dune'))).toEqual({ kicker: '', title: 'Dune' }));
  it('falls back to the file name', () => expect(playerHeading(download(undefined))).toEqual({ kicker: '', title: 'files/v.mkv' }));
});

describe('remaining time', () => {
  it('counts down to the end with a minus sign', () => expect(remainingTime(17 * 60_000 + 51_000, 51 * 60_000)).toBe('\u221233:09'));
  it('is empty while the duration is unknown', () => expect(remainingTime(5000, 0)).toBe(''));
  it('never goes below zero', () => expect(remainingTime(70_000, 60_000)).toBe('\u22120:00'));
});
