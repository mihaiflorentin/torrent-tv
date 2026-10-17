import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from './index';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), headers: new Headers(headers), json: async () => body });

describe('API.titleIfChanged', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends no If-None-Match on the first fetch and returns the detail with its ETag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { title: { id: 'a' }, seasons: [], sources: [] }, { ETag: '"v1"' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new API('http://tv.lan:8097').titleIfChanged('a b', '');
    expect(result).toMatchObject({ detail: { title: { id: 'a' } }, etag: '"v1"' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://tv.lan:8097/api/v1/catalog/titles/a%20b');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('If-None-Match');
  });

  it('sends the ETag back and returns null on 304 without reading the body', async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 304, statusText: 'Not Modified', headers: new Headers(), json });
    vi.stubGlobal('fetch', fetchMock);
    expect(await new API('http://tv.lan:8097').titleIfChanged('a', '"v1"')).toBeNull();
    expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBe('"v1"');
    expect(json).not.toHaveBeenCalled();
  });

  it('turns other failures into errors carrying the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, { detail: 'no such title' })));
    await expect(new API('http://tv.lan:8097').titleIfChanged('a', '')).rejects.toMatchObject({ message: 'no such title', status: 404 });
  });
});
