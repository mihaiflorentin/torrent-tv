import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from './capability';

describe('capability detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports abort controller support when the feature is present', () => {
    expect(detectCapabilities({ abortController: true })).toEqual({ supportsAbortController: true });
  });

  it('reports no abort controller support when the feature is absent', () => {
    expect(detectCapabilities({ abortController: false })).toEqual({ supportsAbortController: false });
  });

  it('derives flags from runtime globals when no presence map is injected', () => {
    expect(detectCapabilities()).toEqual({ supportsAbortController: typeof AbortController === 'function' });
  });

  it('derives flags from runtime globals for an empty presence map', () => {
    expect(detectCapabilities({})).toEqual({ supportsAbortController: typeof AbortController === 'function' });
  });

  it('detects absence when the runtime global is missing', () => {
    vi.stubGlobal('AbortController', undefined);
    expect(detectCapabilities()).toEqual({ supportsAbortController: false });
  });
});

describe('lean graphics detection', () => {
  it('is on for the old TV Chromium builds', async () => {
    const { detectLeanGraphics } = await import('./capability');
    expect(detectLeanGraphics('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 Chrome/56.0.2924.0 TV Safari/537.36')).toBe(true);
    expect(detectLeanGraphics('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/53.0.2785.34 Safari/537.36')).toBe(true);
  });
  it('is off for modern or unidentified engines', async () => {
    const { detectLeanGraphics } = await import('./capability');
    expect(detectLeanGraphics('Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) Chrome/108.0.0.0 TV Safari/537.36')).toBe(false);
    expect(detectLeanGraphics('')).toBe(false);
  });
});
