import type { API } from '@torrent-tv/shared';

// Test doubles stub `title`; give them the conditional fetch the detail screen uses, with a constant ETag.
export function withETag(api: API): API {
  const stub = api as unknown as { title?: (id: string) => Promise<unknown>; titleIfChanged?: unknown };
  if (stub.title && !stub.titleIfChanged) stub.titleIfChanged = async (id: string) => ({ detail: await stub.title!(id), etag: '"test"' });
  return api;
}
