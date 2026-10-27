/**
 * Ticket #62: the startup page in the Night Screen look, checked on the shipped bytes. Each client's index.html
 * carries its own boot screen (the platform shells differ), and startup.js writes the boot messages into it, so
 * the tests read the HTML from disk and run the real ES5 script against it.
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, name), 'utf8');
const PAGES = ['../index.html', '../../webos/index.html', '../../android-tv/app/assets/index.html'];

// The boot screen as the page paints it: the inline style plus the #startup markup (no other script runs).
function paint(name: string) {
  const html = read(name);
  document.head.innerHTML = /<style>[\s\S]*?<\/style>/.exec(html)?.[0] ?? '';
  document.body.innerHTML = /<div id="startup">[\s\S]*?<\/div>\s*<div id="app">/.exec(html)?.[0].replace(/<div id="app">$/, '') ?? '';
  return document.getElementById('startup');
}
const style = (name: string) => /<style>([\s\S]*?)<\/style>/.exec(read(name))?.[1].replace(/\s+/g, ' ') ?? '';
const rule = (css: string, selector: string) => new RegExp(`${selector.replace(/[#.]/g, m => `\\${m}`)}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe.each(PAGES)('%s boot screen', name => {
  it('shows the app mark, a play shape, before the app name', () => {
    const startup = paint(name)!;
    const mark = startup.querySelector('#startup-mark');
    expect(mark, 'app mark').not.toBeNull();
    expect(mark!.querySelector('svg path')?.getAttribute('d')).toBe('M8 5.5v13l11-6.5z');
    expect(mark!.getAttribute('aria-hidden')).toBe('true');
    const order = Array.from(startup.children, child => child.id || child.tagName.toLowerCase());
    expect(order).toEqual(['startup-mark', 'h1', 'startup-message']);
  });

  it('keeps saffron on the mark only: a white name and a muted message on the ground', () => {
    const css = style(name);
    expect(rule(css, '#startup-mark')).toMatch(/background:\s*var\(--tt-accent,\s*#f2a93b\)/);
    expect(rule(css, '#startup h1')).toMatch(/color:\s*var\(--tt-text,\s*#f5f6f8\)/);
    expect(rule(css, '#startup h1')).not.toMatch(/--tt-accent/);
    expect(rule(css, '#startup-message')).toMatch(/color:\s*var\(--tt-text-muted,\s*#c9cdd6\)/);
  });

  it('draws nothing under the 26 px TV floor', () => {
    const sizes = Array.from(style(name).matchAll(/font-size:\s*(\d+)px/g), match => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(26);
  });
});

describe('startup.js boot messages', () => {
  const boot = () => (window as unknown as { FileListBoot: { stage(value: string): void; fail(error: unknown): void } }).FileListBoot;
  const message = () => document.getElementById('startup-message')!;

  it('says what is slow and what to do when the bundle takes too long', () => {
    vi.useFakeTimers();
    paint('../index.html');
    (0, eval)(read('../startup.js'));
    boot().stage('Loading application bundle');
    vi.advanceTimersByTime(8000);
    expect(message().textContent).toBe('Loading application bundle is taking longer than expected. If nothing changes, restart the app.');
  });

  it('names the failure in the danger colour with the cause and the next action', () => {
    paint('../index.html');
    (0, eval)(read('../startup.js'));
    boot().fail(new Error('app.js did not load'));
    expect(message().textContent).toBe('Application startup failed\n\napp.js did not load\n\nRestart the app; if it fails again, tell the household admin.');
    expect(message().style.color).toContain('--tt-danger');
  });
});
