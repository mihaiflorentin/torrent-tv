import { describe, expect, it, vi } from 'vitest';
import { API } from './index';

describe('episode skipping client methods', () => {
  it('POST the sibling-episode routes with the encoded download id', async () => {
    const api = new API('http://server.test');
    const seen: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(api, 'call').mockImplementation(async (path: string, init?: RequestInit) => { seen.push({ path, init }); return null as never });
    await api.nextEpisode('a/b');
    await api.previousEpisode('a/b');
    expect(seen).toEqual([
      { path: '/downloads/a%2Fb/next-episode', init: { method: 'POST' } },
      { path: '/downloads/a%2Fb/previous-episode', init: { method: 'POST' } },
    ]);
  });
});
