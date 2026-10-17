// @vitest-environment happy-dom
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
  it('is on for every TV engine, however modern', async () => {
    const { detectLeanGraphics } = await import('./capability');
    expect(detectLeanGraphics('Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.6099.5/9.0 TV Safari/537.36')).toBe(true);
    expect(detectLeanGraphics('Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) Chrome/108.0.0.0 TV Safari/537.36')).toBe(true);
    expect(detectLeanGraphics('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/108.0.0.0 Safari/537.36')).toBe(true);
    expect(detectLeanGraphics('Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36')).toBe(true);
  });
  it('is off for modern desktop or unidentified engines', async () => {
    const { detectLeanGraphics } = await import('./capability');
    expect(detectLeanGraphics('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false);
    expect(detectLeanGraphics('')).toBe(false);
  });
});

describe('lean graphics root class', () => {
  const chromium = (major: number) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/${major}.0.0.0 Safari/537.36`;
  it('marks the root on an old engine and leaves a capable one unmarked', async () => {
    const { applyGraphicsClass, LEAN_GRAPHICS_CLASS } = await import('./capability');
    const lean = document.createElement('html');
    expect(applyGraphicsClass(lean, chromium(69))).toBe(true);
    expect(lean.classList.contains(LEAN_GRAPHICS_CLASS)).toBe(true);
    const capable = document.createElement('html');
    expect(applyGraphicsClass(capable, chromium(108))).toBe(false);
    expect(capable.classList.contains(LEAN_GRAPHICS_CLASS)).toBe(false);
  });
});
