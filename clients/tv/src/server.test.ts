import { describe, expect, it } from 'vitest';
import type { API } from '@torrent-tv/shared';
import { serverHost, trackerStatuses } from './server';

describe('the connected server', () => {
  it('is named by host and port, so the rail foot and Settings > Server agree', () => {
    expect(serverHost('http://192.168.1.20:8097')).toBe('192.168.1.20:8097');
    expect(serverHost('http://pi.local:8080/')).toBe('pi.local:8080');
    expect(serverHost('https://tv.example.org')).toBe('tv.example.org');
    expect(serverHost('not an address')).toBe('');
  });

  it('lists its trackers, or says it cannot (null) instead of throwing', async () => {
    const list = [{ id: 'filelist', name: 'FileList', enabled: true, configured: true }];
    expect(await trackerStatuses({ trackers: async () => list } as unknown as API)).toEqual(list);
    expect(await trackerStatuses({ call: async () => list } as unknown as API)).toEqual(list);
    expect(await trackerStatuses({ trackers: async () => { throw new Error('503'); } } as unknown as API)).toBeNull();
    expect(await trackerStatuses({ trackers: async () => ({ detail: 'odd' }) } as unknown as API)).toBeNull();
  });
});
