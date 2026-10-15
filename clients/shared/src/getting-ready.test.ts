import { describe, expect, it } from 'vitest';
import { formatEtaLeft, prepareHint, readyLine, readyPercent, type Download } from './index';

// The "getting ready" wording shared by the web and TV clients: calm, and a fact that is not known yet is left out.
const live = (over: Partial<Download> = {}): Download => ({ id: 'd', releaseId: 'r', trackerId: 't', trackerName: 'FileList', engineId: 'e', fileIndex: 0, filePath: 'a.mkv', mimeType: 'video/x-matroska', sizeBytes: 1000, state: 'downloading', progress: 0.37, playbackMode: 'progressive', downloadedBytes: 370, speedBytesPerSecond: 2_100_000, etaSeconds: 240, peers: 12, seeds: 9, leased: false, streamUrl: '/s', ...over });

describe('getting ready text', () => {
  it('words the time left', () => {
    expect(formatEtaLeft(45)).toBe('45 s left');
    expect(formatEtaLeft(720)).toBe('12 min left');
    expect(formatEtaLeft(7500)).toBe('2 h 5 min left');
    expect(formatEtaLeft(0)).toBe('');
  });
  it('lists peers, speed and time left', () => expect(readyLine(live())).toBe('12 peers · 2.1 MB/s · 4 min left'));
  it('omits every unknown part', () => expect(readyLine(live({ peers: 0, speedBytesPerSecond: 0, etaSeconds: 0 }))).toBe(''));
  it('keeps the percent between 0 and 100', () => {
    expect(readyPercent(live())).toBe(37);
    expect(readyPercent(live({ progress: 4 }))).toBe(100);
    expect(readyPercent(undefined)).toBe(0);
  });
  it('stays quiet for 15 seconds, then names the seeders', () => {
    expect(prepareHint(14, 7)).toBe('');
    expect(prepareHint(15, 1)).toBe('Still looking for peers. This release has 1 seeder, so it can take a little longer.');
    expect(prepareHint(30)).toBe('Still looking for peers. It can take a little longer.');
  });
});
